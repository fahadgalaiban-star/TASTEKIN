import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("moderation_audit_log_report_id_idx").on(table.reportId),
]);

export type Report = typeof reports.$inferSelect;
export type ModerationAuditLogEntry = typeof moderationAuditLog.$inferSelect;
