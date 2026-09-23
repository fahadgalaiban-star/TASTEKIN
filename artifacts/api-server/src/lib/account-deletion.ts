/**
 * Permanent account deletion (App Store / Google Play requirement).
 *
 * Design (see docs/ACCOUNT-DELETION.md for the operator view):
 *
 * 1. One database transaction, serialized per account with the same advisory
 *    lock ensureCreatorAccount() uses, removes the `users` row and every row
 *    that refers to the account — both the foreign-keyed tables (which
 *    cascade or set null on their own) and the plain-text references that
 *    have no FK (likes, saves, comments, follows, views, conversations, the
 *    creator workspace, upload ledgers, taste preferences, verification
 *    application). Every web cookie session and native bearer token is gone
 *    once the transaction commits, so nothing can act as the account again.
 * 2. Media that lives outside Postgres (private object storage for creator
 *    photos and My Things photos, Bunny Stream for videos) is deleted AFTER
 *    the commit, best-effort, using the same durable ledger states the rest of
 *    the app already relies on: a failed delete leaves the row in
 *    `delete_failed` for the existing sweeps (reconcile:closet-media, the
 *    video recovery sweep) — the account itself is already gone either way.
 *
 * What is deliberately retained: moderation and safety records (reports,
 * moderation_audit_log) and the feature-flag audit log keep their opaque
 * internal ids, which no longer resolve to anyone once the users row is
 * deleted. Anonymous product-analytics rows keep a null user id (the FK sets
 * it null).
 *
 * Refusals (never partial deletions): an administrator account, or an
 * account that authored feature-flag audit entries (a NOT NULL foreign key
 * with no ON DELETE action), is refused with a clear reason so an operator
 * can hand the role over first — an audit trail is never destroyed to make
 * a delete succeed.
 */
import {
  closetMediaUploads,
  conversationMessages,
  conversations,
  creatorFeaturedCollections,
  creatorFollows,
  creatorMediaUploads,
  creatorViewEvents,
  creatorWorkspaces,
  db,
  editComments,
  editLikes,
  editSaves,
  featureFlagAuditLog,
  featureFlags,
  nativeSessionsTable,
  savedListItems,
  savedLists,
  sessionsTable,
  usersTable,
  userTastePreferences,
  verificationApplications,
  videoUploads,
} from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";

import { deleteBunnyVideo } from "./bunny-stream";
import { deleteClosetMedia, deletePrivateMedia } from "./private-media-storage";
import { finalizeCancelDeleted, finalizeCancelFailed } from "./video-upload-lifecycle";

/** The exact confirmation token the client must send — a typed acknowledgement, never a bare boolean. */
export const ACCOUNT_DELETION_CONFIRMATION = "DELETE";

const PRIVATE_OBJECT_PATH = /^\/objects\/uploads\/[0-9a-fA-F-]{36}$/;
const CLOSET_OBJECT_PATH = /^\/objects\/closet\/[0-9a-fA-F-]{36}$/;

export type AccountDeletionRefusal =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "admin" }
  | { ok: false; reason: "audit_trail" };

export type AccountDeletionPlan = {
  userId: string;
  creatorId: string | null;
  /** Private creator photos (object paths) to delete from storage after commit. */
  creatorObjectPaths: string[];
  /** My Things ledger rows claimed for deletion, with their object keys. */
  closetMedia: Array<{ id: string; imageObjectKey: string }>;
  /** Bunny videos claimed for deletion. */
  videos: Array<{ id: string; bunnyVideoId: string; bunnyLibraryId: string }>;
};

