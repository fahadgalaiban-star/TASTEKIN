/**
 * Verifies the API startup/migration boundary against a disposable database.
 *
 * The direct migration runner is invoked explicitly once to establish a
 * complete isolated schema. The production-style API is then started twice
 * with the legacy RUN_MIGRATIONS_ON_BOOT flag still present, proving normal
 * startup ignores it and leaves both schema and Drizzle ledger unchanged.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:migrations
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Pool } = pg;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");
const migrationsFolder = path.join(repoRoot, "lib/db/migrations");
const migrationJournalPath = path.join(migrationsFolder, "meta/_journal.json");
const configuredDatabaseUrl = process.env.DATABASE_URL;

if (!configuredDatabaseUrl) {
  throw new Error("DATABASE_URL is required to create a disposable verification database.");
}
const baseDatabaseUrl: string = configuredDatabaseUrl;

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
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { output += chunk; });
    child.stderr?.on("data", (chunk: string) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}:\n${output}`)));
  });
}

async function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await captureCommand(command, args, env);
}

async function seedReviewedMigrationLedger(pool: pg.Pool): Promise<void> {
  const journal = JSON.parse(await readFile(migrationJournalPath, "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  await pool.query("CREATE SCHEMA IF NOT EXISTS drizzle");
  await pool.query(`
    CREATE TABLE drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
  for (const entry of journal.entries) {
    const sql = await readFile(path.join(migrationsFolder, `${entry.tag}.sql`));
    const hash = createHash("sha256").update(sql).digest("hex");
    await pool.query(
      "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
      [hash, entry.when],
    );
  }
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
      .filter((line) => !line.startsWith("-- Dumped from") && !line.startsWith("-- Dumped by") && !line.startsWith("\\restrict ") && !line.startsWith("\\unrestrict "))
      .join("\n"),
    columns: columns.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
    migrationLedger: migrationLedger.rows,
  };
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
  let captured = "";
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
  child.stdout!.setEncoding("utf8");
  child.stderr!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => { captured += chunk; });
  child.stderr!.on("data", (chunk: string) => { captured += chunk; });
  const server = { child, baseUrl: `http://127.0.0.1:${port}`, output: () => captured };
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
  const exitedAfterTerm = await Promise.race([
    new Promise<boolean>((resolve) => server.child.once("exit", () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (exitedAfterTerm || server.child.exitCode !== null) return;
  server.child.kill("SIGKILL");
  await Promise.race([
    new Promise<void>((resolve) => server.child.once("exit", () => resolve())),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("API verification child did not exit after SIGKILL.")), 3_000)),
  ]);
}

async function verifyStart(
  number: number,
  databaseUrl: string,
  pool: pg.Pool,
  expectedSnapshot: Snapshot,
): Promise<void> {
  const server = await startProductionStyleApi(databaseUrl);
  try {
    assert.doesNotMatch(server.output(), /Running pending database migrations|Database migrations up to date/);
  } finally {
    await stopServer(server);
  }
  assert.deepEqual(await snapshot(pool, databaseUrl), expectedSnapshot);
  console.log(`✓ production-style startup ${number} succeeded without schema or ledger mutation`);
}

async function main(): Promise<void> {
  const databaseName = `tastekin_startup_verify_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: baseDatabaseUrl, max: 1 });
  const isolatedUrl = disposableUrl(baseDatabaseUrl, databaseName);
  let isolatedPool: pg.Pool | undefined;
  let workspacePool: pg.Pool | undefined;

  try {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    await runCommand(
      "pnpm",
      ["--filter", "@workspace/db", "run", "push-force"],
      { ...process.env, DATABASE_URL: isolatedUrl },
    );
    isolatedPool = new Pool({ connectionString: isolatedUrl, max: 2 });
    await seedReviewedMigrationLedger(isolatedPool);

    process.env.DATABASE_URL = isolatedUrl;
    const dbModule = await import("@workspace/db");
    workspacePool = dbModule.pool;
    await dbModule.runPendingMigrations(migrationsFolder);
    console.log("✓ direct migration runner verified the disposable schema and reviewed ledger");

    const before = await snapshot(isolatedPool, isolatedUrl);
    assert.ok(before.migrationLedger.length > 0, "Expected the isolated Drizzle ledger to contain migrations.");

    await verifyStart(1, isolatedUrl, isolatedPool, before);
    await verifyStart(2, isolatedUrl, isolatedPool, before);
  } finally {
    await isolatedPool?.end().catch(() => {});
    await workspacePool?.end().catch(() => {});
    await adminPool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    ).catch(() => {});
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`).catch(() => {});
    await adminPool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});