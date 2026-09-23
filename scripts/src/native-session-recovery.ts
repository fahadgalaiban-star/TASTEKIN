/**
 * One-time recovery for production migration drift. No connection is opened
 * until the CLI is invoked. Import runRecovery only from disposable-DB tests.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import type { PoolClient } from "pg";

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/db/migrations");
// Reviewed SHA-256 values of the committed SQL bytes; never compute the
// expected values from the files we are about to execute.
const reviewed = [
  ["0000_shared_creator_workspace", 1773962530000, "4e68f5c546dcb31a5692ee3a83a0f6392ab522930373ce943a2a35653bf87516"],
  ["0001_creator_media_uploads", 1787274276000, "aa0c1a1d47311f72d67441c2c052af18da6b7fb6ad28393359220bbdaad8f753"],
  ["0002_creator_profile", 1787325000000, "4bdf3972a08605640b0c54d0fa3a3c6bde17d0f60a43644635a6cfa6a1c45be2"],
  ["0003_taste_preferences", 1787328997296, "d884578e4f08e783d6b6b5213c64c0780bc243425775c709163360e019c5619a"],
  ["0004_place_fields", 1787400000000, "0926106a223f5483b4a850b563881b99ea54f164b8cb56945e555e108c43435e"],
  ["0005_engagement_and_messages", 1787520000000, "fd3b9bd369bbeaa136bb56ba26882d26562dcf6515fa0c0e80c108482d999b13"],
  ["0006_multi_creator_foundation", 1787530000000, "abbe273e80657d6c4cd398f16c8bf4a1bd7e9a7dbcecf92b8a3cd409eb097e03"],
  ["0007_verification_applications", 1787531000000, "f9a679446438d4c6b20bc95501c6de48961473b0f05eef3015876befbb1e7f47"],
  ["0008_featured_collections", 1787532000000, "4fda4c005e3d163b1527d558ba2e9ca8cf5e1e204eb3279304398b0746c36b05"],
  ["0009_catch_up_migration_history", 1788302764875, "c70d2a152e628b85c35a688e6b62aa440f01ccc4c95e4d0897a2ff81b015a591"],
  ["0010_closet_style_optional", 1788390000000, "17e546177744a88c07b324cd78bd40da8f85ef176a3c0ee7e21e98e2823527ea"],
  ["0011_closet_analysis_attempted_at", 1788400000000, "ab5026aca26b18c712fc96f88ffc7b8d5f9fe4b407c1a38dc594864ee765d3e7"],
  ["0012_kin_search_usage", 1788410000000, "fc3fddcd091f61087756c80ec264b1575436570afeaa26c1bd89e53c79df1f13"],
  ["0013_kin_looks_travel", 1788420000000, "f367ae9829f72b1f1d4ea1a5cdc66562cd1881b1e787bddcb05317d8569d1506"],
  ["0014_kin_ledger_schema_repair", 1788574647593, "c135e1374201d96aaa9b0c7aa784e05def192a150c19756adba3a8879fff710f"],
  ["0015_my_circle_memberships", 1788600000000, "6a5e15a948d7338aea9b3cdfcc5ed591b5d7a638645dbc1645e5ae2b6b78e9e3"],
  ["0016_closet_ownership_status", 1788700000000, "34d4435715d02fbe752d0bf7161e280fef214112d1505d2a7d358e52f849c33d"],
  ["0017_video_uploads", 1788800000000, "7162e6aea174f738ed74ac4761687b74d9cbcd7ed54bf7eb3f62c25127f1c297"],
  ["0018_video_upload_lifecycle", 1789000000000, "f399232efaca99522eadabf7dbd2fcf2d80b3a986b43bf4d72c7156e463a00b8"],
  ["0019_video_upload_recovery", 1789100000000, "cd0c05b600fed287234a77d6d1face7cb7fffa1c66b86fbdb6218e03c5e73aac"],
  ["0020_video_upload_attachment", 1789200000000, "869bb5a7167d55427a793b00f10414c9d4e48278e6df039e4a19328c5b38dbff"],
  ["0021_saved_lists", 1789760000000, "6e54f134fd26cd6d1fe4a326a25d1dd0d388b06e2ed1d7a166f87a1ac63b9d4e"],
  ["0022_native_sessions", 1790200000000, "7349f426955b5bebce9a904ac6e511c23b64fb644b328a8d39fb259b3cefe730"],
] as const;

// The historical 0000 ledger hash differs from today's committed SQL. Never
// "correct" or replace that row: this is the exact reviewed production state.
const historicalFirstHash = "be166c77f09289f50afbfafbac53ded79eeda092232c2910577d53b06ab26071";
const lockKey = 727273001001;
const confirmText = "APPLY-NATIVE-SESSIONS-RECOVERY";
type Mode = "dry-run" | "apply";
type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };
type LedgerRow = { id: number; hash: string; created_at: string };

class RecoveryRefusal extends Error {}

function requireMatch(ok: boolean, reason: string): void {
  if (!ok) throw new RecoveryRefusal(reason);
}

async function reviewedSql(): Promise<string> {
  const journal = JSON.parse(await readFile(path.join(migrations, "meta/_journal.json"), "utf8")) as Journal;
  requireMatch(journal.entries.length === reviewed.length, "Journal length differs from reviewed history");
  let nativeSql = "";
  for (const [idx, [tag, timestamp, expectedHash]] of reviewed.entries()) {
    const entry = journal.entries[idx];
    requireMatch(entry?.idx === idx && entry.tag === tag && entry.when === timestamp, `Journal mismatch at ${idx}`);
    const sql = await readFile(path.join(migrations, `${tag}.sql`), "utf8");
    requireMatch(createHash("sha256").update(sql).digest("hex") === expectedHash, `SQL hash mismatch at ${idx}`);
    if (idx === 22) nativeSql = sql;
  }
  return nativeSql;
}

const columns: Record<string, Record<string, [string, boolean, string | null]>> = {
  video_uploads: {
    id: ["uuid", false, "gen_random_uuid()"], creator_id: ["text", false, null],
    owner_user_id: ["text", false, null], bunny_library_id: ["text", false, null],
    bunny_video_id: ["text", true, null], state: ["text", false, "'uploading'::text"],
    duration_seconds: ["integer", true, null], width: ["integer", true, null],
    height: ["integer", true, null], poster_url: ["text", true, null],
    error_reason: ["text", true, null], created_at: ["timestamp with time zone", false, "now()"],
    updated_at: ["timestamp with time zone", false, "now()"],
    declared_file_name: ["text", true, null], declared_size_bytes: ["bigint", true, null],
    declared_mime_type: ["text", true, null], idempotency_key: ["text", true, null],
    retry_count: ["integer", false, "0"], last_error: ["text", true, null],
    last_attempt_at: ["timestamp with time zone", true, null],
    last_reconciled_at: ["timestamp with time zone", true, null],
    deleted_at: ["timestamp with time zone", true, null],
    recovery_lease_until: ["timestamp with time zone", true, null],
    recovery_lease_token: ["uuid", true, null], attached_edit_id: ["text", true, null],
  },
  saved_lists: {
    id: ["uuid", false, "gen_random_uuid()"], user_id: ["text", false, null],
    name: ["text", false, null], created_at: ["timestamp with time zone", false, "now()"],
    updated_at: ["timestamp with time zone", false, "now()"],
  },
  saved_list_items: {
    list_id: ["uuid", false, null], edit_id: ["text", false, null],
    created_at: ["timestamp with time zone", false, "now()"],
  },
};

const indexes: Record<string, [string, string, boolean, string | null]> = {
  video_uploads_pkey: ["video_uploads", "id", true, null],
  video_uploads_owner_user_id_idx: ["video_uploads", "owner_user_id", false, null],
  video_uploads_bunny_video_id_unique: ["video_uploads", "bunny_video_id", true, null],
  video_uploads_state_updated_idx: ["video_uploads", "state,updated_at", false, null],
  video_uploads_owner_created_idx: ["video_uploads", "owner_user_id,created_at", false, null],
  video_uploads_owner_state_idx: ["video_uploads", "owner_user_id,state", false, null],
  video_uploads_owner_idempotency_key_unique: ["video_uploads", "owner_user_id,idempotency_key", true, "(idempotency_key IS NOT NULL)"],
  video_uploads_recovery_lease_idx: ["video_uploads", "state,recovery_lease_until", false, null],
  saved_lists_pkey: ["saved_lists", "id", true, null],
  saved_lists_user_name_unique: ["saved_lists", "user_id,name", true, null],
  saved_lists_user_id_idx: ["saved_lists", "user_id", false, null],
  saved_list_items_list_id_edit_id_pk: ["saved_list_items", "list_id,edit_id", true, null],
  saved_list_items_edit_id_idx: ["saved_list_items", "edit_id", false, null],
};

async function verifySchema(client: PoolClient, nativeExpected: boolean): Promise<void> {
  const names = [...Object.keys(columns), "native_sessions"];
  const tables = await client.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r' AND c.relname = ANY($1::text[])`, [names],
  );
  const present = new Set(tables.rows.map((r) => r.name));
  const persistence = await client.query<{ name: string; persistence: string }>(
    `SELECT c.relname AS name,c.relpersistence AS persistence FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname = ANY($1::text[])`, [Object.keys(columns)],
  );
  for (const name of Object.keys(columns)) requireMatch(present.has(name), `Missing table ${name}`);
  for (const name of Object.keys(columns)) {
    requireMatch(persistence.rows.find((row) => row.name === name)?.persistence === "p", `Table persistence mismatch: ${name}`);
  }
  requireMatch(present.has("native_sessions") === nativeExpected, "native_sessions presence differs from expected state");
  if (!nativeExpected) {
    const relation = await client.query<{ exists: boolean }>(
      "SELECT to_regclass('public.native_sessions') IS NOT NULL AS exists",
    );
    requireMatch(!relation.rows[0]?.exists, "native_sessions name is already in use");
  }

  const actualColumns = await client.query<{ table_name: string; column_name: string; data_type: string; nullable: boolean; default_expr: string | null }>(
    `SELECT c.relname AS table_name, a.attname AS column_name, format_type(a.atttypid,a.atttypmod) AS data_type,
       NOT a.attnotnull AS nullable, pg_get_expr(d.adbin,d.adrelid) AS default_expr
     FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
     WHERE n.nspname='public' AND c.relname = ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped`,
    [Object.keys(columns)],
  );
  for (const [table, expected] of Object.entries(columns)) {
    const rows = actualColumns.rows.filter((row) => row.table_name === table);
    requireMatch(rows.length === Object.keys(expected).length, `Column count mismatch: ${table}`);
    for (const [name, [type, nullable, defaultExpr]] of Object.entries(expected)) {
      const row = rows.find((item) => item.column_name === name);
      requireMatch(!!row && row.data_type === type && row.nullable === nullable && row.default_expr === defaultExpr, `Column mismatch: ${table}.${name}`);
    }
  }
  const actualIndexes = await client.query<{ name: string; table_name: string; keys: string; unique: boolean; predicate: string | null; definition: string; valid: boolean; ready: boolean }>(
    `SELECT i.relname AS name, t.relname AS table_name,
       (SELECT string_agg(pg_get_indexdef(x.indexrelid,k.n,true),',' ORDER BY k.n)
        FROM generate_series(1,x.indnkeyatts) AS k(n)) AS keys,
       x.indisunique AS unique, pg_get_expr(x.indpred,x.indrelid) AS predicate,
       pg_get_indexdef(x.indexrelid) AS definition, x.indisvalid AS valid, x.indisready AS ready
     FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
     JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
     WHERE n.nspname='public' AND t.relname = ANY($1::text[])`, [Object.keys(columns)],
  );
  for (const [name, [table, keys, unique, predicate]] of Object.entries(indexes)) {
    const row = actualIndexes.rows.find((item) => item.name === name);
    const definition = `CREATE ${unique ? "UNIQUE " : ""}INDEX ${name} ON public.${table} USING btree (${keys.replaceAll(",", ", ")})${predicate ? ` WHERE ${predicate}` : ""}`;
    requireMatch(!!row && row.table_name === table && row.keys === keys && row.unique === unique &&
      row.predicate === predicate && row.definition === definition && row.valid && row.ready, `Index mismatch: ${name}`);
  }
  const constraints = await client.query<{ table_name: string; name: string; type: string; definition: string }>(
    `SELECT t.relname AS table_name,c.conname AS name,c.contype AS type,pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
     WHERE n.nspname='public' AND t.relname = ANY($1::text[])`, [Object.keys(columns)],
  );
  const fk = constraints.rows.find((row) => row.table_name === "saved_list_items" && row.name === "saved_list_items_list_id_saved_lists_id_fk");
  requireMatch(fk?.type === "f" && fk.definition === "FOREIGN KEY (list_id) REFERENCES saved_lists(id) ON DELETE CASCADE", "Saved-list foreign key mismatch");
  for (const [table, name] of [["video_uploads", "video_uploads_pkey"], ["saved_lists", "saved_lists_pkey"], ["saved_list_items", "saved_list_items_list_id_edit_id_pk"]]) {
    requireMatch(constraints.rows.some((row) => row.table_name === table && row.name === name && row.type === "p"), `Primary key mismatch: ${table}`);
  }
}

async function verifyNative(client: PoolClient): Promise<void> {
  const expected: Record<string, [string, boolean, string | null]> = {
    id: ["uuid", false, "gen_random_uuid()"],
    user_id: ["character varying", false, null],
    token_hash: ["character varying", false, null],
    platform: ["text", false, null],
    app_version: ["text", true, null],
    created_at: ["timestamp with time zone", false, "now()"],
    last_used_at: ["timestamp with time zone", false, "now()"],
    expires_at: ["timestamp with time zone", false, null],
    revoked_at: ["timestamp with time zone", true, null],
    revoked_reason: ["text", true, null],
  };
  const result = await client.query<{ name: string; type: string; nullable: boolean; default_expr: string | null }>(
    `SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
       NOT a.attnotnull AS nullable,pg_get_expr(d.adbin,d.adrelid) AS default_expr
     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
     WHERE a.attrelid='public.native_sessions'::regclass AND a.attnum>0 AND NOT a.attisdropped`,
  );
  requireMatch(result.rows.length === Object.keys(expected).length, "native_sessions column count mismatch");
  for (const [name, [type, nullable, defaultExpr]] of Object.entries(expected)) {
    const row = result.rows.find((item) => item.name === name);
    requireMatch(!!row && row.type === type && row.nullable === nullable && row.default_expr === defaultExpr, `Native column mismatch: ${name}`);
  }
  const actualIndexes = await client.query<{ name: string; keys: string; unique: boolean; definition: string; valid: boolean; ready: boolean }>(
    `SELECT i.relname AS name,x.indisunique AS unique,
       (SELECT string_agg(pg_get_indexdef(x.indexrelid,k.n,true),',' ORDER BY k.n)
        FROM generate_series(1,x.indnkeyatts) AS k(n)) AS keys,
       pg_get_indexdef(x.indexrelid) AS definition, x.indisvalid AS valid, x.indisready AS ready
     FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
     WHERE x.indrelid='public.native_sessions'::regclass`,
  );
  for (const [name, keys, unique] of [
    ["native_sessions_pkey", "id", true],
    ["native_sessions_token_hash_unique", "token_hash", true],
    ["native_sessions_user_id_idx", "user_id", false],
    ["native_sessions_expires_at_idx", "expires_at", false],
  ] as const) {
    const definition = `CREATE ${unique ? "UNIQUE " : ""}INDEX ${name} ON public.native_sessions USING btree (${keys})`;
    requireMatch(actualIndexes.rows.some((row) => row.name === name && row.keys === keys &&
      row.unique === unique && row.definition === definition && row.valid && row.ready), `Native index mismatch: ${name}`);
  }
  const nativeConstraints = await client.query<{ name: string; type: string; definition: string }>(
    `SELECT conname AS name,contype AS type,pg_get_constraintdef(oid) AS definition
     FROM pg_constraint WHERE conrelid='public.native_sessions'::regclass`,
  );
  requireMatch(nativeConstraints.rows.some((row) => row.name === "native_sessions_pkey" && row.type === "p" && row.definition === "PRIMARY KEY (id)"), "Native primary key missing");
  requireMatch(nativeConstraints.rows.some((row) => row.name === "native_sessions_token_hash_unique" && row.type === "u" && row.definition === "UNIQUE (token_hash)"), "Native token uniqueness missing");
  requireMatch(nativeConstraints.rows.some((row) => row.name === "native_sessions_user_id_users_id_fk" && row.type === "f" && row.definition === "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"), "Native user foreign key missing");
}

async function ledger(client: PoolClient): Promise<LedgerRow[]> {
  const result = await client.query<LedgerRow>(
    "SELECT id, hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at, id",
  );
  return result.rows;
}

function verifyLedger(rows: LedgerRow[], count: number): void {
  requireMatch(rows.length === count, `Expected ${count} ledger rows, found ${rows.length}`);
  const ids = new Set<number>();
  rows.forEach((row, index) => {
    const [, timestamp, hash] = reviewed[index];
    requireMatch(!ids.has(row.id), "Duplicate ledger ID");
    ids.add(row.id);
    requireMatch(row.created_at === String(timestamp) && row.hash === (index === 0 ? historicalFirstHash : hash), `Ledger mismatch at journal index ${index}`);
  });
}

export async function runRecovery(client: PoolClient, mode: Mode): Promise<"ready" | "applied"> {
  // Validate all source files before even starting a transaction.
  const sql = await reviewedSql();
  let active = false;
  try {
    await client.query(mode === "apply" ? "BEGIN" : "BEGIN READ ONLY");
    active = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '20s'");
    if (mode === "apply") await client.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);
    verifyLedger(await ledger(client), 17);
    await verifySchema(client, false);
    if (mode === "apply") {
      for (const [, timestamp, hash] of reviewed.slice(17, 22)) {
        await client.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [hash, timestamp]);
      }
      for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
        await client.query(statement);
      }
      const [, timestamp, hash] = reviewed[22];
      await client.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [hash, timestamp]);
      verifyLedger(await ledger(client), 23);
      await verifySchema(client, true);
      await verifyNative(client);
      await client.query("COMMIT");
      active = false;
      return "applied";
    }
    await client.query("ROLLBACK");
    active = false;
    return "ready";
  } catch (error) {
    if (active) await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export const APPLY_CONFIRMATION = confirmText;

/**
 * CLI argument contract. Exactly two invocation shapes are accepted:
 *   (none)                                  → dry run
 *   --apply --confirm=<exact typed text>     → apply
 * pnpm forwards a standalone "--" to the script verbatim, so exactly one
 * leading separator is tolerated; both `pnpm run recover:native-sessions
 * --apply --confirm=…` and the same with `--` before the flags reach the
 * same check. Anything else (a second "--", a missing or wrong confirmation,
 * extra arguments) is refused before any environment or database access.
 */