export type AccountDeletionResult =
  | AccountDeletionRefusal
  | { ok: true; plan: AccountDeletionPlan; mediaCleanup: "completed" | "pending" | "none" };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function objectPathsReferencedByWorkspace(workspace: typeof creatorWorkspaces.$inferSelect): string[] {
  const paths = new Set<string>();
  for (const edit of workspace.edits as Array<Record<string, unknown>>) {
    for (const value of [edit.sourceImage, edit.image, edit.previewImage]) if (typeof value === "string" && PRIVATE_OBJECT_PATH.test(value)) paths.add(value);
  }
  for (const collection of workspace.collections as Array<Record<string, unknown>>) {
    if (typeof collection.coverImageObjectPath === "string" && PRIVATE_OBJECT_PATH.test(collection.coverImageObjectPath)) paths.add(collection.coverImageObjectPath);
    if (typeof collection.coverImage === "string" && PRIVATE_OBJECT_PATH.test(collection.coverImage)) paths.add(collection.coverImage);
    if (Array.isArray(collection.uploads)) {
      for (const upload of collection.uploads as Array<{ image?: unknown; imageObjectPath?: unknown }>) {
        for (const value of [upload.image, upload.imageObjectPath]) if (typeof value === "string" && PRIVATE_OBJECT_PATH.test(value)) paths.add(value);
      }
    }
  }
  for (const value of [workspace.profile?.avatar, workspace.profile?.coverImage]) if (typeof value === "string" && PRIVATE_OBJECT_PATH.test(value)) paths.add(value);
  return Array.from(paths);
}

function editIdsOf(workspace: typeof creatorWorkspaces.$inferSelect): string[] {
  return (workspace.edits as Array<{ id?: unknown }>).map((edit) => edit.id).filter((id): id is string => typeof id === "string");
}

/**
 * Everything inside the transaction. Returns the media plan for the caller
 * to execute after commit, or a refusal (in which case nothing was changed —
 * the transaction is rolled back by throwing inside db.transaction only on
 * errors, so refusals are returned before any write).
 */
