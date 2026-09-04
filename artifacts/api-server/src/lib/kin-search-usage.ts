import { db, kinSearchUsage } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

export const DEFAULT_KIN_SEARCH_DAILY_LIMIT = 10;
export const KIN_SEARCH_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function kinSearchDailyLimit(): number {
  const raw = process.env.KIN_SEARCH_DAILY_LIMIT;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_KIN_SEARCH_DAILY_LIMIT;
}

/**
 * Race-safe, durable per-user daily KIN search quota — the same
 * pg_advisory_xact_lock + count-then-insert idiom as
 * reserveUploadAttempt in closet-media-upload.ts, so this is correct
 * across any number of server instances and cannot be bypassed by
 * concurrent requests racing each other. A rolling 24h window, not a
 * calendar-day reset, matching the identical convention already used for
 * the upload rate limit.
 *
 * The row is inserted here, before the caller ever touches Anthropic —
 * every reserved attempt counts against the quota regardless of whether
 * the provider call that follows succeeds, fails, or times out, since
 * the cost/risk of an attempted external call was already incurred.
 * Never stores the query text or any other request content — only the
 * fact and time of the attempt.
 */
export async function reserveKinSearchAttempt(ownerUserId: string): Promise<{ id: string } | { rateLimited: true }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`kin-search:${ownerUserId}`}))`);
    const since = new Date(Date.now() - KIN_SEARCH_DAILY_WINDOW_MS);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(kinSearchUsage)
      .where(and(eq(kinSearchUsage.ownerUserId, ownerUserId), gte(kinSearchUsage.createdAt, since)));
    if (count >= kinSearchDailyLimit()) return { rateLimited: true as const };
    const [row] = await tx
      .insert(kinSearchUsage)
      .values({ ownerUserId })
      .returning({ id: kinSearchUsage.id });
    return { id: row.id };
  });
}
