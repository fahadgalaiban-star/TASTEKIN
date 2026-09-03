// My Things (KIN) closet-media reconciliation — a manual, human-invoked
// recovery command. There is NO scheduler, cron, or background worker in
// this repository; nothing retries automatically. This script does
// nothing unless explicitly run, and performs no database writes, claims
// no rows, and makes no storage calls unless --yes is passed (dry-run by
// default, matching admin-grant.ts's safety convention).
//
// Usage:
//   pnpm --filter scripts run reconcile:closet-media                # dry run — prints what would happen
//   pnpm --filter scripts run reconcile:closet-media -- --yes        # applies it
//   pnpm --filter scripts run reconcile:closet-media -- --yes --prod # against PROD_DB_URL (never used by this session)
//
// No transaction is ever held open across an Object Storage call: a
// single atomic UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED) claims
// a bounded batch of eligible rows into 'cleanup_in_progress' with a 5-
// minute lease and a fresh, random cleanup_claim_token (its own implicit
// transaction, committed before this script does anything else); the
// storage call happens outside any transaction; a second, independent
// statement finalizes the result, fenced by
// `WHERE id = :rowId AND state = 'cleanup_in_progress' AND cleanup_claim_token = :myToken`
// so a stale/slow run can never overwrite a newer claim's result. A crash
// between claim and finalize simply leaves the lease to expire, after
// which the row becomes eligible again on the next manual run.
import { sql } from "drizzle-orm";

import { parseArgs } from "./lib/resolve-admin-target";
import { connectDatabase } from "./lib/resolve-database";

// Deliberately self-contained (this repo's scripts/ package never imports
// api-server's src/ across the package boundary — it has no dependency on
// @workspace/api-server and its tsconfig's rootDir is scoped to its own
// src/). This duplicates the small amount of sidecar-calling logic from
// artifacts/api-server/src/lib/private-media-storage.ts's deleteClosetMedia
// rather than reaching across packages.
const SIDE_CAR_ENDPOINT = "http://127.0.0.1:1106";
const CLOSET_MEDIA_PATH = /^\/objects\/closet\/[0-9a-fA-F-]{36}$/;
const MAX_ERROR_LENGTH = 200;

function privateObjectDirectory() {
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) throw new Error("PRIVATE_OBJECT_DIR is not configured");
  return directory.replace(/\/$/, "");
}

/** Mirrors private-media-storage.ts's splitObjectPath exactly: first path segment is the bucket, the rest is the object name within it. */
function splitObjectPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) throw new Error("Invalid object storage path");
  return { bucketName: segments[0], objectName: segments.slice(1).join("/") };
}

async function signedDeleteURL(fullPath: string) {
  const { bucketName, objectName } = splitObjectPath(fullPath);
  const response = await fetch(`${SIDE_CAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "DELETE",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Unable to sign object URL (${response.status})`);
  const result = (await response.json()) as { signed_url?: string };
  if (!result.signed_url) throw new Error("Object storage did not return a signed URL");
  return result.signed_url;
}

/** Idempotent: a 404 (object already absent) is treated as success — identical to the request-time helper's behavior. */
async function deleteClosetMediaObject(objectPath: string) {
  if (!CLOSET_MEDIA_PATH.test(objectPath)) throw new Error("Invalid closet media object path");
  const objectName = objectPath.slice("/objects/".length);
  const signedURL = await signedDeleteURL(`${privateObjectDirectory()}/${objectName}`);
  const response = await fetch(signedURL, { method: "DELETE", signal: AbortSignal.timeout(30_000) });
  if (!response.ok && response.status !== 404) throw new Error(`Unable to delete closet media (${response.status})`);
}

/** Never persists a raw error message (may embed the signed URL) — a short, bounded, fixed-vocabulary reason only. */
function sanitizeErrorReason(prefix: string, error: unknown): string {
  let reason = "unknown error";
  if (error instanceof Error) {
    const httpMatch = error.message.match(/\((\d{3})\)/);
    if (httpMatch) reason = `HTTP ${httpMatch[1]}`;
    else if (error.name === "AbortError" || /timeout/i.test(error.message)) reason = "timeout";
    else reason = "error";
  }
  return `${prefix}: ${reason}`.slice(0, MAX_ERROR_LENGTH);
}

