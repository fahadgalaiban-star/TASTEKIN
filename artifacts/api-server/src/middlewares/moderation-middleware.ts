import { creatorWorkspaces, db, editComments, moderationContentStates, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { isAccountSuspended } from "../lib/active-account";
import { blockedReference, emptyVisibility, isConsumerContentPath, redactPublic } from "../lib/moderation-visibility";

/** Mounted after identity, before every API router. Database failures fail closed. */
export async function suspensionMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user && await isAccountSuspended(req.user.id)) {
      res.setHeader("Cache-Control", "no-store");
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
      const workspaces = await db.select().from(creatorWorkspaces);
      for (const workspace of workspaces) {
        const ownerSuspended = !!workspace.ownerUserId && v.userIds.has(workspace.ownerUserId);
        if (ownerSuspended) {
          v.creatorIds.add(workspace.creatorId); v.usernames.add(workspace.profile.username);
          for (const image of [workspace.profile.avatar, workspace.profile.coverImage]) if (image) v.media.add(image);
        }
        for (const raw of workspace.edits) {
          if (!raw || typeof raw !== "object") continue;
          const edit = raw as Record<string, unknown>;
          if (ownerSuspended && typeof edit.id === "string") v.editIds.add(edit.id);
          if (typeof edit.id === "string" && v.editIds.has(edit.id)) {
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
        const comments = await db.select({ id: editComments.id, userId: editComments.userId }).from(editComments);
        comments.filter((row) => v.userIds.has(row.userId)).forEach((row) => v.commentIds.add(row.id));
      }
    }
    return v;
}
export async function moderationVisibilityMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isConsumerContentPath(req.path)) { next(); return; }
  try {
    const v = await loadModerationVisibility();
    if (req.path.split("/").some((id) => v.editIds.has(id) || v.commentIds.has(id) || v.usernames.has(id))
        || redactPublic(req.body, v) === undefined && req.body !== undefined
        || (req.body && JSON.stringify(redactPublic(req.body, v)) !== JSON.stringify(req.body))) {
      res.status(404).json({ error: "Content unavailable." }); return;
    }
    const json = res.json.bind(res);
    res.setHeader("Cache-Control", "no-store");
    res.json = ((body: unknown) => {
      if (res.statusCode >= 400) return json(body);
      const projected = redactPublic(body, v);
      if (projected === undefined) return res.status(404).json({ error: "Content unavailable." });
      return json(projected);
    }) as Response["json"];
    next();
  } catch { res.status(503).json({ error: "Content visibility temporarily unavailable." }); }
}
/** Production serves packaged demo images here; hidden originals must not bypass API media checks. */
export async function staticModerationMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const v = await loadModerationVisibility();
    res.setHeader("Cache-Control", "no-store");
    if (blockedReference(`/tastekin-media${req.path}`, v)) { res.status(404).end(); return; }
    next();
  } catch { res.status(503).end(); }
}