import { boolean, index, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { usersTable } from "./auth";

/**
 * A feature flag is a server-enforced kill switch, not a UI-only toggle.
 * Every flag a client may query is first declared in the
 * FEATURE_FLAG_DEFINITIONS registry (api-server's lib/feature-flags.ts); a
 * row here only overrides that definition's default once an admin has
 * changed it. Report, Block, and Mute are never registered as flags, so
 * they are structurally impossible to disable through this system.
 */
export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: varchar("updated_by_user_id").references(() => usersTable.id),
});

export const featureFlagAuditLog = pgTable("feature_flag_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  flagKey: text("flag_key").notNull(),
  adminUserId: varchar("admin_user_id").notNull().references(() => usersTable.id),
  fromEnabled: boolean("from_enabled").notNull(),
  toEnabled: boolean("to_enabled").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("feature_flag_audit_log_flag_key_idx").on(table.flagKey, table.createdAt),
]);

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type FeatureFlagAuditLogEntry = typeof featureFlagAuditLog.$inferSelect;
