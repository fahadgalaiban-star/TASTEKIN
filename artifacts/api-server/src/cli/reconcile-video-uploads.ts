import { pool } from "@workspace/db";

import { logger } from "../lib/logger";
import { runVideoUploadRecovery } from "../lib/video-upload-recovery";

/**
 * Video Foundation, Phase 2B — the explicit, manually/scheduler-invoked
 * reconciliation command for video_uploads. There is no in-process timer,
 * cron, or fire-and-forget background task anywhere in this codebase that
 * calls runVideoUploadRecovery — Replit Autoscale can stop this process
 * between requests at any time, so nothing here assumes it stays running
 * long enough for a timer to fire. Retry bookkeeping is durable (persisted
 * on the video_uploads row itself — recovery_lease_until/token, retry_count,
 * last_attempt_at; see video-upload-recovery.ts), so a crash between runs
 * simply leaves the next invocation to pick up where the lease expired.
 *
 * No live schedule is configured by this phase — this is a bounded,
 * one-shot run intended to be wired into a scheduled runner (e.g. a
 * platform cron job invoking this command periodically) as a later,
 * separate step.
 *
 * Usage (after building):
 *   pnpm --filter api-server run build
 *   pnpm --filter api-server run reconcile:video-uploads
 */
async function main() {
  try {
    const summary = await runVideoUploadRecovery();
    // stdout carries exactly one thing: this JSON blob — a scheduled
    // runner (or a human piping this into another tool) must be able to
    // parse it without racing pino-pretty's own asynchronous, worker-thread
    // transport (only active outside NODE_ENV=production — see logger.ts),
    // which does not guarantee it flushes before or after this write.
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    // One-shot CLI invocation, not a long-lived server process — never
    // leave the pool open after this run finishes.
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ err: error }, "Video upload reconciliation run failed");
    process.exit(1);
  });
