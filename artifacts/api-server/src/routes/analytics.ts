import { analyticsEvents, db } from "@workspace/db";
import { countDistinct, gte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";

import { isCurrentUserAdmin } from "../lib/creator-account";
import { isKnownAnalyticsEvent, shouldAcceptAnalyticsEvent, validateAnalyticsMetadata } from "../lib/analytics";

const router: IRouter = Router();

/**
 * Fire-and-forget product-analytics ingestion. Auth is optional — signed
 * -out browsing (Home/Explore) is a normal, trackable path in this app —
 * but every event name and its metadata shape is validated against a
 * strict server-side allowlist (lib/analytics.ts) before anything is
 * stored, and a userId is only ever the authenticated internal user id,
 * never a client-supplied value. This endpoint always responds success
 * -shaped even when the event is rejected or storage fails, because
 * analytics must never break the caller's real action.
 */
router.post("/analytics/events", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  try {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    if (!isKnownAnalyticsEvent(name)) { res.status(202).json({ recorded: false }); return; }
    const metadata = validateAnalyticsMetadata(name, req.body?.metadata ?? {});
    if (metadata === null) { res.status(202).json({ recorded: false }); return; }
    const userId = req.isAuthenticated() && req.user ? req.user.id : null;
    if (!shouldAcceptAnalyticsEvent(name, userId, req)) { res.status(202).json({ recorded: false }); return; }

    await db.insert(analyticsEvents).values({ name, userId, metadata });
    res.status(202).json({ recorded: true });
  } catch (error) {
    req.log.error({ err: error }, "Unable to record analytics event");
    res.status(202).json({ recorded: false });
  }
});

const WINDOW_DAYS = { last7Days: 7, last30Days: 30 } as const;

async function summarizeWindow(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [totals] = await db.select({
    totalEvents: sql<number>`count(*)`.mapWith(Number),
    uniqueActiveUsers: countDistinct(analyticsEvents.userId),
  }).from(analyticsEvents).where(gte(analyticsEvents.createdAt, since));

  const eventCountRows = await db.select({
    name: analyticsEvents.name,
    count: sql<number>`count(*)`.mapWith(Number),
  }).from(analyticsEvents).where(gte(analyticsEvents.createdAt, since)).groupBy(analyticsEvents.name);
  const eventCounts = Object.fromEntries(eventCountRows.map((row) => [row.name, row.count]));

  const started = eventCounts.onboarding_started ?? 0;
  const completed = eventCounts.onboarding_completed ?? 0;

  const funnel = [
    { step: "home_viewed", count: eventCounts.home_viewed ?? 0 },
    { step: "explore_viewed", count: eventCounts.explore_viewed ?? 0 },
    { step: "creator_profile_viewed", count: eventCounts.creator_profile_viewed ?? 0 },
    { step: "edit_viewed", count: eventCounts.edit_viewed ?? 0 },
    { step: "subscription_started", count: eventCounts.subscription_started ?? 0 },
  ];

  return {
    totalEvents: totals?.totalEvents ?? 0,
    uniqueActiveUsers: totals?.uniqueActiveUsers ?? 0,
    eventCounts,
    onboarding: {
      started,
      completed,
      rate: started > 0 ? completed / started : 0,
    },
    funnel,
  };
}

/**
 * Simple admin dashboard aggregation — counts and rates over fixed 7/30-day
 * windows, no per-user sequential attribution and no external analytics
 * provider, per this task's explicit "no advanced attribution system" and
 * "no external analytics provider" scope.
 */
router.get("/admin/analytics/summary", async (req, res): Promise<void> => {
  if (!(await isCurrentUserAdmin(req.user))) { res.status(403).json({ error: "TASTEKIN administrator access required" }); return; }
  res.set("Cache-Control", "private, no-store");
  const [last7Days, last30Days] = await Promise.all([
    summarizeWindow(WINDOW_DAYS.last7Days),
    summarizeWindow(WINDOW_DAYS.last30Days),
  ]);
  res.json({ periods: { last7Days, last30Days } });
});

export default router;
