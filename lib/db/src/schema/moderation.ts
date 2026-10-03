import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const moderationContentStates = pgTable("moderation_content_states", {
  targetType: text("target_type").notNull(),
  creatorId: text("creator_id").notNull(),
  targetId: text("target_id").notNull(),
  isHidden: boolean("is_hidden").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: "moderation_content_states_pk", columns: [table.targetType, table.creatorId, table.targetId] }),
  check("moderation_content_states_type_check", sql`${table.targetType} in ('edit', 'comment')`),
  check("moderation_content_states_identity_check", sql`length(btrim(${table.creatorId})) > 0 and length(btrim(${table.targetId})) > 0`),
]);

export const REPORT_TARGET_TYPES = ["edit", "comment", "profile"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate_or_abuse",
  "sexual_content",
  "violence",
  "scam_or_misleading",
  "privacy_violation",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ["pending", "under_review", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/**
 * A report only records a complaint — creating or reviewing one never hides,
 * restricts, or deletes the reported content. Only a database-authorized
 * admin (users.is_admin) can change status, and every change is mirrored
 * into moderationAuditLog below for an immutable trail.
 */
export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterUserId: text("reporter_user_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason").notNull(),
  details: text("details"),
  status: text("status").notNull().default("pending"),
  adminNote: text("admin_note"),
  reviewedByUserId: text("reviewed_by_user_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("reports_status_created_idx").on(table.status, table.createdAt),
  index("reports_target_idx").on(table.targetType, table.targetId),
  index("reports_reporter_created_idx").on(table.reporterUserId, table.createdAt),
  // Duplicate-report prevention: only one *active* (pending/under_review)
  // report per reporter+target at a time. Once a report is resolved or
  // dismissed, the same reporter may file a new one against the same target.
  uniqueIndex("reports_active_dedupe_unique")
    .on(table.reporterUserId, table.targetType, table.targetId)
    .where(sql`${table.status} in ('pending', 'under_review')`),
]);

export const moderationAuditLog = pgTable("moderation_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportId: uuid("report_id").notNull().references(() => reports.id),
  adminUserId: text("admin_user_id").notNull(),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  note: text("note"),
  action: text("action"),
  targetType: text("target_type"),
  targetId: text("target_id"),
  previousState: jsonb("previous_state").$type<Record<string, unknown>>(),
  newState: jsonb("new_state").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("moderation_audit_log_report_id_idx").on(table.reportId),
  check("moderation_action_complete_check", sql.raw(`"action" IS NULL OR (
    "target_type" IS NOT NULL AND "target_id" IS NOT NULL AND length(btrim("target_id")) > 0
    AND "note" IS NOT NULL AND length(btrim("note")) BETWEEN 1 AND 1000
    AND "previous_state" IS NOT NULL AND "new_state" IS NOT NULL
    AND jsonb_typeof("previous_state") = 'object' AND jsonb_typeof("new_state") = 'object'
    AND (("action" IN ('hide_edit', 'restore_edit') AND "target_type" = 'edit')
      OR ("action" IN ('hide_comment', 'restore_comment') AND "target_type" = 'comment')
      OR ("action" IN ('suspend_user', 'unsuspend_user') AND "target_type" = 'user'))
    AND (("target_type" = 'user'
      AND "previous_state" ? 'suspended' AND "new_state" ? 'suspended'
      AND jsonb_typeof("previous_state"->'suspended') = 'boolean'
      AND jsonb_typeof("new_state"->'suspended') = 'boolean'
      AND ("new_state"->>'suspended')::boolean = ("action" = 'suspend_user'))
      OR ("target_type" IN ('edit', 'comment')
      AND "previous_state" ? 'hidden' AND "new_state" ? 'hidden'
      AND jsonb_typeof("previous_state"->'hidden') = 'boolean'
      AND jsonb_typeof("new_state"->'hidden') = 'boolean'
      AND "previous_state" ? 'creatorId' AND "new_state" ? 'creatorId'
      AND length("new_state"->>'creatorId') > 0
      AND "previous_state"->>'creatorId' = "new_state"->>'creatorId'
      AND ("new_state"->>'hidden')::boolean = ("action" IN ('hide_edit', 'hide_comment'))))
  )`)),
]);

export type Report = typeof reports.$inferSelect;
export type ModerationAuditLogEntry = typeof moderationAuditLog.$inferSelect;
