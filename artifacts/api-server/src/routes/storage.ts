import { RequestUploadUrlBody, RequestUploadUrlResponse } from "@workspace/api-zod";
import { creatorMediaUploads, creatorWorkspaces, db } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";

import { creatorByUsername, creatorForUser, requireCreator } from "../lib/creator-account";
import { createPrivateMediaUpload, deletePrivateMedia, getPrivateMediaDownloadURL } from "../lib/private-media-storage";

const router: IRouter = Router();
const imageContentType = /^image\/(heic|heif|jpeg|png|webp)$/;
const privatePath = /^\/objects\/uploads\/[0-9a-fA-F-]{36}$/;

function referencedPaths(workspace: typeof creatorWorkspaces.$inferSelect) {
  const paths = new Set(
    [
      ...(workspace.edits as Array<Record<string, unknown>>)
        .flatMap((edit) => [edit.sourceImage, edit.image, edit.previewImage]),
      ...(workspace.collections as Array<Record<string, unknown>>)
        .flatMap((collection) => [collection.coverImage, ...(Array.isArray(collection.uploads) ? (collection.uploads as Array<{ image?: unknown }>).map((item) => item.image) : [])]),
    ].filter((path): path is string => typeof path === "string"),
  );
  if (workspace.profile?.avatar) paths.add(workspace.profile.avatar);
  return paths;
}

router.post("/storage/uploads/request-url", async (req, res) => {
  const authorization = await requireCreator(req.user);
  if (!authorization.ok) { res.status(authorization.status).json({ error: authorization.error }); return; }
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success || !imageContentType.test(parsed.data.contentType)) {
    res.status(400).json({ error: "Use a JPG, PNG, HEIC, HEIF, or WebP image up to 15 MB" });
    return;
  }
  try {
    const upload = await createPrivateMediaUpload();
    await db.insert(creatorMediaUploads).values({ objectPath: upload.objectPath, creatorId: authorization.workspace.creatorId, ownerUserId: authorization.userId, state: "pending" });
    res.json(RequestUploadUrlResponse.parse({ ...upload, metadata: parsed.data }));
  } catch (error) {
    req.log.error({ err: error }, "Unable to create media upload URL");
    res.status(500).json({ error: "Unable to prepare media upload" });
  }
});

router.post("/storage/uploads/cleanup", async (req, res) => {
  const authorization = await requireCreator(req.user);
  if (!authorization.ok) { res.status(authorization.status).json({ error: authorization.error }); return; }
  const paths = (req.body as { objectPaths?: unknown }).objectPaths;
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 3 || !paths.every((path): path is string => typeof path === "string" && privatePath.test(path))) {
    res.status(400).json({ error: "Invalid private media paths" }); return;
  }
  const cleanupState = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${authorization.workspace.creatorId}))`);
    const [current] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, authorization.workspace.creatorId));
    if (!current || paths.some((path) => referencedPaths(current).has(path))) return "referenced";
    const uploads = await tx.select().from(creatorMediaUploads).where(inArray(creatorMediaUploads.objectPath, paths));
    if (uploads.length !== paths.length || uploads.some((upload) => upload.creatorId !== current.creatorId || upload.ownerUserId !== authorization.userId || upload.state === "deleted")) return "unavailable";
    await tx.update(creatorMediaUploads).set({ state: "deleting", updatedAt: new Date() }).where(and(inArray(creatorMediaUploads.objectPath, paths), eq(creatorMediaUploads.ownerUserId, authorization.userId)));
    return "ready";
  });
  if (cleanupState === "referenced") { res.status(409).json({ error: "Saved media cannot be removed as a pending upload" }); return; }
  if (cleanupState !== "ready") { res.status(409).json({ error: "Private media is no longer available for cleanup" }); return; }
  const results = await Promise.allSettled(paths.map((path) => deletePrivateMedia(path)));
  if (results.some((result) => result.status === "rejected")) {
    await db.update(creatorMediaUploads).set({ state: "pending", updatedAt: new Date() }).where(inArray(creatorMediaUploads.objectPath, paths));
    res.status(500).json({ error: "Could not clean up all private media" }); return;
  }
  await db.update(creatorMediaUploads).set({ state: "deleted", updatedAt: new Date() }).where(inArray(creatorMediaUploads.objectPath, paths));
  res.status(204).end();
});

router.get("/storage/objects/*path", async (req, res) => {
  const rawPath = req.params.path;
  const path = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
  if (!req.user) { res.status(404).json({ error: "Media object not found" }); return; }
  try {
    const workspace = await creatorForUser(req.user.id);
    const objectPath = `/objects/${path}`;
    if (!workspace || !referencedPaths(workspace).has(objectPath)) { res.status(404).json({ error: "Media object not found" }); return; }
    res.redirect(302, await getPrivateMediaDownloadURL(objectPath));
  } catch (error) {
    req.log.warn({ err: error }, "Unable to serve private media object");
    res.status(404).json({ error: "Media object not found" });
  }
});

async function publicProfileMedia(username: string, res: import("express").Response) {
  const workspace = await creatorByUsername(username);
  const avatar = workspace?.profile.avatar;
  if (!avatar?.startsWith("/objects/")) { res.status(404).json({ error: "Profile photo not found" }); return; }
  res.redirect(302, await getPrivateMediaDownloadURL(avatar));
}

async function publicEditMedia(username: string, editId: string, preview: boolean, res: import("express").Response) {
  const workspace = await creatorByUsername(username);
  const edit = (workspace?.edits as Array<Record<string, unknown>> | undefined)?.find((item) => item.id === editId && item.status === "published" && item.access === (preview ? "locked" : "public"));
  const image = preview ? edit?.previewImage : edit?.image;
  if (typeof image !== "string" || !image.startsWith("/objects/")) { res.status(404).json({ error: preview ? "Media preview not found" : "Media object not found" }); return; }
  res.redirect(302, await getPrivateMediaDownloadURL(image));
}

router.get("/public-profile-media/:username", async (req, res) => {
  try { await publicProfileMedia(req.params.username, res); } catch { res.status(404).json({ error: "Profile photo not found" }); }
});
router.get("/public-profile-media", async (_req, res) => {
  try { await publicProfileMedia("fheed", res); } catch { res.status(404).json({ error: "Profile photo not found" }); }
});
router.get("/public-media/:username/:editId/preview", async (req, res) => {
  try { await publicEditMedia(req.params.username, req.params.editId, true, res); } catch { res.status(404).json({ error: "Media preview not found" }); }
});
router.get("/public-media/:editId/preview", async (req, res) => {
  try { await publicEditMedia("fheed", req.params.editId, true, res); } catch { res.status(404).json({ error: "Media preview not found" }); }
});
router.get("/public-media/:username/:editId", async (req, res) => {
  try { await publicEditMedia(req.params.username, req.params.editId, false, res); } catch { res.status(404).json({ error: "Media object not found" }); }
});
router.get("/public-media/:editId", async (req, res) => {
  try { await publicEditMedia("fheed", req.params.editId, false, res); } catch { res.status(404).json({ error: "Media object not found" }); }
});

export default router;
