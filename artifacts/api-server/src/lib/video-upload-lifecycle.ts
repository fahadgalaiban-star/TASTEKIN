import { db, videoUploads, type VideoUpload } from "@workspace/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

import {
  BUNNY_TUS_UPLOAD_ENDPOINT,
  createBunnyTusUploadAuthorization,
  getBunnyVideoStatus,
  type BunnyVideoMetadata,
} from "./bunny-stream";

/**
 * Video Foundation, Phase 2A — the upload-lifecycle rules layered on top of
 * the Phase 1 `video_uploads` ledger and Bunny Stream wrapper. Nothing here
 * ever routes video bytes through this API: a row only ever carries
 * metadata and Bunny identifiers, and the actual TUS byte transfer happens
 * directly between the client and Bunny using the one-time credentials
 * `issueTusUploadAuthorization` returns.
 */

export const VIDEO_UPLOAD_RATE_LIMIT_MAX = 20;
export const VIDEO_UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const VIDEO_UPLOAD_MAX_CONCURRENT = 3;
export const VIDEO_UPLOAD_MAX_DECLARED_BYTES = 4 * 1024 * 1024 * 1024;
export const VIDEO_UPLOAD_MAX_FILENAME_LENGTH = 255;
export const VIDEO_UPLOAD_ALLOWED_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/3gpp",
  "video/mpeg",
  "video/x-msvideo",
]);
export const VIDEO_UPLOAD_TUS_TTL_SECONDS = 60 * 60;
export const VIDEO_UPLOAD_RECONCILE_MIN_INTERVAL_MS = 5_000;
/** Seconds a client is told to wait before polling status while a duplicate request-upload call is in progress. */
export const VIDEO_UPLOAD_IN_PROGRESS_RETRY_AFTER_SECONDS = 2;

/**
 * "creating" is the brief, never-externally-visible window between the
 * durable intent row being inserted and Bunny's create-video call
 * resolving one way or another — its id is never returned to any client
 * until it leaves this state, so it is never itself a cancel target. It
 * exists so a genuinely concurrent duplicate request-upload call (see
 * reserveUploadIntent) can tell "someone else is creating this right now"
 * apart from "this key already resolved" without needing to hold a
 * transaction or advisory lock open across the Bunny network call.
 *
 * "create_ambiguous" and "orphan_cleanup_pending" exist because a create
 * timeout or connection loss can happen *after* Bunny actually created the
 * video but *before* this API learned its id — see finalizeCreateAmbiguous
 * and claimCancellation for exactly what that does and does not let us do
 * safely. Phase 2B is expected to add a periodic reconciliation job that
 * lists Bunny videos by library + title (see routes/video-uploads.ts's use
 * of the row's own id as the Bunny video title) to actually resolve these;
 * nothing in this phase attempts that.
 *
 * The full state list lives in @workspace/db's VIDEO_UPLOAD_STATES
 * (lib/db/src/schema/video-uploads.ts) — the column is plain, unconstrained
 * text with no DB CHECK, matching this repo's existing convention, so that
 * file is the single source of truth for which strings are valid.
 */

/** States reconcileWithBunny will ever touch — a row must have a confirmed bunny_video_id to be worth polling. */
const RECONCILE_ELIGIBLE_STATES = ["uploading", "processing"] as const;
/** States that count against a owner's concurrency limit — includes "creating" since that row is just as much an active slot as one already confirmed with Bunny. */
const CONCURRENCY_COUNTED_STATES = ["creating", "uploading", "processing"] as const;
/** States a normal (confirmed-created) cancel claim can move directly to "deletion_pending". "create_ambiguous" is handled separately — see claimCancellation. */
const NORMAL_CANCELLABLE_STATES = ["uploading", "processing", "ready", "failed", "delete_failed"] as const;
const MAX_ERROR_LENGTH = 200;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * bunny-stream.ts's own result "reason" strings are already a small, fixed,
 * safe vocabulary (never a raw provider response body, never a credential)
 * — this only adds a short local prefix and bounds the total length, the
 * same discipline closet-media-upload.ts's sanitizeErrorReason applies to
 * its own (much less constrained) raw JS Error inputs.
 */
