import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { accountMediaProviders, type AccountMediaProviders } from "./account-media-providers";

const LIMIT = 50;
const LEASE_MINUTES = 5;

// Only deleted-account work belongs to this runner. Never sweep normal pending
// uploads or delete media that still belongs to a live creator workspace.
const creatorEligible = sql`
  m.state IN ('deleting', 'delete_failed', 'cleanup_in_progress')
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m.owner_user_id)
  AND NOT EXISTS (SELECT 1 FROM creator_workspaces w WHERE w.creator_id = m.creator_id)
  AND m.updated_at < now() - interval '5 minutes'`;
const closetEligible = sql`
  m.owner_user_id IS NULL AND m.image_object_key IS NOT NULL
  AND m.state IN ('uploading', 'upload_failed', 'uploaded', 'attached',
                  'deletion_pending', 'delete_failed', 'cleanup_in_progress')
  AND (m.cleanup_lease_until IS NULL OR m.cleanup_lease_until < now())
  AND (m.state <> 'delete_failed' OR m.last_attempt_at IS NULL
       OR m.last_attempt_at < now() - interval '5 minutes' * power(2, least(m.retry_count, 6)))`;
const videoEligible = sql`
  NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m.owner_user_id)
  AND m.state <> 'deleted'
  AND (m.bunny_video_id IS NOT NULL
       OR m.state IN ('creating', 'create_ambiguous', 'orphan_cleanup_pending'))
  AND (m.recovery_lease_until IS NULL OR m.recovery_lease_until < now())
  AND m.updated_at < now() - interval '5 minutes'
  AND (m.last_attempt_at IS NULL
       OR m.last_attempt_at < now() - interval '5 minutes' * power(2, least(m.retry_count, 6)))`;

