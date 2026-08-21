import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { creatorMediaUploads, creatorWorkspaces, db } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";

import {
  createPrivateMediaUpload,
  deletePrivateMedia,
  getPrivateMediaDownloadURL,
} from "../lib/private-media-storage";

const router: IRouter = Router();
const imageContentType = /^image\/(heic|heif|jpeg|png|webp)$/;
const configuredOwnerId = process.env.FHEED_OWNER_ID ?? process.env.REPL_OWNER_ID;

async function workspace() {
  const [record] = await db.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, "fheed"));
  return record;
}

router.post("/storage/uploads/request-url", async (req, res) => {
  const record = await workspace();
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to upload media" });
    return;
  }
  if (!configuredOwnerId || req.user!.id !== configuredOwnerId || (record?.ownerUserId && record.ownerUserId !== configuredOwnerId)) {
    res.status(403).json({ error: "Only the creator can upload media" });
    return;
  }

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success || !imageContentType.test(parsed.data.contentType)) {
    res.status(400).json({ error: "Use a JPG, PNG, HEIC, HEIF, or WebP image up to 15 MB" });
    return;
  }

  try {
    const upload = await createPrivateMediaUpload();
    await db.insert(creatorMediaUploads).values({ objectPath: upload.objectPath, creatorId: "fheed", ownerUserId: configuredOwnerId, state: "pending" });
    res.json(
      RequestUploadUrlResponse.parse({
        ...upload,
        metadata: parsed.data,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to create media upload URL");
    res.status(500).json({ error: "Unable to prepare media upload" });
  }
});

router.post("/storage/uploads/cleanup", async (req, res) => {
  const record = await workspace();
  if (!req.isAuthenticated() || !configuredOwnerId || req.user!.id !== configuredOwnerId || (record?.ownerUserId && record.ownerUserId !== configuredOwnerId)) {
    res.status(403).json({ error: "Only the creator can clean up media" });
    return;
  }
  const paths = (req.body as { objectPaths?: unknown }).objectPaths;
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 3 || !paths.every((path): path is string => typeof path === "string" && /^\/objects\/uploads\/[0-9a-fA-F-]{36}$/.test(path))) {
    res.status(400).json({ error: "Invalid private media paths" });
    return;
  }
  const cleanupState = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(842611)`);
    const [current] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, "fheed"));
    const referencedPaths = new Set(
      ((current?.edits ?? []) as Array<Record<string, unknown>>)
        .flatMap((edit) => [edit.sourceImage, edit.image, edit.previewImage])
        .filter((path): path is string => typeof path === "string"),
    );
    if (paths.some((path) => referencedPaths.has(path))) return "referenced";
    const uploads = await tx.select().from(creatorMediaUploads).where(inArray(creatorMediaUploads.objectPath, paths));
    if (uploads.length !== paths.length || uploads.some((upload) => upload.ownerUserId !== configuredOwnerId || upload.state === "deleted")) return "unavailable";
    await tx.update(creatorMediaUploads).set({ state: "deleting", updatedAt: new Date() }).where(and(inArray(creatorMediaUploads.objectPath, paths), eq(creatorMediaUploads.ownerUserId, configuredOwnerId)));
    return "ready";
  });
  if (cleanupState === "referenced") {
    res.status(409).json({ error: "Saved media cannot be removed as a pending upload" });
    return;
  }
  if (cleanupState !== "ready") {
    res.status(409).json({ error: "Private media is no longer available for cleanup" });
    return;
  }
  const results = await Promise.allSettled(paths.map((path) => deletePrivateMedia(path)));
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length) {
    req.log.warn({ failed: failed.length }, "Unable to clean up one or more private media objects");
    res.status(500).json({ error: "Could not clean up all private media" });
    return;
  }
  await db.update(creatorMediaUploads).set({ state: "deleted", updatedAt: new Date() }).where(inArray(creatorMediaUploads.objectPath, paths));
  res.status(204).end();
});

router.get("/storage/objects/*path", async (req, res) => {
  const rawPath = req.params.path;
  const path = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;

  try {
    const record = await workspace();
    const objectPath = `/objects/${path}`;
    const edits = (record?.edits ?? []) as Array<Record<string, unknown>>;
    const edit = edits.find((item) => [item.image, item.sourceImage, item.previewImage].includes(objectPath));
    const isOwner = Boolean(configuredOwnerId && req.user?.id && req.user.id === configuredOwnerId && (!record?.ownerUserId || record.ownerUserId === configuredOwnerId));
    if (!edit || !isOwner) {
      res.status(404).json({ error: "Media object not found" });
      return;
    }
    const signedURL = await getPrivateMediaDownloadURL(`/objects/${path}`);
    res.redirect(302, signedURL);
  } catch (error) {
    req.log.warn({ err: error }, "Unable to serve private media object");
    res.status(404).json({ error: "Media object not found" });
  }
});

router.get("/public-media/:editId", async (req, res) => {
  try {
    const record = await workspace();
    const edit = ((record?.edits ?? []) as Array<Record<string, unknown>>).find((item) => item.id === req.params.editId && item.status === "published" && item.access === "public");
    if (!edit || typeof edit.image !== "string" || !edit.image.startsWith("/objects/")) {
      res.status(404).json({ error: "Media object not found" });
      return;
    }
    res.redirect(302, await getPrivateMediaDownloadURL(edit.image));
  } catch {
    res.status(404).json({ error: "Media object not found" });
  }
});

router.get("/public-media/:editId/preview", async (req, res) => {
  try {
    const record = await workspace();
    const edit = ((record?.edits ?? []) as Array<Record<string, unknown>>).find((item) => item.id === req.params.editId && item.status === "published" && item.access === "locked");
    if (!edit || typeof edit.previewImage !== "string" || !edit.previewImage.startsWith("/objects/")) {
      res.status(404).json({ error: "Media preview not found" });
      return;
    }
    res.redirect(302, await getPrivateMediaDownloadURL(edit.previewImage));
  } catch {
    res.status(404).json({ error: "Media preview not found" });
  }
});

export default router;