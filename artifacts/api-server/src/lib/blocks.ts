import { db, userBlocks } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";

/**
 * A block is stored one-directional (blocker -> blocked) but every
 * enforcement check here treats it as mutual: if either account has blocked
 * the other, neither can see or interact with the other's profile or
 * content. This is the single source of truth every route should call
 * instead of querying userBlocks directly.
 */
export async function areUsersBlocked(userIdA: string | undefined, userIdB: string | undefined): Promise<boolean> {
  if (!userIdA || !userIdB || userIdA === userIdB) return false;
  const [row] = await db.select({ id: userBlocks.id }).from(userBlocks).where(or(
    and(eq(userBlocks.blockerUserId, userIdA), eq(userBlocks.blockedUserId, userIdB)),
    and(eq(userBlocks.blockerUserId, userIdB), eq(userBlocks.blockedUserId, userIdA)),
  )).limit(1);
  return Boolean(row);
}

/** Every account id that has a mutual-block relationship with userId, in either direction. */
export async function blockedCounterpartIds(userId: string | undefined): Promise<Set<string>> {
  const set = new Set<string>();
  if (!userId) return set;
  const rows = await db.select({ blockerUserId: userBlocks.blockerUserId, blockedUserId: userBlocks.blockedUserId })
    .from(userBlocks)
    .where(or(eq(userBlocks.blockerUserId, userId), eq(userBlocks.blockedUserId, userId)));
  for (const row of rows) set.add(row.blockerUserId === userId ? row.blockedUserId : row.blockerUserId);
  return set;
}