export async function runAccountMediaCleanup(
  options: { apply?: boolean; limit?: number } = {},
  providers: AccountMediaProviders = accountMediaProviders,
) {
  const limit = options.limit ?? LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT) throw new Error("Cleanup limit must be between 1 and 50");
  const summary = { dryRun: !options.apply, eligible: { creator: 0, closet: 0, video: 0 }, deleted: 0, pending: 0 };
  const previews = await Promise.all([
    db.execute(sql`SELECT m.object_path FROM creator_media_uploads m WHERE ${creatorEligible} LIMIT ${limit}`),
    db.execute(sql`SELECT m.id FROM closet_media_uploads m WHERE ${closetEligible} LIMIT ${limit}`),
    db.execute(sql`SELECT m.id FROM video_uploads m WHERE ${videoEligible} LIMIT ${limit}`),
  ]);
  summary.eligible = { creator: previews[0].rows.length, closet: previews[1].rows.length, video: previews[2].rows.length };
  if (!options.apply) return summary;

  // Creator ledger has no lease columns. Its millisecond-exact updated_at is
  // the fencing token, and cleanup_in_progress expires after five minutes.
  // Reclaims cannot share a timestamp with the prior, expired claim.
  const creatorClaims = await db.execute(sql`
    WITH candidates AS (
      SELECT m.object_path FROM creator_media_uploads m WHERE ${creatorEligible}
      ORDER BY m.updated_at FOR UPDATE SKIP LOCKED LIMIT ${limit}
    )
    UPDATE creator_media_uploads m SET state = 'cleanup_in_progress',
      updated_at = date_trunc('milliseconds', clock_timestamp())
    FROM candidates c WHERE m.object_path = c.object_path
    RETURNING m.object_path, m.updated_at::text AS claim_time`);
  for (const raw of creatorClaims.rows) {
    const row = raw as { object_path: string; claim_time: string };
    let success = false;
    try { await providers.deleteCreatorPhoto(row.object_path); success = true; } catch { /* durable failure below */ }
    const result = await db.execute(sql`
      UPDATE creator_media_uploads SET state = ${success ? "deleted" : "delete_failed"}, updated_at = now()
      WHERE object_path = ${row.object_path} AND state = 'cleanup_in_progress'
        AND updated_at = ${row.claim_time}::timestamptz RETURNING object_path`);
    if (result.rows.length) success ? summary.deleted++ : summary.pending++;
  }

  const closetToken = randomUUID();
  const closetClaims = await db.execute(sql`
    WITH candidates AS (
      SELECT m.id FROM closet_media_uploads m WHERE ${closetEligible}
      ORDER BY m.updated_at FOR UPDATE SKIP LOCKED LIMIT ${limit}
    )
    UPDATE closet_media_uploads m SET state = 'cleanup_in_progress',
      cleanup_claim_token = ${closetToken}::uuid,
      cleanup_lease_until = now() + interval '${sql.raw(String(LEASE_MINUTES))} minutes', updated_at = now()
    FROM candidates c WHERE m.id = c.id RETURNING m.id, m.image_object_key`);
  for (const raw of closetClaims.rows) {
    const row = raw as { id: string; image_object_key: string };
    let success = false;
    try { await providers.deleteClosetPhoto(row.image_object_key); success = true; } catch { /* durable failure below */ }
    const result = await db.execute(sql`
      UPDATE closet_media_uploads SET state = ${success ? "deleted" : "delete_failed"},
        deleted_at = CASE WHEN ${success} THEN now() ELSE deleted_at END,
        retry_count = retry_count + ${success ? 0 : 1},
        last_error = ${success ? null : "account media cleanup failed"},
        last_attempt_at = now(), updated_at = now(), cleanup_claim_token = NULL, cleanup_lease_until = NULL
      WHERE id = ${row.id}::uuid AND state = 'cleanup_in_progress'
        AND cleanup_claim_token = ${closetToken}::uuid RETURNING id`);
    if (result.rows.length) success ? summary.deleted++ : summary.pending++;
  }

  const videoToken = randomUUID();
  const videoClaims = await db.execute(sql`
    WITH candidates AS (
      SELECT m.id FROM video_uploads m WHERE ${videoEligible}
      ORDER BY m.updated_at FOR UPDATE SKIP LOCKED LIMIT ${limit}
    )
    UPDATE video_uploads m SET state = CASE WHEN m.bunny_video_id IS NULL
        THEN 'orphan_cleanup_pending' ELSE 'deletion_pending' END,
      attached_edit_id = NULL, declared_file_name = NULL,
      recovery_lease_token = ${videoToken}::uuid,
      recovery_lease_until = now() + interval '${sql.raw(String(LEASE_MINUTES))} minutes', updated_at = now()
    FROM candidates c WHERE m.id = c.id RETURNING m.id, m.bunny_video_id, m.bunny_library_id`);
  for (const raw of videoClaims.rows) {
    const row = raw as { id: string; bunny_video_id: string | null; bunny_library_id: string };
    let videoId = row.bunny_video_id;
    let success = false;
    try {
      if (!videoId) {
        const found = await providers.findVideo(row.bunny_library_id, row.id);
        if (found.status === "found") videoId = found.videoId;
      }
      if (videoId) success = (await providers.deleteVideo(videoId, { libraryId: row.bunny_library_id })).status === "ok";
    } catch { /* never persist provider errors, which could contain credentials */ }
    const result = await db.execute(sql`
      UPDATE video_uploads SET state = ${success ? "deleted" : videoId ? "delete_failed" : "orphan_cleanup_pending"},
        bunny_video_id = ${videoId}, deleted_at = CASE WHEN ${success} THEN now() ELSE deleted_at END,
        retry_count = retry_count + ${success ? 0 : 1},
        last_error = ${success ? null : "account media cleanup unresolved"},
        last_attempt_at = now(), updated_at = now(), recovery_lease_token = NULL, recovery_lease_until = NULL
      WHERE id = ${row.id}::uuid AND recovery_lease_token = ${videoToken}::uuid
        AND state IN ('deletion_pending', 'orphan_cleanup_pending') RETURNING id`);
    if (result.rows.length) success ? summary.deleted++ : summary.pending++;
  }
  return summary;
}
