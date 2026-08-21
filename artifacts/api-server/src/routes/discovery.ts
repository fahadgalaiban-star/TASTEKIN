import {
  ExploreQueryParams,
  GetCreatorResponse,
  GetTasteCatalogResponse,
  GetTasteMatchParams,
  GetTasteMatchResponse,
  GetTastePreferencesResponse,
  ListCreatorsQueryParams,
  ListCreatorsResponse,
  SaveTastePreferencesBody,
  SaveTastePreferencesResponse,
  UpdateRelationshipBody,
} from "@workspace/api-zod";
import { creatorWorkspaces, db, userTastePreferences } from "@workspace/db";
import {
  MIN_TASTE_CATEGORIES,
  MIN_TASTE_TAGS,
  isCompleteTasteProfile,
  tasteCategories,
  tasteCategoryIds,
  tasteCategoryLabel,
  tasteTagIds,
  tasteTags,
} from "@workspace/taste-catalog";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { calculateTasteMatch, tasteReasons, type CreatorTasteProfile, type TasteSelection } from "../lib/taste-match";

const router: IRouter = Router();

const images = {
  atelier:
    "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=85",
  cafe:
    "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=85",
  travel:
    "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1200&q=85",
  ritual:
    "https://images.unsplash.com/photo-1547887538-e3a2f32cb1cc?auto=format&fit=crop&w=1200&q=85",
  movement:
    "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1200&q=85",
};

const creators = [
  {
    id: "fheed-alaiban",
    username: "fheed",
    displayName: "Fheed Alaiban",
    avatar: "/tastekin-media/fheed-profile.webp",
    categories: ["Fashion", "Travel", "Places", "DailyRoutine"],
    tasteTags: ["quiet-luxury", "tailoring", "neutral-layers", "slow-travel", "coastal-escapes", "city-guides", "morning-rituals"],
    city: "Kuwait City, Kuwait",
    verified: true,
    bio: "A considered edit of what I wear, where I go, and what stays.",
    createdAt: "2026-08-20T08:00:00.000Z",
  },
  {
    id: "noura-studio",
    username: "noura.studio",
    displayName: "Noura Studio",
    avatar: images.cafe,
    categories: ["Restaurants", "Places", "Travel", "Decor"],
    tasteTags: ["long-lunches", "coffee-stops", "table-setting", "hidden-gems", "architecture", "slow-travel", "calm-interiors"],
    city: "Jeddah, SA",
    verified: true,
    bio: "Small tables, beautiful ingredients, and places worth the detour.",
    createdAt: "2026-08-19T08:00:00.000Z",
  },
  {
    id: "omar-moves",
    username: "omarmoves",
    displayName: "Omar Moves",
    avatar: images.movement,
    categories: ["HealthFitness", "DailyRoutine", "Travel"],
    tasteTags: ["strength-training", "recovery", "wellbeing", "weekly-reset", "slow-travel"],
    city: "Dubai, UAE",
    verified: false,
    bio: "Movement rituals for a life lived outside the routine.",
    createdAt: "2026-08-18T08:00:00.000Z",
  },
];

