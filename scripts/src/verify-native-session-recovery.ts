/**
 * Disposable-Postgres regression test. DATABASE_URL selects only the server
 * where a new, uniquely named throwaway database will be created. Never uses
 * PROD_DB_URL and never connects to the configured database itself for DDL.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runRecovery } from "./native-session-recovery";

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/db/migrations");
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

async function snapshot(pool: pg.Pool) {
  const [ledger, columns, indexes, constraints] = await Promise.all([
    pool.query("SELECT id, hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY id"),
    pool.query(`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('video_uploads','saved_lists','saved_list_items','native_sessions')
      ORDER BY table_name,ordinal_position`),
    pool.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'
      AND tablename IN ('video_uploads','saved_lists','saved_list_items','native_sessions') ORDER BY tablename,indexname`),
    pool.query(`SELECT cl.relname,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
      JOIN pg_class cl ON cl.oid=c.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace
      WHERE n.nspname='public' AND cl.relname IN ('video_uploads','saved_lists','saved_list_items','native_sessions')
      ORDER BY cl.relname,c.conname`),
  ]);
  return JSON.stringify([ledger.rows, columns.rows, indexes.rows, constraints.rows]);
}

async function verify() {
  const base = process.env.DATABASE_URL;
  if (!base || !process.env.PROD_DB_URL || !process.env.PGHOST || !process.env.PGDATABASE) {
    throw new Error("Development and production database configuration required to prove disposable isolation");
  }
  // The verifier runs only against the platform-provided development database
  // server, never against a caller-supplied arbitrary DATABASE_URL.
  const baseAddress = new URL(base);
  const production = new URL(process.env.PROD_DB_URL);
  if (baseAddress.hostname !== process.env.PGHOST ||
      decodeURIComponent(baseAddress.pathname.slice(1)) !== process.env.PGDATABASE ||
      baseAddress.host === production.host ||
      decodeURIComponent(baseAddress.pathname) === decodeURIComponent(production.pathname)) {
    throw new Error("Refusing to create a test database without a distinct development server and database");
  }
  const dbName = `native_recovery_verify_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const testAddress = new URL(base);
  testAddress.pathname = `/${dbName}`;
  const admin = new pg.Pool({ connectionString: base, max: 1 });
  let created = false;
  try {
    await admin.query(`CREATE DATABASE ${quote(dbName)}`);
    created = true;
    const pool = new pg.Pool({ connectionString: testAddress.toString(), max: 2 });
    try {
      await pool.query("CREATE SCHEMA drizzle");
      await pool.query(`CREATE TABLE drizzle.__drizzle_migrations
        (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
      await pool.query("CREATE TABLE public.users (id varchar PRIMARY KEY)");
      const journal = JSON.parse(await readFile(path.join(folder, "meta/_journal.json"), "utf8")) as {
        entries: Array<{ idx: number; tag: string; when: number }>;
      };
      for (const entry of journal.entries.slice(0, 17)) {
        const bytes = await readFile(path.join(folder, `${entry.tag}.sql`));
        const hash = entry.idx === 0
          ? "be166c77f09289f50afbfafbac53ded79eeda092232c2910577d53b06ab26071"
          : createHash("sha256").update(bytes).digest("hex");
        await pool.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1,$2)", [hash, entry.when]);
      }
      for (const entry of journal.entries.slice(17, 22)) {
        const sql = await readFile(path.join(folder, `${entry.tag}.sql`), "utf8");
        for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
          await pool.query(statement);
        }
      }
      const client = await pool.connect();
      try {
        const drift = await snapshot(pool);
        assert.equal(await runRecovery(client, "dry-run"), "ready");
        assert.equal(await snapshot(pool), drift, "dry run changed the disposable database");
        console.log("PASS: exact drift fixture and dry run without writes");
        // A globally conflicting index name makes the 0022 IF NOT EXISTS
        // statement skip its intended index. Post-check must reject and roll
        // back both the table and all six newly appended ledger entries.
        await pool.query("CREATE INDEX native_sessions_expires_at_idx ON public.users(id)");
        await assert.rejects(runRecovery(client, "apply"), /Native index mismatch/);
        assert.equal(await snapshot(pool), drift, "failed apply left partial schema or ledger changes");
        await pool.query("DROP INDEX public.native_sessions_expires_at_idx");
        console.log("PASS: post-check failure rolls back table and ledger atomically");
        assert.equal(await runRecovery(client, "apply"), "applied");
        const repaired = await snapshot(pool);
        assert.notEqual(repaired, drift);
        const rows = await pool.query("SELECT created_at::text, hash FROM drizzle.__drizzle_migrations ORDER BY created_at");
        assert.equal(rows.rowCount, 23);
        for (const entry of journal.entries) {
          assert.equal(rows.rows[entry.idx].created_at, String(entry.when));
          if (entry.idx > 0) {
            const hash = createHash("sha256").update(await readFile(path.join(folder, `${entry.tag}.sql`))).digest("hex");
            assert.equal(rows.rows[entry.idx].hash, hash);
          }
        }
        assert.equal(rows.rows[0].hash, "be166c77f09289f50afbfafbac53ded79eeda092232c2910577d53b06ab26071");
        console.log("PASS: 23 ledger records and native schema applied together");
        await assert.rejects(runRecovery(client, "apply"), /Expected 17 ledger rows/);
        assert.equal(await snapshot(pool), repaired, "second apply changed the database");
        console.log("PASS: second apply refuses without changes");
      } finally { client.release(); }
    } finally { await pool.end(); }
  } finally {
    if (created) {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [dbName]);
      await admin.query(`DROP DATABASE ${quote(dbName)}`);
    }
    await admin.end();
  }
}

verify().catch((error: unknown) => {
  // Never print driver errors that may include connection information.
  console.error("Disposable verification failed; check isolation guards and test assertions without logging database connection details.");
  process.exitCode = 1;
});