import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { usersTable } from "./auth";

/**
 * Privacy-safe product analytics: only event *names* and a small,
 * server-validated metadata shape per name are ever accepted (enforced in
 * api-server's lib/analytics.ts allowlist) — never message contents, report
 * or moderation details, mute/block targets, passwords, emails, or raw
 * search text. userId is the authenticated internal id only; anonymous
 * events store a null userId rather than any client-supplied identifier.
 */
export const ANALYTICS_EVENT_NAMES = [
  "onboarding_started",
  "onboarding_completed",
  "home_viewed",
  "explore_viewed",
  "explore_search_performed",
  "creator_profile_viewed",
  "edit_viewed",
  "save_added",
  "save_removed",
  "follow_added",
  "follow_removed",
  "subscription_started",
  "subscription_completed",
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export const analyticsEvents = pgTable("analytics_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  userId: varchar("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("analytics_events_name_created_idx").on(table.name, table.createdAt),
  index("analytics_events_user_created_idx").on(table.userId, table.createdAt),
]);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
