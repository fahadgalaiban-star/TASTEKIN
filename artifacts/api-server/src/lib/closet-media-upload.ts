import { closetMediaUploads, db } from "@workspace/db";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import sharp from "sharp";

export const UPLOAD_RATE_LIMIT_MAX = 30;
export const UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 24_000_000;
export const WEBP_QUALITY = 82;
const MAX_ERROR_LENGTH = 200;

/**
 * Never persist a raw error's message/stack (a storage fetch() failure can
 * embed the signed URL itself) — only a short, fixed-vocabulary reason,
 * bounded in length. Used for every last_error write in the ledger.
 */
export function sanitizeErrorReason(prefix: string, error: unknown): string {
  let reason = "unknown error";
  if (error instanceof Error) {
    const httpMatch = error.message.match(/\((\d{3})\)/) ?? error.message.match(/HTTP (\d{3})/);
    if (httpMatch) reason = `HTTP ${httpMatch[1]}`;
    else if (error.name === "AbortError" || /timeout/i.test(error.message)) reason = "timeout";
    else if (error.name === "TypeError" && /fetch/i.test(error.message)) reason = "network error";
    else reason = "error";
  }
  return `${prefix}: ${reason}`.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Race-safe, durable per-user upload rate limit. Every ledger row counts as
 * an "attempt" regardless of its eventual state — rejected/failed attempts
 * are never excluded, and deleting a closet item afterward never frees up
 * quota, since the ledger row that recorded the original attempt is never
 * touched by item deletion. Serialized per-user via a Postgres advisory
 * lock (the same pg_advisory_xact_lock idiom used by feature-flags.ts's
 * toggle route), so this is correct across any number of server instances.
 */
export async function reserveUploadAttempt(ownerUserId: string): Promise<{ id: string } | { rateLimited: true }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`closet-media-upload:${ownerUserId}`}))`);
    const since = new Date(Date.now() - UPLOAD_RATE_LIMIT_WINDOW_MS);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(closetMediaUploads)
      .where(and(eq(closetMediaUploads.ownerUserId, ownerUserId), gte(closetMediaUploads.createdAt, since)));
    if (count >= UPLOAD_RATE_LIMIT_MAX) return { rateLimited: true as const };
    const [row] = await tx
      .insert(closetMediaUploads)
      .values({ ownerUserId, state: "reserved" })
      .returning({ id: closetMediaUploads.id });
    return { id: row.id };
  });
}

type DecodedImage = { buffer: Buffer; format: string };

/**
 * Authoritative validation: actual decoding and the detected format are
 * what matter — never the client's declared Content-Type or filename.
 * limitInputPixels rejects an oversized-dimension image (and is the
 * primary decompression-bomb defense) before a full decode buffer is
 * ever allocated. Orientation is applied (.rotate()) before the
 * metadata-stripping re-encode; withMetadata() is never called, so EXIF/
 * GPS/ICC are stripped by the re-encode itself. Output is normalized to
 * WebP for every accepted input format.
 */
export async function decodeAndReencodeClosetImage(input: Buffer): Promise<DecodedImage | null> {
  try {
    const probe = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS });
    const metadata = await probe.metadata();
    if (metadata.format !== "jpeg" && metadata.format !== "png" && metadata.format !== "webp") {
      return null;
    }
    const buffer = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    return { buffer, format: "webp" };
  } catch {
    return null;
  }
}

export async function transitionMediaUpload(
  ledgerId: string,
  ownerUserId: string,
  updates: Partial<{
    state: string;
    imageObjectKey: string | null;
    lastError: string | null;
    lastAttemptAt: Date;
    attachedAt: Date;
    closetItemId: string | null;
    retryCountIncrement: boolean;
  }>,
) {
  const { retryCountIncrement, ...rest } = updates;
  const setClause: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (retryCountIncrement) {
    setClause.retryCount = sql`${closetMediaUploads.retryCount} + 1`;
  }
  await db
    .update(closetMediaUploads)
    .set(setClause)
    .where(and(eq(closetMediaUploads.id, ledgerId), eq(closetMediaUploads.ownerUserId, ownerUserId)));
}

export type ReserveAnalysisAttemptResult =
  | { status: "reserved"; imageObjectKey: string }
  | { status: "already_attempted" }
  | { status: "not_found" };

/**
 * Durable, atomic one-shot gate for closet_item_analysis: at most one
 * analysis attempt may ever be reserved per upload. The UPDATE's WHERE
 * clause (id + owner + state "uploaded" + analysis_attempted_at IS NULL)
 * *is* the reservation — no advisory lock is needed, unlike
 * reserveUploadAttempt above, because this check is already scoped to a
 * single row identified by primary key. Postgres serializes concurrent
 * UPDATEs to the same row (the second waits for the first's row lock,
 * then re-evaluates the WHERE predicate against the now-committed row),
 * so two concurrent requests for the same upload can never both succeed.
 *
 * This reserves the slot unconditionally, before the caller ever fetches
 * the image or calls the provider: a provider failure or timeout still
 * spent real request cost, so it must still consume the one allowed
 * attempt, not just a successful analysis.
 */
export async function reserveAnalysisAttempt(uploadId: string, ownerUserId: string): Promise<ReserveAnalysisAttemptResult> {
  const [reserved] = await db
    .update(closetMediaUploads)
    .set({ analysisAttemptedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(closetMediaUploads.id, uploadId),
      eq(closetMediaUploads.ownerUserId, ownerUserId),
      eq(closetMediaUploads.state, "uploaded"),
      isNull(closetMediaUploads.analysisAttemptedAt),
    ))
    .returning({ imageObjectKey: closetMediaUploads.imageObjectKey });
  if (reserved) {
    // An "uploaded" row always has an image key (transitionMediaUpload sets
    // it during the upload step) — the null check is defense in depth, not
    // an expected path.
    if (!reserved.imageObjectKey) return { status: "not_found" };
    return { status: "reserved", imageObjectKey: reserved.imageObjectKey };
  }
  const [existing] = await db
    .select({ state: closetMediaUploads.state, analysisAttemptedAt: closetMediaUploads.analysisAttemptedAt })
    .from(closetMediaUploads)
    .where(and(eq(closetMediaUploads.id, uploadId), eq(closetMediaUploads.ownerUserId, ownerUserId)));
  if (existing && existing.state === "uploaded" && existing.analysisAttemptedAt !== null) {
    return { status: "already_attempted" };
  }
  return { status: "not_found" };
}
