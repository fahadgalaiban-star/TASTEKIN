/**
 * Read-only report of how one database's Drizzle migration ledger
 * (drizzle.__drizzle_migrations) relates to the committed migration history
 * (lib/db/migrations + meta/_journal.json) and to the objects that actually
 * exist in that database.
 *
 * Why this exists: three different mechanisms have shaped TASTEKIN schemas
 * and only one of them writes the ledger.
 *   - `drizzle-kit push` (scripts/post-merge.sh, development) and Replit's
 *     publish-time schema flow apply schema from lib/db/src/schema without
 *     touching the ledger ("schema-only" drift).
 *   - Drizzle's `migrate()` (lib/db/src/run-migrations.ts, one-off recovery
 *     tools) applies journal entries whose `when` is newer than the ledger's
 *     newest `created_at` and records them. It never compares hashes, and it
 *     never checks whether the objects already exist — so after push drift a
 *     migration without IF NOT EXISTS guards fails with "already exists".
 *   - A ledger restored or seeded out of band can record migrations whose
 *     objects are absent ("ledger-only" drift; the 0012/0013 incident).
 * The API no longer runs migrations on boot (commit 19c2069), so nothing in
 * the deploy path reconciles these. This report shows the exact state so an
 * operator can decide; it changes nothing.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... pnpm --filter scripts run report:migration-ledger [--json]
 *
 * Exit code: 0 = ledger, history and schema agree and nothing is pending;
 *            2 = no drift, but pending migrations that migrate() would apply;
 *            1 = drift, or migrate() would fail, or the history is broken.
 *
 * The connection string is never printed. Every query runs inside one
 * READ ONLY transaction with short lock/statement timeouts, then rolls back.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

export const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/db/migrations");

export type MigrationObject = {
  kind: "table" | "column" | "index" | "constraint";
  name: string;
  /** Owning table for columns and constraints. */
  table?: string;
  /** True when the statement tolerates the object already existing (IF NOT EXISTS / duplicate_object handler). */
  guarded: boolean;
};

export type MigrationFile = {
  idx: number;
  tag: string;
  when: number;
  hash: string;
  objects: MigrationObject[];
  /** Statements that remove schema or rows (DROP TABLE/INDEX/COLUMN, DELETE, TRUNCATE). */
  destructiveStatements: string[];
  /** Statements that rewrite existing rows (UPDATE). */
  dataRewriteStatements: string[];
};

export type MigrationHistory = { entries: MigrationFile[]; problems: string[] };

export type EntryStatus =
  | "applied"
  | "pending"
  | "schema-only"
  | "ledger-only"
  | "partial"
  | "recorded-unprobeable"
  | "unrecorded-unprobeable";

export type EntryReport = {
  idx: number;
  tag: string;
  when: number;
  hash: string;
  recorded: boolean;
  ledgerRows: number;
  hashMatches: boolean | null;
  objectsTotal: number;
  objectsPresent: number;
  missingObjects: string[];
  presentUnguardedObjects: string[];
  status: EntryStatus;
  destructiveStatements: string[];
  dataRewriteStatements: string[];
};

export type LedgerReport = {
  database: string;
  serverVersion: string;
  ledgerTableExists: boolean;
  ledgerRowCount: number;
  newestRecordedAt: number | null;
  unknownLedgerRows: Array<{ id: number; hash: string; created_at: string }>;
  journalProblems: string[];
  entries: EntryReport[];
  prediction: {
    wouldAttempt: string[];
    failsAt: { tag: string; object: string } | null;
  };
  warnings: string[];
  drift: boolean;
  pendingClean: boolean;
};

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };

function describe(object: MigrationObject): string {
  return object.kind === "column" || object.kind === "constraint"
    ? `${object.kind} ${object.table}.${object.name}`
    : `${object.kind} ${object.name}`;
}

function stripComments(sql: string): string {
  return sql.split("\n").filter((line) => !/^\s*--/.test(line)).join("\n");
}

function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((part) => stripComments(part).trim())
    .filter(Boolean);
}