async function deleteAccountRows(tx: Tx, userId: string): Promise<AccountDeletionRefusal | { ok: true; plan: AccountDeletionPlan }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tastekin-account:${userId}`}))`);

  const [account] = await tx.select({ id: usersTable.id, isAdmin: usersTable.isAdmin }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!account) return { ok: false, reason: "not_found" };
  if (account.isAdmin) return { ok: false, reason: "admin" };
  const [auditRows] = await tx.select({ count: sql<number>`count(*)::int` }).from(featureFlagAuditLog).where(eq(featureFlagAuditLog.adminUserId, userId));
  if (Number(auditRows?.count ?? 0) > 0) return { ok: false, reason: "audit_trail" };

  // ---- credentials first: nothing may act as this account from here on ----
  await tx.update(nativeSessionsTable).set({ revokedAt: new Date(), revokedReason: "account_deleted" })
    .where(and(eq(nativeSessionsTable.userId, userId), isNull(nativeSessionsTable.revokedAt)));
  await tx.delete(sessionsTable).where(sql`${sessionsTable.sess}->'user'->>'id' = ${userId}`);

  // ---- creator workspace and everything keyed by its Edits ----
  const [workspace] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.ownerUserId, userId)).limit(1);
  const creatorObjectPaths = new Set<string>();
  let creatorId: string | null = null;
  if (workspace) {
    creatorId = workspace.creatorId;
    for (const path of objectPathsReferencedByWorkspace(workspace)) creatorObjectPaths.add(path);
    const editIds = editIdsOf(workspace);
    if (editIds.length) {
      await tx.delete(editLikes).where(inArray(editLikes.editId, editIds));
      await tx.delete(editSaves).where(inArray(editSaves.editId, editIds));
      await tx.delete(editComments).where(inArray(editComments.editId, editIds));
      await tx.delete(savedListItems).where(inArray(savedListItems.editId, editIds));
    }
    await tx.delete(creatorViewEvents).where(eq(creatorViewEvents.creatorId, workspace.creatorId));
    await tx.delete(creatorFollows).where(eq(creatorFollows.creatorId, workspace.creatorId));
    await tx.delete(creatorFeaturedCollections).where(eq(creatorFeaturedCollections.creatorId, workspace.creatorId));
    // my_circle_memberships.creator_id cascades from this delete.
    await tx.delete(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, workspace.creatorId));
  }
  // Upload ledger rows owned by the account (pending or committed) — the
  // objects themselves are removed after commit; the rows are marked here so
  // a crash between commit and cleanup still leaves a durable record.
  const uploadRows = await tx.select({ objectPath: creatorMediaUploads.objectPath }).from(creatorMediaUploads)
    .where(and(eq(creatorMediaUploads.ownerUserId, userId), notInArray(creatorMediaUploads.state, ["deleted"])));
  for (const row of uploadRows) if (PRIVATE_OBJECT_PATH.test(row.objectPath)) creatorObjectPaths.add(row.objectPath);
  if (uploadRows.length) {
    await tx.update(creatorMediaUploads).set({ state: "deleting", updatedAt: new Date() })
      .where(and(eq(creatorMediaUploads.ownerUserId, userId), notInArray(creatorMediaUploads.state, ["deleted"])));
  }

  // ---- the account's own engagement and personal data (no FK) ----
  await tx.delete(editLikes).where(eq(editLikes.userId, userId));
  await tx.delete(editSaves).where(eq(editSaves.userId, userId));
  await tx.delete(editComments).where(eq(editComments.userId, userId));
  await tx.delete(savedLists).where(eq(savedLists.userId, userId)); // saved_list_items cascade
  await tx.delete(creatorFollows).where(eq(creatorFollows.followerUserId, userId));
  await tx.update(creatorViewEvents).set({ viewerUserId: null }).where(eq(creatorViewEvents.viewerUserId, userId));
  await tx.delete(userTastePreferences).where(eq(userTastePreferences.userId, userId));
  await tx.delete(verificationApplications).where(eq(verificationApplications.userId, userId));

  // ---- private messages: every conversation the account took part in ----
  const threads = await tx.select({ id: conversations.id }).from(conversations)
    .where(or(eq(conversations.participantA, userId), eq(conversations.participantB, userId)));
  const threadIds = threads.map((thread) => thread.id);
  if (threadIds.length) {
    await tx.delete(conversationMessages).where(inArray(conversationMessages.conversationId, threadIds));
    await tx.delete(conversations).where(inArray(conversations.id, threadIds));
  }

  // ---- My Things photos: claim every ledger row that still has an object ----
  const closetRows = await tx.update(closetMediaUploads)
    .set({ state: "deletion_pending", updatedAt: new Date() })
    .where(and(
      eq(closetMediaUploads.ownerUserId, userId),
      isNotNull(closetMediaUploads.imageObjectKey),
      notInArray(closetMediaUploads.state, ["deleted", "deletion_pending", "cleanup_in_progress"]),
    ))
    .returning({ id: closetMediaUploads.id, imageObjectKey: closetMediaUploads.imageObjectKey });
  // closet_items cascade from the users delete below; closet_media_uploads
  // keep the row (owner set null by its FK) as the durable cleanup record.

  // ---- Bunny videos: claim every row with a confirmed provider id ----
  const videoRows = await tx.update(videoUploads)
    .set({ state: "deletion_pending", attachedEditId: null, declaredFileName: null, updatedAt: new Date() })
    .where(and(
      eq(videoUploads.ownerUserId, userId),
      isNotNull(videoUploads.bunnyVideoId),
      notInArray(videoUploads.state, ["deleted", "deletion_pending", "orphan_cleanup_pending"]),
    ))
    .returning({ id: videoUploads.id, bunnyVideoId: videoUploads.bunnyVideoId, bunnyLibraryId: videoUploads.bunnyLibraryId });
  // A create that never confirmed a provider id has nothing to delete; an
  // ambiguous one is handed to the existing orphan-recovery sweep.
  await tx.update(videoUploads).set({ state: "orphan_cleanup_pending", attachedEditId: null, declaredFileName: null, updatedAt: new Date() })
    .where(and(eq(videoUploads.ownerUserId, userId), eq(videoUploads.state, "create_ambiguous")));

  // ---- the two feature-flag references (FKs without ON DELETE) ----
  await tx.update(featureFlags).set({ updatedByUserId: null }).where(eq(featureFlags.updatedByUserId, userId));

  // ---- finally the account row; FK cascades/set-nulls handle the rest ----
  await tx.delete(usersTable).where(eq(usersTable.id, userId));

  return {
    ok: true,
    plan: {
      userId,
      creatorId,
      creatorObjectPaths: Array.from(creatorObjectPaths),
      closetMedia: closetRows.filter((row): row is { id: string; imageObjectKey: string } => typeof row.imageObjectKey === "string" && CLOSET_OBJECT_PATH.test(row.imageObjectKey)),
      videos: videoRows.filter((row): row is { id: string; bunnyVideoId: string; bunnyLibraryId: string } => typeof row.bunnyVideoId === "string"),
    },
  };
}