const edits = [
  {
    id: "edit-01",
    creatorUsername: "fheed",
    creatorName: "Fheed Alaiban",
    creatorAvatar: images.atelier,
    creatorVerified: true,
    title: "The quiet uniform",
    caption: "Five pieces I reach for when the day needs a little more intention.",
    contentType: "Shoppable look",
    access: "public",
    image: images.atelier,
    altText: "Person in a neutral layered outfit in a sunlit room",
    location: "Kuwait City, Kuwait",
    tags: ["linen", "neutral", "everyday"],
    saved: false,
    sponsored: false,
    publishedAt: "2 days ago",
  },
  {
    id: "edit-02",
    creatorUsername: "fheed",
    creatorName: "Fheed Alaiban",
    creatorAvatar: images.ritual,
    creatorVerified: true,
    title: "A slower morning",
    caption: "The small rituals that make a Tuesday feel like a Sunday.",
    contentType: "Routine",
    access: "subscribers",
    image: images.ritual,
    altText: "Amber fragrance bottle and folded linen on a table",
    location: "At home",
    tags: ["rituals", "fragrance", "slow living"],
    saved: false,
    sponsored: false,
    publishedAt: "5 days ago",
  },
  {
    id: "edit-03",
    creatorUsername: "noura.studio",
    creatorName: "Noura Studio",
    creatorAvatar: images.cafe,
    creatorVerified: true,
    title: "Worth the table",
    caption: "Three places in Jeddah for a long lunch and no agenda.",
    contentType: "Place guide",
    access: "public",
    image: images.cafe,
    altText: "Coffee and pastry on a small cafe table",
    location: "Jeddah, Saudi Arabia",
    tags: ["places", "food", "Jeddah"],
    saved: false,
    sponsored: true,
    publishedAt: "1 week ago",
  },
  {
    id: "edit-04",
    creatorUsername: "omarmoves",
    creatorName: "Omar Moves",
    creatorAvatar: images.movement,
    creatorVerified: false,
    title: "The 20-minute reset",
    caption: "A compact movement sequence for the days that get away from you.",
    contentType: "Workout",
    access: "public",
    image: images.movement,
    altText: "Person stretching in a bright studio",
    location: "Dubai, UAE",
    tags: ["movement", "wellness", "reset"],
    saved: false,
    sponsored: false,
    publishedAt: "2 weeks ago",
  },
];

const collections = [
  {
    id: "collection-01",
    creatorUsername: "fheed",
    title: "The considered weekend",
    description: "A guide to dressing, moving, and staying somewhere beautifully.",
    image: images.travel,
    itemCount: 8,
    access: "mixed",
    updatedAt: "Updated 3 days ago",
  },
  {
    id: "collection-02",
    creatorUsername: "noura.studio",
    title: "Jeddah, slowly",
    description: "The places that reward an unhurried afternoon.",
    image: images.cafe,
    itemCount: 12,
    access: "public",
    updatedAt: "Updated last week",
  },
];

const publicEdit = <T extends (typeof edits)[number]>(edit: T) =>
  edit.access === "subscribers"
    ? { ...edit, image: "", altText: "Subscribers only edit preview" }
    : edit;

type Creator = (typeof creators)[number];

function serializePreferences(selection: TasteSelection, updatedAt: Date) {
  return {
    categories: selection.categories,
    tags: selection.tags,
    complete: isCompleteTasteProfile(selection.categories, selection.tags),
    updatedAt,
  };
}

async function preferencesForUser(userId: string): Promise<{ selection: TasteSelection; updatedAt: Date } | null> {
  const [preferences] = await db.select().from(userTastePreferences).where(eq(userTastePreferences.userId, userId));
  if (!preferences) return null;
  return {
    selection: {
      categories: preferences.categories.filter((item) => tasteCategoryIds.includes(item as never)),
      tags: preferences.tags.filter((item) => tasteTagIds.includes(item as never)),
    },
    updatedAt: preferences.updatedAt,
  };
}

function creatorResponse(creator: Creator, preferences: TasteSelection | null, authenticated: boolean) {
  const match = calculateTasteMatch(preferences, creator satisfies CreatorTasteProfile, authenticated);
  return {
    id: creator.id,
    username: creator.username,
    displayName: creator.displayName,
    avatar: creator.avatar,
    categories: creator.categories.map((category) => tasteCategoryLabel(category)),
    city: creator.city,
    verified: creator.verified,
    bio: creator.bio,
    matchScore: match.score,
    matchState: match.state,
    sharedTastes: match.sharedTastes,
    matchReasons: tasteReasons(match),
  };
}

