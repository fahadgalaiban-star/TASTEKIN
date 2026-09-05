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
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, pool, runPendingMigrations } from "@workspace/db";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");
const realMigrationsFolder = path.join(repoRoot, "lib/db/migrations");

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

/**
 * Builds a ledger that stops exactly at `throughTag` — reproducing the
 * real reported Production state (the ledger records 0012/0013 with
 * hashes matching the deployed files) without ever touching the real
 * ledger by hand: a temp migrations folder holding only the migration
 * files up to and including `throughTag` (a trimmed copy of the real
 * meta/_journal.json, plus copies of just those .sql files) is handed to
 * Drizzle's own migrate(), so every ledger row it writes is exactly what
 * Drizzle itself would have written after a real boot that stopped there.
 */
async function buildLedgerThrough(throughTag: string): Promise<void> {
  const journal = JSON.parse(fs.readFileSync(path.join(realMigrationsFolder, "meta/_journal.json"), "utf8")) as {
    version: string;
    dialect: string;
    entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
  };
  const cutoffIdx = journal.entries.findIndex((entry) => entry.tag === throughTag);
  assert.notEqual(cutoffIdx, -1, `${throughTag} must exist in meta/_journal.json`);
  const trimmedEntries = journal.entries.slice(0, cutoffIdx + 1);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kin-ledger-fixture-"));
  try {
    fs.mkdirSync(path.join(tempDir, "meta"));
    fs.writeFileSync(path.join(tempDir, "meta/_journal.json"), JSON.stringify({ ...journal, entries: trimmedEntries }));
    for (const entry of trimmedEntries) {
      fs.copyFileSync(path.join(realMigrationsFolder, `${entry.tag}.sql`), path.join(tempDir, `${entry.tag}.sql`));
    }
    await migrate(db, { migrationsFolder: tempDir });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Drops only the KIN tables, leaving the ledger exactly as-is — the actual reported mismatch (ledger says 0012/0013 applied; the tables they create are absent), as opposed to resetToPreKinState's "migrations never ran at all." */
async function dropKinTablesOnly() {
  await db.execute(sql`DROP TABLE IF EXISTS kin_trip_items, kin_trips, kin_saved_recommendations, kin_search_usage CASCADE`);
}

const REQUIRED_KIN_TABLES = ["kin_search_usage", "kin_saved_recommendations", "kin_trips", "kin_trip_items"];

async function missingKinTables(): Promise<string[]> {
  const missing: string[] = [];
  for (const table of REQUIRED_KIN_TABLES) {
    const result = await db.execute(sql`select to_regclass(${"public." + table}) as reg`);
    if (!(result.rows[0] as { reg: string | null }).reg) missing.push(table);
  }
  return missing;
}

/** Every foreign key and index migrations 0012/0013 (recreated by 0014) are supposed to have left behind. */
async function kinConstraintAndIndexNames(): Promise<{ constraints: string[]; indexes: string[] }> {
  const constraints = await db.execute(sql`
    select conname from pg_constraint
    where conname in (
      'kin_search_usage_owner_user_id_users_id_fk',
      'kin_saved_recommendations_owner_user_id_users_id_fk',
      'kin_trips_owner_user_id_users_id_fk',
      'kin_trip_items_trip_id_kin_trips_id_fk',
      'kin_trip_items_owner_user_id_users_id_fk'
    )
  `);
  const indexes = await db.execute(sql`
    select indexname from pg_indexes
    where indexname in (
      'kin_search_usage_owner_created_idx',
      'kin_saved_recommendations_owner_created_idx',
      'kin_trips_owner_created_idx',
      'kin_trip_items_trip_idx',
      'kin_trip_items_owner_idx'
    )
  `);
  return {
    constraints: (constraints.rows as Array<{ conname: string }>).map((row) => row.conname).sort(),
    indexes: (indexes.rows as Array<{ indexname: string }>).map((row) => row.indexname).sort(),
  };
}

async function migrationRowCountFor(tag: string): Promise<number> {
  // Drizzle's ledger stores each migration's sha256 hash, not its tag —
  // recover the count by tag via the same hash the real folder produces.
  const query = fs.readFileSync(path.join(realMigrationsFolder, `${tag}.sql`), "utf8");
  const hash = crypto.createHash("sha256").update(query).digest("hex");
  const result = await db.execute(sql`select count(*)::int as count from drizzle.__drizzle_migrations where hash = ${hash}`);
  return (result.rows[0] as { count: number }).count;
}

/**
 * A throwaway single-file migration folder containing exactly `sqlBody` —
 * used only to fabricate wedged-statement fixtures for the cancellation
 * tests below. Caller must fs.rmSync the returned path.
 *
 * Drizzle's migrate() decides whether to run a migration by comparing its
 * journal `when` against the newest `created_at` already in
 * drizzle.__drizzle_migrations — a ledger shared by every migrationsFolder
 * against the same database, real ones included. `when` here is set far
 * beyond any realistic real value so this fixture is never mistaken for
 * "already applied" by a database this suite has already migrated.
 */
function writeSingleMigrationFolder(sqlBody: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kin-cancellation-fixture-"));
  fs.mkdirSync(path.join(tempDir, "meta"));
  fs.writeFileSync(path.join(tempDir, "0000_fixture.sql"), sqlBody);
  fs.writeFileSync(
    path.join(tempDir, "meta/_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", when: 9_999_999_999_999, tag: "0000_fixture", breakpoints: true }] }),
  );
  return tempDir;
}

