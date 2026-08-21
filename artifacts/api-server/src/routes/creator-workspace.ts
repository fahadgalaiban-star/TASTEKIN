import { creatorMediaUploads, db, creatorWorkspaces } from "@workspace/db";
import {
  GetCreatorWorkspaceResponse,
  SaveCreatorWorkspaceBody,
  SaveCreatorWorkspaceResponse,
} from "@workspace/api-zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";

import {
  FHEED_CREATOR_ID,
  fheedWorkspaceSeed,
} from "../lib/creator-workspace-seed";
import { authorizeFheedCreator, claimFheedWorkspace } from "../lib/creator-authorization";

const router: IRouter = Router();
const legacyLockedPreviews: Record<string, string> = {
  "private-hotel": "/tastekin-media/private-hotel-preview.webp",
  "training-week": "/tastekin-media/training-week-preview.webp",
};

async function getWorkspace() {
  let [workspace] = await db
    .select()
    .from(creatorWorkspaces)
    .where(eq(creatorWorkspaces.creatorId, FHEED_CREATOR_ID));

  if (!workspace) {
    await db
      .insert(creatorWorkspaces)
      .values({
        creatorId: FHEED_CREATOR_ID,
        edits: Array.from(fheedWorkspaceSeed.edits) as unknown[],
        collections: Array.from(fheedWorkspaceSeed.collections) as unknown[],
      })
      .onConflictDoNothing();
    [workspace] = await db
      .select()
      .from(creatorWorkspaces)
      .where(eq(creatorWorkspaces.creatorId, FHEED_CREATOR_ID));
  }

  if (!workspace) {
    throw new Error("Creator workspace could not be initialized");
  }

  return workspace;
}

function normalizeLegacyLockedEdit(edit: Record<string, unknown>) {
  const preview = typeof edit.id === "string" ? legacyLockedPreviews[edit.id] : undefined;
  if (edit.access === "locked" && preview && edit.image === "/tastekin-media/private-hotel-source.webp") {
    return { ...edit, image: preview, sourceImage: undefined, previewImage: preview };
  }
  return edit;
}

function serializeWorkspace(workspace: Awaited<ReturnType<typeof getWorkspace>>) {
  return {
    creatorId: workspace.creatorId,
    edits: (workspace.edits as Array<Record<string, unknown>>).map(normalizeLegacyLockedEdit),
    collections: workspace.collections,
    revision: workspace.revision,
    updatedAt: workspace.updatedAt,
  };
}

router.get("/creator-workspace", async (req, res) => {
  try {
    const workspace = await getWorkspace();
    const authorization = await authorizeFheedCreator(req.user);
    if (authorization.ok && (!workspace.ownerUserId || workspace.ownerUserId === req.user!.id) && await claimFheedWorkspace(req.user!.id)) {
      res.json(GetCreatorWorkspaceResponse.parse(serializeWorkspace(workspace)));
      return;
    }
    const edits = (workspace.edits as Array<Record<string, unknown>>)
      .map(normalizeLegacyLockedEdit)
      .filter((edit) => edit.status === "published" && (edit.access === "public" || (edit.access === "locked" && (typeof edit.previewImage === "string" || typeof edit.id === "string" && Boolean(legacyLockedPreviews[edit.id])))))
      .map((edit): Record<string, unknown> => {
        if (edit.access === "locked") {
          const previewImage = typeof edit.previewImage === "string" && edit.previewImage.startsWith("/objects/") ? `/api/public-media/${edit.id}/preview` : typeof edit.id === "string" ? legacyLockedPreviews[edit.id] : undefined;
          return { ...edit, image: previewImage, sourceImage: undefined, previewImage };
        }
        const publicEdit = { ...edit, sourceImage: undefined, previewImage: undefined };
        return typeof edit.image === "string" && edit.image.startsWith("/objects/") ? { ...publicEdit, image: `/api/public-media/${edit.id}` } : publicEdit;
      });
    const publishedIds = new Set(edits.map((edit) => edit.id));
    const collections = (workspace.collections as Array<Record<string, unknown>>)
      .filter((collection) => collection.access === "public" && (typeof collection.coverEditId !== "string" || publishedIds.has(collection.coverEditId)))
      .map((collection) => ({ ...collection, editIds: Array.isArray(collection.editIds) ? collection.editIds.filter((id) => publishedIds.has(id)) : [] }));
    res.json(GetCreatorWorkspaceResponse.parse({ ...serializeWorkspace(workspace), edits, collections }));
  } catch (error) {
    req.log.error({ err: error }, "Unable to load creator workspace");
    res.status(500).json({ error: "Unable to load creator workspace" });
  }
});