function preferencesFromRequest(value: unknown): TasteSelection | null {
  const parsed = SaveTastePreferencesBody.safeParse(value);
  if (!parsed.success) return null;
  const categories = Array.from(new Set(parsed.data.categories));
  const tags = Array.from(new Set(parsed.data.tags));
  if (
    categories.some((item) => !tasteCategoryIds.includes(item as never))
    || tags.some((item) => !tasteTagIds.includes(item as never))
  ) return null;
  return { categories, tags };
}

router.get("/feed", (_req, res) => res.json(edits.map(publicEdit)));

router.get("/taste-catalog", (_req, res) => {
  res.json(GetTasteCatalogResponse.parse({
    categories: tasteCategories.map((category) => ({ id: category.id, label: category.en, labelAr: category.ar })),
    tags: tasteTags.map((tag) => ({ id: tag.id, categoryId: tag.category, label: tag.en, labelAr: tag.ar })),
    minCategories: MIN_TASTE_CATEGORIES,
    minTags: MIN_TASTE_TAGS,
  }));
});

router.get("/taste-preferences", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to view your private taste preferences" });
    return;
  }
  const preferences = await preferencesForUser(req.user!.id);
  res.json(GetTastePreferencesResponse.parse(
    serializePreferences(preferences?.selection ?? { categories: [], tags: [] }, preferences?.updatedAt ?? new Date()),
  ));
});

router.put("/taste-preferences", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to save your taste preferences" });
    return;
  }
  const preferences = preferencesFromRequest(req.body);
  if (!preferences) {
    res.status(400).json({ error: "Choose only approved taste categories and tags" });
    return;
  }
  const now = new Date();
  const [saved] = await db
    .insert(userTastePreferences)
    .values({ userId: req.user!.id, ...preferences, updatedAt: now })
    .onConflictDoUpdate({
      target: userTastePreferences.userId,
      set: { ...preferences, updatedAt: now },
    })
    .returning();
  res.json(SaveTastePreferencesResponse.parse(serializePreferences(preferences, saved.updatedAt)));
});

router.get("/creators", async (req, res) => {
  const parsed = ListCreatorsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const query = params.q?.toLowerCase();
  const preferences = req.user ? await preferencesForUser(req.user.id) : null;
  const result = creators.filter((creator) => {
    const matchesQuery =
      !query ||
       `${creator.displayName} ${creator.username} ${creator.city} ${creator.categories.join(" ")} ${creator.tasteTags.join(" ")}`
        .toLowerCase()
        .includes(query);
    const matchesCategory =
      !params.category || creator.categories.includes(params.category);
    const matchesCity = !params.city || creator.city.includes(params.city);
    return matchesQuery && matchesCategory && matchesCity;
  }).map((creator) => creatorResponse(creator, preferences?.selection ?? null, Boolean(req.user)));
  res.json(ListCreatorsResponse.parse(result));
});

router.get("/creators/:username", async (req, res) => {
  const creator = creators.find((item) => item.username === req.params.username);
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }
  const preferences = req.user ? await preferencesForUser(req.user.id) : null;
  const summary = creatorResponse(creator, preferences?.selection ?? null, Boolean(req.user));
  res.json(GetCreatorResponse.parse({
    ...summary,
    editCount: edits.filter((edit) => edit.creatorUsername === creator.username).length,
    collectionCount: collections.filter(
      (collection) => collection.creatorUsername === creator.username,
    ).length,
    reasons: summary.matchState === "ready" ? summary.matchReasons : [calculateTasteMatch(preferences?.selection ?? null, creator, Boolean(req.user)).explanation],
    edits: edits.filter((edit) => edit.creatorUsername === creator.username).map(publicEdit),
    collections: collections.filter(
      (collection) => collection.creatorUsername === creator.username,
    ),
  }));
});

