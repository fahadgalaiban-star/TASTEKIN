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

const IN_FLIGHT_STATES = ["uploading", "processing"] as const;
const CANCELLABLE_STATES = ["uploading", "processing", "ready", "failed", "delete_failed"] as const;
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
  | { outcome: "idempotent_replay"; row: VideoUpload }
  | { outcome: "idempotency_conflict" }
  | { outcome: "rate_limited" }
  | { outcome: "concurrency_limited" };

/**
 * Persists the durable "upload intent" row *before* Bunny is ever
 * contacted — the row itself is the record that an attempt happened,
 * regardless of what Bunny goes on to say. Serialized per-owner via the
 * same pg_advisory_xact_lock idiom reserveUploadAttempt (closet-media
 * -upload.ts) uses, so the rate/concurrency checks and the idempotency
 * lookup are race-free across any number of server instances.
 *
 * Idempotent replay: a client retrying the same Idempotency-Key after a
 * network blip gets back the *same* row (and a fresh TUS signature for
 * it, see issueTusUploadAuthorization) instead of a second Bunny video —
 * but only while that original row is still genuinely in flight
 * (uploading/processing with a confirmed bunny_video_id). Once a key's
 * row has resolved any other way (ready, failed, cancelled), replaying it
 * is refused outright: silently reusing a resolved key's identity would
 * either hand back credentials for a video that's already done or already
 * gone, or (for the ambiguous-create-timeout "failed" case, see
 * finalizeCreateFailure) risk a second create against a first attempt
 * whose Bunny-side outcome was never confirmed. Either way the fix is the
 * same for the caller: use a new Idempotency-Key for a genuinely new
 * attempt.
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
        if (existing.bunnyVideoId && (existing.state === "uploading" || existing.state === "processing")) {
          return { outcome: "idempotent_replay" as const, row: existing };
        }
        return { outcome: "idempotency_conflict" as const };
      }
    }

    const since = new Date(Date.now() - VIDEO_UPLOAD_RATE_LIMIT_WINDOW_MS);
    const [{ count: recentCount }] = await tx.select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(videoUploads)
      .where(and(eq(videoUploads.ownerUserId, ownerUserId), gte(videoUploads.createdAt, since)));
    if (recentCount >= VIDEO_UPLOAD_RATE_LIMIT_MAX) return { outcome: "rate_limited" as const };

    const [{ count: inFlightCount }] = await tx.select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(videoUploads)
      .where(and(eq(videoUploads.ownerUserId, ownerUserId), inArray(videoUploads.state, [...IN_FLIGHT_STATES])));
    if (inFlightCount >= VIDEO_UPLOAD_MAX_CONCURRENT) return { outcome: "concurrency_limited" as const };

    const [row] = await tx.insert(videoUploads).values({
      creatorId,
      ownerUserId,
      bunnyLibraryId,
      state: "uploading",
      declaredFileName: declared.fileName,
      declaredSizeBytes: declared.sizeBytes,
      declaredMimeType: declared.mimeType,
      idempotencyKey,
    }).returning();
    return { outcome: "reserved" as const, row };
  });
}

export async function finalizeCreateSuccess(id: string, ownerUserId: string, bunnyVideoId: string): Promise<VideoUpload | null> {
  const [row] = await db.update(videoUploads)
    .set({ bunnyVideoId, updatedAt: new Date() })
    .where(and(eq(videoUploads.id, id), eq(videoUploads.ownerUserId, ownerUserId)))
    .returning();
  return row ?? null;
}

/**
 * Covers both a definite Bunny rejection and an *ambiguous* timeout where
 * we genuinely cannot tell whether Bunny created the video before the
 * connection died. Either way this row is marked "failed" and permanently
 * burns its idempotency key (see reserveUploadIntent) rather than being
 * retried automatically: an automatic retry against an unconfirmed create
 * risks leaving an orphaned, untracked video on Bunny's side with nothing
 * in our ledger pointing at it. The row itself remains queryable
 * (GET /:id) as the durable record that the attempt happened; a genuinely
 * new attempt requires a new Idempotency-Key (or none), which always
 * creates a fresh row and a fresh Bunny video — recovery is a deliberate
 * new attempt, never a silent retry of an ambiguous one.
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
    .where(and(eq(videoUploads.id, id), eq(videoUploads.ownerUserId, ownerUserId)));
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

const KNOWN_FAILURE_STATUSES = new Set([5, 6]);
const FINISHED_STATUS = 4;
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
 * Status mapping is deliberately conservative in both directions:
 *  - A transient provider outage (timeout, network error, or any non-404
 *    HTTP failure) never changes state — an upload is never declared
 *    permanently failed for a Bunny hiccup that might resolve on the next
 *    poll.
 *  - Only Bunny's own documented terminal-failure codes (5 Error, 6
 *    UploadFailed) mark this row "failed"; any other, including an
 *    unrecognized future code, falls through to "processing" rather than
 *    being guessed at — staying in "processing" too long is a much safer
 *    failure mode than a false "failed".
 *  - "ready" additionally requires Bunny's own duration/width/height to
 *    all be present and positive — a "Finished" status without valid
 *    playback metadata yet is treated as still processing, never ready.
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
      inArray(videoUploads.state, [...IN_FLIGHT_STATES]),
      sql`(${videoUploads.lastReconciledAt} is null or ${videoUploads.lastReconciledAt} < ${throttleSince})`,
    ))
    .returning();
  if (!claimed) return row;

  const result = await getBunnyVideoStatus(claimed.bunnyVideoId!, { libraryId: claimed.bunnyLibraryId });

  if (result.status !== "ok") {
    if (result.reason !== "not found") return claimed;
    const [updated] = await db.update(videoUploads)
      .set({ state: "failed", lastError: sanitizeProviderError("reconcile failed", "video not found on provider"), lastAttemptAt: new Date(), updatedAt: new Date() })
      .where(and(eq(videoUploads.id, claimed.id), inArray(videoUploads.state, [...IN_FLIGHT_STATES])))
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
      .where(and(eq(videoUploads.id, claimed.id), inArray(videoUploads.state, [...IN_FLIGHT_STATES])))
      .returning();
    return updated ?? reread(claimed.id, claimed);
  }

  if (bunnyStatus === FINISHED_STATUS && hasValidPlaybackMetadata(result.video)) {
    const [updated] = await db.update(videoUploads)
      .set({
        state: "ready",
        durationSeconds: result.video.durationSeconds,
        width: result.video.width,
        height: result.video.height,
        updatedAt: new Date(),
      })
      .where(and(eq(videoUploads.id, claimed.id), inArray(videoUploads.state, [...IN_FLIGHT_STATES])))
      .returning();
    return updated ?? reread(claimed.id, claimed);
  }

  if (claimed.state !== "processing") {
    const [updated] = await db.update(videoUploads)
      .set({ state: "processing", updatedAt: new Date() })
      .where(and(eq(videoUploads.id, claimed.id), inArray(videoUploads.state, [...IN_FLIGHT_STATES])))
      .returning();
    return updated ?? reread(claimed.id, claimed);
  }
  return claimed;
}

/** Fenced claim: only a row not already mid-cancellation/cancelled can be claimed, and it can be claimed exactly once per cancel attempt. */
export async function claimCancellation(id: string, ownerUserId: string): Promise<VideoUpload | null> {
  const [row] = await db.update(videoUploads)
    .set({ state: "deletion_pending", updatedAt: new Date() })
    .where(and(eq(videoUploads.id, id), eq(videoUploads.ownerUserId, ownerUserId), inArray(videoUploads.state, [...CANCELLABLE_STATES])))
    .returning();
  return row ?? null;
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

/** Leaves the row in "delete_failed", not "deletion_pending" or "deleted" — a subsequent cancel call retries the Bunny delete (see CANCELLABLE_STATES). */
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
