import { index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Edit IDs deliberately remain plain strings: published Edits are owned by the
 * creator workspace JSON document, while interaction rows are normalized so
 * they can be queried and aggregated safely.
 */
export const editLikes = pgTable("edit_likes", {
  editId: text("edit_id").notNull(),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.editId, table.userId] }),
  index("edit_likes_edit_id_idx").on(table.editId),
]);

export const editSaves = pgTable("edit_saves", {
  editId: text("edit_id").notNull(),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.editId, table.userId] }),
  index("edit_saves_user_id_idx").on(table.userId),
]);

export const editComments = pgTable("edit_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  editId: text("edit_id").notNull(),
  userId: text("user_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("edit_comments_edit_created_idx").on(table.editId, table.createdAt)]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantA: text("participant_a").notNull(),
  participantB: text("participant_b").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("conversations_participants_unique").on(table.participantA, table.participantB),
  index("conversations_participant_a_idx").on(table.participantA),
  index("conversations_participant_b_idx").on(table.participantB),
]);

export const conversationMessages = pgTable("conversation_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull(),
  senderUserId: text("sender_user_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (table) => [
  index("conversation_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  index("conversation_messages_recipient_read_idx").on(table.senderUserId, table.readAt),
]);

export const creatorViewEvents = pgTable("creator_view_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: text("creator_id").notNull(),
  editId: text("edit_id"),
  viewerUserId: text("viewer_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("creator_view_events_creator_created_idx").on(table.creatorId, table.createdAt),
  index("creator_view_events_edit_id_idx").on(table.editId),
]);

/**
 * Following is deliberately normalized and private. TASTEKIN uses it to shape
 * discovery, but never exposes follower/following totals as social proof.
 */
export const creatorFollows = pgTable("creator_follows", {
  followerUserId: text("follower_user_id").notNull(),
  creatorId: text("creator_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.followerUserId, table.creatorId] }),
  index("creator_follows_creator_id_idx").on(table.creatorId),
]);

/**
 * A member may maintain one verification application. Approval never happens
 * from the public profile: only a configured TASTEKIN administrator can change
 * the status and the user's verification flag.
 */
export const verificationApplications = pgTable("verification_applications", {
  userId: text("user_id").primaryKey(),
  statement: text("statement").notNull(),
  evidenceLinks: jsonb("evidence_links").notNull().default([]),
  status: text("status").notNull().default("pending"),
  reviewNote: text("review_note"),
  reviewedByUserId: text("reviewed_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (table) => [
  index("verification_applications_status_created_idx").on(table.status, table.createdAt),
]);

export const insertEditCommentSchema = createInsertSchema(editComments).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEditComment = z.infer<typeof insertEditCommentSchema>;
export type EditComment = typeof editComments.$inferSelect;
