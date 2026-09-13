import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, videoUploads, type VideoUpload } from "@workspace/db";

import { deleteBunnyVideo, findOrphanCandidateByTitle } from "./bunny-stream";
import {
  claimCancellation,
  finalizeCancelDeleted,
  finalizeCancelFailed,
  finalizeCreateAmbiguous,
  reconcileWithBunny,
  sanitizeProviderError,
} from "./video-upload-lifecycle";

/**
 * Video Foundation, Phase 2B — bounded, retryable recovery for the four
 * ways a video_uploads row can be left in an unresolved or missed state:
 *
 *  - "creating" rows abandoned by a process that crashed or restarted
 *    before the original request ever learned whether Bunny's create call
 *    succeeded (reclaimStaleCreatingRows).
 *  - "create_ambiguous" / "orphan_cleanup_pending" rows, where a create
 *    timed out or lost its connection and Bunny may or may not have
 *    actually created the video (recoverAmbiguousUpload, via Bunny's List
 *    Videos API — see bunny-stream.ts's findOrphanCandidateByTitle).
 *  - "delete_failed" rows whose Bunny delete call needs retrying
 *    (retryFailedDeletions) — reuses Phase 2A's own already-atomic
 *    claimCancellation/finalizeCancelDeleted/finalizeCancelFailed
 *    directly; no new fencing needed here.
 *  - "uploading"/"processing" rows whose webhook was missed or never
 *    configured (reconcileStaleUploads) — reuses Phase 2A's
 *    reconcileWithBunny directly, which is already throttled and fenced.
 *
 * Only the first two need a lease of their own (recovery_lease_until /
 * recovery_lease_token, see lib/db's video-uploads.ts) — the other two
 * already have atomic, fenced primitives from Phase 2A that a scheduled
 * sweep can safely call exactly like a live request would.
 *
 * No path here ever holds a database transaction open across a Bunny
 * network call: every claim is a single short UPDATE, the provider call
 * happens with no transaction open, and finalization is a second single
 * UPDATE fenced by the lease token (or, for the reused Phase 2A
 * functions, by the state they already require).
 */

export const VIDEO_UPLOAD_RECOVERY_MAX_ATTEMPTS = 10;
export const VIDEO_UPLOAD_RECOVERY_LEASE_MS = 60_000;
export const VIDEO_UPLOAD_STALE_CREATING_MS = 5 * 60 * 1000;
export const VIDEO_UPLOAD_DELETE_RETRY_BACKOFF_MS = 5 * 60 * 1000;
export const VIDEO_UPLOAD_MISSED_WEBHOOK_THRESHOLD_MS = 2 * 60 * 1000;
export const VIDEO_UPLOAD_RECOVERY_SWEEP_LIMIT = 50;

/**
 * Every _OVERRIDE below exists only so regression tests can exercise
 * staleness/backoff/lease windows in milliseconds instead of real
 * minutes — never set in any real environment, exactly like
 * bunny-stream.ts's BUNNY_STREAM_TIMEOUT_MS_OVERRIDE.
 */
function envOverrideMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
function envOverrideCount(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

function maxRecoveryAttempts(): number {
  return envOverrideCount("VIDEO_UPLOAD_RECOVERY_MAX_ATTEMPTS_OVERRIDE", VIDEO_UPLOAD_RECOVERY_MAX_ATTEMPTS);
}

/** Claims a short lease on a row still in one of `expectedStates` — fails (returns null) if already leased, or if the row's state changed concurrently. */
async function claimRecoveryLease(id: string, ownerUserId: string, expectedStates: readonly string[]): Promise<VideoUpload | null> {
  const token = randomUUID();
  const leaseUntil = new Date(Date.now() + envOverrideMs("VIDEO_UPLOAD_RECOVERY_LEASE_MS_OVERRIDE", VIDEO_UPLOAD_RECOVERY_LEASE_MS));
  const [row] = await db.update(videoUploads)
    .set({ recoveryLeaseUntil: leaseUntil, recoveryLeaseToken: token, updatedAt: new Date() })
    .where(and(
      eq(videoUploads.id, id),
      eq(videoUploads.ownerUserId, ownerUserId),
      inArray(videoUploads.state, expectedStates),
      sql`(${videoUploads.recoveryLeaseUntil} is null or ${videoUploads.recoveryLeaseUntil} < now())`,
    ))
    .returning();
  return row ?? null;
}

/**
 * Finalizes a leased row — only if the lease token still matches (a
 * slower, since-superseded worker can never clobber a newer result) *and*
 * the row is still in the exact state it was in when the lease was
 * claimed. That second condition is what fences this against a concurrent
 * cancel: claimCancellation (video-upload-lifecycle.ts) moves
 * "create_ambiguous" -> "orphan_cleanup_pending" without touching the
 * lease columns at all, so without this state check a recovery decision
 * made for "create_ambiguous" (e.g. adopting a found video back into
 * "uploading") could silently overwrite a cancellation that landed while
 * the Bunny lookup was in flight — reviving a row the user just cancelled.
 * If the state moved, this update affects 0 rows: the lease is left to
 * expire on its own (bounded by VIDEO_UPLOAD_RECOVERY_LEASE_MS) and the
 * next sweep re-claims the row in whatever state it actually ended up in.
 */
async function finalizeRecovery(id: string, ownerUserId: string, token: string, expectedState: string, updates: Record<string, unknown>): Promise<VideoUpload | null> {
  const [row] = await db.update(videoUploads)
    .set({ ...updates, recoveryLeaseUntil: null, recoveryLeaseToken: null, updatedAt: new Date() })
    .where(and(
      eq(videoUploads.id, id),
      eq(videoUploads.ownerUserId, ownerUserId),
      eq(videoUploads.recoveryLeaseToken, token),
      eq(videoUploads.state, expectedState),
    ))
    .returning();
  return row ?? null;
}

/** Releases a lease without resolving the row — used when the lookup itself was inconclusive (ambiguous/unavailable), so the next sweep can try again. Same concurrent-cancel fence as finalizeRecovery, for the same reason. */
async function releaseRecoveryLease(id: string, ownerUserId: string, token: string, expectedState: string, reason: string): Promise<void> {
  await db.update(videoUploads)
    .set({
      recoveryLeaseUntil: null,
      recoveryLeaseToken: null,
      lastError: sanitizeProviderError("recovery lookup unresolved", reason),
      lastAttemptAt: new Date(),
      retryCount: sql`${videoUploads.retryCount} + 1`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(videoUploads.id, id),
      eq(videoUploads.ownerUserId, ownerUserId),
      eq(videoUploads.recoveryLeaseToken, token),
      eq(videoUploads.state, expectedState),
    ));
}

export type AmbiguousRecoveryOutcome = "resolved" | "unresolved" | "skipped";

/**
 * Resolves one "create_ambiguous" or "orphan_cleanup_pending" row by
 * searching Bunny's library for a video whose title exactly equals this
 * row's own id (see routes/video-uploads.ts — the title is always the
 * upload's stable internal UUID, never the user's filename, precisely so
 * this match can be exact instead of a filename-based guess).
 *
 *  - Confirmed absent (no match after full pagination): a
 *    "create_ambiguous" row becomes "failed" (nothing was ever created);
 *    an "orphan_cleanup_pending" row becomes "deleted" (nothing needed
 *    deleting — the cancel the user asked for is now confirmed complete).
 *  - Confirmed present (exactly one match): a "create_ambiguous" row
 *    adopts the discovered id and returns to normal "uploading" flow — a
 *    later reconcile call brings its status fully up to date. An
 *    "orphan_cleanup_pending" row is deleted now that its id is finally
 *    known, following the exact same ok/failed split as a live cancel.
 *  - Anything else (multiple matches, a provider error, or incomplete
 *    pagination) leaves the row exactly as it was — still unresolved,
 *    never guessed at — with its attempt count bumped so a bounded number
 *    of future sweeps can keep trying.
 */
export async function recoverAmbiguousUpload(row: Pick<VideoUpload, "id" | "ownerUserId" | "state" | "bunnyLibraryId" | "retryCount">): Promise<AmbiguousRecoveryOutcome> {
  if (row.state !== "create_ambiguous" && row.state !== "orphan_cleanup_pending") return "skipped";
  if (row.retryCount >= maxRecoveryAttempts()) return "skipped";

  const claimed = await claimRecoveryLease(row.id, row.ownerUserId, [row.state]);
  if (!claimed || !claimed.recoveryLeaseToken) return "skipped";
  const token = claimed.recoveryLeaseToken;

  const lookup = await findOrphanCandidateByTitle(claimed.bunnyLibraryId, claimed.id);

  if (lookup.status === "not_found") {
    if (claimed.state === "create_ambiguous") {
      await finalizeRecovery(claimed.id, claimed.ownerUserId, token, claimed.state, {
        state: "failed",
        lastError: sanitizeProviderError("recovery", "no matching video found on provider"),
        lastAttemptAt: new Date(),
      });
    } else {
      await finalizeRecovery(claimed.id, claimed.ownerUserId, token, claimed.state, { state: "deleted", deletedAt: new Date() });
    }
    return "resolved";
  }

  if (lookup.status === "found") {
    if (claimed.state === "create_ambiguous") {
      await finalizeRecovery(claimed.id, claimed.ownerUserId, token, claimed.state, {
        state: "uploading",
        bunnyVideoId: lookup.videoId,
        lastError: null,
      });
    } else {
      const deleted = await deleteBunnyVideo(lookup.videoId, { libraryId: claimed.bunnyLibraryId });
      if (deleted.status === "ok") {
        await finalizeRecovery(claimed.id, claimed.ownerUserId, token, claimed.state, { state: "deleted", bunnyVideoId: lookup.videoId, deletedAt: new Date() });
      } else {
        await finalizeRecovery(claimed.id, claimed.ownerUserId, token, claimed.state, {
          state: "delete_failed",
          bunnyVideoId: lookup.videoId,
          lastError: sanitizeProviderError("recovery delete failed", deleted.reason),
          lastAttemptAt: new Date(),
          retryCount: sql`${videoUploads.retryCount} + 1`,
        });
      }
    }
    return "resolved";
  }

  const reason = lookup.status === "ambiguous" ? `multiple candidates (${lookup.count})` : lookup.reason;
  await releaseRecoveryLease(claimed.id, claimed.ownerUserId, token, claimed.state, reason);
  return "unresolved";
}

/**
 * A "creating" row whose original request-upload call never resolved it
 * (a process crash/restart between the intent insert and the Bunny create
 * call completing) is treated exactly like an ambiguous create — we
 * cannot tell whether Bunny received that request or not, so it moves to
 * "create_ambiguous" for recoverAmbiguousUpload to eventually resolve.
 * The threshold is comfortably longer than BUNNY_STREAM_TIMEOUT_MS, so
 * anything still "creating" this long was abandoned, not merely slow.
 */
export async function reclaimStaleCreatingRows(limit = VIDEO_UPLOAD_RECOVERY_SWEEP_LIMIT): Promise<{ reclaimed: number }> {
  const staleBefore = new Date(Date.now() - envOverrideMs("VIDEO_UPLOAD_STALE_CREATING_MS_OVERRIDE", VIDEO_UPLOAD_STALE_CREATING_MS));
  const staleRows = await db.select({ id: videoUploads.id, ownerUserId: videoUploads.ownerUserId })
    .from(videoUploads)
    .where(and(eq(videoUploads.state, "creating"), lt(videoUploads.createdAt, staleBefore)))
    .limit(limit);
  for (const row of staleRows) {
    // Fenced to state = "creating" inside finalizeCreateAmbiguous itself —
    // a no-op if the original request resolved it in the meantime.
    await finalizeCreateAmbiguous(row.id, row.ownerUserId, "stale: process interrupted before create resolved");
  }
  return { reclaimed: staleRows.length };
}

/**
 * Retries the Bunny delete call for "delete_failed" rows — identical to
 * what a live, repeated POST /cancel call already does (see
 * routes/video-uploads.ts), just triggered by a sweep instead of an HTTP
 * request. claimCancellation's own fenced UPDATE is what prevents this
 * from racing a concurrent live cancel call or another sweep instance.
 */
export async function retryFailedDeletions(limit = VIDEO_UPLOAD_RECOVERY_SWEEP_LIMIT): Promise<{ attempted: number; resolved: number }> {
  const retryBefore = new Date(Date.now() - envOverrideMs("VIDEO_UPLOAD_DELETE_RETRY_BACKOFF_MS_OVERRIDE", VIDEO_UPLOAD_DELETE_RETRY_BACKOFF_MS));
  const candidates = await db.select().from(videoUploads)
    .where(and(
      eq(videoUploads.state, "delete_failed"),
      lt(videoUploads.retryCount, maxRecoveryAttempts()),
      or(isNull(videoUploads.lastAttemptAt), lt(videoUploads.lastAttemptAt, retryBefore)),
    ))
    .limit(limit);

  let attempted = 0;
  let resolved = 0;
  for (const candidate of candidates) {
    attempted += 1;
    const claimed = await claimCancellation(candidate.id, candidate.ownerUserId);
    if (!claimed || !claimed.bunnyVideoId) continue; // raced by a concurrent live cancel, or somehow lost its video id — skip, next sweep re-checks
    const deleted = await deleteBunnyVideo(claimed.bunnyVideoId, { libraryId: claimed.bunnyLibraryId });
    if (deleted.status === "ok") {
      await finalizeCancelDeleted(claimed.id, claimed.ownerUserId);
      resolved += 1;
    } else {
      await finalizeCancelFailed(claimed.id, claimed.ownerUserId, deleted.reason);
    }
  }
  return { attempted, resolved };
}

/**
 * Re-polls "uploading"/"processing" rows that haven't been reconciled
 * recently — the safety net for a missed, failed, or never-configured
 * webhook delivery. Reuses reconcileWithBunny directly, which is already
 * throttled (VIDEO_UPLOAD_RECONCILE_MIN_INTERVAL_MS) and fenced against a
 * concurrent cancel — calling it from a sweep is exactly as safe as a
 * live GET /:id call.
 */
export async function reconcileStaleUploads(limit = VIDEO_UPLOAD_RECOVERY_SWEEP_LIMIT): Promise<{ checked: number }> {
  const staleBefore = new Date(Date.now() - envOverrideMs("VIDEO_UPLOAD_MISSED_WEBHOOK_THRESHOLD_MS_OVERRIDE", VIDEO_UPLOAD_MISSED_WEBHOOK_THRESHOLD_MS));
  const candidates = await db.select().from(videoUploads)
    .where(and(
      inArray(videoUploads.state, ["uploading", "processing"]),
      or(isNull(videoUploads.lastReconciledAt), lt(videoUploads.lastReconciledAt, staleBefore)),
    ))
    .limit(limit);
  for (const candidate of candidates) await reconcileWithBunny(candidate);
  return { checked: candidates.length };
}

export type VideoUploadRecoverySummary = {
  staleCreatingReclaimed: number;
  ambiguousProcessed: number;
  ambiguousResolved: number;
  deletionRetriesAttempted: number;
  deletionRetriesResolved: number;
  missedWebhookChecked: number;
};

/** Runs every bounded recovery sweep once, in a safe order (reclaim stale intents first, so they're immediately eligible for the same-pass ambiguous sweep). Suitable for a scheduled runner — see scripts/src/reconcile-video-uploads.ts. No live schedule is configured by this phase. */
export async function runVideoUploadRecovery(limit = VIDEO_UPLOAD_RECOVERY_SWEEP_LIMIT): Promise<VideoUploadRecoverySummary> {
  const { reclaimed: staleCreatingReclaimed } = await reclaimStaleCreatingRows(limit);

  const ambiguousCandidates = await db.select().from(videoUploads)
    .where(and(
      inArray(videoUploads.state, ["create_ambiguous", "orphan_cleanup_pending"]),
      lt(videoUploads.retryCount, maxRecoveryAttempts()),
      sql`(${videoUploads.recoveryLeaseUntil} is null or ${videoUploads.recoveryLeaseUntil} < now())`,
    ))
    .limit(limit);
  let ambiguousResolved = 0;
  for (const candidate of ambiguousCandidates) {
    const outcome = await recoverAmbiguousUpload(candidate);
    if (outcome === "resolved") ambiguousResolved += 1;
  }

  const { attempted: deletionRetriesAttempted, resolved: deletionRetriesResolved } = await retryFailedDeletions(limit);
  const { checked: missedWebhookChecked } = await reconcileStaleUploads(limit);

  return {
    staleCreatingReclaimed,
    ambiguousProcessed: ambiguousCandidates.length,
    ambiguousResolved,
    deletionRetriesAttempted,
    deletionRetriesResolved,
    missedWebhookChecked,
  };
}

export type WebhookReconcileOutcome = "reconciled" | "not_found" | "identity_mismatch";

/**
 * The webhook handler's only lifecycle action: look the row up strictly
 * by its unique bunny_video_id, confirm the claimed library matches (so a
 * misrouted or cross-library delivery is never acted on), and re-fetch
 * authoritative state via the exact same reconcileWithBunny polling
 * already uses — the webhook payload's own Status field is never read
 * for the decision (see bunny-stream.ts's header comment on why a
 * webhook event code and a Get Video resource-status code are not
 * assumed interchangeable). This also gets duplicate/late/out-of-order
 * delivery safety for free: reconcileWithBunny already no-ops for any
 * row not in ("uploading","processing"), so a webhook that arrives after
 * the row has already moved to "ready"/"failed"/"deleted"/cancelled can
 * never revive it.
 */
export async function reconcileFromWebhook(bunnyLibraryId: string, bunnyVideoId: string): Promise<WebhookReconcileOutcome> {
  const [row] = await db.select().from(videoUploads).where(eq(videoUploads.bunnyVideoId, bunnyVideoId));
  if (!row) return "not_found";
  if (row.bunnyLibraryId !== bunnyLibraryId) return "identity_mismatch";
  await reconcileWithBunny(row);
  return "reconciled";
}
