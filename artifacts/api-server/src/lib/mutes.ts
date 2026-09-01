import { db, userMutes } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/**
 * Unlike a block, a mute is strictly one-directional: it only ever affects
 * what muterUserId sees. This is the single source of truth every route
 * should call instead of querying userMutes directly.
 */
export async function isMuted(muterUserId: string | undefined, mutedUserId: string | undefined): Promise<boolean> {
  if (!muterUserId || !mutedUserId || muterUserId === mutedUserId) return false;
  const [row] = await db.select({ id: userMutes.id }).from(userMutes)
    .where(and(eq(userMutes.muterUserId, muterUserId), eq(userMutes.mutedUserId, mutedUserId))).limit(1);
  return Boolean(row);
}

/** Every account id that muterUserId has muted. Never the reverse — muting never affects what the muted account sees. */
export async function mutedUserIds(muterUserId: string | undefined): Promise<Set<string>> {
  const set = new Set<string>();
  if (!muterUserId) return set;
  const rows = await db.select({ mutedUserId: userMutes.mutedUserId }).from(userMutes)
    .where(eq(userMutes.muterUserId, muterUserId));
  for (const row of rows) set.add(row.mutedUserId);
  return set;
}
