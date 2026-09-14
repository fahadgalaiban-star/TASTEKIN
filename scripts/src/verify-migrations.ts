/**
 * Verifies the direct migration runner against a disposable database, then
 * proves that the compiled production API ignores RUN_MIGRATIONS_ON_BOOT.
 *
 * The configured DATABASE_URL is used only as the server from which this
 * script creates its uniquely named database. It is never read or mutated.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:migrations
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const { Pool } = pg;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");
const migrationsFolder = path.join(repoRoot, "lib/db/migrations");
const journalPath = path.join(migrationsFolder, "meta/_journal.json");
const configuredDatabaseUrl = process.env.DATABASE_URL;

if (!configuredDatabaseUrl) {
  throw new Error("DATABASE_URL is required to create a disposable verification database.");
}

const MIGRATION_ADVISORY_LOCK_KEY = 727_273_001_001;
const REQUIRED_KIN_TABLES = [
  "kin_search_usage",
  "kin_saved_recommendations",
  "kin_trips",
  "kin_trip_items",
] as const;

type MigrationJournal = {
  version: string;
  dialect: string;
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
};

type Snapshot = {
  schemaDump: string;
  columns: unknown[];
  indexes: unknown[];
  constraints: unknown[];
  migrationLedger: unknown[];
};

type RunningServer = {
  child: ChildProcess;
  baseUrl: string;
  output: () => string;
};

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function disposableUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function captureCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { output += chunk; });
    child.stderr?.on("data", (chunk: string) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} exited ${code}:\n${output}`));
    });
  });
}

async function resetMigrationHistory(pool: pg.Pool): Promise<void> {
  await pool.query("DROP TABLE IF EXISTS kin_trip_items, kin_trips, kin_saved_recommendations, kin_search_usage CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
}

async function migrationJournal(): Promise<MigrationJournal> {
  return JSON.parse(await readFile(journalPath, "utf8")) as MigrationJournal;
}

async function copyMigrationsThrough(throughTag: string): Promise<string> {
  const journal = await migrationJournal();
  const cutoff = journal.entries.findIndex((entry) => entry.tag === throughTag);
  assert.notEqual(cutoff, -1, `${throughTag} must exist in the migration journal`);
  const fixture = await mkdtemp(path.join("/tmp", "migration-history-"));
  await mkdir(path.join(fixture, "meta"));
  await writeFile(
    path.join(fixture, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cutoff + 1) }),
  );
  for (const entry of journal.entries.slice(0, cutoff + 1)) {
    await writeFile(
      path.join(fixture, `${entry.tag}.sql`),
      await readFile(path.join(migrationsFolder, `${entry.tag}.sql`)),
    );
  }
  return fixture;
}

/**
 * Creates a genuine historical ledger by running Drizzle against a trimmed
 * copy of the real migration history. This intentionally never inserts
 * ledger rows itself.
 */
