import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db, pool } from "./index";

// An arbitrary, fixed constant — not derived from anything — used only to
// namespace this advisory lock so it can never collide with an unrelated
// one taken elsewhere against the same database.
const MIGRATION_LOCK_KEY = 727_273_001_001;

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
 * first finishes, then finds nothing left to do.
 *
 * Intended to run once, before the server starts accepting traffic — see
 * RUN_MIGRATIONS_ON_BOOT in api-server/src/index.ts. Throws on failure; the
 * caller must treat that as fatal (never start serving with a schema the
 * app doesn't match) rather than swallow it.
 */
export async function runPendingMigrations(migrationsFolder: string): Promise<void> {
  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await migrate(db, { migrationsFolder });
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    lockClient.release();
  }
}
