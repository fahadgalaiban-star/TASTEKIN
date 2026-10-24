export const tasteCategories = [
  { id: "Fashion", en: "Fashion & Outfits", ar: "أزياء وإطلالات" },
  { id: "Travel", en: "Travel", ar: "سفر" },
  { id: "Places", en: "Places", ar: "أماكن" },
  { id: "Restaurants", en: "Restaurants", ar: "مطاعم" },
  { id: "DailyRoutine", en: "Daily Routine", ar: "روتين يومي" },
  { id: "PersonalCare", en: "Personal Care", ar: "عناية شخصية" },
  { id: "HealthFitness", en: "Health & Fitness", ar: "صحة ولياقة" },
  { id: "Decor", en: "Decor", ar: "ديكور" },
  { id: "Books", en: "Books", ar: "كتب" },
  { id: "Vlogs", en: "Vlogs", ar: "فلوقات" },
] as const;

export type TasteCategoryId = (typeof tasteCategories)[number]["id"];

// `keywords` drive tag inference from an Edit's title and caption (see
// inferTasteTags): lowercase English stems matched on word boundaries and
// Arabic fragments matched as substrings (Arabic prefixes such as ال/و/ب
// attach to the word, so a boundary match would miss them). Keep them
// specific — a keyword that fires on unrelated Edits is worse than none.
export const tasteTags = [
  { id: "quiet-luxury", category: "Fashion", en: "Quiet luxury", ar: "فخامة هادئة", keywords: { en: ["quiet luxury", "understated", "cashmere", "minimal", "timeless", "elevated basics"], ar: ["فخامة هادئة", "كشمير", "بسيط", "خالد", "أساسيات راقية"] } },
  { id: "tailoring", category: "Fashion", en: "Tailoring", ar: "تفصيل", keywords: { en: ["tailor", "tailored", "blazer", "suit", "trousers", "structured"], ar: ["تفصيل", "بليزر", "بدلة", "بنطلون", "مفصل"] } },
  { id: "neutral-layers", category: "Fashion", en: "Neutral layers", ar: "طبقات حيادية", keywords: { en: ["layers", "layering", "neutral", "beige", "camel", "linen", "knit"], ar: ["طبقات", "حيادي", "بيج", "كاميل", "كتان", "تريكو"] } },
  { id: "everyday-uniforms", category: "Fashion", en: "Everyday uniforms", ar: "إطلالات يومية", keywords: { en: ["uniform", "everyday", "daily outfit", "go-to", "capsule", "ootd"], ar: ["إطلالة يومية", "إطلالات يومية", "يومي", "كبسولة", "لوك اليوم"] } },
  { id: "slow-travel", category: "Travel", en: "Slow travel", ar: "سفر هادئ", keywords: { en: ["slow travel", "a week in", "unhurried", "long stay", "train", "road trip", "wander"], ar: ["سفر هادئ", "أسبوع في", "إقامة طويلة", "قطار", "رحلة برية", "تجول"] } },
  { id: "coastal-escapes", category: "Travel", en: "Coastal escapes", ar: "رحلات ساحلية", keywords: { en: ["coast", "coastal", "beach", "seaside", "island", "harbour", "harbor", "sea"], ar: ["ساحل", "شاطئ", "بحر", "جزيرة", "مرسى"] } },
  { id: "packing-notes", category: "Travel", en: "Packing notes", ar: "ملاحظات الحقائب", keywords: { en: ["packing", "pack", "suitcase", "carry-on", "what i packed", "luggage"], ar: ["حقيبة", "حقائب", "شنطة", "تجهيز السفر", "ماذا أحمل"] } },
  { id: "city-guides", category: "Places", en: "City guides", ar: "أدلة المدن", keywords: { en: ["guide", "48 hours", "24 hours", "where to", "neighbourhood", "neighborhood", "itinerary"], ar: ["دليل", "48 ساعة", "24 ساعة", "وين تروح", "أين تذهب", "حي", "جدول"] } },
  { id: "hidden-gems", category: "Places", en: "Hidden gems", ar: "أماكن خفية", keywords: { en: ["hidden gem", "hidden", "secret", "tucked away", "off the beaten", "quiet spot", "local favourite"], ar: ["مخفي", "خفي", "سر", "بعيد عن الزحمة", "مكان هادئ", "ما يعرفه"] } },
  { id: "architecture", category: "Places", en: "Architecture", ar: "عمارة", keywords: { en: ["architecture", "architect", "brutalist", "facade", "courtyard", "mosque", "museum", "design"], ar: ["عمارة", "معماري", "واجهة", "فناء", "مسجد", "متحف", "تصميم"] } },
  { id: "long-lunches", category: "Restaurants", en: "Long lunches", ar: "غداء طويل", keywords: { en: ["lunch", "long lunch", "brunch", "dinner", "restaurant", "tasting menu", "chef"], ar: ["غداء", "برانش", "عشاء", "مطعم", "قائمة تذوق", "شيف"] } },
  { id: "coffee-stops", category: "Restaurants", en: "Coffee stops", ar: "محطات القهوة", keywords: { en: ["coffee", "cafe", "café", "espresso", "latte", "flat white", "roaster", "matcha"], ar: ["قهوة", "كافيه", "مقهى", "اسبريسو", "لاتيه", "محمصة", "ماتشا"] } },
  { id: "table-setting", category: "Restaurants", en: "Table setting", ar: "تنسيق المائدة", keywords: { en: ["table setting", "tablescape", "hosting", "dinner party", "plating", "linen napkin"], ar: ["تنسيق المائدة", "سفرة", "ضيافة", "عزيمة", "تقديم"] } },
  { id: "morning-rituals", category: "DailyRoutine", en: "Morning rituals", ar: "طقوس الصباح", keywords: { en: ["morning", "ritual", "sunrise", "first hour", "wake up", "journaling"], ar: ["صباح", "طقوس", "شروق", "أول ساعة", "استيقاظ", "تدوين"] } },
  { id: "weekly-reset", category: "DailyRoutine", en: "Weekly reset", ar: "ترتيب الأسبوع", keywords: { en: ["weekly reset", "reset", "sunday", "plan the week", "declutter", "meal prep"], ar: ["ترتيب الأسبوع", "إعادة ترتيب", "الأحد", "تخطيط الأسبوع", "تنظيم", "تحضير الوجبات"] } },
  { id: "slow-living", category: "DailyRoutine", en: "Slow living", ar: "حياة هادئة", keywords: { en: ["slow living", "slow down", "unplug", "quiet", "calm day", "analog"], ar: ["حياة هادئة", "هدوء", "بطء", "بدون جوال", "يوم هادئ"] } },
  { id: "fragrance", category: "PersonalCare", en: "Fragrance", ar: "عطور", keywords: { en: ["fragrance", "perfume", "scent", "oud", "eau de", "notes of"], ar: ["عطر", "عطور", "رائحة", "عود", "بخور", "نفحات"] } },
  { id: "simple-skincare", category: "PersonalCare", en: "Simple skincare", ar: "عناية بسيطة بالبشرة", keywords: { en: ["skincare", "skin care", "moisturiser", "moisturizer", "spf", "sunscreen", "cleanser", "serum"], ar: ["عناية بالبشرة", "بشرة", "مرطب", "واقي شمس", "غسول", "سيروم"] } },
  { id: "wellbeing", category: "HealthFitness", en: "Wellbeing", ar: "عافية", keywords: { en: ["wellbeing", "well-being", "wellness", "breathwork", "walk", "sleep", "mindful"], ar: ["عافية", "صحة نفسية", "تنفس", "مشي", "نوم", "وعي"] } },
  { id: "strength-training", category: "HealthFitness", en: "Strength training", ar: "تدريب القوة", keywords: { en: ["strength", "lift", "lifting", "deadlift", "squat", "gym", "sets", "reps"], ar: ["قوة", "رفع", "أثقال", "سكوات", "ددلفت", "نادي", "جيم", "تمرين"] } },
  { id: "recovery", category: "HealthFitness", en: "Recovery", ar: "استشفاء", keywords: { en: ["recovery", "rest day", "stretch", "mobility", "sauna", "ice bath", "massage"], ar: ["استشفاء", "راحة", "تمدد", "مرونة", "ساونا", "حمام ثلج", "مساج"] } },
  { id: "calm-interiors", category: "Decor", en: "Calm interiors", ar: "ديكورات هادئة", keywords: { en: ["interior", "interiors", "living room", "bedroom", "sofa", "warm tones", "textures", "home"], ar: ["ديكور", "داخلي", "غرفة المعيشة", "غرفة النوم", "كنب", "ألوان دافئة", "منزل"] } },
  { id: "natural-light", category: "Decor", en: "Natural light", ar: "ضوء طبيعي", keywords: { en: ["natural light", "sunlight", "window", "golden hour", "bright room", "skylight"], ar: ["ضوء طبيعي", "ضوء الشمس", "نافذة", "الساعة الذهبية", "غرفة مضيئة"] } },
  { id: "reading-lists", category: "Books", en: "Reading lists", ar: "قوائم القراءة", keywords: { en: ["reading list", "books i", "to read", "bookshelf", "currently reading", "novel", "library"], ar: ["قائمة قراءة", "قوائم القراءة", "كتب", "أقرأ", "رواية", "مكتبة", "رف الكتب"] } },
  { id: "creative-nonfiction", category: "Books", en: "Creative nonfiction", ar: "كتب واقعية إبداعية", keywords: { en: ["nonfiction", "non-fiction", "memoir", "essay", "essays", "biography", "journalism"], ar: ["واقعي", "مذكرات", "سيرة", "مقالات", "مقال", "صحافة"] } },
  { id: "city-diaries", category: "Vlogs", en: "City diaries", ar: "يوميات المدن", keywords: { en: ["diary", "diaries", "a day in", "day in my life", "vlog", "weekend in", "around the city"], ar: ["يوميات", "يوم في", "يوم من حياتي", "فلوق", "نهاية الأسبوع في", "في المدينة"] } },
  { id: "visual-journals", category: "Vlogs", en: "Visual journals", ar: "يوميات بصرية", keywords: { en: ["visual journal", "film photos", "35mm", "photo dump", "moments", "frames", "on film"], ar: ["يوميات بصرية", "صور فيلم", "لقطات", "لحظات", "كاميرا فيلم", "فوتو دمب"] } },
] as const;