const BATCH_SIZE = 50;
const LEASE_MINUTES = 5;
const STALE_RESERVED_HOURS = 1;
const STALE_UPLOADING_HOURS = 1;
const ABANDONED_UPLOADED_HOURS = 24;
const DELETION_PENDING_MINUTES = 15;
const BACKOFF_BASE_MINUTES = 5;
const MAX_BACKOFF_EXPONENT = 6; // 5 * 2^6 = 320 minutes ≈ 5.3 hours
const MAX_RETRY_COUNT = 10;

/**
 * Eligibility, per state, with the exact age/retry/backoff predicate each
 * one requires — never a bare `state IN (...)` without a condition.
 */
const ELIGIBILITY = sql`
  (cleanup_lease_until IS NULL OR cleanup_lease_until < now())
  AND (
    (state = 'attached' AND closet_item_id IS NULL)
    OR (owner_user_id IS NULL AND state IN ('uploading', 'upload_failed', 'uploaded', 'attached', 'deletion_pending', 'delete_failed'))
    OR (state = 'uploading' AND updated_at < now() - interval '${sql.raw(String(STALE_UPLOADING_HOURS))} hours')
    OR (state = 'upload_failed')
    OR (state = 'uploaded' AND closet_item_id IS NULL AND updated_at < now() - interval '${sql.raw(String(ABANDONED_UPLOADED_HOURS))} hours')
    OR (state = 'deletion_pending' AND updated_at < now() - interval '${sql.raw(String(DELETION_PENDING_MINUTES))} minutes')
    OR (state = 'delete_failed' AND retry_count < ${MAX_RETRY_COUNT}
        AND updated_at < now() - (interval '${sql.raw(String(BACKOFF_BASE_MINUTES))} minutes' * power(2, least(retry_count, ${MAX_BACKOFF_EXPONENT}))))
    OR (state = 'cleanup_in_progress' AND cleanup_lease_until < now())
  )
`;

type Db = ReturnType<typeof connectDatabase>["db"];

async function previewStaleReserved(db: Db) {
  const result = await db.execute(sql`
    SELECT id FROM closet_media_uploads
    WHERE state = 'reserved' AND image_object_key IS NULL
      AND updated_at < now() - interval '${sql.raw(String(STALE_RESERVED_HOURS))} hours'
    ORDER BY updated_at ASC
    LIMIT ${BATCH_SIZE}
  `);
  return result.rows as Array<{ id: string }>;
}

async function previewEligible(db: Db) {
  const result = await db.execute(sql`
    SELECT id, state, owner_user_id, image_object_key, retry_count
    FROM closet_media_uploads
    WHERE ${ELIGIBILITY}
    ORDER BY updated_at ASC
    LIMIT ${BATCH_SIZE}
  `);
  return result.rows as Array<{ id: string; state: string; owner_user_id: string | null; image_object_key: string | null; retry_count: number }>;
}

/** No-storage fast path: a stale reservation that never even reached decoding. Single atomic statement, no lease needed. */
async function resolveStaleReserved(db: Db, id: string) {
  await db.execute(sql`
    UPDATE closet_media_uploads
    SET state = 'deleted', deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND state = 'reserved' AND image_object_key IS NULL
  `);
}

/**
 * Claims a bounded batch atomically: SELECT ... FOR UPDATE SKIP LOCKED
 * (so two concurrent runs never grab the same row) composed with the
 * claiming UPDATE in one statement, so the whole claim is a single,
 * implicitly-atomic operation with no gap between selecting and marking.
 * RETURNING captures the id, image_object_key, and freshly generated
 * cleanup_claim_token in that same atomic step.
 */