export function sanitizeProviderError(prefix: string, reason: string): string {
  return `${prefix}: ${reason}`.slice(0, MAX_ERROR_LENGTH);
}

/**
 * bunny-stream.ts's createBunnyVideo can fail two structurally different
 * ways: a *definite* answer from Bunny (a non-2xx status, or a 2xx with an
 * unparseable/invalid body — "malformed response") means Bunny received
 * and processed the request, so nothing was created. A *transport*
 * failure ("timeout" or "network error", both raised from createBunnyVideo's
 * catch block, never from a response Bunny actually sent) means we cannot
 * tell whether Bunny received the request at all — see
 * finalizeCreateAmbiguous for what that distinction is used for.
 */
export const AMBIGUOUS_CREATE_REASONS = new Set(["timeout", "network error"]);

export type DeclaredMetadata = { fileName: string; sizeBytes: number; mimeType: string };

/**
 * Validates only what the client *claims* about the file it is about to
 * upload directly to Bunny — never proof of the real bytes, since this API
 * never sees them. Used purely for display and for the declared-size limit
 * below; the authoritative duration/width/height only ever come from
 * Bunny's own post-encode metadata (see reconcileWithBunny).
 */
export function validateDeclaredMetadata(body: unknown): DeclaredMetadata | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const fileName = typeof record.fileName === "string" ? record.fileName.trim() : "";
  if (!fileName || fileName.length > VIDEO_UPLOAD_MAX_FILENAME_LENGTH || /[\x00-\x1f]/.test(fileName)) return null;
  const sizeBytes = record.sizeBytes;
  if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > VIDEO_UPLOAD_MAX_DECLARED_BYTES) return null;
  const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim().toLowerCase() : "";
  if (!VIDEO_UPLOAD_ALLOWED_MIME_TYPES.has(mimeType)) return null;
  return { fileName, sizeBytes, mimeType };
}

function declaredMetadataMatches(row: VideoUpload, declared: DeclaredMetadata): boolean {
  return row.declaredFileName === declared.fileName
    && row.declaredSizeBytes === declared.sizeBytes
    && row.declaredMimeType === declared.mimeType;
}

/** undefined = header present but malformed (caller should 400); null = no key given (valid, no idempotency protection). */
export function parseIdempotencyKey(headerValue: unknown): string | null | undefined {
  if (headerValue === undefined) return null;
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_RE.test(value)) return undefined;
  return value;
}

async function reread(id: string, fallback: VideoUpload): Promise<VideoUpload> {
  const [current] = await db.select().from(videoUploads).where(eq(videoUploads.id, id));
  return current ?? fallback;
}

export async function getOwnedUpload(id: string, ownerUserId: string): Promise<VideoUpload | null> {
  const [row] = await db.select().from(videoUploads).where(and(eq(videoUploads.id, id), eq(videoUploads.ownerUserId, ownerUserId)));
  return row ?? null;
}

export type ReserveUploadIntentResult =
  | { outcome: "reserved"; row: VideoUpload }
  | { outcome: "in_progress"; row: VideoUpload }
  | { outcome: "idempotent_replay"; row: VideoUpload }
  | { outcome: "idempotency_conflict"; reason: "metadata_mismatch" | "resolved" }
  | { outcome: "rate_limited" }
  | { outcome: "concurrency_limited" };

/**
 * Persists the durable "upload intent" row *before* Bunny is ever
 * contacted — the row itself is the record that an attempt happened,
 * regardless of what Bunny goes on to say. Serialized per-owner via the
 * same pg_advisory_xact_lock idiom reserveUploadAttempt (closet-media
 * -upload.ts) uses — but that lock is held only for this INSERT
 * transaction, never across the Bunny network call that follows it in the
 * caller (routes/video-uploads.ts): a long-running or hung create call
 * must never block every other request-upload call for the same owner.
 *
 * That means a *second*, genuinely concurrent call with the same
 * Idempotency-Key can still arrive after this transaction commits but
 * before the first call's Bunny create request resolves. It will see the
 * row this transaction just inserted, still in "creating" — outcome
 * "in_progress" tells the caller to poll status shortly rather than
 * either creating a second Bunny video or being wrongly told the key is
 * burned.
 *
 * Once the winning call's create resolves (state becomes "uploading",
 * "failed", or "create_ambiguous"), the same key can be replayed exactly
 * once it's confirmed-in-flight ("uploading"/"processing" with a
 * bunny_video_id) — reusing it against any other resolution, or with
 * materially different declared metadata than the original call, is
 * refused so the caller is never handed credentials for a video that's
 * already done, already gone, or was never confirmed at all.
 */
