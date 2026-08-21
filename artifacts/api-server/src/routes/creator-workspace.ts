import { creatorMediaUploads, db, creatorWorkspaces, type CreatorProfileRecord } from "@workspace/db";
import {
  GetCreatorProfileResponse,
  GetCreatorWorkspaceResponse,
  SaveCreatorProfileBody,
  SaveCreatorProfileResponse,
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
const privateObjectPath = /^\/objects\/uploads\/[0-9a-fA-F-]{36}$/;

function defaultProfile(): CreatorProfileRecord {
  return { ...fheedWorkspaceSeed.profile, interests: [...fheedWorkspaceSeed.profile.interests] };
}

function normalizeProfile(value: unknown): CreatorProfileRecord {
  const source = value && typeof value === "object" ? value as Partial<CreatorProfileRecord> : {};
  const fallback = defaultProfile();
  return {
    displayName: typeof source.displayName === "string" && source.displayName.trim() ? source.displayName : fallback.displayName,
    username: typeof source.username === "string" && source.username.trim() ? source.username : fallback.username,
    bio: typeof source.bio === "string" ? source.bio : fallback.bio,
    city: typeof source.city === "string" ? source.city : fallback.city,
    country: typeof source.country === "string" ? source.country : fallback.country,
    interests: Array.isArray(source.interests) ? source.interests.filter((interest): interest is string => typeof interest === "string").slice(0, 12) : fallback.interests,
    dateOfBirth: typeof source.dateOfBirth === "string" ? source.dateOfBirth : null,
    showAge: Boolean(source.showAge),
    avatar: typeof source.avatar === "string" && source.avatar ? source.avatar : fallback.avatar,
  };
}

function ageFor(dateOfBirth: string | null) {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  const now = new Date();
  const age = now.getUTCFullYear() - year - (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day) ? 1 : 0);
  return age >= 13 && age <= 120 ? age : null;
}

function serializeProfile(value: unknown, includePrivate: boolean, revision: number) {
  const profile = normalizeProfile(value);
  const avatarObjectPath = privateObjectPath.test(profile.avatar) ? profile.avatar : null;
  return {
    displayName: profile.displayName,
    username: profile.username,
    bio: profile.bio,
    city: profile.city,
    country: profile.country,
    interests: profile.interests,
    avatar: avatarObjectPath ? "/api/public-profile-media" : profile.avatar,
    avatarObjectPath: includePrivate ? avatarObjectPath : null,
    age: profile.showAge ? ageFor(profile.dateOfBirth) : null,
    dateOfBirth: includePrivate ? profile.dateOfBirth : null,
    showAge: profile.showAge,
    verified: true,
    revision,
  };
}

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
        profile: defaultProfile(),
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

router.get("/creator-profile", async (req, res): Promise<void> => {
  try {
    const workspace = await getWorkspace();
    const authorization = await authorizeFheedCreator(req.user);
    const claim = authorization.ok ? await claimFheedWorkspace(req.user!.id) : null;
    const privateView = Boolean(authorization.ok && claim?.ok && (!workspace.ownerUserId || workspace.ownerUserId === req.user?.id));
    res.json(GetCreatorProfileResponse.parse(serializeProfile(workspace.profile, privateView, workspace.revision)));
  } catch (error) {
    req.log.error({ err: error }, "Unable to load creator profile");
    res.status(500).json({ error: "Unable to load creator profile" });
  }
});

router.put("/creator-profile", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to update the creator profile" });
    return;
  }
  const authorization = await authorizeFheedCreator(req.user);
  if (!authorization.ok) {
    res.status(authorization.status).json({ error: authorization.error });
    return;
  }
  const parsed = SaveCreatorProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid creator profile" });
    return;
  }

  try {
    await getWorkspace();
    const claim = await claimFheedWorkspace(req.user!.id);
    if (!claim.ok) {
      res.status(409).json({ error: "Creator workspace ownership changed. Reload before saving." });
      return;
    }
    const profileInput = parsed.data;
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(842611)`);
      const [current] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, FHEED_CREATOR_ID));
      if (!current || (current.ownerUserId && current.ownerUserId !== req.user!.id)) return { kind: "owner" as const };
      const previous = normalizeProfile(current.profile);
      const avatar = profileInput.avatarObjectPath ?? previous.avatar;
      if (privateObjectPath.test(avatar)) {
        const [upload] = await tx.select().from(creatorMediaUploads).where(eq(creatorMediaUploads.objectPath, avatar));
        if (!upload || upload.ownerUserId !== req.user!.id || (upload.state !== "pending" && upload.state !== "committed")) return { kind: "media" as const };
        await tx.update(creatorMediaUploads).set({ state: "committed", updatedAt: new Date() }).where(eq(creatorMediaUploads.objectPath, avatar));
      }
      const profile: CreatorProfileRecord = {
        displayName: profileInput.displayName.trim(),
        username: profileInput.username.trim().toLowerCase(),
        bio: profileInput.bio.trim(),
        city: profileInput.city.trim(),
        country: profileInput.country.trim(),
        interests: Array.from(new Set(profileInput.interests.map((interest) => interest.trim()).filter(Boolean))),
        dateOfBirth: profileInput.dateOfBirth,
        showAge: profileInput.showAge,
        avatar,
      };
      const [workspace] = await tx.update(creatorWorkspaces)
        .set({ profile, revision: sql`${creatorWorkspaces.revision} + 1`, updatedAt: new Date() })
        .where(eq(creatorWorkspaces.creatorId, FHEED_CREATOR_ID))
        .returning();
      return workspace ? { kind: "saved" as const, workspace } : { kind: "missing" as const };
    });
    if (result.kind === "owner") {
      res.status(403).json({ error: "This creator workspace belongs to another account" });
      return;
    }
    if (result.kind === "media") {
      res.status(409).json({ error: "The new profile photo is no longer available. Choose it again and retry." });
      return;
    }
    if (result.kind !== "saved") {
      res.status(404).json({ error: "Creator profile not found" });
      return;
    }
    res.json(SaveCreatorProfileResponse.parse(serializeProfile(result.workspace.profile, true, result.workspace.revision)));
  } catch (error) {
    req.log.error({ err: error }, "Unable to save creator profile");
    res.status(500).json({ error: "Unable to save creator profile" });
  }
});

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
    const claim = authorization.ok ? await claimFheedWorkspace(req.user!.id) : null;
    if (authorization.ok && claim?.ok) {
      if (claim.transferred) req.log.info("Transferred Fheed workspace ownership to configured founder");
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
    const claim = await claimFheedWorkspace(req.user!.id);
    if (!claim.ok) {
      res.status(409).json({ error: "Creator workspace ownership changed. Reload before saving." });
      return;
    }
    if (claim.transferred) req.log.info("Transferred Fheed workspace ownership to configured founder");
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