export function parseCliArgs(argv: readonly string[]): Mode {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  const apply = args.includes("--apply");
  const valid = apply
    ? args.length === 2 && args.includes(`--confirm=${confirmText}`)
    : args.length === 0;
  if (!valid) throw new RecoveryRefusal(`Usage: native-session-recovery [--apply --confirm=${confirmText}]`);
  return apply ? "apply" : "dry-run";
}

async function cli(): Promise<void> {
  const mode = parseCliArgs(process.argv.slice(2));
  if (!process.env.PROD_DB_URL) throw new RecoveryRefusal("PROD_DB_URL is required");
  const pool = new pg.Pool({ connectionString: process.env.PROD_DB_URL, max: 1, connectionTimeoutMillis: 10000 });
  // An idle-client error (e.g. the server closing the connection after the
  // run) must never surface as an unhandled 'error' event — same protection
  // the boot migration runner applies to its lock client.
  pool.on("error", () => {});
  try {
    const client = await pool.connect();
    try {
      const result = await runRecovery(client, mode);
      console.log(result === "ready"
        ? "DRY RUN: reviewed sources, 17 existing ledger records, and 0017–0021 schema match; 0022 absent. No writes made."
        : "APPLIED: ledger 0017–0022 and native_sessions created and verified atomically.");
    } finally { client.release(); }
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  cli().catch((error: unknown) => {
    // Never log driver errors: they may embed the connection string or SQL.
    console.error(error instanceof RecoveryRefusal ? error.message : "Recovery failed; transaction rolled back. Review preflight and database logs.");
    process.exitCode = 1;
  });
}