async function migrateThrough(
  db: Parameters<typeof migrate>[0],
  throughTag: string,
): Promise<void> {
  const fixture = await copyMigrationsThrough(throughTag);
  try {
    await migrate(db, { migrationsFolder: fixture });
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

let fixtureSequence = 0;
async function writeSingleMigrationFolder(sqlBody: string): Promise<string> {
  const fixture = await mkdtemp(path.join("/tmp", "migration-cancellation-"));
  const when = 20_000_000_000_000 + fixtureSequence++;
  await mkdir(path.join(fixture, "meta"));
  await writeFile(path.join(fixture, "0000_fixture.sql"), sqlBody);
  await writeFile(
    path.join(fixture, "meta/_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: [{ idx: 0, version: "7", when, tag: "0000_fixture", breakpoints: true }],
    }),
  );
  return fixture;
}

async function ledgerRowCount(pool: pg.Pool): Promise<number> {
  const result = await pool.query(`
    SELECT count(*)::int AS count
    FROM drizzle.__drizzle_migrations
  `);
  return (result.rows[0] as { count: number }).count;
}

async function migrationRowCountFor(pool: pg.Pool, tag: string): Promise<number> {
  const hash = createHash("sha256")
    .update(await readFile(path.join(migrationsFolder, `${tag}.sql`)))
    .digest("hex");
  const result = await pool.query(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations WHERE hash = $1",
    [hash],
  );
  return (result.rows[0] as { count: number }).count;
}

async function missingKinTables(pool: pg.Pool): Promise<string[]> {
  const missing: string[] = [];
  for (const table of REQUIRED_KIN_TABLES) {
    const result = await pool.query("SELECT to_regclass($1) AS reg", [`public.${table}`]);
    if (!(result.rows[0] as { reg: string | null }).reg) missing.push(table);
  }
  return missing;
}

async function snapshot(pool: pg.Pool, databaseUrl: string): Promise<Snapshot> {
  const [rawSchemaDump, columns, indexes, constraints, migrationLedger] = await Promise.all([
    captureCommand(
      "pg_dump",
      ["--schema-only", "--no-owner", "--no-privileges", "--no-comments", databaseUrl],
      process.env,
    ),
    pool.query(`
      SELECT table_schema, table_name, ordinal_position, column_name, data_type,
             is_nullable, COALESCE(column_default, '') AS column_default
      FROM information_schema.columns
      WHERE table_schema IN ('public', 'drizzle')
      ORDER BY table_schema, table_name, ordinal_position
    `),
    pool.query(`
      SELECT schemaname, tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname IN ('public', 'drizzle')
      ORDER BY schemaname, tablename, indexname
    `),
    pool.query(`
      SELECT n.nspname AS schema_name, c.relname AS table_name,
             con.conname AS constraint_name, pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'drizzle')
      ORDER BY n.nspname, c.relname, con.conname
    `),
    pool.query(`
      SELECT id, hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY id
    `),
  ]);
  return {
    schemaDump: rawSchemaDump
      .split("\n")
      .filter((line) =>
        !line.startsWith("-- Dumped from") &&
        !line.startsWith("-- Dumped by") &&
        !line.startsWith("\\restrict ") &&
        !line.startsWith("\\unrestrict ")
      )
      .join("\n"),
    columns: columns.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
    migrationLedger: migrationLedger.rows,
  };
}

async function migrationLockIsFree(pool: pg.Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [MIGRATION_ADVISORY_LOCK_KEY],
    );
    const acquired = (result.rows[0] as { acquired: boolean }).acquired;
    if (acquired) {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
    }
    return acquired;
  } finally {
    client.release();
  }
}

async function activeSleepBackendCount(pool: pg.Pool): Promise<number> {
  const result = await pool.query(`
    SELECT count(*)::int AS count
    FROM pg_stat_activity
    WHERE query LIKE 'SELECT pg_sleep%' AND state = 'active'
  `);
  return (result.rows[0] as { count: number }).count;
}

async function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a verification port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForReady(server: RunningServer): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`API exited before readiness with code ${server.child.exitCode}:\n${server.output()}`);
    }
    try {
      const response = await fetch(`${server.baseUrl}/api/healthz`);
      if (response.ok) {
        assert.deepEqual(await response.json(), { status: "ok" });
        return;
      }
    } catch {
      // The listener may not have bound yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API did not become ready:\n${server.output()}`);
}

async function startProductionStyleApi(databaseUrl: string): Promise<RunningServer> {
  const port = await unusedPort();
  let output = "";
  const child = spawn(process.execPath, ["--enable-source-maps", apiEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
      PORT: String(port),
      RUN_MIGRATIONS_ON_BOOT: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { output += chunk; });
  child.stderr?.on("data", (chunk: string) => { output += chunk; });
  const server = { child, baseUrl: `http://127.0.0.1:${port}`, output: () => output };
  try {
    await waitForReady(server);
    return server;
  } catch (error) {
    await stopServer(server);
    throw error;
  }
}

async function stopServer(server: RunningServer): Promise<void> {
  if (server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => server.child.once("exit", () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (exited || server.child.exitCode !== null) return;
  server.child.kill("SIGKILL");
  await Promise.race([
    new Promise<void>((resolve) => server.child.once("exit", () => resolve())),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("API verification child did not exit after SIGKILL.")), 3_000)
    ),
  ]);
}

