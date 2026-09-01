import { creatorWorkspaces, db, userMutes } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";

import { creatorByUsername } from "../lib/creator-account";
import { isMuted } from "../lib/mutes";
import { requireUser } from "./engagement";

const router: IRouter = Router();

function isCheckViolation(error: unknown) {
  const hasCode = (value: unknown): boolean => Boolean(value && typeof value === "object" && "code" in value && (value as { code?: unknown }).code === "23514");
  return hasCode(error) || (error instanceof Error && hasCode(error.cause));
}

/**
 * Muting is a private, one-directional visibility preference — never a
 * moderation action, never notified to the muted account, and never a
 * restriction on what the muted account can do. It only ever changes what
 * the muter sees in passive/personalized surfaces (handled in
 * creator-workspace.ts's public feed, discovery.ts's Explore, and
 * engagement.ts's comment lists/counts) — it never touches follows,
 * subscriptions, payments, or any interaction endpoint, and it never
 * weakens an existing Block (areUsersBlocked checks run independently and
 * always take precedence wherever both apply).
 */
router.post("/mutes", async (req, res): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  if (!username) { res.status(400).json({ error: "A username is required" }); return; }
  const target = await creatorByUsername(username);
  if (!target || !target.ownerUserId) { res.status(404).json({ error: "Account not found" }); return; }
  const mutedUserId = target.ownerUserId;
  if (mutedUserId === user.id) { res.status(400).json({ error: "You cannot mute yourself" }); return; }

  try {
    await db.insert(userMutes).values({ muterUserId: user.id, mutedUserId }).onConflictDoNothing();
  } catch (error) {
    if (isCheckViolation(error)) { res.status(400).json({ error: "You cannot mute yourself" }); return; }
    req.log.error({ err: error, userId: user.id }, "Unable to create mute");
    res.status(500).json({ error: "Unable to mute this account" });
    return;
  }
  res.status(201).json({ muted: true });
});

router.get("/mutes/status/:username", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  if (!req.user) { res.json({ muted: false }); return; }
  const target = await creatorByUsername(req.params.username);
  if (!target || !target.ownerUserId) { res.json({ muted: false }); return; }
  res.json({ muted: await isMuted(req.user.id, target.ownerUserId) });
});

router.delete("/mutes/:username", async (req, res): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  const target = await creatorByUsername(req.params.username);
  if (!target || !target.ownerUserId) { res.status(404).json({ error: "Account not found" }); return; }
  await db.delete(userMutes).where(and(eq(userMutes.muterUserId, user.id), eq(userMutes.mutedUserId, target.ownerUserId)));
  res.status(200).json({ muted: false });
});

router.get("/mutes", async (req, res): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  res.set("Cache-Control", "private, no-store");
  const rows = await db.select({
    id: userMutes.id,
    mutedUserId: userMutes.mutedUserId,
    createdAt: userMutes.createdAt,
    workspace: creatorWorkspaces,
  }).from(userMutes)
    .leftJoin(creatorWorkspaces, eq(creatorWorkspaces.ownerUserId, userMutes.mutedUserId))
    .where(eq(userMutes.muterUserId, user.id))
    .orderBy(desc(userMutes.createdAt));
  res.json({
    mutes: rows.map((row) => ({
      id: row.id,
      username: row.workspace?.profile.username ?? null,
      displayName: row.workspace?.profile.displayName ?? null,
      avatar: row.workspace?.profile.avatar ?? null,
      createdAt: row.createdAt,
    })),
  });
});

export default router;