/** Post-commit, best-effort physical cleanup. Never throws; reports whether everything completed. */
async function cleanupMedia(plan: AccountDeletionPlan, log: { error: (obj: object, msg: string) => void }): Promise<"completed" | "pending" | "none"> {
  let pending = false;
  let attempted = 0;

  for (const objectPath of plan.creatorObjectPaths) {
    attempted += 1;
    try {
      await deletePrivateMedia(objectPath);
      await db.update(creatorMediaUploads).set({ state: "deleted", updatedAt: new Date() }).where(eq(creatorMediaUploads.objectPath, objectPath));
    } catch (error) {
      pending = true;
      log.error({ err: error, objectPath }, "Account deletion: private creator media could not be deleted");
      await db.update(creatorMediaUploads).set({ state: "delete_failed", updatedAt: new Date() }).where(eq(creatorMediaUploads.objectPath, objectPath)).catch(() => undefined);
    }
  }

  for (const row of plan.closetMedia) {
    attempted += 1;
    try {
      await deleteClosetMedia(row.imageObjectKey);
      await db.update(closetMediaUploads).set({ state: "deleted", deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(closetMediaUploads.id, row.id), eq(closetMediaUploads.state, "deletion_pending")));
    } catch (error) {
      pending = true;
      log.error({ err: error, ledgerId: row.id }, "Account deletion: closet media could not be deleted");
      await db.update(closetMediaUploads)
        .set({ state: "delete_failed", retryCount: sql`${closetMediaUploads.retryCount} + 1`, lastError: "delete failed: account deletion", lastAttemptAt: new Date(), updatedAt: new Date() })
        .where(and(eq(closetMediaUploads.id, row.id), eq(closetMediaUploads.state, "deletion_pending")))
        .catch(() => undefined);
    }
  }

  for (const video of plan.videos) {
    attempted += 1;
    try {
      const deleted = await deleteBunnyVideo(video.bunnyVideoId, { libraryId: video.bunnyLibraryId });
      if (deleted.status === "ok") await finalizeCancelDeleted(video.id, plan.userId);
      else { pending = true; await finalizeCancelFailed(video.id, plan.userId, deleted.reason); }
    } catch (error) {
      pending = true;
      log.error({ err: error, videoUploadId: video.id }, "Account deletion: video could not be deleted");
      await finalizeCancelFailed(video.id, plan.userId, "account deletion").catch(() => undefined);
    }
  }

  if (attempted === 0) return "none";
  return pending ? "pending" : "completed";
}

export async function deleteAccount(userId: string, log: { error: (obj: object, msg: string) => void }): Promise<AccountDeletionResult> {
  const outcome = await db.transaction(async (tx) => deleteAccountRows(tx, userId));
  if (!outcome.ok) return outcome;
  const mediaCleanup = await cleanupMedia(outcome.plan, log);
  return { ok: true, plan: outcome.plan, mediaCleanup };
}
