import { doublePrecision, index, integer, jsonb, pgTable, real, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

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

/**
 * A member's explicitly saved KIN Looks/Travel answer. Unlike
 * kin_search_usage (a content-free rate-limit counter), this table exists
 * specifically to persist content the member chose to keep — the full
 * normalized response contract (answer/options/citations/results), never
 * anything beyond what runKinSearch already returned to them. options is
 * null for travel saves (that shape only exists for looks).
 */
export const kinSavedRecommendations = pgTable("kin_saved_recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: varchar("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  query: text("query").notNull(),
  answer: text("answer").notNull(),
  options: jsonb("options").$type<unknown[] | null>(),
  citations: jsonb("citations").$type<unknown[]>().notNull(),
  results: jsonb("results").$type<unknown[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("kin_saved_recommendations_owner_created_idx").on(table.ownerUserId, table.createdAt),
]);

export type KinSavedRecommendation = typeof kinSavedRecommendations.$inferSelect;

/** A member's own trip plan. Deleting a trip cascades to its itinerary items below. */
export const kinTrips = pgTable("kin_trips", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: varchar("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  destination: text("destination").notNull(),
  startDate: text("start_date"),
  endDate: text("end_date"),
  budget: real("budget"),
  currency: text("currency"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("kin_trips_owner_created_idx").on(table.ownerUserId, table.createdAt),
]);

export type KinTrip = typeof kinTrips.$inferSelect;

/**
 * One itinerary entry added via "Add to Trip" — a place (from KIN Travel's
 * Google Places results) attached to a specific day of a specific trip.
 * ownerUserId is denormalized from the parent trip so every read/write can
 * be scoped by owner without an extra join, mirroring closet_media_uploads'
 * pattern of carrying ownerUserId directly rather than only via a parent FK.
 */
export const kinTripItems = pgTable("kin_trip_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id").notNull().references(() => kinTrips.id, { onDelete: "cascade" }),
  ownerUserId: varchar("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  dayIndex: integer("day_index").notNull().default(0),
  placeId: text("place_id"),
  name: text("name").notNull(),
  formattedAddress: text("formatted_address"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("kin_trip_items_trip_idx").on(table.tripId),
  index("kin_trip_items_owner_idx").on(table.ownerUserId),
]);

export type KinTripItem = typeof kinTripItems.$inferSelect;
