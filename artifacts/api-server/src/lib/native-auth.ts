// Native (iOS/Android) app sessions: opaque, server-revocable bearer tokens.
//
// Why a separate credential rather than the web `sid` cookie: the shell runs
// the bundled web app from capacitor://localhost / https://localhost, so the
// SameSite=Lax session cookie is never sent to the API. Instead the app holds
// a token in iOS Keychain / Android Keystore (see artifacts/tastekin/src/
// native.ts) and sends it as `Authorization: Bearer <token>`. The web's cookie
// path is untouched by any of this.
//
// Storage: only sha256(token) is persisted (native_sessions.token_hash). The
// plaintext exists once, in the login/signup response body, and is never
// logged. Lifetimes: 30 days idle (last_used_at), 180 days absolute
// (expires_at). Revocation is a row update and takes effect on the next
// request.
import crypto from "crypto";
import { db, nativeSessionsTable, sessionsTable, usersTable } from "@workspace/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Request } from "express";

export const NATIVE_SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const NATIVE_SESSION_ABSOLUTE_MS = 180 * 24 * 60 * 60 * 1000;
// last_used_at is written at most this often per session so the sliding idle
// window does not cost a write on every request.
const LAST_USED_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

export const NATIVE_PLATFORMS = ["ios", "android"] as const;
export type NativePlatform = (typeof NATIVE_PLATFORMS)[number];
export function isNativePlatform(value: unknown): value is NativePlatform {
  return typeof value === "string" && (NATIVE_PLATFORMS as readonly string[]).includes(value);
}

// 32 random bytes, base64url → 43 characters, no padding. Anything else is
// rejected before it reaches the database.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type NativeSessionUser = { id: string; email: string | null; firstName: string | null; lastName: string | null; profileImageUrl: string | null };

export function hashNativeToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getBearerToken(req: Request): string | null {
  const header = req.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export async function createNativeSession(input: { userId: string; platform: NativePlatform; appVersion?: string | null }): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + NATIVE_SESSION_ABSOLUTE_MS);
  await db.insert(nativeSessionsTable).values({
    userId: input.userId,
    tokenHash: hashNativeToken(token),
    platform: input.platform,
    appVersion: input.appVersion ?? null,
    expiresAt,
  });
  return { token, expiresAt };
}

export type ResolvedNativeSession = { session: { id: string; userId: string; platform: string }; user: NativeSessionUser };

/**
 * Resolves a bearer token to its session + a fresh user row, or null when the
 * token is malformed, unknown, revoked, idle-expired or absolutely expired.
 * Never throws for a bad token; database errors propagate to the caller.
 */
export async function resolveNativeSession(token: string): Promise<ResolvedNativeSession | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const now = new Date();
  const [row] = await db
    .select({ session: nativeSessionsTable, user: { id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName, profileImageUrl: usersTable.profileImageUrl } })
    .from(nativeSessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, nativeSessionsTable.userId))
    .where(and(eq(nativeSessionsTable.tokenHash, hashNativeToken(token)), isNull(nativeSessionsTable.revokedAt), gt(nativeSessionsTable.expiresAt, now)));
  if (!row) return null;
  if (row.session.lastUsedAt.getTime() + NATIVE_SESSION_IDLE_MS <= now.getTime()) return null;
  if (now.getTime() - row.session.lastUsedAt.getTime() >= LAST_USED_TOUCH_INTERVAL_MS) {
    await db.update(nativeSessionsTable).set({ lastUsedAt: now }).where(eq(nativeSessionsTable.id, row.session.id));
  }
  return { session: { id: row.session.id, userId: row.session.userId, platform: row.session.platform }, user: row.user };
}

export async function revokeNativeSession(id: string, reason: string): Promise<void> {
  await db.update(nativeSessionsTable).set({ revokedAt: new Date(), revokedReason: reason }).where(and(eq(nativeSessionsTable.id, id), isNull(nativeSessionsTable.revokedAt)));
}

export async function revokeAllNativeSessions(userId: string, reason: string): Promise<void> {
  await db.update(nativeSessionsTable).set({ revokedAt: new Date(), revokedReason: reason }).where(and(eq(nativeSessionsTable.userId, userId), isNull(nativeSessionsTable.revokedAt)));
}

/**
 * Web (cookie) sessions store the user inside the `sess` JSON, so revoking
 * them for one user is a JSON-path delete on the existing table — no schema
 * change. Used by password reset and "sign out everywhere".
 */
export async function revokeAllWebSessions(userId: string): Promise<void> {
  await db.delete(sessionsTable).where(sql`${sessionsTable.sess}->'user'->>'id' = ${userId}`);
}

export async function revokeEverySession(userId: string, reason: string): Promise<void> {
  await revokeAllNativeSessions(userId, reason);
  await revokeAllWebSessions(userId);
}
