// Regression coverage for the production KIN Looks 500 caused by an
// unapplied migration (kin_search_usage — the table KIN's daily-quota
// reservation writes to before ever calling Claude):
//
//   - RUN_MIGRATIONS_ON_BOOT is off by default: a database missing the
//     latest tracked migrations still fails exactly as it does in
//     production today (documents the "before" state, and guarantees the
//     opt-in never changes behavior for local dev, preview, or any other
//     verify:* suite that doesn't set it).
//   - RUN_MIGRATIONS_ON_BOOT=true applies every not-yet-applied migration
//     from lib/db/migrations — via Drizzle's own tracked ledger, never
//     hand-edited, never manual SQL — before the server opens its HTTP
//     listener, and the previously-failing request succeeds immediately
//     after.
//   - Running it again against an already-migrated database is a safe,
//     fast no-op (idempotency).
//   - Two instances booting at once against the same not-yet-migrated
//     database (Autoscale can start more than one at a time) never race:
//     an advisory lock serializes them, and the ledger ends up with
//     exactly one row per migration, never duplicated.
//   - A migration failure is fatal: the server must never start accepting
//     traffic with a schema it doesn't match.
//
// Runs the compiled api-server against a REAL Postgres database (point
// DATABASE_URL at a disposable/test database — this drops and recreates
// tables in it — never production) and a real, minimal fake Anthropic
// provider, and drives it over real HTTP.
//
// Usage:
//   pnpm --filter db run push-force   # schema onto DATABASE_URL first
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:migrations
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database already schema-pushed via `pnpm --filter db run push-force`, never production.");
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;

// A tiny real HTTP server standing in for Anthropic — just enough for KIN
// Looks to reach "ok", so a 500 can only mean the database call failed.
function startFakeAnthropic(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/v1/messages") { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "msg_fake", type: "message", role: "assistant", model: "claude-sonnet-5",
        stop_sequence: null, usage: { input_tokens: 5, output_tokens: 5 }, stop_reason: "end_turn",
        content: [{ type: "text", text: "A warm, editorial answer.", citations: null }],
      }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve({ server, port: address.port });
      else reject(new Error("failed to bind fake Anthropic server"));
    });
    server.on("error", reject);
  });
}

/** Drops the tables introduced by the two most recent tracked migrations (0012, 0013) and the migration ledger itself — simulating "production has never run a migration," the actual reported state. */
async function resetToPreKinState() {
  await db.execute(sql`DROP TABLE IF EXISTS kin_trip_items, kin_trips, kin_saved_recommendations, kin_search_usage CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
}

async function ledgerRowCount(): Promise<number> {
  const exists = await db.execute(sql`select exists (select from information_schema.tables where table_schema = 'drizzle' and table_name = '__drizzle_migrations') as exists`);
  if (!(exists.rows[0] as { exists: boolean }).exists) return 0;
  const result = await db.execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations`);
  return (result.rows[0] as { count: number }).count;
}

let nextPort = 24900;
let fakeAnthropicPort = 0;

type Server = { port: number; process: ChildProcess; baseUrl: string; stdout: string };

