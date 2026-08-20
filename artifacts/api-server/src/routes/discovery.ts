import { Router, type IRouter } from "express";
import {
  ExploreQueryParams,
  ListCreatorsQueryParams,
  UpdateRelationshipBody,
} from "@workspace/api-zod";

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
    avatar: images.atelier,
    categories: ["Style", "Travel", "Rituals"],
    city: "Kuwait City, Kuwait",
    matchScore: 94,
    verified: true,
    bio: "A considered edit of what I wear, where I go, and what stays.",
  },
  {
    id: "noura-studio",
    username: "noura.studio",
    displayName: "Noura Studio",
    avatar: images.cafe,
    categories: ["Food", "Places", "Design"],
    city: "Jeddah, SA",
    matchScore: 86,
    verified: true,
    bio: "Small tables, beautiful ingredients, and places worth the detour.",
  },
  {
    id: "omar-moves",
    username: "omarmoves",
    displayName: "Omar Moves",
    avatar: images.movement,
    categories: ["Fitness", "Wellness", "Travel"],
    city: "Dubai, UAE",
    matchScore: 79,
    verified: false,
    bio: "Movement rituals for a life lived outside the routine.",
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

router.get("/feed", (_req, res) => res.json(edits.map(publicEdit)));

router.get("/creators", (req, res) => {
  const parsed = ListCreatorsQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const query = params.q?.toLowerCase();
  const result = creators.filter((creator) => {
    const matchesQuery =
      !query ||
      `${creator.displayName} ${creator.username} ${creator.city} ${creator.categories.join(" ")}`
        .toLowerCase()
        .includes(query);
    const matchesCategory =
      !params.category || creator.categories.includes(params.category);
    const matchesCity = !params.city || creator.city.includes(params.city);
    return matchesQuery && matchesCategory && matchesCity;
  });
  res.json(result);
});

router.get("/creators/:username", (req, res) => {
  const creator = creators.find((item) => item.username === req.params.username);
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }
  res.json({
    ...creator,
    editCount: edits.filter((edit) => edit.creatorUsername === creator.username).length,
    collectionCount: collections.filter(
      (collection) => collection.creatorUsername === creator.username,
    ).length,
    reasons: [
      "You both save understated, everyday style",
      "Your taste overlaps in Kuwait City and travel",
      "You reach for warm neutrals and considered objects",
    ],
    edits: edits.filter((edit) => edit.creatorUsername === creator.username).map(publicEdit),
    collections: collections.filter(
      (collection) => collection.creatorUsername === creator.username,
    ),
  });
});

router.get("/explore", (req, res) => {
  const parsed = ExploreQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const term = params.q?.toLowerCase();
  const matches = (value: string) =>
    !term || value.toLowerCase().includes(term);
  res.json({
    creators: creators.filter((creator) =>
      matches(`${creator.displayName} ${creator.categories.join(" ")} ${creator.city}`),
    ),
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