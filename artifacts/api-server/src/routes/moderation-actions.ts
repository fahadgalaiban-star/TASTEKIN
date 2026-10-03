import { db, moderationAuditLog } from "@workspace/db";
import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { Router } from "express";
import { isCurrentUserAdmin } from "../lib/creator-account";
import { applyModeration, ModerationError } from "../lib/moderation-policy";
import { moderationRepository, resolveModerationTarget } from "../lib/moderation-repository";
import { getPrivateMediaDownloadURL } from "../lib/private-media-storage";
import { streamPrivateImage } from "../lib/private-image-response";
import { clearPhotoOf } from "../lib/edit-access";
import { ApplyModerationActionBody } from "@workspace/api-zod";
import path from "node:path";
import { mediaRequestOriginAllowed, packagedMediaDirectory } from "../lib/packaged-media";
const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.use("/admin/reports/:id", async (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.vary("Origin");
  if (!mediaRequestOriginAllowed(req)) { res.status(403).json({ error: "Request origin unavailable." }); return; }
  if (!await isCurrentUserAdmin(req.user)) { res.status(403).json({ error: "Administrator access required." }); return; }
  if (!UUID.test(req.params.id)) { res.status(404).json({ error: "Report unavailable." }); return; }
  next();
});
router.get("/admin/reports/:id/inspection", async (req, res) => {
  const target = await resolveModerationTarget(db, req.params.id);
  if (!target) { res.status(404).json({ error: "Report target unavailable." }); return; }
  const history = await db.select().from(moderationAuditLog).where(or(
    eq(moderationAuditLog.reportId, req.params.id),
    and(isNotNull(moderationAuditLog.action), or(
      and(eq(moderationAuditLog.targetType, target.targetType), eq(moderationAuditLog.targetId, target.targetId)),
      and(eq(moderationAuditLog.targetType, "user"), eq(moderationAuditLog.targetId, target.ownerUserId)),
    )),
  )).orderBy(desc(moderationAuditLog.createdAt));
  const mediaUrl = target.targetType === "edit" && clearPhotoOf(target.data)
    ? `/api/admin/reports/${encodeURIComponent(req.params.id)}/inspection/media` : undefined;
  res.json({ target: { ...target, mediaUrl }, history });
});
router.get("/admin/reports/:id/inspection/media", async (req, res) => {
  const target = await resolveModerationTarget(db, req.params.id);
  const photo = target?.targetType === "edit" ? clearPhotoOf(target.data) : undefined;
  if (!photo) { res.status(404).json({ error: "Media unavailable." }); return; }
  // Only server-owned private objects or packaged demo images; never fetch an arbitrary user URL.
  if (photo.startsWith("/tastekin-media/") && !photo.includes("..") && /^\/tastekin-media\/[\w.-]+\.(webp|png|jpg|jpeg)$/i.test(photo)) {
    res.sendFile(path.join(packagedMediaDirectory, path.basename(photo)), {
      cacheControl: false, lastModified: false,
    }); return;
  }
  if (!/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(photo)) { res.status(404).json({ error: "Media unavailable." }); return; }
  try { await streamPrivateImage(res, await getPrivateMediaDownloadURL(photo)); }
  catch { if (!res.headersSent) res.status(502).json({ error: "Media unavailable." }); else res.destroy(); }
});
router.post("/admin/reports/:id/actions", async (req, res) => {
  const parsed = ApplyModerationActionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose an action, confirm it, and provide a reason." }); return; }
  try { res.json(await applyModeration(moderationRepository, req.user!.id, req.params.id, parsed.data)); }
  catch (error) {
    res.status(error instanceof ModerationError ? error.status : 500).json({
      error: error instanceof ModerationError ? error.message : "Moderation action failed.",
    });
  }
});
export default router;