import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userTastePreferences = pgTable("user_taste_preferences", {
  userId: text("user_id").primaryKey(),
  categories: jsonb("categories").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserTastePreferencesSchema = createInsertSchema(userTastePreferences).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertUserTastePreferences = z.infer<typeof insertUserTastePreferencesSchema>;
export type UserTastePreferences = typeof userTastePreferences.$inferSelect;