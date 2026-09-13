// Video Foundation, Phase 2B — a targeted, literal SQL-replay test for
// migrations 0017 -> 0018 -> 0019, run against a fresh, isolated, single-
// purpose database that holds nothing but this test's own video_uploads
// table.
//
// This is deliberately NOT the same thing as `pnpm --filter db run push`
// (which reads the current TypeScript schema and reconciles the database
// to match it — that proves the schema *definition* is internally
// consistent, but is not evidence that the .sql migration files themselves
// execute correctly in order) and NOT the same thing as
// `verify:migrations` (which replays the FULL migration history via
// drizzle-orm's migrator, and is known to fail on a from-empty database
// for a pre-existing, unrelated reason: migrations 0000-0009 never
// CREATE TABLE for closet_items/closet_media_uploads, which 0010+ ALTER).
//
// video_uploads is exempt from that gap — 0017_video_uploads.sql is a
// self-contained CREATE TABLE, and 0018/0019 only ALTER the table 0017
// created — so this script applies the three real .sql files directly,
// verbatim, with a raw `pg` client (the simple query protocol executes a
// whole multi-statement file as one implicit transaction, so a mid-file
// failure rolls back everything in that file, matching drizzle-orm's own
// migrate() transactional guarantee for the full migrator), and asserts
// that representative rows inserted after 0017 survive the 0018 and 0019
// upgrades with the correct new-column defaults, nullability, and
// constraint behavior. Report this test's result separately from
// `verify:migrations` — they cover different, non-overlapping claims.
//
// Usage:
//   createdb tastekin_video_upload_migration_replay   # once, must start empty
//   DATABASE_URL=postgresql://user:pass@host/tastekin_video_upload_migration_replay \
//     pnpm --filter scripts run verify:video-upload-migration-replay
//
// Refuses to run against a database that already has any tables — this
// must be a dedicated, single-purpose, disposable database, never a
// shared dev/test/prod database and never the same database another
// Phase 2B suite (verify:video-upload-webhook-recovery) is using.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../lib/db/migrations");

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("DATABASE_URL is required — point this at a fresh, empty, dedicated database (e.g. `createdb tastekin_video_upload_migration_replay`). Never production, never a database anything else is using.");
    process.exit(1);
  }
  return url;
}
const databaseUrl = requireDatabaseUrl();

function describeConnection(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(could not parse connection string)";
  }
}

