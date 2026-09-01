import { sql } from "drizzle-orm";
import { check, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

import { usersTable } from "./auth";

/**
 * Mute is strictly one-directional, unlike a block: it only ever affects
 * what muterUserId sees. mutedUserId is never notified, is unaffected in
 * what they can see or do, and this relationship is never exposed outside
 * the muter's own account.
 */
export const userMutes = pgTable("user_mutes", {
  id: uuid("id").primaryKey().defaultRandom(),
  muterUserId: varchar("muter_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  mutedUserId: varchar("muted_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Repeated mutes of the same account are idempotent (onConflictDoNothing
  // against this index), not duplicate rows.
  uniqueIndex("user_mutes_muter_muted_unique").on(table.muterUserId, table.mutedUserId),
  index("user_mutes_muter_idx").on(table.muterUserId),
  index("user_mutes_muted_idx").on(table.mutedUserId),
  check("user_mutes_no_self_mute", sql`${table.muterUserId} <> ${table.mutedUserId}`),
]);

export type UserMute = typeof userMutes.$inferSelect;
