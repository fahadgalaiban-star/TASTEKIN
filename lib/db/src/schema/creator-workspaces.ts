import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const creatorWorkspaces = pgTable("creator_workspaces", {
  creatorId: text("creator_id").primaryKey(),
  ownerUserId: text("owner_user_id"),
  edits: jsonb("edits").$type<unknown[]>().notNull(),
  collections: jsonb("collections").$type<unknown[]>().notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CreatorWorkspaceRecord = typeof creatorWorkspaces.$inferSelect;