/** Objects a migration creates, parsed from its committed SQL (CREATE TABLE/INDEX, ADD COLUMN/CONSTRAINT). */
export function parseMigrationObjects(sql: string): MigrationObject[] {
  const objects: MigrationObject[] = [];
  for (const statement of splitStatements(sql)) {
    const duplicateHandled = /EXCEPTION\s+WHEN\s+duplicate_(object|column|table)/i.test(statement);
    for (const match of statement.matchAll(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(?:"public"\.)?"([^"]+)"/gi)) {
      objects.push({ kind: "table", name: match[2]!, guarded: Boolean(match[1]) || duplicateHandled });
    }
    for (const match of statement.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi)) {
      objects.push({ kind: "index", name: match[2]!, guarded: Boolean(match[1]) || duplicateHandled });
    }
    // A chunk between breakpoints may hold several ALTER TABLE statements
    // (0000 does), so each ADD COLUMN/CONSTRAINT belongs to the nearest
    // preceding ALTER TABLE, not the chunk's first one.
    const alters = [...statement.matchAll(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:"public"\.)?"([^"]+)"/gi)];
    const owningTable = (position: number): string | undefined =>
      alters.filter((alter) => (alter.index ?? 0) < position).at(-1)?.[1];
    for (const match of statement.matchAll(/ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi)) {
      const table = owningTable(match.index ?? 0);
      if (table) objects.push({ kind: "column", name: match[2]!, table, guarded: Boolean(match[1]) || duplicateHandled });
    }
    for (const match of statement.matchAll(/ADD\s+CONSTRAINT\s+"([^"]+)"/gi)) {
      const table = owningTable(match.index ?? 0);
      if (table) objects.push({ kind: "constraint", name: match[1]!, table, guarded: duplicateHandled });
    }
  }
  return objects;
}

/** Statement heads that remove or rewrite data; `ON DELETE cascade` inside a foreign key is deliberately not matched. */
export function classifyStatements(sql: string): { destructive: string[]; dataRewrites: string[] } {
  const destructive: string[] = [];
  const dataRewrites: string[] = [];
  for (const statement of splitStatements(sql)) {
    const head = statement.replace(/\s+/g, " ").slice(0, 80);
    if (/^(DELETE|TRUNCATE)\b/i.test(statement) || /^DROP\s+(TABLE|INDEX|SCHEMA|VIEW|SEQUENCE)\b/i.test(statement) || /\bDROP\s+COLUMN\b/i.test(statement)) {
      destructive.push(head);
    } else if (/^UPDATE\b/i.test(statement)) {
      dataRewrites.push(head);
    }
  }
  return { destructive, dataRewrites };
}

