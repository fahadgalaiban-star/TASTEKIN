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
// it forever. Applied via Postgres's own `lock_timeout`, which reliably
// aborts a blocking `pg_advisory_lock` wait — verified directly against
// Postgres 16 (the version this repo's .replit provisions in Production):
// a session blocked in pg_advisory_lock() with lock_timeout set is
// canceled with `57014 canceling statement due to lock timeout` at
// exactly the configured bound, not left hanging.
const LOCK_ACQUIRE_TIMEOUT_MS_DEFAULT = 30_000;

// Bounds each individual migration SQL statement server-side, via
// Postgres's own `statement_timeout` — verified directly (Postgres 16)
// that a statement running past this bound is canceled by the server
// itself (`57014 canceling statement due to statement timeout`), not
// merely abandoned by the client while it keeps running. This is the
// actual cancellation mechanism; MIGRATION_RUN_TIMEOUT_MS below is a
// secondary, whole-run backstop, not the primary one — a bare client-side
// `Promise.race` around migrate() (this module's previous approach) does
// NOT stop the query: it only stops *waiting* for it, and a subsequent
// query issued on the same connection (e.g. to unlock) queues behind the
// still-running one instead of running promptly, which was verified to
// make that supposed timeout take as long as the wedged query itself.
const MIGRATION_STATEMENT_TIMEOUT_MS_DEFAULT = 60_000;

// A whole-run backstop below the statement timeout does not usually need
// to fire — a single wedged statement is caught by statement_timeout
// above well before this elapses. It exists for the case statement_timeout
// alone can't cover: many individually-fast statements whose sum still
// runs long. When it fires, the connection is not trusted to respond to
// another query of its own (see the "hard kill" note below) — its backend
// is terminated from a separate connection instead.
const MIGRATION_RUN_TIMEOUT_MS_DEFAULT = 120_000;

// Each bound is overridable via env var, purely so regression tests can
// prove real cancellation/termination behavior in seconds instead of
// waiting out the production-sized defaults above — never set in any real
// environment (.replit's run command sets none of these).
function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function lockAcquireTimeoutMs(): number {
  return positiveIntEnv("MIGRATION_LOCK_ACQUIRE_TIMEOUT_MS", LOCK_ACQUIRE_TIMEOUT_MS_DEFAULT);
}
function migrationStatementTimeoutMs(): number {
  return positiveIntEnv("MIGRATION_STATEMENT_TIMEOUT_MS", MIGRATION_STATEMENT_TIMEOUT_MS_DEFAULT);
}
function migrationRunTimeoutMs(): number {
  return positiveIntEnv("MIGRATION_RUN_TIMEOUT_MS", MIGRATION_RUN_TIMEOUT_MS_DEFAULT);
}

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

/** Thrown when a migration run is forcibly terminated for exceeding its run timeout (migrationRunTimeoutMs()). By the time this is thrown, the backend running it has already been sent pg_terminate_backend — the statement cannot still be running. */
export class MigrationTimeoutError extends Error {
  constructor(ms: number) {
    super(`Migration run did not complete within ${ms}ms — its database backend has been forcibly terminated so it cannot continue running in the background.`);
    this.name = "MigrationTimeoutError";
  }
}

/**
 * Races `promise` against a deadline. Unlike a bare `Promise.race`, a
 * losing promise here is never left to run unobserved: `onDeadline` runs
 * (and is awaited) before this rejects, so the caller can be certain
 * whatever `onDeadline` was responsible for — here, terminating the
 * backend actually running the query — has already happened by the time
 * this function's rejection reaches anyone.
 */
function raceWithDeadline<T>(promise: Promise<T>, ms: number, onDeadline: () => Promise<void>, deadlineError: Error): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onDeadline().finally(() => reject(deadlineError));
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
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
 * bounded (lockAcquireTimeoutMs(), via lock_timeout) so a stuck holder
 * fails the boot instead of hanging it.
 *
 * The migration itself runs through a Drizzle instance bound to the exact
 * same reserved PoolClient that holds the lock — not the shared pool —
 * so there is no window where the lock is held on one connection while the
 * DDL runs on a different, unlocked one. Each statement is bounded
 * server-side by migrationStatementTimeoutMs() (statement_timeout); the
 * whole run is additionally bounded by migrationRunTimeoutMs(), enforced
 * by forcibly terminating the backend (pg_terminate_backend, from a
 * separate connection) if it fires — never by merely abandoning a client-
 * side wait, which would leave the SQL running and the lock held.
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
 * that as fatal. In every one of those cases, by the time this rejects,
 * no migration SQL from this run is still executing.
 */
