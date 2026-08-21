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

export const tasteTags = [
  { id: "quiet-luxury", category: "Fashion", en: "Quiet luxury", ar: "فخامة هادئة" },
  { id: "tailoring", category: "Fashion", en: "Tailoring", ar: "تفصيل" },
  { id: "neutral-layers", category: "Fashion", en: "Neutral layers", ar: "طبقات حيادية" },
  { id: "everyday-uniforms", category: "Fashion", en: "Everyday uniforms", ar: "إطلالات يومية" },
  { id: "slow-travel", category: "Travel", en: "Slow travel", ar: "سفر هادئ" },
  { id: "coastal-escapes", category: "Travel", en: "Coastal escapes", ar: "رحلات ساحلية" },
  { id: "packing-notes", category: "Travel", en: "Packing notes", ar: "ملاحظات الحقائب" },
  { id: "city-guides", category: "Places", en: "City guides", ar: "أدلة المدن" },
  { id: "hidden-gems", category: "Places", en: "Hidden gems", ar: "أماكن خفية" },
  { id: "architecture", category: "Places", en: "Architecture", ar: "عمارة" },
  { id: "long-lunches", category: "Restaurants", en: "Long lunches", ar: "غداء طويل" },
  { id: "coffee-stops", category: "Restaurants", en: "Coffee stops", ar: "محطات القهوة" },
  { id: "table-setting", category: "Restaurants", en: "Table setting", ar: "تنسيق المائدة" },
  { id: "morning-rituals", category: "DailyRoutine", en: "Morning rituals", ar: "طقوس الصباح" },
  { id: "weekly-reset", category: "DailyRoutine", en: "Weekly reset", ar: "ترتيب الأسبوع" },
  { id: "slow-living", category: "DailyRoutine", en: "Slow living", ar: "حياة هادئة" },
  { id: "fragrance", category: "PersonalCare", en: "Fragrance", ar: "عطور" },
  { id: "simple-skincare", category: "PersonalCare", en: "Simple skincare", ar: "عناية بسيطة بالبشرة" },
  { id: "wellbeing", category: "HealthFitness", en: "Wellbeing", ar: "عافية" },
  { id: "strength-training", category: "HealthFitness", en: "Strength training", ar: "تدريب القوة" },
  { id: "recovery", category: "HealthFitness", en: "Recovery", ar: "استشفاء" },
  { id: "calm-interiors", category: "Decor", en: "Calm interiors", ar: "ديكورات هادئة" },
  { id: "natural-light", category: "Decor", en: "Natural light", ar: "ضوء طبيعي" },
  { id: "reading-lists", category: "Books", en: "Reading lists", ar: "قوائم القراءة" },
  { id: "creative-nonfiction", category: "Books", en: "Creative nonfiction", ar: "كتب واقعية إبداعية" },
  { id: "city-diaries", category: "Vlogs", en: "City diaries", ar: "يوميات المدن" },
  { id: "visual-journals", category: "Vlogs", en: "Visual journals", ar: "يوميات بصرية" },
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