// Regression coverage for the preview-deployment health/500 investigation:
//   - GET /api/healthz is a real, unauthenticated, dependency-free liveness route
//   - GET /api and unmatched /api/* paths are clean 404 JSON, never the SPA shell
//   - A database outage during session lookup (the actual root cause reproduced
//     during triage: an unguarded query inside authMiddleware) must never crash
//     the request pipeline for ANY route, cookie or not
//   - Replit OIDC login/callback degrade to a redirect with authError instead of
//     crashing when the provider is unreachable or rejects the request
//   - Settings APIs and Admin authorization are unaffected by any of the above
//
// Runs the compiled api-server against a REAL Postgres database (point
// DATABASE_URL at a disposable/test database — this creates real rows) and
// drives it over real HTTP.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:deployment-health
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

const goodDatabaseUrl = process.env.DATABASE_URL;
// Same host/port, deliberately wrong credentials — simulates the class of
// failure a misconfigured/unreachable preview-deployment database looks like,
// without needing a second real database.
const brokenDatabaseUrl = goodDatabaseUrl.replace(/:\/\/[^@]*@/, "://baduser:badpass@");

let nextPort = 24300;

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
  // A broken DB means /api/health (used below only for readiness of the HTTP
  // listener itself, not DB health) must still come up — poll /api/healthz
  // instead of /api/version, since /api/healthz is the one route this whole
  // suite guarantees never depends on the database.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
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
  async me() {
    const response = await this.request("/api/me");
    assert.equal(response.status, 200);
    return (await response.json()) as { isAdmin?: boolean; user: { id: string; email: string } | null };
  }
  async putSettings(body: Record<string, unknown>) {
    return this.request("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  async adminCreatorsStatus() {
    return (await this.request("/api/admin/creators")).status;
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
  console.log("Phase 1: healthy database — baseline behavior for /api, /api/healthz, and the SPA fallback boundary.");
  const healthy = await startServer({ DATABASE_URL: goodDatabaseUrl });
  try {
    await check("GET /api/healthz is unauthenticated, dependency-free, and 200", async () => {
      const response = await fetch(`${healthy.baseUrl}/api/healthz`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json() as Record<string, unknown>;
      assert.equal(body.status, "ok");
      // Must never expose secrets/user data — only the fixed status field.
      assert.deepEqual(Object.keys(body), ["status"]);
    });

    await check("GET /api/health (existing route) is unaffected", async () => {
      const response = await fetch(`${healthy.baseUrl}/api/health`);
      assert.equal(response.status, 200);
    });

    await check("GET /api (no matching route) is a clean 404 JSON, not the SPA shell or a crash", async () => {
      const response = await fetch(`${healthy.baseUrl}/api`);
      assert.equal(response.status, 404);
      assert.match(response.headers.get("content-type") ?? "", /json/);
    });

    await check("GET /api/does-not-exist is a clean 404 JSON", async () => {
      const response = await fetch(`${healthy.baseUrl}/api/does-not-exist`);
      assert.equal(response.status, 404);
      assert.match(response.headers.get("content-type") ?? "", /json/);
    });

    await check("a non-/api path still falls back to the SPA shell (200)", async () => {
      const response = await fetch(`${healthy.baseUrl}/some/client/route`);
      assert.equal(response.status, 200);
    });
  } finally {
    stopServer(healthy);
  }

  console.log("\nPhase 2: broken database (the reproduced root cause) — no route may 500, healthz must stay 200.");
  const broken = await startServer({ DATABASE_URL: brokenDatabaseUrl });
  try {
    const anyCookie = { headers: { cookie: "sid=nonexistent-session-id" } };

    await check("GET /api/healthz stays 200 even when the database is entirely unreachable", async () => {
      const response = await fetch(`${broken.baseUrl}/api/healthz`, anyCookie);
      assert.equal(response.status, 200);
    });

    await check("GET /api with a session cookie never 500s when the DB is down (this was the reproduced bug)", async () => {
      const response = await fetch(`${broken.baseUrl}/api`, anyCookie);
      assert.equal(response.status, 404, "must be the clean 404, not a crash");
    });

    await check("GET /api/me with a session cookie degrades to signed-out (200) instead of 500 when the DB is down", async () => {
      const response = await fetch(`${broken.baseUrl}/api/me`, anyCookie);
      assert.equal(response.status, 200);
      const body = await response.json() as { user: unknown };
      assert.equal(body.user, null);
    });

    await check("GET /api/login degrades to an authError redirect instead of crashing when the OIDC provider is unreachable", async () => {
      const response = await fetch(`${broken.baseUrl}/api/login`, { redirect: "manual" });
      assert.ok(response.status >= 300 && response.status < 400, `expected a redirect, got ${response.status}`);
      const location = response.headers.get("location") ?? "";
      assert.match(location, /authError=/);
    });

    await check("GET /api/callback with an explicit OIDC error param redirects with authError, never crashes or loops", async () => {
      const response = await fetch(`${broken.baseUrl}/api/callback?error=access_denied&error_description=denied`, { redirect: "manual" });
      assert.ok(response.status >= 300 && response.status < 400);
      const location = response.headers.get("location") ?? "";
      assert.match(location, /authError=/);
    });

    await check("GET /api/callback with a mismatched/missing state+code still safely redirects to /api/login", async () => {
      const response = await fetch(`${broken.baseUrl}/api/callback`, { redirect: "manual" });
      assert.ok(response.status >= 300 && response.status < 400);
      assert.match(response.headers.get("location") ?? "", /\/api\/login/);
    });
  } finally {
    stopServer(broken);
  }

  console.log("\nPhase 3: regression — Settings APIs and Admin authorization are unaffected by the health/auth-middleware changes.");
  const server = await startServer({ DATABASE_URL: goodDatabaseUrl });
  try {
    const email = `deploy-health-${suffix}@example.com`;
    const session = new Session(server.baseUrl);
    const user = await session.signup(email, PASSWORD);

    await check("Settings: unauthenticated PUT /api/settings is still 401", async () => {
      const anon = new Session(server.baseUrl);
      const response = await anon.putSettings({ language: "ar" });
      assert.equal(response.status, 401);
    });

    await check("Settings: an authenticated PUT/GET round trip still persists correctly", async () => {
      const put = await session.putSettings({ language: "ar", notifyPush: false });
      assert.equal(put.status, 200);
      const me = await session.me();
      assert.equal((me as { language?: string }).language, "ar");
    });

    await check("Admin: a normal user still gets 403 from an admin endpoint", async () => {
      assert.equal(await session.adminCreatorsStatus(), 403);
    });

    await check("Admin: granting admin via the existing script still works end-to-end", async () => {
      const tsxBin = path.join(repoRoot, "scripts/node_modules/.bin/tsx");
      const grant = await new Promise<{ code: number; stdout: string }>((resolve, reject) => {
        const child = spawn(tsxBin, [path.join(repoRoot, "scripts/src/admin-grant.ts"), "--user-id", user.user.id, "--yes"], {
          cwd: path.join(repoRoot, "scripts"),
          env: { ...process.env, DATABASE_URL: goodDatabaseUrl },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk) => { stdout += chunk.toString(); });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
      });
      assert.equal(grant.code, 0, grant.stdout);
      assert.equal(await isAdminInDb(user.user.id), true);
      const me = await session.me();
      assert.equal(me.isAdmin, true);
      assert.equal(await session.adminCreatorsStatus(), 200);
    });
  } finally {
    stopServer(server);
  }

  console.log("\nResults:");
  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`  ${result.ok ? "PASS" : "FAIL"} — ${result.name}`);
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} checks failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} deployment-health regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
