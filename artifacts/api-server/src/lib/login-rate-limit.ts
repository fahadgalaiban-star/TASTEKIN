// Shared password-login throttle for BOTH the web route (POST /auth/login)
// and the native route (POST /auth/native/login): the same credentials sit
// behind both, so protecting only one would leave the other as the brute-force
// path.
//
// Counts FAILED attempts only, in two sliding windows: per client IP and per
// (normalized) email. A success clears the email bucket. The response for a
// throttled request is the same fixed 429 whether or not the account exists,
// so the limiter adds no enumeration signal.
//
// LIMITATION: state is process-local (a Map). In an autoscaled deployment
// with N instances an attacker gets roughly N× the budget, and a restart
// resets it. That is acceptable as a first line (bcrypt cost 12 already makes
// each guess expensive) and is documented in docs/MOBILE.md; a shared store
// (Postgres/Redis) can replace the Map behind the same two functions without
// touching the routes.
import type { Request, Response } from "express";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IP = 30;
const MAX_FAILURES_PER_EMAIL = 10;
const MAX_TRACKED_KEYS = 50_000;

type Bucket = { timestamps: number[] };
const buckets = new Map<string, Bucket>();

function prune(bucket: Bucket, now: number): void {
  const cutoff = now - WINDOW_MS;
  while (bucket.timestamps.length > 0 && bucket.timestamps[0] <= cutoff) bucket.timestamps.shift();
}

function failuresFor(key: string, now: number): number {
  const bucket = buckets.get(key);
  if (!bucket) return 0;
  prune(bucket, now);
  if (bucket.timestamps.length === 0) buckets.delete(key);
  return bucket.timestamps.length;
}

function clientKey(req: Request): string {
  // req.ip honours `trust proxy` (app.ts), i.e. the real client behind
  // Replit's edge, not the edge itself.
  return `ip:${req.ip ?? "unknown"}`;
}
function emailKey(email: string): string {
  return `email:${email.trim().toLowerCase()}`;
}

/** True when this attempt must be refused before any credential check. */
export function isLoginThrottled(req: Request, email: string): boolean {
  const now = Date.now();
  return failuresFor(clientKey(req), now) >= MAX_FAILURES_PER_IP || failuresFor(emailKey(email), now) >= MAX_FAILURES_PER_EMAIL;
}

export function recordLoginFailure(req: Request, email: string): void {
  const now = Date.now();
  if (buckets.size >= MAX_TRACKED_KEYS) {
    // Bounded memory: drop everything rather than grow without limit under a
    // flood; the bcrypt cost remains as the floor.
    buckets.clear();
  }
  for (const key of [clientKey(req), emailKey(email)]) {
    const bucket = buckets.get(key) ?? { timestamps: [] };
    prune(bucket, now);
    bucket.timestamps.push(now);
    buckets.set(key, bucket);
  }
}

export function recordLoginSuccess(email: string): void {
  buckets.delete(emailKey(email));
}

export function sendLoginThrottled(res: Response): void {
  res.set("Retry-After", String(Math.ceil(WINDOW_MS / 1000)));
  res.status(429).json({ error: "Too many sign-in attempts. Please try again later." });
}

/** Test hook (verify scripts): the current window/limits, never mutated at runtime. */
export const LOGIN_RATE_LIMIT = { windowMs: WINDOW_MS, maxFailuresPerIp: MAX_FAILURES_PER_IP, maxFailuresPerEmail: MAX_FAILURES_PER_EMAIL } as const;
