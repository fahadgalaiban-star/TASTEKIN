import { creatorFeaturedCollections, creatorFollows, creatorMediaUploads, db, creatorWorkspaces, usersTable, type CreatorProfileRecord } from "@workspace/db";
import {
  GetCreatorProfileResponse,
  GetCreatorWorkspaceResponse,
  SaveCreatorProfileBody,
  SaveCreatorProfileResponse,
  SaveCreatorWorkspaceBody,
  SaveCreatorWorkspaceResponse,
} from "@workspace/api-zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";

import {
  FHEED_CREATOR_ID,
  fheedWorkspaceSeed,
} from "../lib/creator-workspace-seed";
import { creatorByUsername, ensureCreatorAccount } from "../lib/creator-account";

const router: IRouter = Router();
function noStoreAccountResponse(res: import("express").Response) {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.vary("Cookie");
}
const legacyLockedPreviews: Record<string, string> = {
  "private-hotel": "/tastekin-media/private-hotel-preview.webp",
  "training-week": "/tastekin-media/training-week-preview.webp",
};
const privateObjectPath = /^\/objects\/uploads\/[0-9a-fA-F-]{36}$/;

/** Categories that accept place detail fields (placeName, locationLabel, mapsUrl, tasteRating, creatorReview) */
const PLACE_CATEGORIES = new Set(["Restaurants", "Places", "Travel"]);

/** Valid HTTPS Google Maps or Apple Maps URL */
const MAPS_URL_PATTERN = /^https:\/\/(www\.)?(google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl|apple\.com\/maps|maps\.apple\.com)\//;

type EditRecord = Record<string, unknown>;

function validatePlaceFields(edit: EditRecord): string | null {
  const category = typeof edit.category === "string" ? edit.category : "";
  const hasImage = typeof edit.image === "string" && edit.image.length > 0;
  const isPublished = edit.status === "published";

  // Place fields are only accepted for place-like categories
  const hasPlaceFields =
    (edit.placeName != null && edit.placeName !== "") ||
    (edit.locationLabel != null && edit.locationLabel !== "") ||
    edit.mapsUrl != null ||
    edit.tasteRating != null ||
    (edit.creatorReview != null && edit.creatorReview !== "");

  if (hasPlaceFields && !PLACE_CATEGORIES.has(category)) {
    return `Place details (placeName, locationLabel, mapsUrl, tasteRating, creatorReview) are only accepted for Restaurants, Places, or Travel edits`;
  }

  // Validate mapsUrl when supplied
  if (edit.mapsUrl != null) {
    if (typeof edit.mapsUrl !== "string" || !MAPS_URL_PATTERN.test(edit.mapsUrl)) {
      return "mapsUrl must be a valid HTTPS Google Maps or Apple Maps URL";
    }
  }

  // Validate tasteRating is integer 1–5 when supplied
  if (edit.tasteRating != null) {
    const rating = edit.tasteRating;
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return "tasteRating must be an integer between 1 and 5";
    }
  }

  // No-photo rules
  if (!hasImage) {
    // Published no-photo edits are only allowed for place categories
    if (isPublished && !PLACE_CATEGORIES.has(category)) {
      return "A photo is required to publish this edit";
    }
    if (isPublished && edit.access === "locked") {
      return "Photo-free place edits must be public because subscriber-only edits require protected preview media";
    }
    // Published no-photo place edits require placeName, locationLabel, and at least rating or review
    if (isPublished && PLACE_CATEGORIES.has(category)) {
      const placeName = typeof edit.placeName === "string" ? edit.placeName.trim() : "";
      const locationLabel = typeof edit.locationLabel === "string" ? edit.locationLabel.trim() : "";
      if (!placeName) {
        return "A place name is required to publish a photo-free place edit";
      }
      if (!locationLabel) {
        return "A location label is required to publish a photo-free place edit";
      }
      const hasRating = typeof edit.tasteRating === "number" && Number.isInteger(edit.tasteRating);
      const hasReview = typeof edit.creatorReview === "string" && edit.creatorReview.trim().length > 0;
      if (!hasRating && !hasReview) {
        return "A rating or review is required to publish a photo-free place edit";
      }
    }
  }

  return null;
}

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
    avatar: typeof source.avatar === "string" ? source.avatar : fallback.avatar,
  };
}

