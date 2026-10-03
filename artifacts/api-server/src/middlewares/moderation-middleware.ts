import { creatorWorkspaces, db, editComments, moderationContentStates, usersTable } from "@workspace/db";
import { eq, inArray, or } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { isAccountSuspended } from "../lib/active-account";
import { blockedReference, blockedConsumerRequest, emptyVisibility, isConsumerContentPath, projectConsumerResponse } from "../lib/moderation-visibility";
import { suspendedAccountAccess } from "../lib/suspended-account-access";

/** Mounted after identity, before every API router. Database failures fail closed. */
export async function suspensionMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const suspended = req.user && await isAccountSuspended(req.user.id);
    if (req.suspendedAccountOnly && (!suspended || !suspendedAccountAccess(req.method, req.path))) {
      res.status(403).json({ error: "Account unavailable." }); return;
    }
    if (suspended && req.user) {
      res.setHeader("Cache-Control", "no-store");
      if (suspendedAccountAccess(req.method, req.path)) {
        if (req.method === "GET" && ["/me", "/auth/user"].includes(req.path)) {
          res.json({ user: { id: req.user.id, email: req.user.email ?? null }, accountSuspended: true, role: "consumer",
            creator: null, isAdmin: false, featureFlags: {}, needsOnboarding: false, onboardingStep: "done",
            nativeAuth: req.nativeAuth ?? null, supportEmail: process.env.SUPPORT_EMAIL?.trim() || null }); return;
        }
        next(); return;
      }
      res.status(403).json({ error: "Account unavailable." }); return;
    }
    next();
  } catch { res.status(503).json({ error: "Account status temporarily unavailable." }); }
}
export async function loadModerationVisibility() {
    const v = emptyVisibility();
    const [states, suspended] = await Promise.all([
      db.select().from(moderationContentStates).where(eq(moderationContentStates.isHidden, true)),
      db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.isSuspended, true)),
    ]);
    for (const state of states) (state.targetType === "edit" ? v.editIds : v.commentIds).add(state.targetId);
    suspended.forEach((user) => v.userIds.add(user.id));
    if (states.length || suspended.length) {
       const creatorIds = [...new Set(states.map((state) => state.creatorId))];
       const userIds = [...v.userIds];
       const workspaces = await db.select().from(creatorWorkspaces).where(or(
         creatorIds.length ? inArray(creatorWorkspaces.creatorId, creatorIds) : undefined,
         userIds.length ? inArray(creatorWorkspaces.ownerUserId, userIds) : undefined,
       ));
       for (const state of states.filter((s) => s.targetType === "edit")) {
         const targets = v.editTargets.get(state.creatorId) ?? new Set<string>();
         targets.add(state.targetId); v.editTargets.set(state.creatorId, targets);
       }
      for (const workspace of workspaces) {
         v.creatorByUsername.set(workspace.profile.username, workspace.creatorId);
        const ownerSuspended = !!workspace.ownerUserId && v.userIds.has(workspace.ownerUserId);
        if (ownerSuspended) {
          v.creatorIds.add(workspace.creatorId); v.usernames.add(workspace.profile.username);
          for (const image of [workspace.profile.avatar, workspace.profile.coverImage]) if (image) v.media.add(image);
        }
        for (const raw of workspace.edits) {
          if (!raw || typeof raw !== "object") continue;
          const edit = raw as Record<string, unknown>;
          if (ownerSuspended && typeof edit.id === "string") v.editIds.add(edit.id);
          if (ownerSuspended || typeof edit.id === "string" && v.editTargets.get(workspace.creatorId)?.has(edit.id)) {
            const media = (value: unknown): void => {
              if (typeof value === "string" && /^(https?:\/\/|\/objects\/|\/tastekin-media\/)/.test(value)) v.media.add(value);
              else if (value && typeof value === "object") Object.values(value).forEach(media);
            };
            for (const key of ["image", "sourceImage", "previewImage", "videoUrl", "embedUrl", "posterUrl", "video"]) {
              media(edit[key]);
            }
          }
        }
      }
      if (suspended.length) {
         const comments = await db.select({ id: editComments.id }).from(editComments).where(inArray(editComments.userId, [...v.userIds]));
         comments.forEach((row) => v.commentIds.add(row.id));
      }
    }
    return v;
}
export async function moderationVisibilityMiddleware(req: Request, res: Response, next: NextFunction) {
  // These legacy routes have a public default for guests and private originals
  // for authenticated owners. Only the guest response is projected.
  if (!isConsumerContentPath(req.path)) { next(); return; }
  try {
    if (req.user && ["/creator-workspace", "/creator-profile", "/creator-featured-collections"].includes(req.path)) {
      const [owned] = await db.select({ id: creatorWorkspaces.creatorId }).from(creatorWorkspaces)
        .where(eq(creatorWorkspaces.ownerUserId, req.user.id)).limit(1);
      if (owned) { next(); return; }
    }
    const v = await loadModerationVisibility();
    v.trustedOrigins.add(`${req.protocol}://${req.get("host")}`);
    if (blockedConsumerRequest(req.path, req.body, v)) {
      res.status(404).json({ error: "Content unavailable." }); return;
    }
    const json = res.json.bind(res);
    res.setHeader("Cache-Control", "no-store");
    res.json = ((body: unknown) => {
      if (res.statusCode >= 400) return json(body);
       const projected = projectConsumerResponse(req.path, body, v);
      if (projected === undefined) return res.status(404).json({ error: "Content unavailable." });
      return json(projected);
    }) as Response["json"];
    next();
  } catch { res.status(503).json({ error: "Content visibility temporarily unavailable." }); }
}
/** Single-process Express fallback only; the platform static handler bypasses this guard. */
export async function staticModerationMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const v = await loadModerationVisibility();
    res.setHeader("Cache-Control", "no-store");
    if (blockedReference(`/tastekin-media${req.path}`, v)) { res.status(404).end(); return; }
    next();
  } catch { res.status(503).end(); }
}