async function main(): Promise<void> {
  const databaseName = `tastekin_migration_verify_${randomUUID().replaceAll("-", "")}`;
  const isolatedUrl = disposableUrl(configuredDatabaseUrl!, databaseName);
  const adminPool = new Pool({ connectionString: configuredDatabaseUrl, max: 1 });
  let isolatedPool: pg.Pool | undefined;
  let runningApi: RunningServer | undefined;
  let dbModule: typeof import("@workspace/db") | undefined;

  try {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    await captureCommand(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      { ...process.env, DATABASE_URL: isolatedUrl },
    );
    process.env.DATABASE_URL = isolatedUrl;
    dbModule = await import("@workspace/db");
    isolatedPool = dbModule.pool;
    const pool = isolatedPool;
    const kinRepairFixture = await copyMigrationsThrough("0014_kin_ledger_schema_repair");

    try {
      console.log("Phase 1: historical KIN repair — real migrations through 0013, then the real runner applies 0014.");
      await resetMigrationHistory(pool);
      await migrateThrough(dbModule.db, "0013_kin_looks_travel");
      await pool.query("DROP TABLE IF EXISTS kin_trip_items, kin_trips, kin_saved_recommendations, kin_search_usage CASCADE");
      assert.equal(await ledgerRowCount(pool), 14, "historical setup must have exactly 0000-0013 in its real ledger");
      assert.deepEqual(await missingKinTables(pool), [...REQUIRED_KIN_TABLES]);
      await dbModule.runPendingMigrations(kinRepairFixture);
      assert.deepEqual(await missingKinTables(pool), [], "the repair must recreate every KIN table");
      assert.equal(await ledgerRowCount(pool), 15);
      assert.equal(await migrationRowCountFor(pool, "0014_kin_ledger_schema_repair"), 1);
      console.log("  ✓ historical KIN ledger/schema mismatch repaired by real migration execution");

      console.log("Phase 2: healthy-schema no-op — the repaired schema is unchanged by the direct runner.");
      const healthyBefore = await snapshot(pool, isolatedUrl);
      await dbModule.runPendingMigrations(kinRepairFixture);
      assert.deepEqual(await snapshot(pool, isolatedUrl), healthyBefore);
      console.log("  ✓ healthy KIN schema and ledger are unchanged");

      console.log("Phase 3: schema-integrity validation — an applied ledger is not trusted when KIN objects are absent.");
      await pool.query("DROP TABLE IF EXISTS kin_trip_items, kin_trips, kin_saved_recommendations, kin_search_usage CASCADE");
      await assert.rejects(
        dbModule.runPendingMigrations(kinRepairFixture),
        (error: unknown) =>
          error instanceof Error &&
          error.name === "MigrationLedgerMismatchError" &&
          error.message.includes("kin_search_usage"),
      );
      assert.deepEqual(await missingKinTables(pool), [...REQUIRED_KIN_TABLES]);
      console.log("  ✓ applied-ledger/schema-integrity mismatch fails explicitly");
    } finally {
      await rm(kinRepairFixture, { recursive: true, force: true });
    }

    await captureCommand(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      { ...process.env, DATABASE_URL: isolatedUrl },
    );

    console.log("Phase 4: idempotency — a real direct-runner migration followed by a no-op run.");
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    const idempotencyFixture = await writeSingleMigrationFolder("CREATE TABLE runner_idempotency (id integer PRIMARY KEY);");
    try {
      await dbModule.runPendingMigrations(idempotencyFixture);
      const idempotentBefore = await snapshot(pool, isolatedUrl);
      await dbModule.runPendingMigrations(idempotencyFixture);
      assert.deepEqual(await snapshot(pool, isolatedUrl), idempotentBefore);
      assert.equal(await ledgerRowCount(pool), 1);
    } finally {
      await rm(idempotencyFixture, { recursive: true, force: true });
    }
    console.log("  ✓ repeated direct execution leaves one ledger row and no schema change");

    console.log("Phase 5: concurrent runner execution — advisory locking serializes two real runners.");
    const concurrentFixture = await writeSingleMigrationFolder("SELECT pg_sleep(2);");
    try {
      const ledgerBeforeConcurrentRun = await ledgerRowCount(pool);
      const startedAt = Date.now();
      await Promise.all([
        dbModule.runPendingMigrations(concurrentFixture),
        dbModule.runPendingMigrations(concurrentFixture),
      ]);
      assert.ok(Date.now() - startedAt >= 1_500, "one runner should hold the advisory lock while the fixture runs");
      assert.equal(await ledgerRowCount(pool), ledgerBeforeConcurrentRun + 1);
    } finally {
      await rm(concurrentFixture, { recursive: true, force: true });
    }
    console.log("  ✓ concurrent runners complete without duplicate ledger rows");

    console.log("Phase 6: lock timeout — a held advisory lock fails the runner at its configured bound.");
    const holder = await pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
      process.env.MIGRATION_LOCK_ACQUIRE_TIMEOUT_MS = "1200";
      const startedAt = Date.now();
      await assert.rejects(
        dbModule.runPendingMigrations(migrationsFolder),
        /Could not acquire the migration advisory lock within 1200ms|lock timeout/i,
      );
      const elapsed = Date.now() - startedAt;
      assert.ok(elapsed >= 800 && elapsed < 5_000, `lock timeout took ${elapsed}ms`);
    } finally {
      delete process.env.MIGRATION_LOCK_ACQUIRE_TIMEOUT_MS;
      await holder.query("SELECT pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK_KEY]).catch(() => {});
      holder.release();
    }
    assert.equal(await migrationLockIsFree(pool), true);
    console.log("  ✓ advisory lock acquisition is bounded and released cleanly");

    console.log("Phase 7: server-side statement timeout — a wedged migration statement is canceled by Postgres.");
    const statementFixture = await writeSingleMigrationFolder("SELECT pg_sleep(300);");
    try {
      const ledgerBeforeStatementTimeout = await ledgerRowCount(pool);
      process.env.MIGRATION_STATEMENT_TIMEOUT_MS = "1200";
      process.env.MIGRATION_LOCK_ACQUIRE_TIMEOUT_MS = "5000";
      const startedAt = Date.now();
      await assert.rejects(dbModule.runPendingMigrations(statementFixture));
      assert.ok(Date.now() - startedAt < 10_000, "statement timeout must beat pg_sleep(300)");
      assert.equal(await migrationLockIsFree(pool), true);
      assert.equal(await activeSleepBackendCount(pool), 0);
      assert.equal(await ledgerRowCount(pool), ledgerBeforeStatementTimeout, "a canceled migration must not advance the ledger");
    } finally {
      delete process.env.MIGRATION_STATEMENT_TIMEOUT_MS;
      delete process.env.MIGRATION_LOCK_ACQUIRE_TIMEOUT_MS;
      await rm(statementFixture, { recursive: true, force: true });
    }
    console.log("  ✓ statement_timeout canceled the SQL and left no sleeping backend");

    console.log("Phase 8: whole-run timeout — backend termination stops cumulative work beyond statement_timeout.");
    const runFixture = await writeSingleMigrationFolder(
      Array(10).fill("SELECT pg_sleep(1);").join("\n--> statement-breakpoint\n"),
    );
    try {
      const ledgerBeforeRunTimeout = await ledgerRowCount(pool);
      process.env.MIGRATION_STATEMENT_TIMEOUT_MS = "10000";
      process.env.MIGRATION_RUN_TIMEOUT_MS = "3000";
      process.env.MIGRATION_LOCK_ACQUIRE_TIMEOUT_MS = "5000";
      const startedAt = Date.now();
      let caught: unknown;
      try {
        await dbModule.runPendingMigrations(runFixture);
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof Error, "runPendingMigrations must reject");
      assert.equal(
        caught.name,
        "MigrationTimeoutError",
        `expected MigrationTimeoutError, received ${caught.name}: ${caught.message}`,
      );
      assert.ok(Date.now() - startedAt < 6_000, "whole-run timeout must terminate before ten sleeps finish");
      assert.equal(await migrationLockIsFree(pool), true);
      assert.equal(await activeSleepBackendCount(pool), 0);
      assert.equal(await ledgerRowCount(pool), ledgerBeforeRunTimeout, "a terminated migration must not advance the ledger");
    } finally {
      delete process.env.MIGRATION_STATEMENT_TIMEOUT_MS;
      delete process.env.MIGRATION_RUN_TIMEOUT_MS;
      delete process.env.MIGRATION_LOCK_ACQUIRE_TIMEOUT_MS;
      await rm(runFixture, { recursive: true, force: true });
    }
    console.log("  ✓ whole-run timeout terminated the migration backend and released its lock");

    console.log("Phase 9: production API startup — two compiled boots with RUN_MIGRATIONS_ON_BOOT=true.");
    await captureCommand(
      "pnpm",
      ["--filter", "@workspace/api-server", "run", "build"],
      process.env,
    );
    const apiBefore = await snapshot(pool, isolatedUrl);
    for (const attempt of [1, 2]) {
      runningApi = await startProductionStyleApi(isolatedUrl);
      try {
        assert.doesNotMatch(runningApi.output(), /Running pending database migrations|Database migrations up to date/);
        assert.deepEqual(await snapshot(pool, isolatedUrl), apiBefore);
        console.log(`  ✓ compiled API startup ${attempt} became ready without schema or ledger changes`);
      } finally {
        await stopServer(runningApi);
        runningApi = undefined;
      }
    }
  } finally {
    if (runningApi) await stopServer(runningApi).catch(() => {});
    await isolatedPool?.end().catch(() => {});
    await adminPool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    ).catch(() => {});
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`).catch(() => {});
    await adminPool.end().catch(() => {});
    process.env.DATABASE_URL = configuredDatabaseUrl;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});