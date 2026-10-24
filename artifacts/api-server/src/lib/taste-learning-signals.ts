import { analyticsEvents, creatorFollows, creatorViewEvents, db, editDismissals, editLikes, editSaves, myCircleMemberships } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { TASTE_LEARNING, type TasteSignal } from "./taste-learning";

/**
 * Database side of taste learning, kept apart from the pure learner so the
 * unit tests can load taste-learning.ts without a database.
 *
 * Loads the member's OWN signals from the last window. Every query is
 * filtered by the member's user id; nothing about anyone else is read, and
 * no count of any kind is computed.
 */
export async function loadViewerSignals(userId: string, now = new Date()): Promise<TasteSignal[]> {
  const since = new Date(now.getTime() - TASTE_LEARNING.windowDays * 86_400_000);
  const [saves, likes, follows, circle, views, dwell, dismissals] = await Promise.all([
    db.select({ editId: editSaves.editId, at: editSaves.createdAt }).from(editSaves).where(and(eq(editSaves.userId, userId), gte(editSaves.createdAt, since))),
    db.select({ editId: editLikes.editId, at: editLikes.createdAt }).from(editLikes).where(and(eq(editLikes.userId, userId), gte(editLikes.createdAt, since))),
    db.select({ creatorId: creatorFollows.creatorId, at: creatorFollows.createdAt }).from(creatorFollows).where(eq(creatorFollows.followerUserId, userId)),
    db.select({ creatorId: myCircleMemberships.creatorId, at: myCircleMemberships.createdAt }).from(myCircleMemberships).where(eq(myCircleMemberships.ownerUserId, userId)),
    db.select({ editId: creatorViewEvents.editId, at: creatorViewEvents.createdAt }).from(creatorViewEvents).where(and(eq(creatorViewEvents.viewerUserId, userId), gte(creatorViewEvents.createdAt, since), sql`${creatorViewEvents.editId} IS NOT NULL`)),
    db.select({ metadata: analyticsEvents.metadata, at: analyticsEvents.createdAt }).from(analyticsEvents).where(and(eq(analyticsEvents.userId, userId), eq(analyticsEvents.name, "edit_dwell"), gte(analyticsEvents.createdAt, since))),
    db.select({ editId: editDismissals.editId, at: editDismissals.createdAt }).from(editDismissals).where(eq(editDismissals.userId, userId)),
  ]);
  const signals: TasteSignal[] = [];
  for (const row of saves) signals.push({ kind: "save", editId: row.editId, at: row.at });
  for (const row of likes) signals.push({ kind: "like", editId: row.editId, at: row.at });
  // Follows and Circle are standing relationships, not dated events: they count at full weight.
  for (const row of follows) signals.push({ kind: "follow", creatorId: row.creatorId, at: now });
  for (const row of circle) signals.push({ kind: "circle", creatorId: row.creatorId, at: now });
  for (const row of views) if (row.editId) signals.push({ kind: "view", editId: row.editId, at: row.at });
  for (const row of dwell) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const editId = typeof metadata.editId === "string" ? metadata.editId : null;
    const seconds = typeof metadata.seconds === "number" ? metadata.seconds : 0;
    if (editId) signals.push({ kind: "dwell", editId, at: row.at, seconds });
  }
  // Dismissals never decay away: the Edit stays hidden.
  for (const row of dismissals) signals.push({ kind: "notInterested", editId: row.editId, at: now });
  return signals;
}