/** Starts the built server and waits for it to become ready — or, if it never does within the deadline, returns whatever it logged so the caller can assert on the failure. */
function startServer(extraEnv: Record<string, string | undefined>): Promise<{ ready: true; server: Server } | { ready: false; stdout: string; process: ChildProcess }> {
  const port = nextPort;
  nextPort += 1;
  return new Promise((resolve) => {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PORT: String(port),
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      ANTHROPIC_API_KEY: "fake-test-key",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${fakeAnthropicPort}`,
      PRIVATE_OBJECT_DIR: "/closet-test-bucket/my-things",
      KIN_SEARCH_DAILY_LIMIT: "1000",
    };
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    const child = spawn("node", [serverEntry], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 15_000;
    let settled = false;
    child.on("exit", () => {
      if (!settled) { settled = true; resolve({ ready: false, stdout, process: child }); }
    });
    (async () => {
      while (Date.now() < deadline && !settled) {
        try {
          const response = await fetch(`${baseUrl}/api/healthz`);
          if (response.ok) { settled = true; resolve({ ready: true, server: { port, process: child, baseUrl, stdout } }); return; }
        } catch {
          // not up yet
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!settled) { settled = true; resolve({ ready: false, stdout, process: child }); }
    })();
  });
}

function stopServer(proc: ChildProcess) {
  proc.kill();
}

async function signupAndEnableKin(baseUrl: string, email: string): Promise<string> {
  const signup = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "regression-test-1234" }),
  });
  assert.equal(signup.status, 201, `signup for ${email} should succeed`);
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(cookie, "signup must set a session cookie");
  await db.execute(sql`update users set onboarding_completed_at = now() where email = ${email}`);
  await db.execute(sql`
    insert into feature_flags (key, description, enabled) values ('kin_search', 'KIN', true)
    on conflict (key) do update set enabled = true
  `);
  return cookie;
}

async function kinLooks(baseUrl: string, cookie: string): Promise<number> {
  const response = await fetch(`${baseUrl}/api/kin/search`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ mode: "looks", query: "a dinner outfit" }),
  });
  return response.status;
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
  const anthropic = await startFakeAnthropic();
  fakeAnthropicPort = anthropic.port;

  try {
    console.log("Phase 1: RUN_MIGRATIONS_ON_BOOT unset (today's actual behavior) — reproduces the reported 500.");
    await resetToPreKinState();
    {
      const started = await startServer({});
      assert.ok(started.ready, "server must still start even with no migration step (unaffected by default)");
      const server = (started as { ready: true; server: Server }).server;
      try {
        await check("with the env var unset, a database missing kin_search_usage still 500s on KIN Looks (the reported bug, unpatched)", async () => {
          const cookie = await signupAndEnableKin(server.baseUrl, `migtest-before-${Date.now()}@example.com`);
          const status = await kinLooks(server.baseUrl, cookie);
          assert.equal(status, 500);
        });
        await check("no migration log lines appear when the env var is unset", async () => {
          assert.doesNotMatch(server.stdout, /Running pending database migrations/);
        });
      } finally {
        stopServer(server.process);
      }
    }

    console.log("\nPhase 2: RUN_MIGRATIONS_ON_BOOT=true — migrates before accepting traffic, and the same request now succeeds.");
    await resetToPreKinState();
    {
      const started = await startServer({ RUN_MIGRATIONS_ON_BOOT: "true" });
      assert.ok(started.ready, "server must start once migrations complete");
      const server = (started as { ready: true; server: Server }).server;
      try {
        await check("the migration log line appears, and completes before 'Server listening'", async () => {
          const runningAt = server.stdout.indexOf("Running pending database migrations");
          const upToDateAt = server.stdout.indexOf("Database migrations up to date");
          const listeningAt = server.stdout.indexOf("Server listening");
          assert.ok(runningAt !== -1 && upToDateAt !== -1 && listeningAt !== -1, "all three log lines must appear");
          assert.ok(runningAt < upToDateAt && upToDateAt < listeningAt, "must complete migrating strictly before opening the HTTP listener");
        });
        await check("the ledger records exactly one row per migration file", async () => {
          assert.equal(await ledgerRowCount(), 14);
        });
        await check("KIN Looks now succeeds — kin_search_usage exists and quota reservation no longer throws", async () => {
          const cookie = await signupAndEnableKin(server.baseUrl, `migtest-after-${Date.now()}@example.com`);
          const status = await kinLooks(server.baseUrl, cookie);
          assert.equal(status, 200);
        });
      } finally {
        stopServer(server.process);
      }
    }

    console.log("\nPhase 3: idempotency — running again against an already-migrated database is a safe no-op.");
    {
      const started = await startServer({ RUN_MIGRATIONS_ON_BOOT: "true" });
      assert.ok(started.ready, "a second run against an already-migrated database must still start cleanly");
      const server = (started as { ready: true; server: Server }).server;
      try {
        await check("re-running migrations changes nothing and still reaches 'Server listening'", async () => {
          assert.match(server.stdout, /Database migrations up to date/);
          assert.equal(await ledgerRowCount(), 14);
        });
      } finally {
        stopServer(server.process);
      }
    }

    console.log("\nPhase 4: concurrent boots (Autoscale can start more than one instance at once) never race.");
    await resetToPreKinState();
    {
      const [a, b] = await Promise.all([
        startServer({ RUN_MIGRATIONS_ON_BOOT: "true" }),
        startServer({ RUN_MIGRATIONS_ON_BOOT: "true" }),
      ]);
      try {
        await check("both concurrently-booting instances start successfully", async () => {
          assert.ok(a.ready, "first instance must start");
          assert.ok(b.ready, "second instance must start");
        });
        await check("the ledger ends up with exactly one row per migration, never duplicated by the race", async () => {
          assert.equal(await ledgerRowCount(), 14);
        });
      } finally {
        if (a.ready) stopServer((a as { ready: true; server: Server }).server.process);
        else stopServer((a as { ready: false; process: ChildProcess }).process);
        if (b.ready) stopServer((b as { ready: true; server: Server }).server.process);
        else stopServer((b as { ready: false; process: ChildProcess }).process);
      }
    }

    console.log("\nPhase 5: a migration failure is fatal — never start accepting traffic with a schema the app doesn't match.");
    {
      const brokenUrl = databaseUrl.replace(/:\/\/[^@]*@/, "://baduser:badpass@");
      const started = await startServer({ RUN_MIGRATIONS_ON_BOOT: "true", DATABASE_URL: brokenUrl });
      await check("an unreachable database during migration prevents the server from ever listening", async () => {
        assert.equal(started.ready, false, "the server must not report ready");
        assert.doesNotMatch(started.stdout, /Server listening/);
        assert.match(started.stdout, /Database migration failed/);
      });
    }
  } finally {
    anthropic.server.close();
  }

  console.log("\nResults:");
  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`  ${result.ok ? "PASS" : "FAIL"} — ${result.name}`);
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} checks failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} migration regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
