import { AddCircleMemberResponse, GetCircleFeedResponseItem, GetCircleMemberStatusResponse, ListCircleMembersResponseItem } from "@workspace/api-zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { creatorFollows, creatorWorkspaces, db, myCircleMemberships, usersTable } from "@workspace/db";
import { areUsersBlocked, blockedCounterpartIds } from "../lib/blocks";
import { creatorByUsername } from "../lib/creator-account";
import { circleAddDecision, circleFeedVisible, sanitizeCircleEdit } from "../lib/circle-policy";
import { addCircleMember, createDrizzleCircleRepository, removeCircleMember } from "../lib/circle-service";
import { isFeatureEnabled } from "../lib/feature-flags";

const router: IRouter = Router();
const circleRepository = createDrizzleCircleRepository(db, { memberships: myCircleMemberships, follows: creatorFollows });

function noStore(res: import("express").Response) {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.vary("Cookie");
}

function profileOf(value: unknown) {
  const profile = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const username = typeof profile.username === "string" ? profile.username : "";
  const avatar = typeof profile.avatar === "string" ? profile.avatar : "";
  return {
    username,
    displayName: typeof profile.displayName === "string" ? profile.displayName : "",
    avatar: avatar.startsWith("/objects/") ? `/api/public-profile-media/${encodeURIComponent(username)}` : avatar,
  };
}

function publicEdit(edit: Record<string, unknown>, username: string) {
  return sanitizeCircleEdit(edit, username);
}

const legacyLockedPreviews: Record<string, string> = {
  "private-hotel": "/tastekin-media/private-hotel-preview.webp",
  "training-week": "/tastekin-media/training-week-preview.webp",
};

function normalizeLockedEdit(edit: Record<string, unknown>) {
  const preview = typeof edit.id === "string" ? legacyLockedPreviews[edit.id] : undefined;
  if (edit.access === "locked" && preview && edit.image === "/tastekin-media/private-hotel-source.webp") {
    return { ...edit, image: preview, sourceImage: undefined, previewImage: preview };
  }
  return edit;
}

async function requireUser(req: import("express").Request, res: import("express").Response) {
  noStore(res);
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to access your Circle" });
    return null;
  }
  return req.user!;
}

async function requireCircle(req: import("express").Request, res: import("express").Response) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (!(await isFeatureEnabled("my_circle"))) {
    res.status(403).json({ error: "My Circle is not available right now" });
    return null;
  }
  return user;
}

router.get("/circle/members", async (req, res): Promise<void> => {
  const user = await requireCircle(req, res);
  if (!user) return;
  const rows = await db.select({ membership: myCircleMemberships, workspace: creatorWorkspaces })
    .from(myCircleMemberships)
    .innerJoin(creatorWorkspaces, eq(myCircleMemberships.creatorId, creatorWorkspaces.creatorId))
    .innerJoin(usersTable, eq(creatorWorkspaces.ownerUserId, usersTable.id))
    .where(and(eq(myCircleMemberships.ownerUserId, user.id), eq(usersTable.isVerified, true)))
    .orderBy(asc(myCircleMemberships.createdAt));
  const blocked = await blockedCounterpartIds(user.id);
  const result = rows.filter(({ workspace }) => !workspace.ownerUserId || !blocked.has(workspace.ownerUserId)).map(({ membership, workspace }) => {
    const profile = profileOf(workspace.profile);
    return ListCircleMembersResponseItem.parse({ creatorId: workspace.creatorId, ...profile, verified: true, addedAt: membership.createdAt });
  });
  res.json(result);
});

router.get("/circle/members/:targetId", async (req, res): Promise<void> => {
  const user = await requireCircle(req, res);
  if (!user) return;
  const target = await creatorByUsername(String(req.params.targetId));
  const creatorId = target?.creatorId;
  const [workspace] = target ? await db.select({ workspace: creatorWorkspaces, verified: usersTable.isVerified })
    .from(creatorWorkspaces).innerJoin(usersTable, eq(creatorWorkspaces.ownerUserId, usersTable.id))
    .where(eq(creatorWorkspaces.creatorId, target.creatorId)).limit(1) : [];
  if (!workspace || await areUsersBlocked(user.id, workspace.workspace.ownerUserId ?? undefined)) {
    res.status(404).json({ error: "Creator not found" }); return;
  }
  const [membership] = await db.select().from(myCircleMemberships).where(and(eq(myCircleMemberships.ownerUserId, user.id), eq(myCircleMemberships.creatorId, creatorId))).limit(1);
  res.json(GetCircleMemberStatusResponse.parse({ creatorId, active: Boolean(membership && workspace.verified) }));
});