async function readMigration(tag: string): Promise<string> {
  return fs.readFile(path.join(migrationsDir, `${tag}.sql`), "utf8");
}

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  console.log(`Connected → ${describeConnection(databaseUrl)}`);

  try {
    // --- isolation guard ---------------------------------------------------
    const existingTables = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    if (existingTables.rows.length > 0) {
      throw new Error(
        `Refusing to run: this database already has ${existingTables.rows.length} table(s) ` +
        `(${existingTables.rows.map((r) => r.tablename).join(", ")}). ` +
        `This test requires a freshly created, empty, dedicated database.`,
      );
    }
    console.log("Isolation check passed: database starts with zero tables.\n");

    // --- apply 0017_video_uploads.sql ---------------------------------------
    const sql0017 = await readMigration("0017_video_uploads");
    await client.query(sql0017);
    console.log("Applied 0017_video_uploads.sql");

    const columnsAfter0017 = await client.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'video_uploads' ORDER BY ordinal_position`,
    );
    const colNames0017 = columnsAfter0017.rows.map((r) => r.column_name);
    for (const expected of ["id", "creator_id", "owner_user_id", "bunny_library_id", "bunny_video_id", "state", "created_at", "updated_at"]) {
      assert.ok(colNames0017.includes(expected), `0017 should create column ${expected}`);
    }
    const bunnyVideoIdCol = columnsAfter0017.rows.find((r) => r.column_name === "bunny_video_id");
    assert.equal(bunnyVideoIdCol?.is_nullable, "NO", "0017: bunny_video_id should be NOT NULL before 0018");

    // Representative rows inserted immediately after 0017 — these are what
    // the 0018/0019 upgrades below must preserve untouched.
    await client.query(
      `INSERT INTO video_uploads (id, creator_id, owner_user_id, bunny_library_id, bunny_video_id, state)
       VALUES ('11111111-1111-1111-1111-111111111111', 'creator-a', 'owner-a', 'lib-1', 'bunny-video-a', 'ready')`,
    );
    await client.query(
      `INSERT INTO video_uploads (id, creator_id, owner_user_id, bunny_library_id, bunny_video_id, state)
       VALUES ('22222222-2222-2222-2222-222222222222', 'creator-b', 'owner-b', 'lib-1', 'bunny-video-b', 'uploading')`,
    );

    // The unique index on bunny_video_id must already be enforced.
    await assert.rejects(
      client.query(
        `INSERT INTO video_uploads (id, creator_id, owner_user_id, bunny_library_id, bunny_video_id, state)
         VALUES ('33333333-3333-3333-3333-333333333333', 'creator-c', 'owner-c', 'lib-1', 'bunny-video-a', 'ready')`,
      ),
      (err: unknown) => (err as { code?: string }).code === "23505",
      "0017: duplicate bunny_video_id should violate the unique index",
    );
    // The rejected statement's own implicit single-statement transaction
    // rolled itself back — the connection is still usable for what follows.
    console.log("Verified 0017 schema shape, NOT NULL, and unique-index behavior; inserted 2 representative rows.\n");

    // --- apply 0018_video_upload_lifecycle.sql ------------------------------
    const sql0018 = await readMigration("0018_video_upload_lifecycle");
    await client.query(sql0018);
    console.log("Applied 0018_video_upload_lifecycle.sql");

    const rowCountAfter0018 = await client.query(`SELECT count(*)::int AS n FROM video_uploads`);
    assert.equal(rowCountAfter0018.rows[0].n, 2, "0018: both representative rows must survive the upgrade");

    const rowA = await client.query(
      `SELECT declared_file_name, retry_count, idempotency_key, last_error, last_attempt_at, last_reconciled_at, deleted_at, state, bunny_video_id
       FROM video_uploads WHERE id = '11111111-1111-1111-1111-111111111111'`,
    );
    assert.equal(rowA.rows[0].state, "ready", "0018: pre-existing row's state must be untouched");
    assert.equal(rowA.rows[0].bunny_video_id, "bunny-video-a", "0018: pre-existing row's bunny_video_id must be untouched");
    assert.equal(rowA.rows[0].declared_file_name, null, "0018: new declared_file_name column should default to null on pre-existing rows");
    assert.equal(rowA.rows[0].retry_count, 0, "0018: new retry_count column should default to 0 on pre-existing rows");
    assert.equal(rowA.rows[0].idempotency_key, null);
    assert.equal(rowA.rows[0].last_error, null);
    assert.equal(rowA.rows[0].last_attempt_at, null);
    assert.equal(rowA.rows[0].last_reconciled_at, null);
    assert.equal(rowA.rows[0].deleted_at, null);

    const bunnyVideoIdColAfter0018 = await client.query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'video_uploads' AND column_name = 'bunny_video_id'`,
    );
    assert.equal(bunnyVideoIdColAfter0018.rows[0].is_nullable, "YES", "0018: bunny_video_id must become nullable");

    // bunny_video_id nullable now — an ambiguous-create row with no id yet.
    await client.query(
      `INSERT INTO video_uploads (id, creator_id, owner_user_id, bunny_library_id, bunny_video_id, state)
       VALUES ('44444444-4444-4444-4444-444444444444', 'creator-d', 'owner-d', 'lib-1', NULL, 'create_ambiguous')`,
    );

    // Partial unique index: (owner_user_id, idempotency_key) unique only
    // where idempotency_key is not null.
    await client.query(
      `INSERT INTO video_uploads (id, creator_id, owner_user_id, bunny_library_id, bunny_video_id, state, idempotency_key)
       VALUES ('55555555-5555-5555-5555-555555555555', 'creator-e', 'owner-e', 'lib-1', NULL, 'creating', 'key-1')`,
    );
    await assert.rejects(
      client.query(
        `INSERT INTO video_uploads (id, creator_id, owner_user_id, bunny_library_id, bunny_video_id, state, idempotency_key)
         VALUES ('66666666-6666-6666-6666-666666666666', 'creator-f', 'owner-e', 'lib-1', NULL, 'creating', 'key-1')`,
      ),
      (err: unknown) => (err as { code?: string }).code === "23505",
      "0018: duplicate (owner_user_id, idempotency_key) should violate the partial unique index",
    );
    // Two rows with the same owner and a NULL idempotency_key must NOT collide.
    await client.query(
      `INSERT INTO video_uploads (id, creator_id, owner_user_id, bunny_library_id, bunny_video_id, state)
       VALUES ('77777777-7777-7777-7777-777777777777', 'creator-g', 'owner-e', 'lib-1', NULL, 'creating')`,
    );
    await client.query(
      `INSERT INTO video_uploads (id, creator_id, owner_user_id, bunny_library_id, bunny_video_id, state)
       VALUES ('88888888-8888-8888-8888-888888888888', 'creator-h', 'owner-e', 'lib-1', NULL, 'creating')`,
    );
    console.log("Verified 0018 preserved prior rows, applied correct defaults, dropped the bunny_video_id NOT NULL, and enforced the new partial unique index.\n");

    // --- apply 0019_video_upload_recovery.sql -------------------------------
    const sql0019 = await readMigration("0019_video_upload_recovery");
    await client.query(sql0019);
    console.log("Applied 0019_video_upload_recovery.sql");

    const rowCountAfter0019 = await client.query(`SELECT count(*)::int AS n FROM video_uploads`);
    assert.equal(rowCountAfter0019.rows[0].n, 6, "0019: all 6 surviving representative rows must still be present (2 from 0017 + 4 successful inserts from 0018)");

    const columnsAfter0019 = await client.query<{ column_name: string; is_nullable: string; data_type: string }>(
      `SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name = 'video_uploads' AND column_name IN ('recovery_lease_until', 'recovery_lease_token')`,
    );
    assert.equal(columnsAfter0019.rows.length, 2, "0019: both recovery lease columns must exist");
    for (const row of columnsAfter0019.rows) {
      assert.equal(row.is_nullable, "YES", `0019: ${row.column_name} must be nullable`);
    }

    const rowAAfter0019 = await client.query(
      `SELECT recovery_lease_until, recovery_lease_token, state, bunny_video_id FROM video_uploads WHERE id = '11111111-1111-1111-1111-111111111111'`,
    );
    assert.equal(rowAAfter0019.rows[0].recovery_lease_until, null, "0019: pre-existing rows default recovery_lease_until to null");
    assert.equal(rowAAfter0019.rows[0].recovery_lease_token, null, "0019: pre-existing rows default recovery_lease_token to null");
    assert.equal(rowAAfter0019.rows[0].state, "ready", "0019: row A's state must remain untouched through this upgrade too");
    assert.equal(rowAAfter0019.rows[0].bunny_video_id, "bunny-video-a");

    const indexCheck = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'video_uploads' AND indexname = 'video_uploads_recovery_lease_idx'`,
    );
    assert.equal(indexCheck.rows.length, 1, "0019: video_uploads_recovery_lease_idx must exist");

    console.log("Verified 0019 preserved all prior rows and added the recovery lease columns/index correctly.\n");

    console.log("PASS: migrations 0017 -> 0018 -> 0019 replay cleanly against an isolated video_uploads baseline, preserving representative rows at every step.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\nFAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
