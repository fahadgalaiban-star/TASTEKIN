import { sql } from "drizzle-orm";
import { check, index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

import { usersTable } from "./auth";

/**
 * A block is one-directional to record (blockerUserId blocked
 * blockedUserId), but every enforcement check treats a block as mutual —
 * neither account may see or interact with the other while it exists. Who
 * blocked whom is never exposed outside the blocker's own account.
 */
export const userBlocks = pgTable("user_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  blockerUserId: varchar("blocker_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  blockedUserId: varchar("blocked_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Repeated blocks of the same account are idempotent (onConflictDoNothing
  // against this index), not duplicate rows.
  uniqueIndex("user_blocks_blocker_blocked_unique").on(table.blockerUserId, table.blockedUserId),
  index("user_blocks_blocker_idx").on(table.blockerUserId),
  index("user_blocks_blocked_idx").on(table.blockedUserId),
  check("user_blocks_no_self_block", sql`${table.blockerUserId} <> ${table.blockedUserId}`),
]);

export type UserBlock = typeof userBlocks.$inferSelect;