router.put("/circle/members/:targetId", async (req, res): Promise<void> => {
  const user = await requireCircle(req, res);
  if (!user) return;
  const target = await creatorByUsername(String(req.params.targetId));
  const creatorId = target?.creatorId;
  const [workspace] = target ? await db.select({ workspace: creatorWorkspaces, verified: usersTable.isVerified })
    .from(creatorWorkspaces).innerJoin(usersTable, eq(creatorWorkspaces.ownerUserId, usersTable.id))
    .where(eq(creatorWorkspaces.creatorId, target.creatorId)).limit(1) : [];
  const decision = circleAddDecision(user.id, workspace ? { ownerUserId: workspace.workspace.ownerUserId, verified: workspace.verified } : null, Boolean(workspace && await areUsersBlocked(user.id, workspace.workspace.ownerUserId ?? undefined)));
  if (decision === "not_found") { res.status(404).json({ error: "Creator not found" }); return; }
  if (decision === "self") { res.status(403).json({ error: "You cannot add yourself to Circle" }); return; }
  if (decision === "unverified") { res.status(403).json({ error: "Only verified creators can join Circle" }); return; }
  await addCircleMember(circleRepository, user.id, creatorId!);
  res.json(AddCircleMemberResponse.parse({ creatorId, active: true }));
});

router.delete("/circle/members/:targetId", async (req, res): Promise<void> => {
  const user = await requireCircle(req, res);
  if (!user) return;
  const target = await creatorByUsername(String(req.params.targetId));
  if (target) await removeCircleMember(circleRepository, user.id, target.creatorId);
  res.status(204).send();
});

router.get("/circle/feed", async (req, res): Promise<void> => {
  const user = await requireCircle(req, res);
  if (!user) return;
  const memberships = await db.select({ creatorId: myCircleMemberships.creatorId }).from(myCircleMemberships)
    .innerJoin(creatorWorkspaces, eq(myCircleMemberships.creatorId, creatorWorkspaces.creatorId))
    .innerJoin(usersTable, eq(creatorWorkspaces.ownerUserId, usersTable.id))
    .where(eq(myCircleMemberships.ownerUserId, user.id));
  const ids = memberships.map((item) => item.creatorId);
  if (!ids.length) { res.json([]); return; }
  const memberIds = new Set(ids);
  const blocked = await blockedCounterpartIds(user.id);
  const rows = await db.select({ workspace: creatorWorkspaces, verified: usersTable.isVerified })
    .from(creatorWorkspaces).innerJoin(usersTable, eq(creatorWorkspaces.ownerUserId, usersTable.id))
    .where(inArray(creatorWorkspaces.creatorId, ids))
    .orderBy(desc(creatorWorkspaces.updatedAt), asc(creatorWorkspaces.creatorId));
  const items = rows.filter(({ workspace, verified }) =>
    circleFeedVisible(workspace.ownerUserId, user.id, Boolean(verified), memberIds.has(workspace.creatorId), blocked),
  ).flatMap(({ workspace }) => {
    const profile = profileOf(workspace.profile);
    return (workspace.edits as Array<Record<string, unknown>>).map(normalizeLockedEdit).filter((edit) => edit.status === "published" && (edit.access === "public" || edit.access === "locked"))
      .map((edit) => publicEdit(edit, profile.username))
      .flatMap((edit) => edit ? [GetCircleFeedResponseItem.parse({ creatorUsername: profile.username, creatorName: profile.displayName, creatorVerified: true, edit })] : []);
  });
  res.json(items);
});

router.use((error: unknown, req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
  req.log.error({ err: error }, "Unable to serve Circle request");
  if (res.headersSent) return;
  res.status(500).json({ error: "Unable to load Circle" });
});

export default router;