export type TasteTagId = (typeof tasteTags)[number]["id"];

export const tasteCategoryIds = tasteCategories.map(({ id }) => id);
export const tasteTagIds = tasteTags.map(({ id }) => id);

export const MIN_TASTE_CATEGORIES = 1;
export const MIN_TASTE_TAGS = 2;

export function isCompleteTasteProfile(categories: readonly string[], tags: readonly string[]) {
  return categories.length >= MIN_TASTE_CATEGORIES && tags.length >= MIN_TASTE_TAGS;
}

export function sharedUnique<T>(left: readonly T[], right: readonly T[]) {
  const leftSet = new Set(left);
  return Array.from(new Set(right.filter((item) => leftSet.has(item))));
}

export function jaccardOverlap(left: readonly string[], right: readonly string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (!union.size) return 0;
  return sharedUnique(Array.from(leftSet), Array.from(rightSet)).length / union.size;
}

export function tasteTagLabel(id: string, language: "en" | "ar" = "en") {
  const tag = tasteTags.find((item) => item.id === id);
  return tag ? tag[language] : id;
}

export function tasteCategoryLabel(id: string, language: "en" | "ar" = "en") {
  const category = tasteCategories.find((item) => item.id === id);
  return category ? category[language] : id;
}

/**
 * Shared weights for every taste score in the product (creator-level Taste
 * Match and per-Edit scoring): 35% categories, 65% tags. Nothing else — no
 * count of any kind — ever enters a taste score.
 */
