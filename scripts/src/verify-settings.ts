// Automated regression coverage for the Settings page's server-backed
// preferences (language, push/email notification flags) and for the
// account isolation and authorization rules those APIs must uphold.
// Runs the compiled api-server against a REAL Postgres database (point
// DATABASE_URL at a disposable/test database — this creates real rows) and
// drives it over real HTTP, so it exercises the actual route/middleware
// code path rather than a reimplementation.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:settings
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

let nextPort = 24200;

type Server = { port: number; process: ChildProcess; baseUrl: string };

async function startServer(extraEnv: Record<string, string | undefined> = {}): Promise<Server> {
  const port = nextPort;
  nextPort += 1;
  const env: Record<string, string | undefined> = { ...process.env, PORT: String(port), NODE_ENV: "production", ...extraEnv };
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
  }
  const child = spawn("node", [serverEntry], { env, stdio: ["ignore", "pipe", "pipe"] });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/version`);
      if (response.ok) return { port, process: child, baseUrl };
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`Server on port ${port} did not become ready in time`);
}

function stopServer(server: Server) {
  server.process.kill();
}

// --- tiny per-user cookie jar over fetch, since Node's fetch has none ---
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
  async signup(email: string, password: string) {
    const response = await this.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 201, `signup for ${email} should succeed`);
    return (await response.json()) as { user: { id: string; email: string } };
  }
  async login(email: string, password: string) {
    const response = await this.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200, `login for ${email} should succeed`);
  }
  async logout() {
    await this.request("/api/logout");
  }
  async me() {
    const response = await this.request("/api/me");
    assert.equal(response.status, 200);
    return (await response.json()) as {
      isAdmin: boolean;
      user: { id: string; email: string } | null;
      language: string | null;
      notifyPush: boolean;
      notifyEmail: boolean;
      subscribed: boolean;
      supportEmail: string | null;
      googleAuthConfigured: boolean;
    };
  }
  async putSettings(body: Record<string, unknown>) {
    return this.request("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  async adminCreatorsStatus() {
    const response = await this.request("/api/admin/creators");
    return response.status;
  }
}

async function isAdminInDb(userId: string) {
  const [row] = await db.select({ isAdmin: usersTable.isAdmin }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return row?.isAdmin ?? null;
}

const suffix = Date.now();
const PASSWORD = "regression-test-1234";
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
  console.log("Settings regression: persistence, isolation, authorization, and admin-access non-regression.");
  const server = await startServer();
  try {
    const emailA = `settings-a-${suffix}@example.com`;
    const emailB = `settings-b-${suffix}@example.com`;

    const a = new Session(server.baseUrl);
    const userA = await a.signup(emailA, PASSWORD);

    const b = new Session(server.baseUrl);
    const userB = await b.signup(emailB, PASSWORD);

    await check("a fresh account has the honest defaults from /api/me", async () => {
      const me = await a.me();
      assert.equal(me.language, "en");
      assert.equal(me.notifyPush, true);
      assert.equal(me.notifyEmail, true);
      assert.equal(me.subscribed, false, "no subscriptions table exists yet — must never be simulated as true");
    });

    await check("unauthenticated PUT /api/settings is rejected with 401", async () => {
      const anon = new Session(server.baseUrl);
      const response = await anon.putSettings({ language: "ar" });
      assert.equal(response.status, 401);
    });

    await check("an invalid language value is rejected with 400 and does not change the row", async () => {
      const response = await a.putSettings({ language: "fr" });
      assert.equal(response.status, 400);
      const me = await a.me();
      assert.equal(me.language, "en");
    });

    await check("an invalid notifyPush type is rejected with 400", async () => {
      const response = await a.putSettings({ notifyPush: "yes" });
      assert.equal(response.status, 400);
    });

    await check("an empty body is rejected with 400", async () => {
      const response = await a.putSettings({});
      assert.equal(response.status, 400);
    });

    await check("a valid PUT updates language and is reflected on the next /api/me", async () => {
      const response = await a.putSettings({ language: "ar" });
      assert.equal(response.status, 200);
      const me = await a.me();
      assert.equal(me.language, "ar");
      // untouched fields must survive a partial update unchanged
      assert.equal(me.notifyPush, true);
      assert.equal(me.notifyEmail, true);
    });

    await check("a partial PUT of only notifyPush does not clobber language or notifyEmail", async () => {
      const response = await a.putSettings({ notifyPush: false });
      assert.equal(response.status, 200);
      const me = await a.me();
      assert.equal(me.language, "ar", "language set in the previous check must persist");
      assert.equal(me.notifyPush, false);
      assert.equal(me.notifyEmail, true);
    });

    await check("account B is fully isolated from account A's settings changes", async () => {
      const me = await b.me();
      assert.equal(me.language, "en");
      assert.equal(me.notifyPush, true);
      assert.equal(me.notifyEmail, true);
    });

    await check("account B changing its own settings never affects account A", async () => {
      const response = await b.putSettings({ language: "en", notifyEmail: false });
      assert.equal(response.status, 200);
      const meA = await a.me();
      assert.equal(meA.language, "ar");
      assert.equal(meA.notifyPush, false);
      assert.equal(meA.notifyEmail, true);
      const meB = await b.me();
      assert.equal(meB.notifyEmail, false);
    });

    await check("settings persist in the database, not session memory: sign out, sign in again, values survive", async () => {
      await a.logout();
      const meAfterLogout = await a.me();
      assert.equal(meAfterLogout.user, null, "sign out must clear the session");
      const freshA = new Session(server.baseUrl);
      await freshA.login(emailA, PASSWORD);
      const me = await freshA.me();
      assert.equal(me.language, "ar");
      assert.equal(me.notifyPush, false);
      assert.equal(me.notifyEmail, true);
    });

    await check("sign out clears the session cookie's authentication (subsequent /api/me is anonymous)", async () => {
      const fresh = new Session(server.baseUrl);
      await fresh.login(emailB, PASSWORD);
      assert.ok((await fresh.me()).user, "sanity: logged in");
      await fresh.logout();
      const me = await fresh.me();
      assert.equal(me.user, null);
      assert.ok(!me.isAdmin, "an anonymous session must never report admin access");
    });

    await check("regression: admin authorization is unaffected by the settings feature (non-admin gets 403)", async () => {
      const fresh = new Session(server.baseUrl);
      await fresh.login(emailB, PASSWORD);
      assert.equal(await fresh.adminCreatorsStatus(), 403);
    });

    await check("regression: granting admin still works end-to-end alongside settings changes", async () => {
      const tsxBin = path.join(repoRoot, "scripts/node_modules/.bin/tsx");
      const grant = await new Promise<{ code: number; stdout: string }>((resolve, reject) => {
        const child = spawn(tsxBin, [path.join(repoRoot, "scripts/src/admin-grant.ts"), "--user-id", userB.user.id, "--yes"], {
          cwd: path.join(repoRoot, "scripts"),
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk) => { stdout += chunk.toString(); });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
      });
      assert.equal(grant.code, 0, `admin-grant should exit 0: ${grant.stdout}`);
      assert.equal(await isAdminInDb(userB.user.id), true);
      const fresh = new Session(server.baseUrl);
      await fresh.login(emailB, PASSWORD);
      const me = await fresh.me();
      assert.equal(me.isAdmin, true);
      // Admin's own settings must still read back correctly alongside the elevated role.
      assert.equal(me.notifyEmail, false);
      assert.equal(await fresh.adminCreatorsStatus(), 200);
    });

    await check("supportEmail is absent by default (no hardcoded fallback) unless SUPPORT_EMAIL is configured", async () => {
      const me = await a.me();
      assert.equal(me.supportEmail, null);
    });

    await check("googleAuthConfigured is false by default (no GOOGLE_CLIENT_ID) — the sign-in screen must not offer Google", async () => {
      const anon = new Session(server.baseUrl);
      assert.equal((await anon.me()).googleAuthConfigured, false, "must be false for a signed-out visitor too, since that's who sees the sign-in screen");
      assert.equal((await a.me()).googleAuthConfigured, false);
    });

    void userA;
  } finally {
    stopServer(server);
  }

  console.log("\nPhase 2: SUPPORT_EMAIL, when configured, is surfaced verbatim by /api/me.");
  const server2 = await startServer({ SUPPORT_EMAIL: "support@example.com" });
  try {
    const session = new Session(server2.baseUrl);
    await session.signup(`settings-support-${suffix}@example.com`, PASSWORD);
    await check("a configured SUPPORT_EMAIL is returned to authenticated users", async () => {
      const me = await session.me();
      assert.equal(me.supportEmail, "support@example.com");
    });
  } finally {
    stopServer(server2);
  }

  console.log("\nPhase 3: GOOGLE_CLIENT_ID, when configured, flips googleAuthConfigured to true.");
  const server3 = await startServer({ GOOGLE_CLIENT_ID: "test-google-client-id" });
  try {
    const anon = new Session(server3.baseUrl);
    await check("a configured GOOGLE_CLIENT_ID makes googleAuthConfigured true, even for a signed-out visitor", async () => {
      assert.equal((await anon.me()).googleAuthConfigured, true);
    });
  } finally {
    stopServer(server3);
  }

  console.log("\nResults:");
  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`  ${result.ok ? "PASS" : "FAIL"} — ${result.name}`);
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} checks failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} settings regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
