import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { creatorWorkspaces, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";

import {
  createPrivateMediaUpload,
  getPrivateMediaDownloadURL,
} from "../lib/private-media-storage";

const router: IRouter = Router();
const imageContentType = /^image\/(avif|gif|jpeg|png|webp)$/;
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
  if (!configuredOwnerId || req.user!.id !== configuredOwnerId) {
    res.status(403).json({ error: "Only the creator can upload media" });
    return;
  }

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success || !imageContentType.test(parsed.data.contentType)) {
    res.status(400).json({ error: "Use an image up to 8 MB" });
    return;
  }

  try {
    const upload = await createPrivateMediaUpload();
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

router.get("/storage/objects/*path", async (req, res) => {
  const rawPath = req.params.path;
  const path = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;

  try {
    const record = await workspace();
    const objectPath = `/objects/${path}`;
    const edits = (record?.edits ?? []) as Array<Record<string, unknown>>;
    const edit = edits.find((item) => item.image === objectPath);
    const isOwner = Boolean(req.user?.id && req.user.id === configuredOwnerId);
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

export default router;