function ageFor(dateOfBirth: string | null) {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  const now = new Date();
  const age = now.getUTCFullYear() - year - (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day) ? 1 : 0);
  return age >= 13 && age <= 120 ? age : null;
}

function serializeProfile(value: unknown, includePrivate: boolean, revision: number, verified = false) {
  const profile = normalizeProfile(value);
  const avatarObjectPath = privateObjectPath.test(profile.avatar) ? profile.avatar : null;
  return {
    displayName: profile.displayName,
    username: profile.username,
    bio: profile.bio,
    city: profile.city,
    country: profile.country,
    interests: profile.interests,
    avatar: avatarObjectPath ? `/api/public-profile-media/${encodeURIComponent(profile.username)}` : profile.avatar,
    avatarObjectPath: includePrivate ? avatarObjectPath : null,
    age: profile.showAge ? ageFor(profile.dateOfBirth) : null,
    dateOfBirth: includePrivate ? profile.dateOfBirth : null,
    showAge: profile.showAge,
    verified,
    revision,
  };
}

async function getWorkspace(creatorId = FHEED_CREATOR_ID) {
  let [workspace] = await db
    .select()
    .from(creatorWorkspaces)
    .where(eq(creatorWorkspaces.creatorId, creatorId));

  if (!workspace && creatorId === FHEED_CREATOR_ID) {
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
      .where(eq(creatorWorkspaces.creatorId, creatorId));
  }

  if (!workspace) {
    throw new Error("Creator workspace could not be initialized");
  }

  return workspace;
}

async function verifiedForWorkspace(workspace: Awaited<ReturnType<typeof getWorkspace>>) {
  if (!workspace.ownerUserId) return false;
  const [owner] = await db.select({ isVerified: usersTable.isVerified }).from(usersTable).where(eq(usersTable.id, workspace.ownerUserId)).limit(1);
  return Boolean(owner?.isVerified);
}

router.get("/creator-profile", async (req, res): Promise<void> => {
  noStoreAccountResponse(res);
  try {
    const authorization = req.user ? await ensureCreatorAccount(req.user) : null;
    const workspace = authorization?.ok ? authorization.workspace : await getWorkspace();
    const privateView = Boolean(req.user && workspace.ownerUserId === req.user.id);
    res.json(GetCreatorProfileResponse.parse(serializeProfile(workspace.profile, privateView, workspace.revision, authorization?.ok ? authorization.verified : await verifiedForWorkspace(workspace))));
  } catch (error) {
    req.log.error({ err: error }, "Unable to load creator profile");
    res.status(500).json({ error: "Unable to load creator profile" });
  }
});

router.get("/creators/:username/profile", async (req, res): Promise<void> => {
  noStoreAccountResponse(res);
  try {
    const workspace = await creatorByUsername(req.params.username);
    if (!workspace) { res.status(404).json({ error: "Creator not found" }); return; }
    const privateView = Boolean(req.user && workspace.ownerUserId === req.user.id);
    res.json(GetCreatorProfileResponse.parse(serializeProfile(workspace.profile, privateView, workspace.revision, await verifiedForWorkspace(workspace))));
  } catch (error) {
    req.log.error({ err: error }, "Unable to load public creator profile");
    res.status(500).json({ error: "Unable to load creator profile" });
  }
});

