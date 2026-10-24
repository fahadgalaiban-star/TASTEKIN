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