router.get("/taste-match/:username", async (req, res): Promise<void> => {
  const parsed = GetTasteMatchParams.safeParse(req.params);
  const creator = parsed.success ? creators.find((item) => item.username === parsed.data.username) : undefined;
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }
  const preferences = req.user ? await preferencesForUser(req.user.id) : null;
  const selection = preferences?.selection ?? null;
  res.json(GetTasteMatchResponse.parse({
    authenticated: Boolean(req.user),
    creator: creatorResponse(creator, selection, Boolean(req.user)),
    preferences: selection ? {
      categories: selection.categories,
      tags: selection.tags,
      complete: isCompleteTasteProfile(selection.categories, selection.tags),
    } : null,
    match: calculateTasteMatch(selection, creator, Boolean(req.user)),
  }));
});

router.get("/explore", async (req, res) => {
  const parsed = ExploreQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const term = params.q?.toLowerCase();
  const matches = (value: string) =>
    !term || value.toLowerCase().includes(term);
  const matchesCategory = (creator: Creator) =>
    !params.category || creator.categories.includes(params.category);
  const normalizedCity = params.city?.trim().toLowerCase();
  const matchesCity = (creator: Creator) =>
    !normalizedCity || creator.city.toLowerCase().includes(normalizedCity);
  const preferences = req.user ? await preferencesForUser(req.user.id) : null;
  const [fheedWorkspace] = await db
    .select()
    .from(creatorWorkspaces)
    .where(eq(creatorWorkspaces.creatorId, "fheed"));
  const savedFheedAvatar = fheedWorkspace?.profile
    && typeof fheedWorkspace.profile === "object"
    && typeof (fheedWorkspace.profile as { avatar?: unknown }).avatar === "string"
    ? (fheedWorkspace.profile as { avatar: string }).avatar
    : null;
  const fheedAvatar = savedFheedAvatar?.startsWith("/objects/")
    ? "/api/public-profile-media"
    : savedFheedAvatar ?? creators.find((creator) => creator.username === "fheed")?.avatar;
  const viewingOwnFheedProfile = Boolean(req.user && fheedWorkspace?.ownerUserId === req.user.id);
  const sort = params.sort ?? (req.user ? "best" : "new");
  const matchedCreators = creators
    .filter((creator) => creator.verified)
    .filter((creator) => !viewingOwnFheedProfile || creator.username !== "fheed")
    .filter((creator) => matches(`${creator.displayName} ${creator.categories.join(" ")} ${creator.tasteTags.join(" ")} ${creator.city}`))
    .filter(matchesCategory)
    .filter(matchesCity)
    .map((creator) => ({
      ...creatorResponse(creator, preferences?.selection ?? null, Boolean(req.user)),
      avatar: creator.username === "fheed" ? fheedAvatar : creator.avatar,
      createdAt: creator.createdAt,
    }))
    .sort((left, right) => sort === "new"
      ? right.createdAt.localeCompare(left.createdAt)
      : (right.matchScore ?? -1) - (left.matchScore ?? -1) || right.createdAt.localeCompare(left.createdAt))
    .map(({ createdAt: _createdAt, ...creator }) => creator);
  res.json({
    authenticated: Boolean(req.user),
    sort,
    creators: matchedCreators,
     edits: edits.filter((edit) => matches(`${edit.title} ${edit.caption} ${edit.tags.join(" ")}`)).map(publicEdit),
    collections: collections.filter((collection) =>
      matches(`${collection.title} ${collection.description}`),
    ),
    places: ["The Lighthouse, Kuwait City", "Hayy Jameel, Jeddah", "Alserkal Avenue, Dubai"].filter(matches),
    products: ["Aesop Resurrection", "Linen overshirt", "Kinto travel tumbler"].filter(matches),
  });
});

router.get("/edits/:id", (req, res) => {
  const edit = edits.find((item) => item.id === req.params.id);
  if (!edit) {
    res.status(404).json({ error: "Edit not found" });
    return;
  }
  res.json(publicEdit(edit));
});

router.post("/relationships", (req, res) => {
  const parsed = UpdateRelationshipBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid relationship" });
    return;
  }
  res.json({ ...parsed.data, updatedAt: new Date().toISOString() });
});

export { creators, edits, collections };
export default router;