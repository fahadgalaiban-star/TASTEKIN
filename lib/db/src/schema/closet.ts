import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { usersTable } from "./auth";

/**
 * My Things (KIN) — private, per-user closet items. PR-1: backend/API and
 * storage foundation only, no UI, no Match This, no image analysis.
 *
 * Categorical fields are plain text with an application-level allowlist
 * (see api-server's lib/closet-items.ts) — matching this repo's existing
 * convention (REPORT_STATUSES, ANALYTICS_EVENT_NAMES): no pgEnum, no native
 * Postgres enum, no CHECK IN (...) constraint anywhere in this file.
 *
 * image_object_key is a private object-storage key only (see
 * lib/private-media-storage.ts's closet-specific helpers) — never a signed
 * URL, public URL, or sidecar-internal URL. It is denormalized here from
 * closet_media_uploads at creation time for a join-free read on the common
 * "view my item" path; closet_media_uploads remains the authoritative
 * lifecycle/audit trail, especially for deletion tracking.
 */
export const CLOSET_ITEM_TYPES = [
  "t_shirt", "shirt", "polo", "blouse", "top", "sweater", "hoodie",
  "pants", "jeans", "shorts", "skirt", "dress",
  "jacket", "coat", "blazer", "suit",
  "sneakers", "shoes", "boots", "sandals", "heels",
  "bag", "accessory", "other",
] as const;
export type ClosetItemType = (typeof CLOSET_ITEM_TYPES)[number];

export const CLOSET_PRIMARY_COLORS = [
  "black", "white", "gray", "beige", "cream", "brown", "navy", "blue",
  "green", "olive", "red", "burgundy", "orange", "yellow", "purple",
  "pink", "gold", "silver", "multicolor",
] as const;
export type ClosetPrimaryColor = (typeof CLOSET_PRIMARY_COLORS)[number];

export const CLOSET_STYLES = [
  "casual", "smart_casual", "formal", "classic", "minimalist",
  "streetwear", "sporty", "business", "evening", "bohemian",
] as const;
export type ClosetStyle = (typeof CLOSET_STYLES)[number];

export const CLOSET_OCCASIONS = [
  "everyday", "work", "formal_event", "evening", "travel", "sport", "home",
] as const;
export type ClosetOccasion = (typeof CLOSET_OCCASIONS)[number];

export const CLOSET_SEASONS = [
  "spring", "summer", "autumn", "winter", "all_season",
] as const;
export type ClosetSeason = (typeof CLOSET_SEASONS)[number];

export const CLOSET_CONFIRMATION_STATUSES = ["confirmed", "pending_review"] as const;
export type ClosetConfirmationStatus = (typeof CLOSET_CONFIRMATION_STATUSES)[number];

export const closetItems = pgTable("closet_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: varchar("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  imageObjectKey: text("image_object_key").notNull(),
  itemType: text("item_type").notNull(),
  primaryColor: text("primary_color").notNull(),
  style: text("style").notNull(),
  occasion: text("occasion"),
  season: text("season"),
  brand: text("brand"),
  confirmationStatus: text("confirmation_status").notNull().default("pending_review"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("closet_items_owner_user_id_idx").on(table.ownerUserId),
  index("closet_items_owner_created_idx").on(table.ownerUserId, table.createdAt),
  uniqueIndex("closet_items_image_object_key_unique").on(table.imageObjectKey),
]);

export const CLOSET_MEDIA_STATES = [
  "reserved",
  "uploading",
  "rejected",
  "upload_failed",
  "uploaded",
  "attached",
  "deletion_pending",
  "cleanup_in_progress",
  "delete_failed",
  "deleted",
] as const;
export type ClosetMediaState = (typeof CLOSET_MEDIA_STATES)[number];

/**
 * The durable My Things media lifecycle ledger. Every row is a counted
 * upload "attempt" for rate-limiting purposes, regardless of its outcome.
 *
 * owner_user_id is nullable with onDelete: "set null" (matches
 * analyticsEvents.userId's precedent) — this ledger must outlive the user
 * account it belonged to, so a deleted account's pending image cleanup
 * remains durably tracked. closet_item_id is likewise "set null", not
 * "cascade": this row must outlive the closet_items row it was attached
 * to, whether that row was deleted through the app's own delete flow or
 * cascaded away by a user-account deletion.
 *
 * cleanup_lease_until / cleanup_claim_token implement a fenced,
 * lease-based claim for the reconciliation script, so no database
 * transaction is ever held open across an Object Storage call: a short
 * transaction claims a row (state -> cleanup_in_progress, a bounded
 * lease, a fresh token), the storage call happens outside any
 * transaction, and a second short transaction finalizes the result only
 * if the claim token still matches — so a stale/slow process can never
 * overwrite a newer result.
 */
export const closetMediaUploads = pgTable("closet_media_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: varchar("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  imageObjectKey: text("image_object_key"),
  state: text("state").notNull().default("reserved"),
  closetItemId: uuid("closet_item_id").references(() => closetItems.id, { onDelete: "set null" }),
  retryCount: integer("retry_count").notNull().default(0),
  lastError: text("last_error"),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  attachedAt: timestamp("attached_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  cleanupLeaseUntil: timestamp("cleanup_lease_until", { withTimezone: true }),
  cleanupClaimToken: uuid("cleanup_claim_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("closet_media_uploads_owner_created_idx").on(table.ownerUserId, table.createdAt),
  index("closet_media_uploads_state_updated_idx").on(table.state, table.updatedAt),
  index("closet_media_uploads_cleanup_lease_idx").on(table.state, table.cleanupLeaseUntil),
  uniqueIndex("closet_media_uploads_image_object_key_unique")
    .on(table.imageObjectKey)
    .where(sql`${table.imageObjectKey} is not null`),
  uniqueIndex("closet_media_uploads_closet_item_id_unique")
    .on(table.closetItemId)
    .where(sql`${table.closetItemId} is not null`),
]);

export type ClosetItem = typeof closetItems.$inferSelect;
export type ClosetMediaUpload = typeof closetMediaUploads.$inferSelect;
