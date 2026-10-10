/**
 * Disposable-database regression test for migration-ledger-report.ts, and a
 * proof of how migration 0023 behaves against each ledger state this project
 * has actually produced.
 *
 * DATABASE_URL selects only the server on which a new, uniquely named
 * throwaway database is created and dropped. Because of that, the script
 * fails closed before opening any connection unless DATABASE_URL is a
 * dedicated local disposable server (see disposable-db-guard.ts): remote
 * hosts, managed providers, TLS-required and production-like URLs are
 * refused, as is a target sharing host:port with PROD_DB_URL.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres pnpm --filter scripts run verify:migration-ledger-report
 *
 * Scenarios, all on the one disposable database:
 *   0. static: journal/files consistent; 0023 creates exactly the reviewed
 *      objects, none guarded, and contains no destructive or UPDATE statement.
 *   1. 0022 baseline (the state PR #96's runbook requires): pushed schema with
 *      the 0023 objects removed, ledger seeded 0000–0022 → report says 0023
 *      pending/clean (exit 2); the real runner then applies 0023 and the
 *      report says consistent (exit 0). Pre-seeded rows are byte-identical
 *      before and after, and is_suspended defaults to false for them.
 *   2. ledger-only drift (the 0012/0013 incident): KIN tables dropped → report
 *      flags LEDGER-ONLY (exit 1); the runner refuses with
 *      MigrationLedgerMismatchError.
 *   3. schema-only drift (the Development database: objects created by
 *      drizzle-kit push, no ledger row): 0023 row removed → report flags
 *      SCHEMA-ONLY and predicts failure (exit 1); the runner fails with
 *      "already exists" and leaves ledger and schema untouched.
 *   4. no ledger at all: drizzle schema dropped → report says table absent
 *      (exit 1) and predicts failure at the first unguarded existing object;
 *      the runner fails the same way.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { assertDisposableDatabaseUrl } from "./disposable-db-guard";
import {
  MIGRATIONS_FOLDER,
  exitCodeFor,
  inspectDatabase,
  loadMigrationHistory,
  renderReport,
  type LedgerReport,
  type MigrationHistory,
} from "./migration-ledger-report";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Fail closed before any pool exists: this script creates and drops
// databases, so only a dedicated local disposable server is ever accepted.
const configuredUrl = assertDisposableDatabaseUrl(process.env.DATABASE_URL, process.env).toString();

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const TAG_0023 = "0023_moderation_actions";
const EXPECTED_0023_HASH = "9d95a96f67c00d79c4bc767e9e31fa491d1dd321f7bc99cda88fbd5fa60ef9a1";

async function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}:\n${output}`)));
  });
}

async function report(pool: pg.Pool, history: MigrationHistory): Promise<LedgerReport> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    try {
      return await inspectDatabase(client, history);
    } finally {
      await client.query("ROLLBACK");
    }
  } finally {
    client.release();
  }
}

/** drizzle wraps the Postgres error (DrizzleQueryError) and keeps the real message in `cause`. */
function rootMessage(error: unknown): string {
  const seen = new Set<unknown>();
  let current = error;
  const parts: string[] = [];
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" <- ");
}

function rejectsWith(pattern: RegExp) {
  return (error: unknown) => {
    const message = rootMessage(error);
    assert.match(message, pattern);
    return true;
  };
}

function statusOf(result: LedgerReport, tag: string) {
  const entry = result.entries.find((item) => item.tag === tag);
  assert.ok(entry, `${tag} missing from report`);
  return entry;
}

/** Test fixture only: the ledger rows a healthy database would hold after migrate() ran 0000..N. */
async function seedLedgerThrough(pool: pg.Pool, history: MigrationHistory, lastIdx: number): Promise<void> {
  await pool.query("CREATE SCHEMA IF NOT EXISTS drizzle");
  await pool.query("CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)");
  for (const entry of history.entries.filter((item) => item.idx <= lastIdx)) {
    await pool.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [entry.hash, entry.when]);
  }
}

async function ledgerCount(pool: pg.Pool): Promise<number> {
  return Number(((await pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0] as { count: number }).count);
}

async function schemaFingerprint(pool: pg.Pool): Promise<string> {
  const [columns, indexes, constraints] = await Promise.all([
    pool.query(`SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`),
    pool.query("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2"),
    pool.query(`SELECT c.relname, con.conname, pg_get_constraintdef(con.oid) AS def FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' ORDER BY 1, 2`),
  ]);
  return JSON.stringify([columns.rows, indexes.rows, constraints.rows]);
}