export const TASTE_MATCH_WEIGHTS = { categories: 0.35, tags: 0.65 } as const;

/** How many taste tags a creator may pick for their profile. */
export const MAX_CREATOR_TASTE_TAGS = 8;
/** How many tags inference attaches to a single Edit. */
export const MAX_INFERRED_EDIT_TAGS = 4;

export function tasteTagsForCategory(categoryId: string): TasteTagId[] {
  return tasteTags.filter((tag) => tag.category === categoryId).map((tag) => tag.id);
}

/** Keeps only known tag ids, in catalog order, without duplicates, capped. */
export function normalizeTasteTagIds(values: readonly unknown[], max = MAX_CREATOR_TASTE_TAGS): TasteTagId[] {
  const wanted = new Set(values.filter((value): value is string => typeof value === "string"));
  return tasteTags.filter((tag) => wanted.has(tag.id)).map((tag) => tag.id).slice(0, max);
}

const englishBoundary = (keyword: string) => new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`, "i");

export type TasteTagSource = {
  category?: string | null;
  title?: string | null;
  titleAr?: string | null;
  caption?: string | null;
  captionAr?: string | null;
};

/**
 * Infers the taste tags an Edit speaks to, from its category and the words
 * in its title/caption (English and Arabic). Tags of the Edit's own
 * category rank first, then by how many keywords matched, then catalog
 * order. Deterministic and cheap (27 tags), so callers run it at read time
 * instead of storing a derived field. Never returns more than
 * MAX_INFERRED_EDIT_TAGS tags, and returns nothing for an Edit with no
 * recognisable words.
 */
export function inferTasteTags(source: TasteTagSource, max = MAX_INFERRED_EDIT_TAGS): TasteTagId[] {
  const english = [source.title, source.caption].filter(Boolean).join(" \n ").toLowerCase();
  // Arabic-Indic digits (٤٨) are folded to Western digits so "48 ساعة" matches either spelling.
  const arabic = [source.titleAr, source.captionAr].filter(Boolean).join(" \n ").replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
  const scored = tasteTags.map((tag, index) => {
    let hits = 0;
    if (english) for (const keyword of tag.keywords.en) if (englishBoundary(keyword).test(english)) hits += 1;
    if (arabic) for (const keyword of tag.keywords.ar) if (arabic.includes(keyword)) hits += 1;
    return { id: tag.id, hits, sameCategory: tag.category === source.category ? 1 : 0, index };
  }).filter((entry) => entry.hits > 0);
  scored.sort((left, right) => right.sameCategory - left.sameCategory || right.hits - left.hits || left.index - right.index);
  return scored.slice(0, max).map((entry) => entry.id);
}

// ---------------------------------------------------------------------------
/**
 * Taste in KIN Travel (feature flag taste_everywhere).
 *
 * Two pure helpers shared by the web app, the API server and the unit
 * tests:
 *  - travelInterestsForTaste: which "Choose your interests" chips a taste
 *    profile suggests, so the step opens with them already on;
 *  - creatorPlacesForDestination: which real places from Edits the member
 *    saved, or from creators they follow, sit in the destination and may
 *    join the plan.
 *
 * "Follow your taste, not the numbers": neither helper has an input for
 * likes, saves, views or followers. Candidate order is: the member's own
 * saved Edits first, then followed creators, then newest Edit first. The
 * tests permute count fields on the inputs and assert nothing moves.
 */

/** The guided flow's chip values (kin-search.ts KIN_TRAVEL_INTERESTS, mirrored to keep this package dependency-free). */
export const TRAVEL_INTERESTS = [
  "breakfast", "dinner", "cafes", "shopping", "museums", "parks", "hidden_gems", "gyms", "pilates", "walking_places",
] as const;
export type TravelInterest = (typeof TRAVEL_INTERESTS)[number];

/** At most this many chips are pre-selected; the member can always add or remove any. */
export const MAX_PRESELECTED_TRAVEL_INTERESTS = 4;
/** A chip needs at least this many votes to be pre-selected: one tag's first chip, or two weaker hints. */
export const MIN_PRESELECT_TRAVEL_VOTES = 2;

/** Tag → chips. A tag may speak to more than one chip; the first listed is the strongest. */
const TAG_TO_INTERESTS: Record<string, readonly TravelInterest[]> = {
  "coffee-stops": ["cafes", "breakfast"],
  "long-lunches": ["dinner"],
  "table-setting": ["dinner"],
  "morning-rituals": ["breakfast", "cafes"],
  "city-guides": ["museums", "hidden_gems"],
  "hidden-gems": ["hidden_gems"],
  "architecture": ["museums", "walking_places"],
  "slow-travel": ["walking_places", "parks"],
  "coastal-escapes": ["walking_places", "parks"],
  "packing-notes": [],
  "quiet-luxury": ["shopping"],
  "tailoring": ["shopping"],
  "neutral-layers": ["shopping"],
  "everyday-uniforms": ["shopping"],
  "fragrance": ["shopping"],
  "simple-skincare": [],
  "wellbeing": ["walking_places", "pilates"],
  "strength-training": ["gyms"],
  "recovery": ["pilates", "walking_places"],
  "calm-interiors": ["shopping"],
  "natural-light": ["parks"],
  "slow-living": ["parks", "cafes"],
  "weekly-reset": [],
  "reading-lists": ["cafes"],
  "creative-nonfiction": ["museums"],
  "city-diaries": ["hidden_gems", "walking_places"],
  "visual-journals": ["walking_places", "museums"],
};

/** Category → chips, used with a lower weight so tags decide ties. */
const CATEGORY_TO_INTERESTS: Record<string, readonly TravelInterest[]> = {
  Restaurants: ["dinner", "cafes"],
  Travel: ["hidden_gems", "walking_places"],
  Places: ["museums", "hidden_gems"],
  Fashion: ["shopping"],
  Decor: ["shopping"],
  PersonalCare: ["shopping"],
  HealthFitness: ["gyms", "walking_places"],
  DailyRoutine: ["breakfast", "cafes"],
  Books: ["cafes"],
  Vlogs: ["hidden_gems"],
};

export type TasteSelectionLike = { categories: readonly string[]; tags: readonly string[] };

/**
 * The chips a taste profile suggests, strongest first, capped. Every tag
 * votes 2 for its first chip and 1 for each other chip it lists; every
 * category votes 1 for its chips. Only chips with MIN_PRESELECT_TRAVEL_VOTES
 * or more are suggested. Ties keep the catalog chip order so the result is
 * stable. An empty or unknown profile suggests nothing.
 */
export function travelInterestsForTaste(selection: TasteSelectionLike | null | undefined, max = MAX_PRESELECTED_TRAVEL_INTERESTS): TravelInterest[] {
  if (!selection) return [];
  const votes = new Map<TravelInterest, number>();
  const vote = (interest: TravelInterest, weight: number) => votes.set(interest, (votes.get(interest) ?? 0) + weight);
  for (const tag of new Set(selection.tags)) {
    const chips = TAG_TO_INTERESTS[tag] ?? [];
    chips.forEach((chip, index) => vote(chip, index === 0 ? 2 : 1));
  }
  for (const category of new Set(selection.categories)) {
    for (const chip of CATEGORY_TO_INTERESTS[category] ?? []) vote(chip, 1);
  }
  return [...votes.entries()]
    .filter(([, weight]) => weight >= MIN_PRESELECT_TRAVEL_VOTES)
    .sort((left, right) => right[1] - left[1] || TRAVEL_INTERESTS.indexOf(left[0]) - TRAVEL_INTERESTS.indexOf(right[0]))
    .slice(0, Math.max(0, max))
    .map(([chip]) => chip);
}

/** An Edit with a real place on it, as stored on the creator's workspace. */
export type CreatorPlaceSource = {
  editId: string;
  creatorUsername: string;
  creatorDisplayName: string;
  placeName: string;
  /** "Paris, France", "Saint-Germain, Paris" — whatever the creator typed. */
  locationLabel?: string | null;
  location?: string | null;
  locationAr?: string | null;
  mapsUrl?: string | null;
  /** Why this Edit is a candidate for THIS member. */
  via: "saved" | "followed";
  /** Newest first within a group; any monotonic value (workspace update time is fine). */
  updatedAt?: Date | string | null;
};

export type CreatorPlace = {
  editId: string;
  creatorUsername: string;
  creatorDisplayName: string;
  placeName: string;
  locationLabel: string;
  mapsUrl: string | null;
  via: "saved" | "followed";
};

export const MAX_CREATOR_PLACES_PER_PLAN = 5;

/**
 * Puts resolved creator places into a day-by-day plan. A place the plan
 * already holds (same placeId) is kept where it is and only gains its
 * creator label; a new one goes to the day with the fewest stops, between
 * breakfast and dinner when the day has them. Nothing is dropped.
 */
export function mergeCreatorPlacesIntoDays<T extends { placeId: string; requestedSlot?: string | null }>(
  days: readonly (readonly T[])[],
  creatorPlaces: readonly T[],
  label: (existing: T, incoming: T) => T,
): T[][] {
  const result = days.map((day) => [...day]);
  if (!result.length) return result;
  for (const incoming of creatorPlaces) {
    let placed = false;
    for (const day of result) {
      const index = day.findIndex((place) => place.placeId === incoming.placeId);
      if (index >= 0) { day[index] = label(day[index], incoming); placed = true; break; }
    }
    if (placed) continue;
    const target = result.reduce((best, day) => (day.length < best.length ? day : best), result[0]);
    const lastIsDinner = target.length > 0 && target[target.length - 1].requestedSlot === "DINNER";
    target.splice(lastIsDinner ? target.length - 1 : target.length, 0, incoming);
  }
  return result;
}

/** Lower-cases, strips punctuation/diacritics and the Arabic definite article, so "Paris", "paris, france" and "باريس" compare by words. */
export function normalizePlaceWords(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .normalize("NFKD")
    .replace(/[̀-ًͯ-ْ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^(ال|the)/u, ""))
    .filter((word) => word.length >= 2);
}

/**
 * True when every word of the destination's first part (before a comma)
 * appears in the Edit's place text. "Paris" matches "Paris, France" and
 * "Le Marais, Paris"; "Paris, Texas" does not match "Paris, France".
 */
export function placeMatchesDestination(source: Pick<CreatorPlaceSource, "placeName" | "locationLabel" | "location" | "locationAr">, destination: string): boolean {
  const [head, ...rest] = destination.split(",");
  const wanted = normalizePlaceWords(head);
  if (!wanted.length) return false;
  const haystack = new Set(normalizePlaceWords([source.locationLabel, source.location, source.locationAr, source.placeName].filter(Boolean).join(" ")));
  if (!wanted.every((word) => haystack.has(word))) return false;
  // A qualifier after the comma ("Paris, Texas") must not contradict the Edit's own qualifier.
  const qualifier = normalizePlaceWords(rest.join(" "));
  const editQualifier = normalizePlaceWords((source.locationLabel ?? source.location ?? "").split(",").slice(1).join(" "));
  if (qualifier.length && editQualifier.length && !qualifier.some((word) => editQualifier.includes(word))) return false;
  return true;
}

/**
 * Picks the creator places for one plan: in the destination, no duplicate
 * place names, saved Edits before followed creators, newest first within
 * each group, capped. Nothing about counts is read; nothing about other
 * members is an input.
 */
export function creatorPlacesForDestination(sources: readonly CreatorPlaceSource[], destination: string, max = MAX_CREATOR_PLACES_PER_PLAN): CreatorPlace[] {
  const time = (value: CreatorPlaceSource["updatedAt"]) => {
    if (!value) return 0;
    const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const ordered = sources
    .filter((source) => source.placeName.trim() && placeMatchesDestination(source, destination))
    .sort((left, right) =>
      (left.via === right.via ? 0 : left.via === "saved" ? -1 : 1)
      || time(right.updatedAt) - time(left.updatedAt)
      || left.editId.localeCompare(right.editId));
  const seen = new Set<string>();
  const picked: CreatorPlace[] = [];
  for (const source of ordered) {
    const key = normalizePlaceWords(source.placeName).join(" ");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    picked.push({
      editId: source.editId,
      creatorUsername: source.creatorUsername,
      creatorDisplayName: source.creatorDisplayName,
      placeName: source.placeName.trim(),
      locationLabel: (source.locationLabel || source.location || "").trim(),
      mapsUrl: source.mapsUrl ?? null,
      via: source.via,
    });
    if (picked.length >= max) break;
  }
  return picked;
}