export async function reserveUploadIntent(
  creatorId: string,
  ownerUserId: string,
  bunnyLibraryId: string,
  declared: DeclaredMetadata,
  idempotencyKey: string | null,
): Promise<ReserveUploadIntentResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`video-upload-intent:${ownerUserId}`}))`);

    if (idempotencyKey) {
      const [existing] = await tx.select().from(videoUploads)
        .where(and(eq(videoUploads.ownerUserId, ownerUserId), eq(videoUploads.idempotencyKey, idempotencyKey)));
      if (existing) {
        if (!declaredMetadataMatches(existing, declared)) {
          return { outcome: "idempotency_conflict" as const, reason: "metadata_mismatch" };
        }
        if (existing.state === "creating") {
          return { outcome: "in_progress" as const, row: existing };
        }
        if (existing.bunnyVideoId && (existing.state === "uploading" || existing.state === "processing")) {
          return { outcome: "idempotent_replay" as const, row: existing };
        }
        return { outcome: "idempotency_conflict" as const, reason: "resolved" };
      }
    }

    const since = new Date(Date.now() - VIDEO_UPLOAD_RATE_LIMIT_WINDOW_MS);
    const [{ count: recentCount }] = await tx.select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(videoUploads)
      .where(and(eq(videoUploads.ownerUserId, ownerUserId), gte(videoUploads.createdAt, since)));
    if (recentCount >= VIDEO_UPLOAD_RATE_LIMIT_MAX) return { outcome: "rate_limited" as const };

    const [{ count: inFlightCount }] = await tx.select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(videoUploads)
      .where(and(eq(videoUploads.ownerUserId, ownerUserId), inArray(videoUploads.state, [...CONCURRENCY_COUNTED_STATES])));
    if (inFlightCount >= VIDEO_UPLOAD_MAX_CONCURRENT) return { outcome: "concurrency_limited" as const };

    const [row] = await tx.insert(videoUploads).values({
      creatorId,
      ownerUserId,
      bunnyLibraryId,
      state: "creating",
      declaredFileName: declared.fileName,
      declaredSizeBytes: declared.sizeBytes,
      declaredMimeType: declared.mimeType,
      idempotencyKey,
    }).returning();
    return { outcome: "reserved" as const, row };
  });
}

/** Fenced to state = "creating": nothing else should legitimately be able to move a row out of "creating" concurrently. */
export async function finalizeCreateSuccess(id: string, ownerUserId: string, bunnyVideoId: string): Promise<VideoUpload | null> {
  const [row] = await db.update(videoUploads)
    .set({ state: "uploading", bunnyVideoId, updatedAt: new Date() })
    .where(and(eq(videoUploads.id, id), eq(videoUploads.ownerUserId, ownerUserId), eq(videoUploads.state, "creating")))
    .returning();
  return row ?? null;
}

/**
 * A *definite* Bunny rejection (a real HTTP response, just not a success)
 * — Bunny received the request and nothing was created, so this row can
 * safely be treated the same as a normal failure: cancelling it later
 * skips the Bunny delete call entirely (see routes/video-uploads.ts) and
 * physicalDeletion is honestly "completed", because there was never
 * anything on Bunny's side to delete.
 */
export async function finalizeCreateFailure(id: string, ownerUserId: string, reason: string): Promise<void> {
  await db.update(videoUploads)
    .set({
      state: "failed",
      lastError: sanitizeProviderError("create failed", reason),
      lastAttemptAt: new Date(),
      retryCount: sql`${videoUploads.retryCount} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(videoUploads.id, id), eq(videoUploads.ownerUserId, ownerUserId), eq(videoUploads.state, "creating")));
}

