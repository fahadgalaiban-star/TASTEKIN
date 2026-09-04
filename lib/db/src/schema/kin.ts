import { index, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { usersTable } from "./auth";

/**
 * Durable, per-user KIN search quota ledger. Every row is one *attempted*
 * search — inserted the instant a request is admitted, before Anthropic is
 * ever called — so a provider failure or timeout still permanently counts
 * against the member's daily quota (the same "attempt, not outcome" model
 * as closet_media_uploads' upload rate limit). Never stores the query
 * text, the response, or any wardrobe/context data — only that an attempt
 * happened and when, which is the minimum needed to enforce the quota.
 *
 * onDelete: "cascade" (unlike closet_media_uploads' "set null") because
 * this is a pure rate-limit counter with no audit-trail purpose — nothing
 * here needs to outlive the account it belonged to.
 */
export const kinSearchUsage = pgTable("kin_search_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: varchar("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("kin_search_usage_owner_created_idx").on(table.ownerUserId, table.createdAt),
]);

export type KinSearchUsage = typeof kinSearchUsage.$inferSelect;
