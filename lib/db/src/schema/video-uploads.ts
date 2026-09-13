import { bigint, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Video Foundation, Phase 1 — the durable Bunny Stream upload/processing
 * ledger. This table is deliberately independent of creator_media_uploads
 * (a different provider, a different lifecycle) and of the
 * creator_workspaces JSON document: a video is only ever attached to a
 * published Edit once this row reaches "ready" (see api-server's future
 * publish-time check), and Phase 2's webhook handler updates only this
 * normalized row — it never reaches into or mutates creator_workspaces'
 * JSONB edits array directly.
 *
 * creator_id / owner_user_id are plain, unconstrained text, matching
 * creator_media_uploads' existing convention (creator_workspaces.creator_id
 * is a text primary key with no FK relationships pointing at it anywhere
 * in this schema).
 *
 * Phase 2A additions (see migration 0018): bunny_video_id is now nullable
 * — a row is inserted as the durable "upload intent" record before Bunny
 * is ever contacted, so an ambiguous provider timeout during creation
 * still leaves a permanent, queryable record rather than silently
 * vanishing. declared_* columns are client-reported metadata only — never
 * proof of the real uploaded file's size or type, since video bytes never
 * pass through this API (see routes/video-uploads.ts). deletion_pending /
 * delete_failed mirror closet_media_uploads' existing cancel/delete
 * fencing convention.
 *
 * "creating" (added post-Phase-2A-review): the brief window between the
 * intent row being inserted and Bunny's create-video call resolving — its
 * id is never returned to a client until it leaves this state. See
 * api-server's video-upload-lifecycle.ts for why this exists (a genuinely
 * concurrent duplicate request-upload call must never be told to use a
 * new Idempotency-Key just because the winning call hasn't finished yet).
 *
 * "create_ambiguous" / "orphan_cleanup_pending" (added post-Phase-2A-review):
 * a create timeout or connection loss can happen after Bunny actually
 * created the video but before this API learned its id. These states keep
 * that possibility structurally distinct from a definite "failed" — see
 * finalizeCreateAmbiguous and claimCancellation in video-upload-lifecycle.ts.
 */
export const VIDEO_UPLOAD_STATES = [
  "creating",
  "uploading",
  "processing",
  "ready",
  "failed",
  "create_ambiguous",
  "deletion_pending",
  "delete_failed",
  "orphan_cleanup_pending",
  "deleted",
] as const;
export type VideoUploadState = (typeof VIDEO_UPLOAD_STATES)[number];

export const videoUploads = pgTable("video_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: text("creator_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  bunnyLibraryId: text("bunny_library_id").notNull(),
  // Nullable: set only once Bunny's create-video call is confirmed to have
  // succeeded (see reserveUploadIntent/finalizeCreateSuccess in
  // video-upload-lifecycle.ts). A row with a null bunny_video_id and state
  // "failed" records an ambiguous (timed-out) create attempt whose Bunny
  // side effect could not be confirmed either way — see that file for why
  // it is never automatically retried against the same row.
  bunnyVideoId: text("bunny_video_id"),
  state: text("state").notNull().default("uploading"),
  durationSeconds: integer("duration_seconds"),
  width: integer("width"),
  height: integer("height"),
  posterUrl: text("poster_url"),
  errorReason: text("error_reason"),
  // Client-declared metadata captured at request-upload time, for display
  // and quota bookkeeping only — never treated as a verified fact about
  // the bytes actually sent to Bunny over TUS (this API never sees them).
  declaredFileName: text("declared_file_name"),
  declaredSizeBytes: bigint("declared_size_bytes", { mode: "number" }),
  declaredMimeType: text("declared_mime_type"),
  // Optional client-supplied idempotency key (scoped per owner) so a
  // retried request-upload call after a network blip reuses the same row
  // and Bunny video instead of creating a duplicate — see
  // reserveUploadIntent.
  idempotencyKey: text("idempotency_key"),
  retryCount: integer("retry_count").notNull().default(0),
  lastError: text("last_error"),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  // Throttle marker for server-side status reconciliation with Bunny (see
  // reconcileWithBunny) — never updated more often than
  // VIDEO_UPLOAD_RECONCILE_MIN_INTERVAL_MS apart for a given row.
  lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("video_uploads_owner_user_id_idx").on(table.ownerUserId),
  index("video_uploads_owner_created_idx").on(table.ownerUserId, table.createdAt),
  index("video_uploads_owner_state_idx").on(table.ownerUserId, table.state),
  uniqueIndex("video_uploads_bunny_video_id_unique").on(table.bunnyVideoId),
  uniqueIndex("video_uploads_owner_idempotency_key_unique")
    .on(table.ownerUserId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} is not null`),
  index("video_uploads_state_updated_idx").on(table.state, table.updatedAt),
]);

export type VideoUpload = typeof videoUploads.$inferSelect;
export type NewVideoUpload = typeof videoUploads.$inferInsert;