/**
 * A *transport* failure (timeout / connection loss) during create — Bunny
 * may or may not have actually created the video before the response was
 * lost. This is deliberately a different terminal state than "failed":
 * cancelling a "create_ambiguous" row must never claim physical deletion
 * is "completed" (see claimCancellation/routes/video-uploads.ts), because
 * that would be lying about a video that might still exist on Bunny's
 * side. The row's own id (used as the Bunny video title — see
 * routes/video-uploads.ts) and bunny_library_id remain the durable trail
 * a future reconciliation job (Phase 2B, not implemented here) would need
 * to find a matching orphan via Bunny's List Videos API.
 *
 * Same-key retries are refused exactly like a definite failure (see
 * reserveUploadIntent) — an ambiguous outcome is never silently retried
 * against the same row, since that risks a *second* untracked create on
 * top of a possible first one.
 */
export async function finalizeCreateAmbiguous(id: string, ownerUserId: string, reason: string): Promise<void> {
  await db.update(videoUploads)
    .set({
      state: "create_ambiguous",
      lastError: sanitizeProviderError("create outcome unresolved", reason),
      lastAttemptAt: new Date(),
      retryCount: sql`${videoUploads.retryCount} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(videoUploads.id, id), eq(videoUploads.ownerUserId, ownerUserId), eq(videoUploads.state, "creating")));
}

export type TusUploadAuthorization = {
  endpoint: string;
  libraryId: string;
  videoId: string;
  expirationTime: number;
  signature: string;
};

/**
 * Always signs against the row's *own* persisted bunny_library_id, never
 * the server's current BUNNY_STREAM_LIBRARY_ID env var — those must stay
 * in lockstep only at create time; a later library/key rotation on the
 * deployment must never silently invalidate (or worse, mis-sign) an
 * in-flight upload's credentials.
 */
export function issueTusUploadAuthorization(row: Pick<VideoUpload, "bunnyLibraryId" | "bunnyVideoId">): TusUploadAuthorization | null {
  if (!row.bunnyVideoId) return null;
  const result = createBunnyTusUploadAuthorization(row.bunnyVideoId, VIDEO_UPLOAD_TUS_TTL_SECONDS, { libraryId: row.bunnyLibraryId });
  if (result.status !== "ok") return null;
  return { ...result.authorization, endpoint: BUNNY_TUS_UPLOAD_ENDPOINT };
}

/**
 * The integer this reads (result.video.bunnyStatus, see bunny-stream.ts)
 * comes from Bunny's Get Video response body's own "status" field — this
 * is a REST resource-state field, not a webhook event-type payload, and
 * the two are not assumed interchangeable. Bunny's current Stream status
 * documentation enumerates (at minimum) 0-8 across contexts; only two
 * values are treated as authoritative and terminal here:
 *
 *  - 3 (Finished) plus valid positive duration/width/height => "ready".
 *  - 5 (Failed) => "failed", unconditionally.
 *
 * Every other numeric value — 0, 1, 2, 4, 6, 7, 8, and anything not yet
 * assigned a documented meaning — is treated as non-terminal and maps to
 * "processing" (0 is the sole exception: see NOT_YET_UPLOADED_STATUS,
 * which leaves state at "uploading" since Bunny hasn't received any bytes
 * yet). In particular, 6 is never treated as a failure here: it overlaps
 * with a documented *webhook* event code (PresignedUploadStarted) that is
 * clearly not a failure, and nothing available confirms whether the Get
 * Video resource-status field shares that exact numbering — so it is
 * deliberately routed to the same safe "processing" fallthrough as any
 * other unrecognized code, per the rule below: never make an irreversible
 * failed transition on a status code whose meaning for *this specific
 * field* is not established.
 */
const READY_STATUS = 3;
const KNOWN_FAILURE_STATUSES = new Set([5]);
const NOT_YET_UPLOADED_STATUS = 0;

function hasValidPlaybackMetadata(video: BunnyVideoMetadata): boolean {
  return Boolean(video.durationSeconds && video.durationSeconds > 0 && video.width && video.width > 0 && video.height && video.height > 0);
}

/**
 * Throttled, defensive reconciliation so a row's readiness never depends
 * on a future webhook (Phase 2's own scope): at most one Bunny status call
 * per row per VIDEO_UPLOAD_RECONCILE_MIN_INTERVAL_MS, claimed via a fenced
 * UPDATE (mirrors closet_media_uploads' cleanup-lease convention) so rapid
 * concurrent polling only ever makes one outbound call. Every write here
 * is fenced to `state IN (uploading, processing)`: if a concurrent cancel
 * already moved the row to deletion_pending/deleted, these updates affect
 * zero rows and the (already-cancelled) current row is re-read and
 * returned instead — a status poll can never revive a cancelled upload.
 *
 * See the status-code mapping comment above KNOWN_FAILURE_STATUSES for
 * exactly which codes are treated as terminal and why 6 deliberately is
 * not one of them despite superficially resembling a Bunny "failed" code
 * in some contexts.
 */
export async function reconcileWithBunny(row: VideoUpload): Promise<VideoUpload> {
  if (row.state !== "uploading" && row.state !== "processing") return row;
  if (!row.bunnyVideoId) return row;

  // VIDEO_UPLOAD_RECONCILE_MIN_INTERVAL_MS_OVERRIDE exists only so
  // regression tests can observe reconciliation without a real multi
  // -second wait — never set in any real environment, exactly like
  // bunny-stream.ts's BUNNY_STREAM_TIMEOUT_MS_OVERRIDE.
  const throttleMs = Number(process.env.VIDEO_UPLOAD_RECONCILE_MIN_INTERVAL_MS_OVERRIDE) || VIDEO_UPLOAD_RECONCILE_MIN_INTERVAL_MS;
  const throttleSince = new Date(Date.now() - throttleMs);
  const [claimed] = await db.update(videoUploads)
    .set({ lastReconciledAt: new Date() })
    .where(and(
      eq(videoUploads.id, row.id),
      eq(videoUploads.ownerUserId, row.ownerUserId),
      inArray(videoUploads.state, [...RECONCILE_ELIGIBLE_STATES]),
      sql`(${videoUploads.lastReconciledAt} is null or ${videoUploads.lastReconciledAt} < ${throttleSince})`,
    ))
    .returning();
  if (!claimed) return row;

  const result = await getBunnyVideoStatus(claimed.bunnyVideoId!, { libraryId: claimed.bunnyLibraryId });

  if (result.status !== "ok") {
    if (result.reason !== "not found") return claimed;
    const [updated] = await db.update(videoUploads)
      .set({ state: "failed", lastError: sanitizeProviderError("reconcile failed", "video not found on provider"), lastAttemptAt: new Date(), updatedAt: new Date() })
      .where(and(eq(videoUploads.id, claimed.id), inArray(videoUploads.state, [...RECONCILE_ELIGIBLE_STATES])))
      .returning();
    return updated ?? reread(claimed.id, claimed);
  }

  // Defense against a provider/proxy bug returning a different video's
  // data than the one we asked about — never trust it if identities
  // mismatch, and never change local state on the strength of it.
  if (result.video.videoId !== claimed.bunnyVideoId) return claimed;

  const bunnyStatus = result.video.bunnyStatus;
  if (bunnyStatus === NOT_YET_UPLOADED_STATUS) return claimed;

  if (KNOWN_FAILURE_STATUSES.has(bunnyStatus)) {
    const [updated] = await db.update(videoUploads)
      .set({ state: "failed", lastError: sanitizeProviderError("encoding failed", `provider status ${bunnyStatus}`), lastAttemptAt: new Date(), updatedAt: new Date() })
      .where(and(eq(videoUploads.id, claimed.id), inArray(videoUploads.state, [...RECONCILE_ELIGIBLE_STATES])))
      .returning();
    return updated ?? reread(claimed.id, claimed);
  }

  if (bunnyStatus === READY_STATUS && hasValidPlaybackMetadata(result.video)) {
    const [updated] = await db.update(videoUploads)
      .set({
        state: "ready",
        durationSeconds: result.video.durationSeconds,
        width: result.video.width,
        height: result.video.height,
        updatedAt: new Date(),
      })
      .where(and(eq(videoUploads.id, claimed.id), inArray(videoUploads.state, [...RECONCILE_ELIGIBLE_STATES])))
      .returning();
    return updated ?? reread(claimed.id, claimed);
  }

  if (claimed.state !== "processing") {
    const [updated] = await db.update(videoUploads)
      .set({ state: "processing", updatedAt: new Date() })
      .where(and(eq(videoUploads.id, claimed.id), inArray(videoUploads.state, [...RECONCILE_ELIGIBLE_STATES])))
      .returning();
    return updated ?? reread(claimed.id, claimed);
  }
  return claimed;
}

/**
 * Fenced claim: only a row not already mid-cancellation/cancelled can be
 * claimed, and it can be claimed exactly once per cancel attempt.
 * "create_ambiguous" rows are claimed through a separate branch into
 * "orphan_cleanup_pending" rather than "deletion_pending", since there is
 * no confirmed bunny_video_id to ever call Bunny's delete endpoint with —
 * see routes/video-uploads.ts for how the two are told apart and reported.
 */
export async function claimCancellation(id: string, ownerUserId: string): Promise<VideoUpload | null> {
  const [row] = await db.update(videoUploads)
    .set({ state: "deletion_pending", updatedAt: new Date() })
    .where(and(eq(videoUploads.id, id), eq(videoUploads.ownerUserId, ownerUserId), inArray(videoUploads.state, [...NORMAL_CANCELLABLE_STATES])))
    .returning();
  if (row) return row;

  const [ambiguousRow] = await db.update(videoUploads)
    .set({ state: "orphan_cleanup_pending", updatedAt: new Date() })
    .where(and(eq(videoUploads.id, id), eq(videoUploads.ownerUserId, ownerUserId), eq(videoUploads.state, "create_ambiguous")))
    .returning();
  return ambiguousRow ?? null;
}

export async function finalizeCancelDeleted(id: string, ownerUserId: string): Promise<VideoUpload> {
  const [row] = await db.update(videoUploads)
    .set({ state: "deleted", deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(videoUploads.id, id), eq(videoUploads.ownerUserId, ownerUserId), eq(videoUploads.state, "deletion_pending")))
    .returning();
  if (row) return row;
  const [current] = await db.select().from(videoUploads).where(eq(videoUploads.id, id));
  if (!current) throw new Error("video upload disappeared mid-cancel");
  return current;
}

/** Leaves the row in "delete_failed", not "deletion_pending" or "deleted" — a subsequent cancel call retries the Bunny delete (see NORMAL_CANCELLABLE_STATES). */
export async function finalizeCancelFailed(id: string, ownerUserId: string, reason: string): Promise<VideoUpload> {
  const [row] = await db.update(videoUploads)
    .set({
      state: "delete_failed",
      lastError: sanitizeProviderError("delete failed", reason),
      lastAttemptAt: new Date(),
      retryCount: sql`${videoUploads.retryCount} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(videoUploads.id, id), eq(videoUploads.ownerUserId, ownerUserId), eq(videoUploads.state, "deletion_pending")))
    .returning();
  if (row) return row;
  const [current] = await db.select().from(videoUploads).where(eq(videoUploads.id, id));
  if (!current) throw new Error("video upload disappeared mid-cancel");
  return current;
}

export function serializeVideoUpload(row: VideoUpload) {
  return {
    id: row.id,
    state: row.state,
    declaredFileName: row.declaredFileName,
    declaredSizeBytes: row.declaredSizeBytes,
    declaredMimeType: row.declaredMimeType,
    durationSeconds: row.durationSeconds,
    width: row.width,
    height: row.height,
    posterUrl: row.posterUrl,
    errorReason: row.errorReason ?? row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