export async function loadMigrationHistory(folder = MIGRATIONS_FOLDER): Promise<MigrationHistory> {
  const problems: string[] = [];
  const journal = JSON.parse(await readFile(path.join(folder, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; when: number; tag: string }>;
  };
  const entries: MigrationFile[] = [];
  let previousWhen = -Infinity;
  for (const [position, entry] of journal.entries.entries()) {
    if (entry.idx !== position) problems.push(`journal idx ${entry.idx} at position ${position} is out of sequence`);
    if (!(entry.when > previousWhen)) problems.push(`${entry.tag}: 'when' ${entry.when} is not newer than the previous entry — migrate() orders by this value`);
    previousWhen = entry.when;
    let sql: string;
    try {
      sql = await readFile(path.join(folder, `${entry.tag}.sql`), "utf8");
    } catch {
      problems.push(`${entry.tag}: SQL file is missing`);
      continue;
    }
    const classified = classifyStatements(sql);
    entries.push({
      idx: entry.idx,
      tag: entry.tag,
      when: entry.when,
      hash: createHash("sha256").update(sql).digest("hex"),
      objects: parseMigrationObjects(sql),
      destructiveStatements: classified.destructive,
      dataRewriteStatements: classified.dataRewrites,
    });
  }
  return { entries, problems };
}

async function exists(client: Queryable, text: string, values: unknown[]): Promise<boolean> {
  const result = await client.query(text, values);
  return Boolean((result.rows[0] as { present: boolean } | undefined)?.present);
}

async function objectExists(client: Queryable, object: MigrationObject): Promise<boolean> {
  switch (object.kind) {
    case "table":
      return exists(client, `SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind IN ('r', 'p')) AS present`, [object.name]);
    case "index":
      return exists(client, `SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind IN ('i', 'I')) AS present`, [object.name]);
    case "column":
      return exists(client, `SELECT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1 AND a.attname = $2 AND a.attnum > 0 AND NOT a.attisdropped) AS present`, [object.table, object.name]);
    case "constraint":
      return exists(client, `SELECT EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1 AND con.conname = $2) AS present`, [object.table, object.name]);
  }
}

/**
 * Inspects `client`'s database. Issues only SELECTs; the caller owns the
 * transaction (the CLI wraps this in BEGIN READ ONLY … ROLLBACK).
 */
export async function inspectDatabase(client: Queryable, history: MigrationHistory): Promise<LedgerReport> {
  const identity = (await client.query("SELECT current_database() AS database, current_setting('server_version') AS version")).rows[0] as { database: string; version: string };
  const ledgerTableExists = await exists(client, "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present", []);
  const ledgerRows = ledgerTableExists
    ? ((await client.query("SELECT id, hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at, id")).rows as Array<{ id: number; hash: string; created_at: string }>)
    : [];
  const warnings: string[] = [];
  const knownTimestamps = new Set(history.entries.map((entry) => String(entry.when)));
  const unknownLedgerRows = ledgerRows.filter((row) => !knownTimestamps.has(row.created_at));
  const newestRecordedAt = ledgerRows.length ? Math.max(...ledgerRows.map((row) => Number(row.created_at))) : null;

  const entries: EntryReport[] = [];
  for (const entry of history.entries) {
    const rows = ledgerRows.filter((row) => row.created_at === String(entry.when));
    const recorded = rows.length > 0;
    if (rows.length > 1) warnings.push(`${entry.tag}: ${rows.length} ledger rows share created_at ${entry.when}`);
    const hashMatches = recorded ? rows.some((row) => row.hash === entry.hash) : null;
    if (recorded && !hashMatches) warnings.push(`${entry.tag}: ledger hash differs from the committed SQL (migrate() ignores hashes; the file changed after it was recorded, or the row was seeded by hand)`);
    const missingObjects: string[] = [];
    const presentUnguardedObjects: string[] = [];
    let present = 0;
    for (const object of entry.objects) {
      if (await objectExists(client, object)) {
        present += 1;
        if (!object.guarded) presentUnguardedObjects.push(describe(object));
      } else {
        missingObjects.push(describe(object));
      }
    }
    const total = entry.objects.length;
    let status: EntryStatus;
    if (total === 0) status = recorded ? "recorded-unprobeable" : "unrecorded-unprobeable";
    else if (present === total) status = recorded ? "applied" : "schema-only";
    else if (present === 0) status = recorded ? "ledger-only" : "pending";
    else status = "partial";
    entries.push({
      idx: entry.idx,
      tag: entry.tag,
      when: entry.when,
      hash: entry.hash,
      recorded,
      ledgerRows: rows.length,
      hashMatches,
      objectsTotal: total,
      objectsPresent: present,
      missingObjects,
      presentUnguardedObjects,
      status,
      destructiveStatements: entry.destructiveStatements,
      dataRewriteStatements: entry.dataRewriteStatements,
    });
  }

  // What drizzle's migrate() would do next: every journal entry newer than
  // the ledger's newest created_at, in order, inside one transaction — so the
  // first statement that hits an existing unguarded object fails the whole run.
  const wouldAttempt: string[] = [];
  let failsAt: LedgerReport["prediction"]["failsAt"] = null;
  for (const entry of entries) {
    if (newestRecordedAt !== null && entry.when <= newestRecordedAt) continue;
    wouldAttempt.push(entry.tag);
    if (!failsAt && entry.presentUnguardedObjects.length) {
      failsAt = { tag: entry.tag, object: entry.presentUnguardedObjects[0]! };
    }
  }

  const driftStatuses: EntryStatus[] = ["schema-only", "ledger-only", "partial"];
  const drift =
    history.problems.length > 0 ||
    unknownLedgerRows.length > 0 ||
    failsAt !== null ||
    entries.some((entry) => driftStatuses.includes(entry.status) || entry.ledgerRows > 1);
  const pendingClean = !drift && wouldAttempt.length > 0;

  return {
    database: identity.database,
    serverVersion: identity.version,
    ledgerTableExists,
    ledgerRowCount: ledgerRows.length,
    newestRecordedAt,
    unknownLedgerRows,
    journalProblems: history.problems,
    entries,
    prediction: { wouldAttempt, failsAt },
    warnings,
    drift,
    pendingClean,
  };
}

export function exitCodeFor(report: LedgerReport): 0 | 1 | 2 {
  if (report.drift) return 1;
  return report.pendingClean ? 2 : 0;
}

const STATUS_LABEL: Record<EntryStatus, string> = {
  applied: "applied (recorded, objects present)",
  pending: "pending (not recorded, objects absent)",
  "schema-only": "SCHEMA-ONLY drift (objects present, not recorded — applied outside the ledger, e.g. drizzle-kit push / publish-time schema flow)",
  "ledger-only": "LEDGER-ONLY drift (recorded, objects absent)",
  partial: "PARTIAL (some objects present)",
  "recorded-unprobeable": "recorded (creates no probeable objects)",
  "unrecorded-unprobeable": "not recorded (creates no probeable objects)",
};

export function renderReport(report: LedgerReport): string {
  const lines: string[] = [];
  lines.push(`Migration ledger report — database "${report.database}", PostgreSQL ${report.serverVersion}`);
  lines.push(report.ledgerTableExists
    ? `Ledger drizzle.__drizzle_migrations: ${report.ledgerRowCount} rows, newest created_at ${report.newestRecordedAt ?? "none"}`
    : "Ledger drizzle.__drizzle_migrations: TABLE ABSENT (migrate() would create it and treat every journal entry as pending)");
  lines.push(`Journal: ${report.entries.length} entries, last ${report.entries.at(-1)?.tag ?? "none"}`);
  if (report.journalProblems.length) {
    lines.push("Journal problems:");
    for (const problem of report.journalProblems) lines.push(`  ! ${problem}`);
  }
  lines.push("");
  for (const entry of report.entries) {
    const mark = ["schema-only", "ledger-only", "partial"].includes(entry.status) ? "!" : entry.status === "pending" || entry.status === "unrecorded-unprobeable" ? "~" : " ";
    lines.push(`${mark} ${entry.tag}  ${STATUS_LABEL[entry.status]}`);
    if (entry.objectsTotal) lines.push(`    objects ${entry.objectsPresent}/${entry.objectsTotal} present${entry.missingObjects.length ? `; missing: ${entry.missingObjects.join(", ")}` : ""}`);
    if (entry.recorded && entry.hashMatches === false) lines.push("    ledger hash differs from committed SQL");
    if (entry.destructiveStatements.length) lines.push(`    DESTRUCTIVE statements: ${entry.destructiveStatements.join(" | ")}`);
    if (entry.dataRewriteStatements.length) lines.push(`    data rewrite statements: ${entry.dataRewriteStatements.join(" | ")}`);
  }
  if (report.unknownLedgerRows.length) {
    lines.push("");
    lines.push("Ledger rows with no matching journal entry:");
    for (const row of report.unknownLedgerRows) lines.push(`  ! id ${row.id} created_at ${row.created_at} hash ${row.hash.slice(0, 12)}…`);
  }
  if (report.warnings.length) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of report.warnings) lines.push(`  - ${warning}`);
  }
  lines.push("");
  if (report.prediction.wouldAttempt.length === 0) {
    lines.push("drizzle migrate(): nothing newer than the ledger — it would do nothing.");
  } else if (report.prediction.failsAt) {
    lines.push(`drizzle migrate(): would attempt ${report.prediction.wouldAttempt.join(", ")} and FAIL at ${report.prediction.failsAt.tag} because ${report.prediction.failsAt.object} already exists (whole run rolls back, ledger unchanged).`);
  } else {
    lines.push(`drizzle migrate(): would apply ${report.prediction.wouldAttempt.join(", ")} cleanly (no conflicting objects found).`);
  }
  lines.push(report.drift
    ? "RESULT: DRIFT — the ledger does not describe this schema; do not rely on migrate() or a publish flow to reconcile it."
    : report.pendingClean
      ? "RESULT: consistent, with pending migrations that migrate() would apply."
      : "RESULT: consistent — ledger, history and schema agree; nothing pending.");
  return lines.join("\n");
}

async function cli(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const json = args.includes("--json");
  const unknown = args.filter((arg) => arg !== "--json");
  if (unknown.length) throw new Error(`Usage: migration-ledger-report [--json] (unexpected: ${unknown.join(" ")})`);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (it is never printed)");
  const history = await loadMigrationHistory();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
  pool.on("error", () => {});
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      let report: LedgerReport;
      try {
        report = await inspectDatabase(client, history);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
      }
      console.log(json ? JSON.stringify(report, null, 2) : renderReport(report));
      process.exitCode = exitCodeFor(report);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  cli().catch((error: unknown) => {
    // Connection failures can echo the host; keep those generic. Nothing
    // here ever prints the connection string itself.
    const code = (error as { code?: string }).code;
    console.error(code && /^E[A-Z]+$/.test(code)
      ? `Could not connect to the database (${code}).`
      : error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
