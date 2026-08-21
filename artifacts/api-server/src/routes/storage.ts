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
import { authorizeFheedCreator, claimFheedWorkspace } from "../lib/creator-authorization";

const router: IRouter = Router();
const imageContentType = /^image\/(heic|heif|jpeg|png|webp)$/;

async function workspace() {
  const [record] = await db.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, "fheed"));
  return record;
}

router.post("/storage/uploads/request-url", async (req, res) => {
  const authorization = await authorizeFheedCreator(req.user);
  const claim = authorization.ok ? await claimFheedWorkspace(req.user!.id) : null;
  const record = await workspace();
  if (!authorization.ok || !claim?.ok || (record?.ownerUserId && record.ownerUserId !== req.user!.id)) {
    res.status(authorization.ok ? 403 : authorization.status).json({ error: authorization.ok ? "This creator workspace belongs to another account" : authorization.error });
    return;
  }

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success || !imageContentType.test(parsed.data.contentType)) {
    res.status(400).json({ error: "Use a JPG, PNG, HEIC, HEIF, or WebP image up to 15 MB" });
    return;
  }

  try {
    const upload = await createPrivateMediaUpload();
    await db.insert(creatorMediaUploads).values({ objectPath: upload.objectPath, creatorId: "fheed", ownerUserId: req.user!.id, state: "pending" });
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
  const authorization = await authorizeFheedCreator(req.user);
  const claim = authorization.ok ? await claimFheedWorkspace(req.user!.id) : null;
  const record = await workspace();
  if (!authorization.ok || !claim?.ok || (record?.ownerUserId && record.ownerUserId !== req.user!.id)) {
    res.status(authorization.ok ? 403 : authorization.status).json({ error: authorization.ok ? "This creator workspace belongs to another account" : authorization.error });
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
    const profileAvatar = current?.profile && typeof current.profile === "object" && typeof (current.profile as { avatar?: unknown }).avatar === "string"
      ? (current.profile as { avatar: string }).avatar
      : undefined;
    if (profileAvatar) referencedPaths.add(profileAvatar);
    if (paths.some((path) => referencedPaths.has(path))) return "referenced";
    const uploads = await tx.select().from(creatorMediaUploads).where(inArray(creatorMediaUploads.objectPath, paths));
    if (uploads.length !== paths.length || uploads.some((upload) => upload.ownerUserId !== req.user!.id || upload.state === "deleted")) return "unavailable";
    await tx.update(creatorMediaUploads).set({ state: "deleting", updatedAt: new Date() }).where(and(inArray(creatorMediaUploads.objectPath, paths), eq(creatorMediaUploads.ownerUserId, req.user!.id)));
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
    const authorization = await authorizeFheedCreator(req.user);
    const claim = authorization.ok ? await claimFheedWorkspace(req.user!.id) : null;
    const record = await workspace();
    const objectPath = `/objects/${path}`;
    const edits = (record?.edits ?? []) as Array<Record<string, unknown>>;
    const profileAvatar = record?.profile && typeof record.profile === "object" && typeof (record.profile as { avatar?: unknown }).avatar === "string"
      ? (record.profile as { avatar: string }).avatar
      : undefined;
    const edit = edits.find((item) => [item.image, item.sourceImage, item.previewImage].includes(objectPath));
    const isOwner = Boolean(authorization.ok && claim?.ok && (!record?.ownerUserId || record.ownerUserId === req.user?.id));
    if ((!edit && profileAvatar !== objectPath) || !isOwner) {
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

router.get("/public-profile-media", async (_req, res) => {
  try {
    const record = await workspace();
    const avatar = record?.profile && typeof record.profile === "object" && typeof (record.profile as { avatar?: unknown }).avatar === "string"
      ? (record.profile as { avatar: string }).avatar
      : undefined;
    if (!avatar || !avatar.startsWith("/objects/")) {
      res.status(404).json({ error: "Profile photo not found" });
      return;
    }
    res.redirect(302, await getPrivateMediaDownloadURL(avatar));
  } catch {
    res.status(404).json({ error: "Profile photo not found" });
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