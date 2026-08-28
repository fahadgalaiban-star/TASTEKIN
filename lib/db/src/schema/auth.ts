import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

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
  // isAdmin, isVerified, or any creator/subscriber entitlement.
  onboardingStep: text("onboarding_step").notNull().default("basics"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  authProvider: text("auth_provider").notNull().default("replit"),
  passwordHash: varchar("password_hash"),
  googleId: varchar("google_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  token: varchar("token").primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});