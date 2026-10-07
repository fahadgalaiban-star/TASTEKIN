// Store-readiness honesty checks for the account surfaces, driven over real
// HTTP against the compiled api-server and a REAL Postgres database (point
// DATABASE_URL at a disposable/test database — this creates real rows):
//
//  1. Password reset: no transactional email provider exists, so GET /api/me
//     reports `passwordResetAvailable: false` and POST /api/auth/forgot-password
//     answers 503 `password_reset_unavailable` for EVERY email (never a
//     "link sent" claim), naming the configured SUPPORT_EMAIL when there is one
//     and nothing invented when there is not.
//  2. Password settings: GET /api/me carries `authProvider` for the signed-in
//     account ("password" for email/password signups) and never for guests.
//  3. Notification controls: the `notification_preferences` flag defaults to
//     OFF, so /api/me reports it false and PUT /api/settings refuses
//     notifyPush/notifyEmail until an admin enables it.
//  4. Support contact: /api/me exposes exactly the configured SUPPORT_EMAIL,
//     or null when unset.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:app-readiness
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, featureFlags } from "@workspace/db";
import { eq } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

let nextPort = 24400;
type Server = { port: number; process: ChildProcess; baseUrl: string };

async function startServer(extraEnv: Record<string, string | undefined> = {}): Promise<Server> {
  const port = nextPort;
  nextPort += 1;
  const env: Record<string, string | undefined> = { ...process.env, PORT: String(port), NODE_ENV: "production", ...extraEnv };
  for (const [key, value] of Object.entries(extraEnv)) if (value === undefined) delete env[key];
  const child = spawn("node", [serverEntry], { env, stdio: ["ignore", "pipe", "pipe"] });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/version`);
      if (response.ok) return { port, process: child, baseUrl };
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`Server on port ${port} did not become ready in time`);
}

class Session {
  cookie: string | null = null;
  constructor(private baseUrl: string) {}
  async request(pathName: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    const response = await fetch(`${this.baseUrl}${pathName}`, { ...init, headers, redirect: "manual" });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    return response;
  }
  json(pathName: string, body: unknown) {
    return this.request(pathName, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  async me() {
    const response = await this.request("/api/me");
    assert.equal(response.status, 200);
    return (await response.json()) as Record<string, unknown> & { featureFlags: Record<string, boolean> };
  }
}

type ForgotResponse = { status: number; body: { error?: string; message?: string; code?: string } };
async function forgot(session: Session, email: string): Promise<ForgotResponse> {
  const response = await session.json("/api/auth/forgot-password", { email });
  return { status: response.status, body: (await response.json()) as ForgotResponse["body"] };
}

const results: Array<{ name: string; ok: boolean; error?: string }> = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok — ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
    console.log(`  FAIL — ${name}`);
    console.log(`    ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  console.log("App readiness: honest password reset, password settings, hidden notification controls, support contact.");
  const suffix = Date.now();
  // Any override left behind by another verifier must not mask the default.
  await db.delete(featureFlags).where(eq(featureFlags.key, "notification_preferences"));

  const noSupport = await startServer({ SUPPORT_EMAIL: undefined });
  try {
    const anon = new Session(noSupport.baseUrl);
    const member = new Session(noSupport.baseUrl);
    const email = `readiness-${suffix}@example.com`;

    await check("guest /api/me: passwordResetAvailable is false, no authProvider, supportEmail null, notification flag off", async () => {
      const me = await anon.me();
      assert.equal(me.passwordResetAvailable, false);
      assert.equal("authProvider" in me, false, "guests have no sign-in method to describe");
      assert.equal(me.supportEmail, null);
      assert.equal(me.featureFlags.notification_preferences, false);
    });

    await check("an email/password signup is described as authProvider 'password' on /api/me", async () => {
      const response = await member.json("/api/auth/signup", { email, password: "readiness-pass-1234" });
      assert.equal(response.status, 201);
      const me = await member.me();
      assert.equal(me.authProvider, "password");
      assert.equal(me.passwordResetAvailable, false);
    });

    await check("forgot-password never claims an email was sent: 503 password_reset_unavailable for a real account", async () => {
      const result = await forgot(anon, email);
      assert.equal(result.status, 503);
      assert.equal(result.body.code, "password_reset_unavailable");
      assert.equal(result.body.message, undefined, "no 'reset link has been sent' message");
      assert.match(result.body.error ?? "", /not available yet/);
      assert.doesNotMatch(result.body.error ?? "", /@/, "no contact address is invented when SUPPORT_EMAIL is unset");
    });

    await check("the unavailable answer is identical for an unknown email (no account enumeration)", async () => {
      const known = await forgot(anon, email);
      const unknown = await forgot(anon, `nobody-${suffix}@example.com`);
      assert.equal(unknown.status, 503);
      assert.deepEqual(unknown.body, known.body);
    });

    await check("a missing email is still a 400, not an unavailable notice", async () => {
      assert.equal((await forgot(anon, "")).status, 400);
    });

    await check("with the notification flag at its default, PUT /api/settings refuses notifyPush and notifyEmail but still accepts language", async () => {
      const refused = await member.request("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ notifyPush: false }) });
      assert.equal(refused.status, 403);
      const refusedEmail = await member.request("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ notifyEmail: false }) });
      assert.equal(refusedEmail.status, 403);
      const language = await member.request("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: "ar" }) });
      assert.equal(language.status, 200);
      const me = await member.me();
      assert.equal(me.notifyPush, true, "stored preference untouched");
      assert.equal(me.language, "ar");
    });
  } finally {
    noSupport.process.kill();
  }

  const supportAddress = `support-${suffix}@example.test`;
  const withSupport = await startServer({ SUPPORT_EMAIL: supportAddress });
  try {
    const anon = new Session(withSupport.baseUrl);
    await check("with SUPPORT_EMAIL set, /api/me exposes exactly that address and the forgot-password notice points to it", async () => {
      const me = await anon.me();
      assert.equal(me.supportEmail, supportAddress);
      const result = await forgot(anon, `anyone-${suffix}@example.com`);
      assert.equal(result.status, 503);
      assert.equal(result.body.code, "password_reset_unavailable");
      assert.ok(result.body.error?.includes(supportAddress), `error should name ${supportAddress}: ${result.body.error}`);
      assert.equal(result.body.message, undefined);
    });
  } finally {
    withSupport.process.kill();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
