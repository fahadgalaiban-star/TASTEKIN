import crypto from "crypto";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";

export const SESSION_COOKIE = "sid";
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
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
  const [user] = await db.insert(usersTable).values(data).onConflictDoUpdate({ target: usersTable.id, set: { ...data, updatedAt: new Date() } }).returning();
  return user;
}