/** Digests of the ORIGINAL columns only, so an added column cannot mask a rewrite of existing values. */
async function rowDigests(pool: pg.Pool): Promise<Record<string, string>> {
  const digest = async (table: string, rowExpr: string, order: string) =>
    String(((await pool.query(`SELECT count(*)::text || ':' || coalesce(md5(string_agg(${rowExpr}::text, '|' ORDER BY ${order})), '') AS d FROM ${table}`)).rows[0] as { d: string }).d);
  return {
    users: await digest("users", "row(id, email, role, is_admin, is_verified, language, onboarding_step, auth_provider)", "id"),
    creator_workspaces: await digest("creator_workspaces", "row(creator_id, owner_user_id, edits, collections, revision)", "creator_id"),
    edit_comments: await digest("edit_comments", "row(id, edit_id, user_id, body)", "id"),
    reports: await digest("reports", "row(id, reporter_user_id, target_type, target_id, reason, status)", "id"),
    moderation_audit_log: await digest("moderation_audit_log", "row(id, report_id, admin_user_id, from_status, to_status, note)", "id"),
  };
}

async function main(): Promise<void> {
  const history = await loadMigrationHistory();

  console.log("Scenario 0: static history checks");
  assert.deepEqual(history.problems, [], "journal and files must be consistent");
  const file0023 = history.entries.find((entry) => entry.tag === TAG_0023);
  assert.ok(file0023, "0023 must be the reviewed migration");
  assert.equal(file0023.idx, history.entries.length - 1, "0023 must be the last journal entry");
  assert.equal(file0023.hash, EXPECTED_0023_HASH, "0023 bytes must match the reviewed checksum");
  assert.deepEqual(file0023.destructiveStatements, [], "0023 must not drop or delete anything");
  assert.deepEqual(file0023.dataRewriteStatements, [], "0023 must not rewrite rows");
  const described = file0023.objects.map((object) => `${object.kind}:${object.table ? `${object.table}.` : ""}${object.name}${object.guarded ? ":guarded" : ""}`).sort();
  assert.deepEqual(described, [
    "column:moderation_audit_log.action",
    "column:moderation_audit_log.new_state",
    "column:moderation_audit_log.previous_state",
    "column:moderation_audit_log.target_id",
    "column:moderation_audit_log.target_type",
    "column:users.is_suspended",
    "constraint:moderation_audit_log.moderation_action_complete_check",
    "index:creator_workspaces_edits_gin_idx",
    "index:edit_comments_user_idx",
    "index:moderation_audit_target_time_idx",
    "index:moderation_content_hidden_idx",
    "index:users_suspended_idx",
    "table:moderation_content_states",
  ], "0023 creates exactly the reviewed objects and none of them is guarded against already existing");
  const destructiveElsewhere = history.entries.filter((entry) => entry.destructiveStatements.length).map((entry) => entry.tag);
  assert.deepEqual(destructiveElsewhere, [], "no committed migration drops or deletes");
  assert.deepEqual(history.entries.filter((entry) => entry.dataRewriteStatements.length).map((entry) => entry.tag), ["0004_place_fields"], "only 0004 rewrites rows (its documented idempotent JSON backfill)");
  console.log("  ✓ journal consistent; 0023 is additive, unguarded, checksum-pinned");

  const databaseName = `tastekin_ledger_report_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const isolated = new URL(configuredUrl!);
  isolated.pathname = `/${databaseName}`;
  const isolatedUrl = isolated.toString();
  const admin = new pg.Pool({ connectionString: configuredUrl, max: 1 });
  admin.on("error", () => {});
  let dbPool: pg.Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE ${quote(databaseName)}`);
    await run("pnpm", ["--filter", "@workspace/db", "run", "push-force"], { ...process.env, DATABASE_URL: isolatedUrl });
    process.env.DATABASE_URL = isolatedUrl;
    const dbModule = await import("@workspace/db");
    dbPool = dbModule.pool;
    // Cleanup below terminates this database's backends; an idle client that
    // notices must not surface as an unhandled 'error' event.
    dbPool.on("error", () => {});
    const pool = dbPool;

    console.log("Scenario 1: 0022 baseline → report, then the real runner applies 0023");
    await pool.query(`
      DROP TABLE moderation_content_states;
      DROP INDEX users_suspended_idx;
      ALTER TABLE users DROP COLUMN is_suspended;
      ALTER TABLE moderation_audit_log DROP CONSTRAINT moderation_action_complete_check;
      DROP INDEX moderation_audit_target_time_idx;
      ALTER TABLE moderation_audit_log DROP COLUMN action, DROP COLUMN target_type, DROP COLUMN target_id, DROP COLUMN previous_state, DROP COLUMN new_state;
      DROP INDEX creator_workspaces_edits_gin_idx;
      DROP INDEX edit_comments_user_idx;
    `);
    // A database that really ran 0006 through migrate() also carries the
    // index under its 0006 name; lib/db/src/schema (and so drizzle-kit push)
    // only knows the later name from 0009. Add it so the fixture is the
    // migrate()-built baseline, not the push-built shape (scenario 4 shows
    // that difference deliberately).
    await pool.query(`CREATE UNIQUE INDEX "creator_workspaces_profile_username_unique" ON "creator_workspaces" (lower("profile"->>'username'))`);
    await seedLedgerThrough(pool, history, 22);
    let result = await report(pool, history);
    assert.equal(result.ledgerTableExists, true);
    assert.equal(result.ledgerRowCount, 23);
    assert.equal(statusOf(result, TAG_0023).status, "pending");
    assert.equal(statusOf(result, "0022_native_sessions").status, "applied");
    assert.equal(statusOf(result, "0004_place_fields").status, "recorded-unprobeable");
    assert.ok(result.entries.every((entry) => entry.tag === TAG_0023 || entry.status === "applied" || entry.status === "recorded-unprobeable"), renderReport(result));
    assert.deepEqual(result.prediction, { wouldAttempt: [TAG_0023], failsAt: null });
    assert.deepEqual(result.warnings, []);
    assert.equal(result.drift, false);
    assert.equal(exitCodeFor(result), 2);
    console.log("  ✓ baseline reports 0023 pending and predicts a clean apply (exit 2)");

    await pool.query(`
      INSERT INTO users (id, email, role) VALUES ('ledger-user-1', 'ledger1@example.test', 'consumer'), ('ledger-user-2', 'ledger2@example.test', 'creator');
      INSERT INTO creator_workspaces (creator_id, owner_user_id, edits, collections)
        VALUES ('ledger-creator', 'ledger-user-2', '[{"id":"edit-1","title":"Before 0023","locked":false}]', '[]');
      INSERT INTO edit_comments (edit_id, user_id, body) VALUES ('edit-1', 'ledger-user-1', 'left before the migration');
      INSERT INTO reports (id, reporter_user_id, target_type, target_id, reason)
        VALUES ('00000000-0000-4000-8000-000000000001', 'ledger-user-1', 'edit', 'edit-1', 'spam');
      INSERT INTO moderation_audit_log (report_id, admin_user_id, from_status, to_status, note)
        VALUES ('00000000-0000-4000-8000-000000000001', 'ledger-user-2', 'pending', 'resolved', 'legacy status change');
    `);
    const before = await rowDigests(pool);
    await dbModule.runPendingMigrations(MIGRATIONS_FOLDER);
    assert.deepEqual(await rowDigests(pool), before, "0023 must not rewrite any pre-existing row");
    assert.equal(await ledgerCount(pool), 24);
    const row0023 = (await pool.query("SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at = $1", [file0023.when])).rows as Array<{ hash: string }>;
    assert.deepEqual(row0023.map((row) => row.hash), [EXPECTED_0023_HASH]);
    const suspended = (await pool.query("SELECT id, is_suspended FROM users ORDER BY id")).rows as Array<{ id: string; is_suspended: boolean }>;
    assert.deepEqual(suspended, [{ id: "ledger-user-1", is_suspended: false }, { id: "ledger-user-2", is_suspended: false }]);
    const audit = (await pool.query("SELECT action, target_type, target_id, previous_state, new_state FROM moderation_audit_log")).rows;
    assert.deepEqual(audit, [{ action: null, target_type: null, target_id: null, previous_state: null, new_state: null }], "legacy audit rows stay valid under the new CHECK");
    const validIndexes = (await pool.query(`SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indisvalid AND c.relname = ANY($1::text[]) ORDER BY 1`,
      [["moderation_content_hidden_idx", "users_suspended_idx", "moderation_audit_target_time_idx", "creator_workspaces_edits_gin_idx", "edit_comments_user_idx"]])).rows as Array<{ relname: string }>;
    assert.equal(validIndexes.length, 5, "all five 0023 indexes are valid");
    result = await report(pool, history);
    assert.equal(statusOf(result, TAG_0023).status, "applied");
    assert.equal(result.drift, false);
    assert.deepEqual(result.prediction.wouldAttempt, []);
    assert.equal(exitCodeFor(result), 0);
    console.log("  ✓ real runner applied 0023 from the 0022 baseline; rows unchanged; report consistent (exit 0)");
    const healthyFingerprint = await schemaFingerprint(pool);

    console.log("Scenario 2: ledger-only drift (recorded KIN migrations, tables absent)");
    await pool.query("DROP TABLE kin_trip_items, kin_trips, kin_saved_recommendations, kin_search_usage CASCADE");
    result = await report(pool, history);
    assert.equal(statusOf(result, "0012_kin_search_usage").status, "ledger-only");
    assert.equal(statusOf(result, "0013_kin_looks_travel").status, "ledger-only");
    assert.equal(statusOf(result, "0014_kin_ledger_schema_repair").status, "ledger-only");
    assert.equal(result.drift, true);
    assert.equal(exitCodeFor(result), 1);
    await assert.rejects(dbModule.runPendingMigrations(MIGRATIONS_FOLDER), (error: unknown) => error instanceof Error && error.name === "MigrationLedgerMismatchError");
    // Restore with the committed, guarded repair SQL (0014 is idempotent by design).
    const repairSql = await import("node:fs/promises").then((fs) => fs.readFile(path.join(MIGRATIONS_FOLDER, "0014_kin_ledger_schema_repair.sql"), "utf8"));
    for (const statement of repairSql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) await pool.query(statement);
    assert.equal(await schemaFingerprint(pool), healthyFingerprint);
    console.log("  ✓ LEDGER-ONLY flagged (exit 1); runner refuses with MigrationLedgerMismatchError");

    console.log("Scenario 3: schema-only drift (0023 objects present, no 0023 ledger row — the Development database shape)");
    await pool.query("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1", [file0023.when]);
    assert.equal(await ledgerCount(pool), 23);
    result = await report(pool, history);
    assert.equal(statusOf(result, TAG_0023).status, "schema-only");
    assert.deepEqual(result.prediction, { wouldAttempt: [TAG_0023], failsAt: { tag: TAG_0023, object: "table moderation_content_states" } });
    assert.equal(result.drift, true);
    assert.equal(exitCodeFor(result), 1);
    await assert.rejects(dbModule.runPendingMigrations(MIGRATIONS_FOLDER), rejectsWith(/relation "moderation_content_states" already exists/));
    assert.equal(await ledgerCount(pool), 23, "a failed run must not advance the ledger");
    assert.equal(await schemaFingerprint(pool), healthyFingerprint, "a failed run must not change the schema");
    assert.deepEqual(await rowDigests(pool), before);
    console.log("  ✓ SCHEMA-ONLY flagged with the exact failing object (exit 1); runner fails 'already exists', nothing changes");

    console.log("Scenario 4: no ledger at all (schema from drizzle-kit push only)");
    await pool.query("DROP SCHEMA drizzle CASCADE");
    await pool.query(`DROP INDEX "creator_workspaces_profile_username_unique"`);
    const pushOnlyFingerprint = await schemaFingerprint(pool);
    result = await report(pool, history);
    assert.equal(result.ledgerTableExists, false);
    assert.equal(result.ledgerRowCount, 0);
    assert.equal(result.prediction.wouldAttempt.length, history.entries.length);
    assert.deepEqual(result.prediction.failsAt, { tag: "0012_kin_search_usage", object: "table kin_search_usage" }, "0000–0011 are guarded; 0012 is the first unguarded CREATE TABLE");
    const entry0006 = statusOf(result, "0006_multi_creator_foundation");
    assert.equal(entry0006.status, "partial");
    assert.deepEqual(entry0006.missingObjects, ["index creator_workspaces_profile_username_unique"], "push-built databases only carry the 0009/schema name of the username index");
    assert.ok(result.entries.filter((entry) => entry.status === "schema-only").length >= 18, renderReport(result));
    assert.equal(exitCodeFor(result), 1);
    await assert.rejects(dbModule.runPendingMigrations(MIGRATIONS_FOLDER), rejectsWith(/relation "kin_search_usage" already exists/));
    assert.equal(await ledgerCount(pool), 0, "the ledger table is created empty and the failed run records nothing");
    assert.equal(await schemaFingerprint(pool), pushOnlyFingerprint);
    assert.deepEqual(await rowDigests(pool), before, "the rolled-back run must not leave 0004's UPDATE behind");
    console.log("  ✓ absent ledger reported (exit 1); runner fails at 0012 and rolls back completely");

    console.log("\nSample report (scenario 4 state):\n");
    console.log(renderReport(result));
    console.log("\nAll scenarios passed.");
  } finally {
    await dbPool?.end().catch(() => {});
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [databaseName]).catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${quote(databaseName)}`).catch(() => {});
    await admin.end().catch(() => {});
    process.env.DATABASE_URL = configuredUrl;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