async function claimBatch(db: Db) {
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT id FROM closet_media_uploads
      WHERE ${ELIGIBILITY}
      ORDER BY updated_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    )
    UPDATE closet_media_uploads
    SET state = 'cleanup_in_progress',
        cleanup_lease_until = now() + interval '${sql.raw(String(LEASE_MINUTES))} minutes',
        cleanup_claim_token = gen_random_uuid(),
        updated_at = now()
    FROM candidates
    WHERE closet_media_uploads.id = candidates.id
    RETURNING closet_media_uploads.id, closet_media_uploads.image_object_key, closet_media_uploads.cleanup_claim_token
  `);
  return result.rows as Array<{ id: string; image_object_key: string | null; cleanup_claim_token: string }>;
}

/** Fenced finalize: 0 rows affected means a newer claim already resolved this row — never overwritten. */
async function finalizeClaim(db: Db, id: string, token: string, outcome: "deleted" | "delete_failed", errorReason?: string) {
  if (outcome === "deleted") {
    const result = await db.execute(sql`
      UPDATE closet_media_uploads
      SET state = 'deleted', deleted_at = now(), updated_at = now(),
          cleanup_lease_until = NULL, cleanup_claim_token = NULL
      WHERE id = ${id} AND state = 'cleanup_in_progress' AND cleanup_claim_token = ${token}
      RETURNING id
    `);
    return result.rows.length > 0;
  }
  const result = await db.execute(sql`
    UPDATE closet_media_uploads
    SET state = 'delete_failed', retry_count = retry_count + 1, last_error = ${errorReason ?? null},
        last_attempt_at = now(), updated_at = now(),
        cleanup_lease_until = NULL, cleanup_claim_token = NULL
    WHERE id = ${id} AND state = 'cleanup_in_progress' AND cleanup_claim_token = ${token}
    RETURNING id
  `);
  return result.rows.length > 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { db, pool } = connectDatabase(args);
  try {
    const staleReserved = await previewStaleReserved(db);
    const eligible = await previewEligible(db);

    console.log(`\nStale 'reserved' rows with no object key (no storage call needed): ${staleReserved.length}`);
    console.log(`Rows eligible for claim-based cleanup (may need a storage delete call): ${eligible.length}`);
    for (const row of eligible) {
      console.log(`  ${row.id}  state=${row.state}  owner=${row.owner_user_id ?? "(deleted)"}  key=${row.image_object_key ?? "(none)"}  retry_count=${row.retry_count}`);
    }

    if (!args.yes) {
      console.log("\nDry run only — no database writes, no rows claimed, no storage calls made. Re-run with --yes to apply.");
      return;
    }

    let resolvedFastPath = 0;
    for (const row of staleReserved) {
      await resolveStaleReserved(db, row.id);
      resolvedFastPath += 1;
    }
    console.log(`\nResolved ${resolvedFastPath} stale reserved row(s) via the no-storage fast path.`);

    const claimed = await claimBatch(db);
    console.log(`Claimed ${claimed.length} row(s) for cleanup.`);

    let deleted = 0;
    let failed = 0;
    for (const row of claimed) {
      if (!row.image_object_key) {
        // Should not happen structurally (every eligible state that reaches
        // the claim has a key) — defensive guard per explicit instruction:
        // never call storage without a key to operate on.
        const finalizedOk = await finalizeClaim(db, row.id, row.cleanup_claim_token, "deleted");
        if (finalizedOk) deleted += 1;
        continue;
      }
      try {
        await deleteClosetMediaObject(row.image_object_key);
        const finalizedOk = await finalizeClaim(db, row.id, row.cleanup_claim_token, "deleted");
        if (finalizedOk) deleted += 1;
      } catch (error) {
        console.error(`  cleanup failed for ${row.id}: ${error instanceof Error ? error.message.slice(0, 120) : "unknown error"}`);
        const finalizedOk = await finalizeClaim(db, row.id, row.cleanup_claim_token, "delete_failed", sanitizeErrorReason("reconcile delete failed", error));
        if (finalizedOk) failed += 1;
      }
    }
    console.log(`Reconciliation complete: ${deleted} deleted, ${failed} marked delete_failed (will be retried on a future run once backoff elapses).`);
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