router.put("/creator-workspace", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to update the creator workspace" });
    return;
  }
  const authorization = await authorizeFheedCreator(req.user);
  if (!authorization.ok) {
    res.status(authorization.status).json({ error: authorization.error });
    return;
  }
  const parsed = SaveCreatorWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid creator workspace" });
    return;
  }
  if (parsed.data.expectedRevision === undefined) {
    res.status(400).json({ error: "Workspace revision is required" });
    return;
  }

  try {
    await getWorkspace();
    const ownerId = req.user!.id;
    const privatePaths = Array.from(new Set(
      (parsed.data.edits as Array<Record<string, unknown>>)
        .flatMap((edit) => [edit.sourceImage, edit.image, edit.previewImage])
        .filter((path): path is string => typeof path === "string" && /^\/objects\/uploads\/[0-9a-fA-F-]{36}$/.test(path)),
    ));
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(842611)`);
      const [current] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, FHEED_CREATOR_ID));
      if (!current || (current.ownerUserId && current.ownerUserId !== ownerId)) return { kind: "owner" as const };
      if (!current.ownerUserId) {
        const [claimed] = await tx.update(creatorWorkspaces).set({ ownerUserId: ownerId }).where(sql`${creatorWorkspaces.creatorId} = ${FHEED_CREATOR_ID} and ${creatorWorkspaces.ownerUserId} is null`).returning();
        if (!claimed) return { kind: "conflict" as const };
      }
      if (parsed.data.expectedRevision !== current.revision) return { kind: "conflict" as const };
      const existingPrivatePaths = Array.from(new Set(
        (current.edits as Array<Record<string, unknown>>)
          .flatMap((edit) => [edit.sourceImage, edit.image, edit.previewImage])
          .filter((path): path is string => typeof path === "string" && /^\/objects\/uploads\/[0-9a-fA-F-]{36}$/.test(path)),
      ));
      if (existingPrivatePaths.length) {
        await tx.insert(creatorMediaUploads)
          .values(existingPrivatePaths.map((objectPath) => ({ objectPath, creatorId: FHEED_CREATOR_ID, ownerUserId: ownerId, state: "committed" })))
          .onConflictDoNothing();
      }
      if (privatePaths.length) {
        const uploads = await tx.select().from(creatorMediaUploads).where(inArray(creatorMediaUploads.objectPath, privatePaths));
        if (uploads.length !== privatePaths.length || uploads.some((upload) => upload.ownerUserId !== ownerId || (upload.state !== "pending" && upload.state !== "committed"))) return { kind: "media" as const };
        await tx.update(creatorMediaUploads).set({ state: "committed", updatedAt: new Date() }).where(and(inArray(creatorMediaUploads.objectPath, privatePaths), eq(creatorMediaUploads.ownerUserId, ownerId)));
      }
      const [workspace] = await tx.update(creatorWorkspaces)
        .set({ edits: parsed.data.edits, collections: parsed.data.collections, revision: sql`${creatorWorkspaces.revision} + 1`, updatedAt: new Date() })
        .where(sql`${creatorWorkspaces.creatorId} = ${FHEED_CREATOR_ID} and ${creatorWorkspaces.ownerUserId} = ${ownerId} and ${creatorWorkspaces.revision} = ${parsed.data.expectedRevision}`)
        .returning();
      return workspace ? { kind: "saved" as const, workspace } : { kind: "conflict" as const };
    });
    if (result.kind === "owner") {
      res.status(403).json({ error: "This creator workspace belongs to another account" });
      return;
    }
    if (result.kind === "media") {
      res.status(409).json({ error: "One or more private uploads were removed before this Edit could be saved. Choose the image again and retry." });
      return;
    }
    if (result.kind === "conflict") {
      res.status(409).json({ error: "Creator workspace changed on another device. Reload before saving." });
      return;
    }

    res.json(
      SaveCreatorWorkspaceResponse.parse(
        serializeWorkspace(result.workspace),
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to save creator workspace");
    res.status(500).json({ error: "Unable to save creator workspace" });
  }
});

export default router;