const MIGRATION_ADVISORY_LOCK_KEY = 727_273_001_001;

/** True if the migration advisory lock is currently free — acquires it non-blockingly (pg_try_advisory_lock) and immediately releases it if so. */
async function migrationLockIsFree(): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [MIGRATION_ADVISORY_LOCK_KEY]);
    const acquired = (result.rows[0] as { acquired: boolean }).acquired;
    if (acquired) await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
    return acquired;
  } finally {
    client.release();
  }
}

/** Count of backends still actively running a pg_sleep — proof (or disproof) that migration SQL is really still executing server-side, independent of whatever the client-side promise did. */
async function activeSleepBackendCount(): Promise<number> {
  const result = await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep%' AND state = 'active'");
  return (result.rows[0] as { n: number }).n;
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
          assert.equal(await ledgerRowCount(), 15);
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
          assert.equal(await ledgerRowCount(), 15);
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
          assert.equal(await ledgerRowCount(), 15);
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

    console.log("\nPhase 6: the reported Production incident — ledger records 0012/0013 as applied (real hashes, via Drizzle's own migrate()), but the tables those migrations create are absent. Migration 0014 repairs this additively.");
    await resetToPreKinState();
    await buildLedgerThrough("0013_kin_looks_travel");
    await dropKinTablesOnly();
    {
      await check("fixture reproduces the exact reported state: ledger has 0000-0013 (14 rows), KIN tables are absent", async () => {
        assert.equal(await ledgerRowCount(), 14);
        assert.deepEqual(await missingKinTables(), REQUIRED_KIN_TABLES);
      });

      const started = await startServer({ RUN_MIGRATIONS_ON_BOOT: "true" });
      assert.ok(started.ready, "server must start once 0014 repairs the missing tables");
      const server = (started as { ready: true; server: Server }).server;
      try {
        await check("startup applies migration 0014 (the only one pending) before opening the HTTP listener", async () => {
          assert.match(server.stdout, /Database migrations up to date/);
          const listeningAt = server.stdout.indexOf("Server listening");
          const upToDateAt = server.stdout.indexOf("Database migrations up to date");
          assert.ok(upToDateAt !== -1 && listeningAt !== -1 && upToDateAt < listeningAt);
        });
        await check("every required KIN table now exists", async () => {
          assert.deepEqual(await missingKinTables(), []);
        });
        await check("every required KIN foreign key and index now exists", async () => {
          const { constraints, indexes } = await kinConstraintAndIndexNames();
          assert.equal(constraints.length, 5, `expected 5 FK constraints, found: ${constraints.join(", ")}`);
          assert.equal(indexes.length, 5, `expected 5 indexes, found: ${indexes.join(", ")}`);
        });
        await check("0014 is recorded in the ledger exactly once, alongside the pre-existing 0000-0013 rows", async () => {
          assert.equal(await ledgerRowCount(), 15);
          assert.equal(await migrationRowCountFor("0014_kin_ledger_schema_repair"), 1);
        });
        await check("KIN Looks now succeeds end-to-end", async () => {
          const cookie = await signupAndEnableKin(server.baseUrl, `migtest-repair-${Date.now()}@example.com`);
          const status = await kinLooks(server.baseUrl, cookie);
          assert.equal(status, 200);
        });
      } finally {
        stopServer(server.process);
      }
    }

    console.log("\nPhase 7: repeat and concurrent startup from the just-repaired database remain idempotent.");
    {
      const started = await startServer({ RUN_MIGRATIONS_ON_BOOT: "true" });
      assert.ok(started.ready, "a repeat boot after the repair must still start cleanly");
      const server = (started as { ready: true; server: Server }).server;
      try {
        await check("re-running after the repair changes nothing — 0014 stays recorded exactly once", async () => {
          assert.match(server.stdout, /Database migrations up to date/);
          assert.equal(await ledgerRowCount(), 15);
          assert.equal(await migrationRowCountFor("0014_kin_ledger_schema_repair"), 1);
          assert.deepEqual(await missingKinTables(), []);
        });
      } finally {
        stopServer(server.process);
      }
    }
    {
      const [a, b] = await Promise.all([
        startServer({ RUN_MIGRATIONS_ON_BOOT: "true" }),
        startServer({ RUN_MIGRATIONS_ON_BOOT: "true" }),
      ]);
      try {
        await check("two instances concurrently booting against the already-repaired database both start successfully", async () => {
          assert.ok(a.ready, "first instance must start");
          assert.ok(b.ready, "second instance must start");
        });
        await check("concurrent boots never duplicate the 0014 ledger row", async () => {
          assert.equal(await ledgerRowCount(), 15);
          assert.equal(await migrationRowCountFor("0014_kin_ledger_schema_repair"), 1);
        });
      } finally {
        if (a.ready) stopServer((a as { ready: true; server: Server }).server.process);
        else stopServer((a as { ready: false; process: ChildProcess }).process);
        if (b.ready) stopServer((b as { ready: true; server: Server }).server.process);
        else stopServer((b as { ready: false; process: ChildProcess }).process);
      }
    }

    console.log("\nPhase 8: a healthy database (every KIN object already present) is left unchanged by 0014.");
    {
      await check("before re-verifying: the database is fully healthy (no missing KIN objects, ledger at 15)", async () => {
        assert.deepEqual(await missingKinTables(), []);
        assert.equal(await ledgerRowCount(), 15);
      });
      const started = await startServer({ RUN_MIGRATIONS_ON_BOOT: "true" });
      assert.ok(started.ready, "booting a healthy database must succeed");
      const server = (started as { ready: true; server: Server }).server;
      try {
        await check("a healthy database boots cleanly with no schema changes and no duplicated ledger rows", async () => {
          assert.match(server.stdout, /Database migrations up to date/);
          assert.equal(await ledgerRowCount(), 15);
          assert.deepEqual(await missingKinTables(), []);
          const { constraints, indexes } = await kinConstraintAndIndexNames();
          assert.equal(constraints.length, 5);
          assert.equal(indexes.length, 5);
        });
      } finally {
        stopServer(server.process);
      }
    }

    console.log("\nPhase 9: the ledger claiming success is not trusted blindly — if required KIN objects are absent even after migrate() reports up to date, startup fails with an explicit diagnostic instead of opening the HTTP listener.");
    await dropKinTablesOnly();
    {
      await check("fixture: ledger is fully at 0014, but the KIN tables were dropped again after the fact", async () => {
        assert.equal(await ledgerRowCount(), 15);
        assert.deepEqual(await missingKinTables(), REQUIRED_KIN_TABLES);
      });
      const started = await startServer({ RUN_MIGRATIONS_ON_BOOT: "true" });
      await check("startup fails with an explicit ledger/schema mismatch diagnostic, and never opens the HTTP listener", async () => {
        assert.equal(started.ready, false, "the server must not report ready");
        assert.doesNotMatch(started.stdout, /Server listening/);
        assert.match(started.stdout, /Database migration failed/);
        assert.match(started.stdout, /ledger reports every migration applied/);
        assert.match(started.stdout, /kin_search_usage/);
      });
    }

    console.log("\nPhase 10: lock_timeout reliably bounds pg_advisory_lock (the mechanism runPendingMigrations relies on to bound lock acquisition) — proven directly at the Postgres level, not left as an assumption.");
    {
      const holder = await pool.connect();
      try {
        await holder.query("SELECT pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
        await check("a session blocked on pg_advisory_lock with lock_timeout set is canceled at the configured bound, not left hanging", async () => {
          const waiter = await pool.connect();
          try {
            await waiter.query("SET lock_timeout = 1500");
            const start = Date.now();
            await assert.rejects(
              waiter.query("SELECT pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK_KEY]),
              /lock timeout/i,
            );
            const elapsed = Date.now() - start;
            assert.ok(elapsed >= 1000 && elapsed < 5000, `expected cancellation near the 1500ms bound, took ${elapsed}ms`);
          } finally {
            waiter.release();
          }
        });
      } finally {
        await holder.query("SELECT pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
        holder.release();
      }
    }

    console.log("\nPhase 11: a wedged migration statement is canceled server-side (statement_timeout), not merely abandoned client-side — the previous Promise.race-only approach left the SQL running and the lock held.");
    {
      process.env.MIGRATION_STATEMENT_TIMEOUT_MS = "1500";
      process.env.MIGRATION_LOCK_ACQUIRE_TIMEOUT_MS = "5000";
      const fixture = writeSingleMigrationFolder("SELECT pg_sleep(300);");
      try {
        const start = Date.now();
        let caught: unknown;
        try {
          await runPendingMigrations(fixture);
        } catch (error) {
          caught = error;
        }
        const elapsed = Date.now() - start;
        await check("runPendingMigrations rejects near the statement_timeout bound, not after the full wedged duration", async () => {
          assert.ok(caught, "runPendingMigrations must reject");
          assert.ok(elapsed < 10_000, `took ${elapsed}ms — statement_timeout (1500ms) should have canceled this long before pg_sleep(300)'s 300000ms`);
        });
        await check("the advisory lock is immediately free afterward — the failed statement did not leave it held", async () => {
          assert.equal(await migrationLockIsFree(), true);
        });
        await check("no backend is left actually running the sleep — the statement was truly canceled server-side, not just abandoned", async () => {
          assert.equal(await activeSleepBackendCount(), 0);
        });
      } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
        delete process.env.MIGRATION_STATEMENT_TIMEOUT_MS;
        delete process.env.MIGRATION_LOCK_ACQUIRE_TIMEOUT_MS;
      }
    }

    console.log("\nPhase 12: many individually-fast statements whose sum exceeds the whole-run bound force-terminate the backend — the one case statement_timeout alone can't cover.");
    {
      process.env.MIGRATION_STATEMENT_TIMEOUT_MS = "10000"; // no single 1s sleep trips this
      process.env.MIGRATION_RUN_TIMEOUT_MS = "3000"; // ten of them cumulatively will
      process.env.MIGRATION_LOCK_ACQUIRE_TIMEOUT_MS = "5000";
      const fixture = writeSingleMigrationFolder(Array(10).fill("SELECT pg_sleep(1);").join("\n--> statement-breakpoint\n"));
      try {
        const start = Date.now();
        let caught: unknown;
        try {
          await runPendingMigrations(fixture);
        } catch (error) {
          caught = error;
        }
        const elapsed = Date.now() - start;
        await check("runPendingMigrations rejects near the whole-run bound, not after the full ~10s cumulative duration", async () => {
          assert.ok(caught instanceof Error, "runPendingMigrations must reject");
          assert.equal((caught as Error).name, "MigrationTimeoutError");
          assert.ok(elapsed < 6000, `took ${elapsed}ms — the 3000ms run timeout should have force-terminated this well before the full ~10s`);
        });
        await check("the advisory lock is immediately free afterward — forced termination released it as a side effect of ending the session", async () => {
          assert.equal(await migrationLockIsFree(), true);
        });
        await check("no backend is left actually running any of the sleeps — the connection was truly terminated, not merely abandoned", async () => {
          assert.equal(await activeSleepBackendCount(), 0);
        });
      } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
        delete process.env.MIGRATION_STATEMENT_TIMEOUT_MS;
        delete process.env.MIGRATION_RUN_TIMEOUT_MS;
        delete process.env.MIGRATION_LOCK_ACQUIRE_TIMEOUT_MS;
      }
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
