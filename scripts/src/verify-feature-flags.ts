// Automated regression coverage for the first-party feature-flag system.
// Runs the compiled api-server against a REAL Postgres database (point
// DATABASE_URL at a disposable/test database — this creates real rows) and
// drives it over real HTTP, so it exercises the actual route/middleware
// code path rather than a reimplementation.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:feature-flags
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, featureFlagAuditLog, featureFlags } from "@workspace/db";
import { eq } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

let nextPort = 24800;

type Server = { port: number; process: ChildProcess; baseUrl: string };

async function startServer(env: Record<string, string | undefined> = {}): Promise<Server> {
  const port = nextPort;
  nextPort += 1;
  const fullEnv: Record<string, string | undefined> = { ...process.env, ...env, PORT: String(port), NODE_ENV: "production" };
  const child = spawn("node", [serverEntry], { env: fullEnv, stdio: ["ignore", "pipe", "pipe"] });
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

async function expectStatus(response: Response, expected: number) {
  if (response.status !== expected) {
    const text = await response.text().catch(() => "");
    throw new Error(`expected status ${expected}, got ${response.status}: ${text}`);
  }
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
  async signup(email: string, password: string) {
    const response = await this.request("/api/auth/signup", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    await expectStatus(response, 201);
    return (await response.json()) as { user: { id: string; email: string } };
  }
  async me() {
    const response = await this.request("/api/me");
    await expectStatus(response, 200);
    return (await response.json()) as { isAdmin: boolean; googleAuthConfigured: boolean; featureFlags: Record<string, boolean> };
  }
  async listFlags() {
    return this.request("/api/admin/feature-flags");
  }
  async setFlag(key: string, enabled: boolean) {
    return this.request(`/api/admin/feature-flags/${encodeURIComponent(key)}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }),
    });
  }
  async flagAuditLog(key: string) {
    return this.request(`/api/admin/feature-flags/${encodeURIComponent(key)}/audit-log`);
  }
  async putSettings(body: Record<string, unknown>) {
    return this.request("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
}

const tsxBin = path.join(repoRoot, "scripts/node_modules/.bin/tsx");

async function runScript(scriptPath: string, args: string[]) {
  return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    const child = spawn(tsxBin, [scriptPath, ...args], { cwd: path.join(repoRoot, "scripts"), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stdout += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

async function resetFlagsToDefault() {
  // Every flag defaults to enabled — this restores that baseline after the
  // test suite so a later verify script (e.g. verify-settings.ts) never
  // inherits a flag this suite deliberately disabled mid-run.
  await db.delete(featureFlags);
  await db.delete(featureFlagAuditLog);
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
  await resetFlagsToDefault();
  // GOOGLE_CLIENT_ID/SECRET are set so googleAuthConfigured() (the env-only
  // check) is true — this isolates the google_sign_in *flag*'s own effect
  // from environment configuration, proving the flag is a genuine
  // independent gate rather than redundant with the env check.
  const server = await startServer({ GOOGLE_CLIENT_ID: "test-client-id", GOOGLE_CLIENT_SECRET: "test-client-secret" });
  try {
    const anon = new Session(server.baseUrl);
    const user = new Session(server.baseUrl);
    await user.signup(`member-${suffix}@example.com`, PASSWORD);
    const admin = new Session(server.baseUrl);
    const adminAccount = await admin.signup(`admin-${suffix}@example.com`, PASSWORD);
    const grant = await runScript(path.join(repoRoot, "scripts/src/admin-grant.ts"), ["--user-id", adminAccount.user.id, "--yes"]);
    assert.equal(grant.code, 0, `admin-grant should exit 0: ${grant.stdout}`);

    // --- 1. admin authorization ---
    await check("anonymous GET /api/admin/feature-flags is rejected with 403", async () => {
      assert.equal((await anon.listFlags()).status, 403);
    });
    await check("non-admin GET /api/admin/feature-flags is rejected with 403", async () => {
      assert.equal((await user.listFlags()).status, 403);
    });
    await check("non-admin PUT /api/admin/feature-flags/:key is rejected with 403", async () => {
      assert.equal((await user.setFlag("notification_preferences", false)).status, 403);
    });
    await check("admin GET /api/admin/feature-flags succeeds and lists the known flags, enabled by default", async () => {
      const response = await admin.listFlags();
      await expectStatus(response, 200);
      const payload = (await response.json()) as { flags: Array<{ key: string; enabled: boolean }> };
      const byKey = new Map(payload.flags.map((flag) => [flag.key, flag.enabled]));
      assert.equal(byKey.get("google_sign_in"), true, "google_sign_in must default to enabled — existing production behavior stays on");
      assert.equal(byKey.get("notification_preferences"), true, "notification_preferences must default to enabled — existing production behavior stays on");
    });

    // --- 2. unknown flags are rejected ---
    await check("PUT of an unknown flag key is rejected with 404", async () => {
      assert.equal((await admin.setFlag(`not-a-real-flag-${suffix}`, false)).status, 404);
    });
    await check("an unknown flag never appears in the admin listing", async () => {
      const response = await admin.listFlags();
      const payload = (await response.json()) as { flags: Array<{ key: string }> };
      assert.ok(!payload.flags.some((flag) => flag.key === `not-a-real-flag-${suffix}`));
    });

    // --- 3. Report/Block/Mute can never be disabled ---
    await check("Report, Block, and Mute are never registered as flags at all", async () => {
      const response = await admin.listFlags();
      const payload = (await response.json()) as { flags: Array<{ key: string }> };
      for (const protectedKey of ["report", "reports", "block", "blocks", "mute", "mutes"]) {
        assert.ok(!payload.flags.some((flag) => flag.key === protectedKey), `${protectedKey} must never be a flag`);
      }
    });
    await check("an explicit PUT attempt against a protected safety key is rejected outright (defense in depth)", async () => {
      for (const protectedKey of ["report", "reports", "block", "blocks", "mute", "mutes"]) {
        const response = await admin.setFlag(protectedKey, false);
        assert.ok(response.status === 400 || response.status === 404, `${protectedKey} attempt should be rejected, got ${response.status}`);
      }
    });

    // --- 4. enable/disable behavior + server-side enforcement (notification_preferences) ---
    await check("a signed-in user can change notification preferences while the flag is enabled", async () => {
      const response = await user.putSettings({ notifyPush: false });
      await expectStatus(response, 200);
    });
    await check("admin can disable the notification_preferences flag", async () => {
      const response = await admin.setFlag("notification_preferences", false);
      await expectStatus(response, 200);
      const payload = (await response.json()) as { key: string; enabled: boolean };
      assert.equal(payload.enabled, false);
    });
    await check("with the flag disabled, changing notifyPush/notifyEmail is rejected server-side (not just hidden client-side)", async () => {
      const response = await user.putSettings({ notifyPush: true });
      assert.equal(response.status, 403);
    });
    await check("with the flag disabled, a language-only settings update still works — enforcement is scoped to notification fields only", async () => {
      const response = await user.putSettings({ language: "ar" });
      await expectStatus(response, 200);
    });
    await check("re-enabling the flag restores the ability to change notification preferences", async () => {
      await expectStatus(await admin.setFlag("notification_preferences", true), 200);
      const response = await user.putSettings({ notifyPush: true });
      await expectStatus(response, 200);
    });

    // --- 5. enable/disable behavior + server-side enforcement (google_sign_in) ---
    await check("with GOOGLE_CLIENT_ID/SECRET configured and the flag enabled, /api/me reports Google sign-in as available", async () => {
      const me = await anon.me();
      assert.equal(me.googleAuthConfigured, true);
      assert.equal(me.featureFlags.google_sign_in, true);
    });
    await check("admin can disable the google_sign_in flag", async () => {
      const response = await admin.setFlag("google_sign_in", false);
      await expectStatus(response, 200);
    });
    await check("with the flag disabled, /api/me reports Google sign-in as unavailable even though env vars are configured", async () => {
      const me = await anon.me();
      assert.equal(me.googleAuthConfigured, false, "the server-computed flag must override the env-only check for the client-facing value");
      assert.equal(me.featureFlags.google_sign_in, false);
    });
    await check("with the flag disabled, GET /api/auth/google itself refuses to start the OAuth flow (server-side enforcement, not just a hidden button)", async () => {
      const response = await anon.request("/api/auth/google");
      assert.equal(response.status, 302);
      const location = response.headers.get("location") || "";
      assert.match(location, /authError=/, "must redirect with an auth error rather than proceeding to Google's OAuth discovery endpoint");
    });
    await check("re-enabling the flag restores Google sign-in availability", async () => {
      await expectStatus(await admin.setFlag("google_sign_in", true), 200);
      const me = await anon.me();
      assert.equal(me.googleAuthConfigured, true);
    });

    // --- 6. audit logging ---
    await check("every flag change is recorded in the feature-flag audit log with the correct admin, from, and to values", async () => {
      await expectStatus(await admin.setFlag("notification_preferences", false), 200);
      await expectStatus(await admin.setFlag("notification_preferences", true), 200);
      const response = await admin.flagAuditLog("notification_preferences");
      await expectStatus(response, 200);
      const payload = (await response.json()) as { entries: Array<{ adminUserId: string; adminEmail: string | null; fromEnabled: boolean; toEnabled: boolean }> };
      assert.ok(payload.entries.length >= 2, "both the disable and the re-enable must be recorded");
      const [mostRecent, previous] = payload.entries;
      assert.equal(mostRecent.toEnabled, true);
      assert.equal(mostRecent.fromEnabled, false);
      assert.equal(previous.toEnabled, false);
      assert.equal(mostRecent.adminUserId, adminAccount.user.id);
      assert.equal(mostRecent.adminEmail, `admin-${suffix}@example.com`);
    });
    await check("the audit log is backed by a real, queryable database row for each change", async () => {
      const rows = await db.select().from(featureFlagAuditLog).where(eq(featureFlagAuditLog.flagKey, "notification_preferences"));
      assert.ok(rows.length >= 2);
      assert.ok(rows.every((row) => row.adminUserId === adminAccount.user.id));
    });
    await check("non-admin GET of a flag's audit log is rejected with 403", async () => {
      assert.equal((await user.flagAuditLog("notification_preferences")).status, 403);
    });
  } finally {
    stopServer(server);
    await resetFlagsToDefault();
  }

  console.log("\nResults:");
  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`  ${result.ok ? "PASS" : "FAIL"} — ${result.name}`);
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} checks failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} feature-flag regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
