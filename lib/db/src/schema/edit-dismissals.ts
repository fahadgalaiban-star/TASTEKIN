import { index, pgTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { creatorWorkspaces } from "./creator-workspaces";

/**
 * "Not interested" on an Edit (feature flag taste_learning). Hides the Edit
 * from that member's feeds and is a negative taste signal for that member
 * only. Never aggregated across members, never shown to the creator.
 * Mirrors lib/db/migrations/0025_edit_dismissals.sql.
 */
export const editDismissals = pgTable("edit_dismissals", {
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  creatorId: text("creator_id").notNull().references(() => creatorWorkspaces.creatorId, { onDelete: "cascade" }),
  editId: text("edit_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.editId], name: "edit_dismissals_pk" }),
  index("edit_dismissals_user_created_idx").on(table.userId, table.createdAt),
]);

export type EditDismissal = typeof editDismissals.$inferSelect;
