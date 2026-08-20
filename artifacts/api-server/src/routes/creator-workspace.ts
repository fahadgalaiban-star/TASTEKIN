import { db, creatorWorkspaces } from "@workspace/db";
import {
  GetCreatorWorkspaceResponse,
  SaveCreatorWorkspaceBody,
  SaveCreatorWorkspaceResponse,
} from "@workspace/api-zod";
import { eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";

import {
  FHEED_CREATOR_ID,
  fheedWorkspaceSeed,
} from "../lib/creator-workspace-seed";

const router: IRouter = Router();
const configuredOwnerId = process.env.FHEED_OWNER_ID ?? process.env.REPL_OWNER_ID;

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

function serializeWorkspace(workspace: Awaited<ReturnType<typeof getWorkspace>>) {
  return {
    creatorId: workspace.creatorId,
    edits: workspace.edits,
    collections: workspace.collections,
    revision: workspace.revision,
    updatedAt: workspace.updatedAt,
  };
}

router.get("/creator-workspace", async (req, res) => {
  try {
    const workspace = await getWorkspace();
    if (
      req.user?.id === configuredOwnerId &&
      (!workspace.ownerUserId || workspace.ownerUserId === configuredOwnerId)
    ) {
      res.json(GetCreatorWorkspaceResponse.parse(serializeWorkspace(workspace)));
      return;
    }
    const edits = (workspace.edits as Array<Record<string, unknown>>)
      .filter((edit) => edit.status === "published" && edit.access === "public")
      .map((edit) => typeof edit.image === "string" && edit.image.startsWith("/objects/") ? { ...edit, image: `/api/public-media/${edit.id}` } : edit);
    const publishedIds = new Set(edits.map((edit) => edit.id));
    const collections = (workspace.collections as Array<Record<string, unknown>>)
      .filter((collection) => collection.access === "public")
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
  if (!configuredOwnerId) {
    res.status(503).json({ error: "Fheed creator ownership is not configured" });
    return;
  }
  if (req.user!.id !== configuredOwnerId) {
    res.status(403).json({ error: "Only Fheed can update this creator workspace" });
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
    const current = await getWorkspace();
    if (current.ownerUserId && current.ownerUserId !== configuredOwnerId) {
      res.status(403).json({ error: "This creator workspace belongs to another account" });
      return;
    }
    if (!current.ownerUserId) {
      const [claimed] = await db.update(creatorWorkspaces).set({ ownerUserId: configuredOwnerId }).where(sql`${creatorWorkspaces.creatorId} = ${FHEED_CREATOR_ID} and ${creatorWorkspaces.ownerUserId} is null`).returning();
      if (!claimed) {
        res.status(409).json({ error: "Creator workspace ownership changed. Reload before saving." });
        return;
      }
      current.ownerUserId = claimed.ownerUserId;
    }
    if (parsed.data.expectedRevision !== current.revision) {
      res.status(409).json({
        error: "Creator workspace changed on another device. Reload before saving.",
      });
      return;
    }

    const [workspace] = await db
      .update(creatorWorkspaces)
      .set({ edits: parsed.data.edits, collections: parsed.data.collections, revision: sql`${creatorWorkspaces.revision} + 1`, updatedAt: new Date() })
      .where(sql`${creatorWorkspaces.creatorId} = ${FHEED_CREATOR_ID} and ${creatorWorkspaces.ownerUserId} = ${configuredOwnerId} and ${creatorWorkspaces.revision} = ${parsed.data.expectedRevision}`)
      .returning();
    if (!workspace) {
      res.status(409).json({ error: "Creator workspace changed on another device. Reload before saving." });
      return;
    }

    res.json(
      SaveCreatorWorkspaceResponse.parse(
        serializeWorkspace(workspace),
      ),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to save creator workspace");
    res.status(500).json({ error: "Unable to save creator workspace" });
  }
});

export default router;