export async function runPendingMigrations(migrationsFolder: string): Promise<void> {
  const lockClient = await pool.connect();
  let forceTerminated = false;
  // Forcibly terminating this client's own backend (the emergency path
  // below) closes its socket out from under it, which makes the
  // underlying pg Client emit its own 'error' event for the unexpected
  // disconnect — on an EventEmitter with no listener, Node treats an
  // unhandled 'error' event as fatal and crashes the process. Every
  // failure path here already surfaces through a rejected promise, so
  // that event carries nothing this function doesn't already report;
  // it's swallowed here specifically so a deliberate termination can
  // never crash the server it's trying to protect.
  lockClient.on("error", () => {});
  try {
    const backendPidResult = await lockClient.query("SELECT pg_backend_pid() AS pid");
    const backendPid = (backendPidResult.rows[0] as { pid: number }).pid;

    const lockAcquireTimeout = lockAcquireTimeoutMs();
    await lockClient.query(`SET lock_timeout = ${lockAcquireTimeout}`);
    try {
      await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    } catch (error) {
      throw new Error(
        `Could not acquire the migration advisory lock within ${lockAcquireTimeout}ms — another instance may be stuck holding it: ${error instanceof Error ? error.message : String(error)}`,
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
      // The real, server-side cancellation for migration SQL: Postgres
      // itself aborts any single statement that runs past this bound.
      const runTimeout = migrationRunTimeoutMs();
      await lockClient.query(`SET statement_timeout = ${migrationStatementTimeoutMs()}`);
      try {
        const lockDb = drizzle(lockClient, { schema });
        await raceWithDeadline(
          migrate(lockDb, { migrationsFolder }),
          runTimeout,
          async () => {
            forceTerminated = true;
            // Issuing another query on lockClient here would queue behind
            // whatever it's still running and could wait just as long as
            // the thing we're trying to bound — so this always goes
            // through a separate connection from the pool. Terminating
            // the backend aborts its current statement immediately,
            // regardless of what it's doing, and releases everything the
            // session held (including the advisory lock) as a side effect
            // of the session ending. Terminating one's own backend needs
            // no elevated privilege in Postgres.
            await pool.query("SELECT pg_terminate_backend($1)", [backendPid]).catch(() => {});
          },
          new MigrationTimeoutError(runTimeout),
        );
      } finally {
        // Reset when the session is still ours to use, same reasoning as
        // lock_timeout above: this client returns to the shared pool and
        // must never leave a non-default statement_timeout for an
        // unrelated later query to inherit. Skipped after a forced
        // termination — not because querying a dead connection is
        // unsafe (it just fails fast), but because pg_terminate_backend
        // was just sent and the original migrate() query on this same
        // client may not have finished unwinding yet; racing a new query
        // against that teardown is exactly what pg's "client is already
        // executing a query" deprecation warns about. A force-terminated
        // client is discarded outright below, never reused, so there is
        // nothing left to reset.
        if (!forceTerminated) {
          await lockClient.query("SET statement_timeout = 0").catch(() => {});
        }
      }

      const missing = await findMissingKinTables(lockClient);
      if (missing.length > 0) {
        throw new MigrationLedgerMismatchError(missing);
      }
    } finally {
      if (!forceTerminated) {
        // Normal path (success or an ordinary migration/validation
        // failure): the session is alive and still holds the lock —
        // release it. Skipped only when the backend was just terminated
        // above, where the session — and the lock with it — is already
        // gone, and this client must never be trusted to run another
        // query of its own again.
        await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
      }
    }
  } finally {
    // A force-terminated connection is handed back with an error so the
    // pool discards and closes it (pg-pool's release(err) path) instead
    // of returning it to the idle list for reuse — it must never be
    // handed to unrelated later code as if it were a normal, healthy
    // connection.
    lockClient.release(forceTerminated ? new Error("Discarding a connection whose backend was force-terminated after a migration timeout") : undefined);
  }
}