router.put("/creator-profile", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to update the creator profile" });
    return;
  }
  const authorization = await ensureCreatorAccount(req.user!);
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
    const workspaceId = authorization.workspace.creatorId;
    const profileInput = parsed.data;
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`);
      const [current] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, workspaceId));
      if (!current || (current.ownerUserId && current.ownerUserId !== req.user!.id)) return { kind: "owner" as const };
      const previous = normalizeProfile(current.profile);
      const avatar = profileInput.avatarObjectPath ?? previous.avatar;
      if (privateObjectPath.test(avatar)) {
        const [upload] = await tx.select().from(creatorMediaUploads).where(eq(creatorMediaUploads.objectPath, avatar));
        if (!upload || upload.creatorId !== workspaceId || upload.ownerUserId !== req.user!.id || (upload.state !== "pending" && upload.state !== "committed")) return { kind: "media" as const };
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
      const [usernameOwner] = await tx.select({ creatorId: creatorWorkspaces.creatorId }).from(creatorWorkspaces)
        .where(sql`lower(${creatorWorkspaces.profile}->>'username') = ${profile.username}`).limit(1);
      if (usernameOwner && usernameOwner.creatorId !== workspaceId) return { kind: "username" as const };
      const [workspace] = await tx.update(creatorWorkspaces)
        .set({ profile, revision: sql`${creatorWorkspaces.revision} + 1`, updatedAt: new Date() })
        .where(and(eq(creatorWorkspaces.creatorId, workspaceId), eq(creatorWorkspaces.ownerUserId, req.user!.id)))
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
    if (result.kind === "username") {
      res.status(409).json({ error: "That username is already in use" });
      return;
    }
    if (result.kind !== "saved") {
      res.status(404).json({ error: "Creator profile not found" });
      return;
    }
    res.json(SaveCreatorProfileResponse.parse(serializeProfile(result.workspace.profile, true, result.workspace.revision, authorization.verified)));
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

/**
 * Uploaded-photo collection items have no backing Edit, so they are never
 * gated by publishedIds — they're only ever visible when the collection
 * itself is visible to the viewer.
 */
function publicCollection(collection: Record<string, unknown>, publishedIds: Set<unknown>) {
  const uploads = Array.isArray(collection.uploads) ? collection.uploads : [];
  const uploadIds = new Set((uploads as Array<{ id?: unknown }>).map((item) => item.id).filter((id) => typeof id === "string"));
  const editIds = Array.isArray(collection.editIds) ? collection.editIds.filter((id) => publishedIds.has(id)) : [];
  const itemOrder = Array.isArray(collection.itemOrder)
    ? collection.itemOrder.filter((id) => publishedIds.has(id) || uploadIds.has(id))
    : [...editIds, ...uploadIds];
  return { ...collection, editIds, uploads, itemOrder };
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
  noStoreAccountResponse(res);
  try {
    const authorization = req.user ? await ensureCreatorAccount(req.user) : null;
    const workspace = authorization?.ok ? authorization.workspace : await getWorkspace();
    if (authorization?.ok && workspace.ownerUserId === req.user?.id) {
      res.json(GetCreatorWorkspaceResponse.parse(serializeWorkspace(workspace)));
      return;
    }
    const edits = (workspace.edits as Array<Record<string, unknown>>)
      .map(normalizeLegacyLockedEdit)
      .filter((edit) => {
        if (edit.status !== "published") return false;
        if (edit.access === "public") return true;
        if (edit.access === "locked") {
          return typeof edit.previewImage === "string" || (typeof edit.id === "string" && Boolean(legacyLockedPreviews[edit.id]));
        }
        return false;
      })
      .map((edit): Record<string, unknown> => {
        if (edit.access === "locked") {
          const username = normalizeProfile(workspace.profile).username;
          const previewImage = typeof edit.previewImage === "string" && edit.previewImage.startsWith("/objects/") ? `/api/public-media/${encodeURIComponent(username)}/${edit.id}/preview` : typeof edit.id === "string" ? legacyLockedPreviews[edit.id] : undefined;
          return { ...edit, image: previewImage, sourceImage: undefined, previewImage };
        }
        // Public edit: strip private fields, rewrite object URLs
        const publicEdit: Record<string, unknown> = {
          ...edit,
          sourceImage: undefined,
          previewImage: undefined,
        };
        if (typeof edit.image === "string" && edit.image.startsWith("/objects/")) {
          publicEdit.image = `/api/public-media/${encodeURIComponent(normalizeProfile(workspace.profile).username)}/${edit.id}`;
        }
        return publicEdit;
      });
    const publishedIds = new Set(edits.map((edit) => edit.id));
    const collections = (workspace.collections as Array<Record<string, unknown>>)
      .filter((collection) => collection.access === "public" && (typeof collection.coverEditId !== "string" || !collection.coverEditId || publishedIds.has(collection.coverEditId)))
      .map((collection) => publicCollection(collection, publishedIds));
    res.json(GetCreatorWorkspaceResponse.parse({ ...serializeWorkspace(workspace), edits, collections }));
  } catch (error) {
    req.log.error({ err: error }, "Unable to load creator workspace");
    res.status(500).json({ error: "Unable to load creator workspace" });
  }
});

router.get("/creators/:username/workspace", async (req, res) => {
  noStoreAccountResponse(res);
  try {
    const workspace = await creatorByUsername(req.params.username);
    if (!workspace) { res.status(404).json({ error: "Creator not found" }); return; }
    const owner = Boolean(req.user && workspace.ownerUserId === req.user.id);
    if (owner) { res.json(GetCreatorWorkspaceResponse.parse(serializeWorkspace(workspace))); return; }
    const username = normalizeProfile(workspace.profile).username;
    const edits: Array<Record<string, unknown>> = (workspace.edits as Array<Record<string, unknown>>).map(normalizeLegacyLockedEdit)
      .filter((edit) => edit.status === "published" && (edit.access === "public" || (edit.access === "locked" && typeof edit.previewImage === "string")))
      .map((edit) => edit.access === "locked"
        ? { ...edit, image: typeof edit.previewImage === "string" && edit.previewImage.startsWith("/objects/") ? `/api/public-media/${encodeURIComponent(username)}/${edit.id}/preview` : edit.previewImage, sourceImage: undefined, previewImage: undefined }
        : { ...edit, image: typeof edit.image === "string" && edit.image.startsWith("/objects/") ? `/api/public-media/${encodeURIComponent(username)}/${edit.id}` : edit.image, sourceImage: undefined, previewImage: undefined });
    const publishedIds = new Set(edits.map((edit) => edit.id));
    const collections = (workspace.collections as Array<Record<string, unknown>>)
      .filter((collection) => collection.access === "public")
      .map((collection) => publicCollection(collection, publishedIds));
    res.json(GetCreatorWorkspaceResponse.parse({ ...serializeWorkspace(workspace), edits, collections }));
  } catch (error) {
    req.log.error({ err: error }, "Unable to load public creator workspace");
    res.status(500).json({ error: "Unable to load creator workspace" });
  }
});

router.get("/public-feed", async (req, res) => {
  try {
    const [rows, followed] = await Promise.all([
      db.select({ workspace: creatorWorkspaces, verified: usersTable.isVerified })
        .from(creatorWorkspaces)
        .leftJoin(usersTable, eq(creatorWorkspaces.ownerUserId, usersTable.id)),
      req.user
        ? db.select({ creatorId: creatorFollows.creatorId }).from(creatorFollows).where(eq(creatorFollows.followerUserId, req.user.id))
        : Promise.resolve([]),
    ]);
    const followedIds = new Set(followed.map((item) => item.creatorId));
    const items = rows.flatMap(({ workspace, verified }) => {
      const profile = normalizeProfile(workspace.profile);
      return (workspace.edits as Array<Record<string, unknown>>).map(normalizeLegacyLockedEdit)
        .filter((edit) => edit.status === "published" && (edit.access === "public" || (edit.access === "locked" && Boolean(verified) && typeof edit.previewImage === "string")))
        .map((edit) => {
          const publicEdit = edit.access === "locked"
            ? { ...edit, image: typeof edit.previewImage === "string" && edit.previewImage.startsWith("/objects/") ? `/api/public-media/${encodeURIComponent(profile.username)}/${edit.id}/preview` : edit.previewImage, sourceImage: undefined, previewImage: undefined }
            : { ...edit, image: typeof edit.image === "string" && edit.image.startsWith("/objects/") ? `/api/public-media/${encodeURIComponent(profile.username)}/${edit.id}` : edit.image, sourceImage: undefined, previewImage: undefined };
          return {
            creatorUsername: profile.username,
            creatorName: profile.displayName,
            creatorVerified: Boolean(verified),
            creatorAvatar: profile.avatar.startsWith("/objects/") ? `/api/public-profile-media/${encodeURIComponent(profile.username)}` : profile.avatar,
            following: followedIds.has(workspace.creatorId),
            workspaceUpdatedAt: workspace.updatedAt,
            edit: publicEdit,
          };
        });
    }).sort((left, right) => right.workspaceUpdatedAt.getTime() - left.workspaceUpdatedAt.getTime())
      .map(({ workspaceUpdatedAt: _updatedAt, ...item }) => item);
    res.set("Cache-Control", "private, no-store");
    res.json({ items });
  } catch (error) {
    req.log.error({ err: error }, "Unable to load public creator feed");
    res.status(500).json({ error: "Unable to load the public feed" });
  }
});

router.get("/creator-featured-collections", async (req, res) => {
  if (!req.user) { res.status(401).json({ error: "Sign in to manage featured collections" }); return; }
  const authorization = await ensureCreatorAccount(req.user);
  if (!authorization.ok) { res.status(authorization.status).json({ error: authorization.error }); return; }
  const rows = await db.select().from(creatorFeaturedCollections)
    .where(eq(creatorFeaturedCollections.creatorId, authorization.workspace.creatorId))
    .orderBy(asc(creatorFeaturedCollections.position));
  res.json({ collectionIds: rows.map((item) => item.collectionId) });
});

router.get("/creators/:username/featured-collections", async (req, res) => {
  const workspace = await creatorByUsername(req.params.username);
  if (!workspace) { res.status(404).json({ error: "Creator not found" }); return; }
  const rows = await db.select().from(creatorFeaturedCollections)
    .where(eq(creatorFeaturedCollections.creatorId, workspace.creatorId))
    .orderBy(asc(creatorFeaturedCollections.position));
  res.json({ collectionIds: rows.map((item) => item.collectionId) });
});

router.put("/creator-featured-collections", async (req, res) => {
  if (!req.user) { res.status(401).json({ error: "Sign in to manage featured collections" }); return; }
  const authorization = await ensureCreatorAccount(req.user);
  if (!authorization.ok) { res.status(authorization.status).json({ error: authorization.error }); return; }
  const requested: string[] | null = Array.isArray(req.body?.collectionIds)
    ? Array.from(new Set<string>((req.body.collectionIds as unknown[])
      .filter((item): item is string => typeof item === "string" && item.length > 0))).slice(0, 3)
    : null;
  if (!requested) { res.status(400).json({ error: "collectionIds must be an array" }); return; }
  const validIds = new Set<string>((authorization.workspace.collections as Array<{ id?: unknown }>)
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string"));
  if (requested.some((id) => !validIds.has(id))) { res.status(400).json({ error: "A featured collection is not part of this workspace" }); return; }
  await db.transaction(async (tx) => {
    await tx.delete(creatorFeaturedCollections).where(eq(creatorFeaturedCollections.creatorId, authorization.workspace.creatorId));
    if (requested.length) await tx.insert(creatorFeaturedCollections).values(requested.map((collectionId, position) => ({ creatorId: authorization.workspace.creatorId, collectionId, position })));
  });
  res.json({ collectionIds: requested });
});

router.put("/creator-workspace", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to update the creator workspace" });
    return;
  }
  const authorization = await ensureCreatorAccount(req.user!);
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
  if (!authorization.verified && (parsed.data.edits.some((edit) => edit.access === "locked") || parsed.data.collections.some((collection) => collection.access === "locked"))) {
    res.status(403).json({ error: "Subscriber-only content is available only to verified TASTEKIN creators" });
    return;
  }

  // Validate place fields and no-photo rules for each edit
  for (const edit of parsed.data.edits as EditRecord[]) {
    const placeError = validatePlaceFields(edit);
    if (placeError) {
      res.status(400).json({ error: placeError });
      return;
    }
  }

  try {
    const workspaceId = authorization.workspace.creatorId;
    const ownerId = req.user!.id;
    const privatePaths = Array.from(new Set(
      [
        ...(parsed.data.edits as Array<Record<string, unknown>>)
          .flatMap((edit) => [edit.sourceImage, edit.image, edit.previewImage]),
        ...(parsed.data.collections as Array<Record<string, unknown>>)
          .flatMap((collection) => Array.isArray(collection.uploads) ? (collection.uploads as Array<{ image?: unknown }>).map((item) => item.image) : []),
      ].filter((path): path is string => typeof path === "string" && /^\/objects\/uploads\/[0-9a-fA-F-]{36}$/.test(path)),
    ));
    const result = await db.transaction(async (tx) => {
      // Engagement rows are keyed by Edit ID, so IDs must remain globally unique
      // across creator workspaces. UUIDs are generated by the client, and this
      // lock closes the final race between simultaneous publishes.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('tastekin-edit-identifiers'))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`);
      const [current] = await tx.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, workspaceId));
      if (!current || (current.ownerUserId && current.ownerUserId !== ownerId)) return { kind: "owner" as const };
      if (!current.ownerUserId) {
        const [claimed] = await tx.update(creatorWorkspaces).set({ ownerUserId: ownerId }).where(sql`${creatorWorkspaces.creatorId} = ${workspaceId} and ${creatorWorkspaces.ownerUserId} is null`).returning();
        if (!claimed) return { kind: "conflict" as const };
      }
      if (parsed.data.expectedRevision !== current.revision) return { kind: "conflict" as const };
      const requestedEditIds = new Set(parsed.data.edits.map((edit) => edit.id));
      if (requestedEditIds.size !== parsed.data.edits.length) return { kind: "edit-id" as const };
      const otherWorkspaces = await tx.select({ creatorId: creatorWorkspaces.creatorId, edits: creatorWorkspaces.edits })
        .from(creatorWorkspaces).where(sql`${creatorWorkspaces.creatorId} <> ${workspaceId}`);
      const collides = otherWorkspaces.some((other) => (other.edits as Array<{ id?: unknown }>).some((edit) => typeof edit.id === "string" && requestedEditIds.has(edit.id)));
      if (collides) return { kind: "edit-id" as const };
      const existingPrivatePaths = Array.from(new Set(
        [
          ...(current.edits as Array<Record<string, unknown>>)
            .flatMap((edit) => [edit.sourceImage, edit.image, edit.previewImage]),
          ...(current.collections as Array<Record<string, unknown>>)
            .flatMap((collection) => Array.isArray(collection.uploads) ? (collection.uploads as Array<{ image?: unknown }>).map((item) => item.image) : []),
        ].filter((path): path is string => typeof path === "string" && /^\/objects\/uploads\/[0-9a-fA-F-]{36}$/.test(path)),
      ));
      if (existingPrivatePaths.length) {
        await tx.insert(creatorMediaUploads)
          .values(existingPrivatePaths.map((objectPath) => ({ objectPath, creatorId: workspaceId, ownerUserId: ownerId, state: "committed" })))
          .onConflictDoNothing();
      }
      if (privatePaths.length) {
        const uploads = await tx.select().from(creatorMediaUploads).where(inArray(creatorMediaUploads.objectPath, privatePaths));
        if (uploads.length !== privatePaths.length || uploads.some((upload) => upload.creatorId !== workspaceId || upload.ownerUserId !== ownerId || (upload.state !== "pending" && upload.state !== "committed"))) return { kind: "media" as const };
        await tx.update(creatorMediaUploads).set({ state: "committed", updatedAt: new Date() }).where(and(inArray(creatorMediaUploads.objectPath, privatePaths), eq(creatorMediaUploads.ownerUserId, ownerId)));
      }
      const [workspace] = await tx.update(creatorWorkspaces)
        .set({ edits: parsed.data.edits, collections: parsed.data.collections, revision: sql`${creatorWorkspaces.revision} + 1`, updatedAt: new Date() })
        .where(sql`${creatorWorkspaces.creatorId} = ${workspaceId} and ${creatorWorkspaces.ownerUserId} = ${ownerId} and ${creatorWorkspaces.revision} = ${parsed.data.expectedRevision}`)
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
    if (result.kind === "edit-id") {
      res.status(409).json({ error: "An Edit identifier is already in use. Recreate this Edit and retry." });
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
