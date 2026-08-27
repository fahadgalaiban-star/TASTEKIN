import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db, sessionsTable, usersTable, passwordResetTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";

export const SESSION_COOKIE = "sid";
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL = 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;
type AuthUser = { id: string; email: string | null; firstName: string | null; lastName: string | null; profileImageUrl: string | null; role?: string; isVerified?: boolean };
type Session = { user: AuthUser; accessToken: string; expiresAt: number };

export async function createSession(session: Session) {
  const sid = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({ sid, sess: session, expire: new Date(Date.now() + SESSION_TTL) });
  return sid;
}
export async function getSession(sid: string) {
  const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.sid, sid));
  if (!row || row.expire < new Date()) return null;
  return row.sess as unknown as Session;
}
export function getSessionId(req: Request) { return req.cookies?.[SESSION_COOKIE] as string | undefined; }
export async function clearSession(res: Response, sid?: string) {
  if (sid) await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}
export function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL });
}
export async function upsertUser(claims: Record<string, unknown>) {
  const data = { id: String(claims.sub), email: typeof claims.email === "string" ? claims.email : null, firstName: typeof claims.first_name === "string" ? claims.first_name : null, lastName: typeof claims.last_name === "string" ? claims.last_name : null, profileImageUrl: typeof claims.picture === "string" ? claims.picture : null };
  const [user] = await db.insert(usersTable).values({ ...data, authProvider: "replit" }).onConflictDoUpdate({ target: usersTable.id, set: { ...data, updatedAt: new Date() } }).returning();
  return user;
}

export async function upsertGoogleUser(claims: Record<string, unknown>) {
  const googleId = String(claims.sub);
  const id = `google:${googleId}`;
  const data = { id, email: typeof claims.email === "string" ? claims.email : null, firstName: typeof claims.given_name === "string" ? claims.given_name : null, lastName: typeof claims.family_name === "string" ? claims.family_name : null, profileImageUrl: typeof claims.picture === "string" ? claims.picture : null, googleId, authProvider: "google" as const };
  const [existingByEmail] = data.email ? await db.select().from(usersTable).where(eq(usersTable.email, data.email)) : [];
  if (existingByEmail && existingByEmail.id !== id) {
    throw new Error("EMAIL_ALREADY_REGISTERED");
  }
  const [user] = await db.insert(usersTable).values(data).onConflictDoUpdate({ target: usersTable.id, set: { email: data.email, firstName: data.firstName, lastName: data.lastName, profileImageUrl: data.profileImageUrl, updatedAt: new Date() } }).returning();
  return user;
}

export function validatePassword(password: string) {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function findUserByEmail(email: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.trim().toLowerCase()));
  return user ?? null;
}

export async function createLocalUser(email: string, passwordHash: string) {
  const [user] = await db.insert(usersTable).values({ email: email.trim().toLowerCase(), passwordHash, authProvider: "password" }).returning();
  return user;
}

export async function createPasswordResetToken(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.insert(passwordResetTokensTable).values({ token, userId, expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL) });
  return token;
}

export async function consumePasswordResetToken(token: string) {
  const [row] = await db.select().from(passwordResetTokensTable).where(eq(passwordResetTokensTable.token, token));
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  await db.update(passwordResetTokensTable).set({ usedAt: new Date() }).where(eq(passwordResetTokensTable.token, token));
  return row.userId;
}