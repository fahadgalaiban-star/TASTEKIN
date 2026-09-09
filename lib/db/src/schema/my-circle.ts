import { index, pgTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { creatorWorkspaces } from "./creator-workspaces";

export const myCircleMemberships = pgTable("my_circle_memberships", {
  ownerUserId: varchar("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  creatorId: text("creator_id").notNull().references(() => creatorWorkspaces.creatorId, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.ownerUserId, table.creatorId], name: "my_circle_memberships_owner_creator_pk" }),
  index("my_circle_memberships_owner_created_idx").on(table.ownerUserId, table.createdAt),
  index("my_circle_memberships_creator_idx").on(table.creatorId),
]);

export type MyCircleMembership = typeof myCircleMemberships.$inferSelect;