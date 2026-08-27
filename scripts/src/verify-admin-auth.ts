// Automated regression coverage for the Admin authorization architecture.
// Runs the compiled api-server against a REAL Postgres database (point
// DATABASE_URL at a disposable/test database — this creates real rows) and
// drives it over real HTTP, so it exercises the actual route/middleware
// code path rather than a reimplementation.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:admin-auth
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

let nextPort = 24100;

type Server = { port: number; process: ChildProcess; baseUrl: string };

async function startServer(extraEnv: Record<string, string | undefined> = {}): Promise<Server> {
  const port = nextPort;
  nextPort += 1;
  const env: Record<string, string | undefined> = { ...process.env, PORT: String(port), NODE_ENV: "production", ...extraEnv };
  // Explicitly unset keys whose value is undefined, so a phase can remove an
  // env var entirely rather than merely leaving it at its prior value.
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
    return (await response.json()) as { isAdmin: boolean; user: { id: string; email: string } | null };
  }
  async adminCreatorsStatus() {
    const response = await this.request("/api/admin/creators");
    return response.status;
  }
}

const tsxBin = path.join(repoRoot, "scripts/node_modules/.bin/tsx");

async function runScript(scriptPath: string, args: string[], env: Record<string, string | undefined> = {}) {
  return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    const child = spawn(tsxBin, [scriptPath, ...args], {
      cwd: path.join(repoRoot, "scripts"),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stdout += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
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
  let grantedAdminId: string | undefined;
  let grantedAdminEmail: string | undefined;

  console.log("Phase 1: baseline — no env vars matching anyone, admin-grant/admin-revoke used explicitly.");
  const server1 = await startServer({ FOUNDER_EMAIL: undefined, FOUNDER_AUTH_USER_ID: undefined, ADMIN_AUTH_USER_IDS: undefined });
  try {
    const adminEmail = `admin-target-${suffix}@example.com`;
    const normalEmail = `normal-user-${suffix}@example.com`;

    const adminSession = new Session(server1.baseUrl);
    const admin = await adminSession.signup(adminEmail, PASSWORD);

    const normalSession = new Session(server1.baseUrl);
    await normalSession.signup(normalEmail, PASSWORD);

    await check("a freshly signed-up user is not an admin", async () => {
      const me = await adminSession.me();
      assert.equal(me.isAdmin, false);
      assert.equal(await adminSession.adminCreatorsStatus(), 403);
    });

    await check("normal user never sees admin access (403 from admin endpoint)", async () => {
      assert.equal(await normalSession.adminCreatorsStatus(), 403);
    });

    await check("unauthenticated request gets 403, not 500, from an admin endpoint", async () => {
      const anon = new Session(server1.baseUrl);
      assert.equal(await anon.adminCreatorsStatus(), 403);
    });

    await check("admin-grant script grants admin by exact user id, and is_admin=true now works", async () => {
      const grant = await runScript(path.join(repoRoot, "scripts/src/admin-grant.ts"), ["--user-id", admin.user.id, "--yes"]);
      assert.equal(grant.code, 0, `admin-grant should exit 0: ${grant.stdout}`);
      assert.match(grant.stdout, /Granted admin/);
      assert.equal(await isAdminInDb(admin.user.id), true);
      const me = await adminSession.me();
      assert.equal(me.isAdmin, true);
      assert.equal(await adminSession.adminCreatorsStatus(), 200);
    });

    await check("admin-revoke script revokes admin, and the same user immediately gets 403", async () => {
      const revoke = await runScript(path.join(repoRoot, "scripts/src/admin-revoke.ts"), ["--user-id", admin.user.id, "--yes"]);
      assert.equal(revoke.code, 0, `admin-revoke should exit 0: ${revoke.stdout}`);
      assert.match(revoke.stdout, /Revoked admin/);
      assert.equal(await isAdminInDb(admin.user.id), false);
      const me = await adminSession.me();
      assert.equal(me.isAdmin, false);
      assert.equal(await adminSession.adminCreatorsStatus(), 403);
    });

    await check("switching sessions does not retain admin access", async () => {
      // re-grant so there is something to lose
      const grant = await runScript(path.join(repoRoot, "scripts/src/admin-grant.ts"), ["--user-id", admin.user.id, "--yes"]);
      assert.equal(grant.code, 0, grant.stdout);
      const shared = new Session(server1.baseUrl);
      await shared.login(adminEmail, PASSWORD);
      assert.equal((await shared.me()).isAdmin, true);
      await shared.logout();
      await shared.login(normalEmail, PASSWORD);
      assert.equal((await shared.me()).isAdmin, false, "the same cookie jar must not carry over the previous account's admin status");
      assert.equal(await shared.adminCreatorsStatus(), 403);
      // leave admin's own flag as granted for the next phase's "removal" check
    });

    grantedAdminId = admin.user.id;
    grantedAdminEmail = adminEmail;
  } finally {
    stopServer(server1);
  }

  console.log("\nPhase 2: a matching FOUNDER_EMAIL must not grant admin to an unflagged account.");
  const server2 = await startServer({ FOUNDER_EMAIL: `unflagged-${suffix}@example.com`, FOUNDER_AUTH_USER_ID: undefined });
  try {
    const session = new Session(server2.baseUrl);
    // deliberately signs up AFTER the server already has this exact email configured as FOUNDER_EMAIL
    const unflaggedEmail = `unflagged-${suffix}@example.com`;
    const user = await session.signup(unflaggedEmail, PASSWORD);
    await check("a matching email alone never grants admin at request time", async () => {
      assert.equal(await isAdminInDb(user.user.id), false, "signup must never set is_admin, regardless of FOUNDER_EMAIL");
      const me = await session.me();
      assert.equal(me.isAdmin, false);
      assert.equal(await session.adminCreatorsStatus(), 403);
    });
  } finally {
    stopServer(server2);
  }

  console.log("\nPhase 3: removing/changing env vars must not alter an existing database role.");
  const server3 = await startServer({ FOUNDER_EMAIL: `someone-else-${suffix}@example.com`, FOUNDER_AUTH_USER_ID: undefined, ADMIN_AUTH_USER_IDS: undefined });
  try {
    assert.ok(grantedAdminId && grantedAdminEmail, "phase 1 must have produced a granted admin account to test against");
    const adminId = grantedAdminId;
    const adminEmail = grantedAdminEmail;
    const session = new Session(server3.baseUrl);
    await check("an existing is_admin=true row stays true when FOUNDER_EMAIL/FOUNDER_AUTH_USER_ID point elsewhere or are absent", async () => {
      assert.equal(await isAdminInDb(adminId), true, "phase 1 left this account granted");
      await session.login(adminEmail, PASSWORD);
      const me = await session.me();
      assert.equal(me.isAdmin, true, "the database flag must be authoritative regardless of the current env configuration");
      assert.equal(await session.adminCreatorsStatus(), 200);
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
  console.log(`\nAll ${results.length} admin-authorization regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
