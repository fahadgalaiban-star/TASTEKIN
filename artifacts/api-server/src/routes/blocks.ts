import { creatorFollows, creatorWorkspaces, db, userBlocks } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";

import { creatorByUsername } from "../lib/creator-account";
import { requireUser } from "./engagement";

const router: IRouter = Router();

function isCheckViolation(error: unknown) {
  const hasCode = (value: unknown): boolean => Boolean(value && typeof value === "object" && "code" in value && (value as { code?: unknown }).code === "23514");
  return hasCode(error) || (error instanceof Error && hasCode(error.cause));
}

/**
 * Blocking is a private, mutual-visibility control — never a moderation
 * action against content. Creating a block only ever removes the free
 * "follow" relationship in both directions; it never touches subscriptions,
 * payments, reports, or any published content.
 */
router.post("/blocks", async (req, res): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  if (!username) { res.status(400).json({ error: "A username is required" }); return; }
  const target = await creatorByUsername(username);
  if (!target || !target.ownerUserId) { res.status(404).json({ error: "Account not found" }); return; }
  const blockedUserId = target.ownerUserId;
  if (blockedUserId === user.id) { res.status(400).json({ error: "You cannot block yourself" }); return; }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(userBlocks).values({ blockerUserId: user.id, blockedUserId }).onConflictDoNothing();
      await tx.delete(creatorFollows).where(and(eq(creatorFollows.followerUserId, user.id), eq(creatorFollows.creatorId, target.creatorId)));
      const [blockerWorkspace] = await tx.select({ creatorId: creatorWorkspaces.creatorId }).from(creatorWorkspaces).where(eq(creatorWorkspaces.ownerUserId, user.id)).limit(1);
      if (blockerWorkspace) {
        await tx.delete(creatorFollows).where(and(eq(creatorFollows.followerUserId, blockedUserId), eq(creatorFollows.creatorId, blockerWorkspace.creatorId)));
      }
    });
  } catch (error) {
    if (isCheckViolation(error)) { res.status(400).json({ error: "You cannot block yourself" }); return; }
    req.log.error({ err: error, userId: user.id }, "Unable to create block");
    res.status(500).json({ error: "Unable to block this account" });
    return;
  }
  res.status(201).json({ blocked: true });
});

router.delete("/blocks/:username", async (req, res): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  const target = await creatorByUsername(req.params.username);
  if (!target || !target.ownerUserId) { res.status(404).json({ error: "Account not found" }); return; }
  await db.delete(userBlocks).where(and(eq(userBlocks.blockerUserId, user.id), eq(userBlocks.blockedUserId, target.ownerUserId)));
  res.status(200).json({ blocked: false });
});

router.get("/blocks", async (req, res): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  res.set("Cache-Control", "private, no-store");
  const rows = await db.select({
    id: userBlocks.id,
    blockedUserId: userBlocks.blockedUserId,
    createdAt: userBlocks.createdAt,
    workspace: creatorWorkspaces,
  }).from(userBlocks)
    .leftJoin(creatorWorkspaces, eq(creatorWorkspaces.ownerUserId, userBlocks.blockedUserId))
    .where(eq(userBlocks.blockerUserId, user.id))
    .orderBy(desc(userBlocks.createdAt));
  res.json({
    blocks: rows.map((row) => ({
      id: row.id,
      username: row.workspace?.profile.username ?? null,
      displayName: row.workspace?.profile.displayName ?? null,
      avatar: row.workspace?.profile.avatar ?? null,
      createdAt: row.createdAt,
    })),
  });
});

export default router;
