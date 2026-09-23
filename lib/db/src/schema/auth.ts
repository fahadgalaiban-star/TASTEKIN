import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const sessionsTable = pgTable("sessions", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire", { withTimezone: true }).notNull(),
}, (table) => [index("IDX_session_expire").on(table.expire)]);

export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: text("role").notNull().default("consumer"),
  isVerified: boolean("is_verified").notNull().default(false),
  isAdmin: boolean("is_admin").notNull().default(false),
  language: text("language").notNull().default("en"),
  notifyPush: boolean("notify_push").notNull().default(true),
  notifyEmail: boolean("notify_email").notNull().default(true),
  // New-user onboarding progress. onboardingStep tracks which step to resume
  // at; onboardingCompletedAt is the durable "has finished onboarding" value
  // requested for completion — null until the wizard (or an established/
  // admin/verified-account bypass) sets it. Neither column implies or grants
  // isAdmin, isVerified, or any creator entitlement.
  onboardingStep: text("onboarding_step").notNull().default("basics"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  authProvider: text("auth_provider").notNull().default("replit"),
  passwordHash: varchar("password_hash"),
  googleId: varchar("google_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Native (iOS/Android) app sessions. Entirely separate from the cookie
// `sessions` table above: the app never sees or reuses a web `sid`. Only the
// SHA-256 of the opaque bearer token is stored, so a database read can never
// yield a usable credential. Revocation is a row update (immediate), idle
// expiry is computed from last_used_at, absolute expiry from expires_at.
export const nativeSessionsTable = pgTable("native_sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash").notNull().unique(),
  platform: text("platform").notNull(),
  appVersion: text("app_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
}, (table) => [
  index("native_sessions_user_id_idx").on(table.userId),
  index("native_sessions_expires_at_idx").on(table.expiresAt),
]);

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  token: varchar("token").primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});