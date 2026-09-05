import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { pool } from "./index";
import * as schema from "./schema";

// An arbitrary, fixed constant — not derived from anything — used only to
// namespace this advisory lock so it can never collide with an unrelated
// one taken elsewhere against the same database.
const MIGRATION_LOCK_KEY = 727_273_001_001;

// Bounded so a stuck lock holder (a crashed prior instance that never
// unlocked, or a wedged database) fails the boot loudly instead of hanging
// it forever. Applied via Postgres's own `lock_timeout`, which — unlike
// `statement_timeout` — does cover a blocking `pg_advisory_lock` wait.
const LOCK_ACQUIRE_TIMEOUT_MS = 30_000;

// Bounded client-side, since `migrate()` has no timeout option of its own.
// A real migration run is a handful of small DDL statements; if it hasn't
// finished in two minutes something is wrong (a wedged connection, a lock
// held by an unrelated long-running query) and the boot should fail rather
// than hang indefinitely holding the advisory lock.
const MIGRATION_RUN_TIMEOUT_MS = 120_000;

// The objects the reported Production incident showed can be silently
// absent even though Drizzle's own ledger records their migrations
// (0012, 0013) as applied — e.g. a ledger seeded or restored out of band
// from the schema it describes. Checked with `to_regclass`, which is a
// simple existence probe (works for any regclass-having relation) rather
// than a full structural diff — enough to catch exactly the class of
// mismatch that caused KIN to fail before ever reaching Anthropic, without
// this module re-implementing schema validation.
const REQUIRED_KIN_TABLES = ["kin_search_usage", "kin_saved_recommendations", "kin_trips", "kin_trip_items"] as const;

/** Thrown when the ledger reports success but the schema it claims to describe doesn't match reality. Distinguished from a plain migration failure so the diagnostic can be explicit about which case occurred. */
export class MigrationLedgerMismatchError extends Error {
  constructor(missingTables: readonly string[]) {
    super(
      `Migration ledger reports every migration applied, but the following required tables are still absent from the database: ${missingTables.join(", ")}. ` +
        "This is a ledger/schema mismatch, not a pending migration — refusing to start rather than serve requests against a schema that doesn't match what was recorded. " +
        "See lib/db/migrations/0014_kin_ledger_schema_repair.sql for the additive repair migration that recreates these objects; if it already ran and this still fails, the database needs manual investigation.",
    );
    this.name = "MigrationLedgerMismatchError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Probes for the tables every migration claims to have created — the same check the caller runs after `runPendingMigrations` returns, kept here so both live next to the list they check against. */
async function findMissingKinTables(client: { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }): Promise<string[]> {
  const missing: string[] = [];
  for (const table of REQUIRED_KIN_TABLES) {
    const result = await client.query("SELECT to_regclass($1) AS reg", [`public.${table}`]);
    const row = result.rows[0] as { reg: string | null } | undefined;
    if (!row?.reg) missing.push(table);
  }
  return missing;
}

/**
 * Applies every not-yet-applied migration from migrationsFolder, using
 * Drizzle's own migration ledger (a `drizzle.__drizzle_migrations` table it
 * creates and manages itself — this function never writes to it directly,
 * and nothing in this codebase may hand-edit it). Every migration file is
 * additive SQL already reviewed and committed to the repo; this never runs
 * arbitrary or generated SQL.
 *
 * migrationsFolder is passed in by the caller rather than computed here:
 * once this package is bundled by a caller's build (esbuild, for
 * api-server), import.meta.url inside this module resolves to the bundle's
 * own location, not this source file's real path, so any path computed
 * relative to it here would be wrong. The caller already has a reliable
 * way to locate lib/db/migrations relative to itself.
 *
 * Takes a Postgres advisory lock for the duration of the migration run so
 * that multiple instances booting at once (Autoscale can start more than
 * one on deploy or scale-up) never race to apply the same pending
 * migration concurrently — every instance but one blocks here until the
 * first finishes, then finds nothing left to do. Lock acquisition is
 * bounded (LOCK_ACQUIRE_TIMEOUT_MS) so a stuck holder fails the boot
 * instead of hanging it.
 *
 * The migration itself runs through a Drizzle instance bound to the exact
 * same reserved PoolClient that holds the lock — not the shared pool —
 * so there is no window where the lock is held on one connection while the
 * DDL runs on a different, unlocked one. Bounded by
 * MIGRATION_RUN_TIMEOUT_MS.
 *
 * After migrate() returns, validates that the tables every tracked
 * migration is supposed to have created actually exist. This is the
 * repair for a real Production incident: the ledger recorded 0012 and
 * 0013 as applied (correct hashes, migrate() reports nothing pending) but
 * the tables those migrations create were nevertheless absent. A ledger
 * that claims success is not proof the schema matches it — this check is
 * the difference between the two, and its failure is fatal for the same
 * reason a migration failure is: never start serving with a schema the
 * app doesn't match.
 *
 * Throws on any failure (lock timeout, migration failure, migration
 * timeout, or post-migration validation failure); the caller must treat
 * that as fatal.
 */
export async function runPendingMigrations(migrationsFolder: string): Promise<void> {
  const lockClient = await pool.connect();
  try {
    await lockClient.query(`SET lock_timeout = ${LOCK_ACQUIRE_TIMEOUT_MS}`);
    try {
      await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    } catch (error) {
      throw new Error(
        `Could not acquire the migration advisory lock within ${LOCK_ACQUIRE_TIMEOUT_MS}ms — another instance may be stuck holding it: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      // Reset unconditionally (success or failure): this client is
      // returned to the shared pool below and its session-level settings
      // outlive this function, so a lingering non-default lock_timeout
      // must never leak into an unrelated later query that reuses the
      // same physical connection. Safe to run even if the lock attempt
      // itself failed — a lock_timeout error aborts only that one
      // implicit-transaction statement, not the session.
      await lockClient.query("SET lock_timeout = 0").catch(() => {});
    }
    try {
      const lockDb = drizzle(lockClient, { schema });
      await withTimeout(
        migrate(lockDb, { migrationsFolder }),
        MIGRATION_RUN_TIMEOUT_MS,
        `Migration run did not complete within ${MIGRATION_RUN_TIMEOUT_MS}ms`,
      );
      const missing = await findMissingKinTables(lockClient);
      if (missing.length > 0) {
        throw new MigrationLedgerMismatchError(missing);
      }
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    lockClient.release();
  }
}
