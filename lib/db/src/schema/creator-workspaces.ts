import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export type CreatorProfileRecord = {
  displayName: string;
  username: string;
  bio: string;
  city: string;
  country: string;
  interests: string[];
  dateOfBirth: string | null;
  showAge: boolean;
  avatar: string;
};

export const creatorWorkspaces = pgTable("creator_workspaces", {
  creatorId: text("creator_id").primaryKey(),
  ownerUserId: text("owner_user_id"),
  edits: jsonb("edits").$type<unknown[]>().notNull(),
  collections: jsonb("collections").$type<unknown[]>().notNull(),
  profile: jsonb("profile").$type<CreatorProfileRecord>().notNull().default(sql`'{"displayName":"Fheed Alaiban","username":"fheed","bio":"A considered edit of fashion, places, travel, and the rituals that make everyday life feel better.","city":"Kuwait City","country":"Kuwait","interests":["Fashion","Travel","Places"],"dateOfBirth":null,"showAge":false,"avatar":"/tastekin-media/fheed-profile.webp"}'::jsonb`),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const creatorMediaUploads = pgTable("creator_media_uploads", {
  objectPath: text("object_path").primaryKey(),
  creatorId: text("creator_id").notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  state: text("state").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CreatorWorkspaceRecord = typeof creatorWorkspaces.$inferSelect;