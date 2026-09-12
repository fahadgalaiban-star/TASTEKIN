import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
 */
export const VIDEO_UPLOAD_STATES = [
  "uploading",
  "processing",
  "ready",
  "failed",
  "deleted",
] as const;
export type VideoUploadState = (typeof VIDEO_UPLOAD_STATES)[number];

export const videoUploads = pgTable("video_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: text("creator_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  bunnyLibraryId: text("bunny_library_id").notNull(),
  bunnyVideoId: text("bunny_video_id").notNull(),
  state: text("state").notNull().default("uploading"),
  durationSeconds: integer("duration_seconds"),
  width: integer("width"),
  height: integer("height"),
  posterUrl: text("poster_url"),
  errorReason: text("error_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("video_uploads_owner_user_id_idx").on(table.ownerUserId),
  uniqueIndex("video_uploads_bunny_video_id_unique").on(table.bunnyVideoId),
  index("video_uploads_state_updated_idx").on(table.state, table.updatedAt),
]);

export type VideoUpload = typeof videoUploads.$inferSelect;
export type NewVideoUpload = typeof videoUploads.$inferInsert;
