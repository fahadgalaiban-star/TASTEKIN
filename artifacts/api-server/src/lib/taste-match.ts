import {
  jaccardOverlap,
  isCompleteTasteProfile,
  sharedUnique,
  tasteCategories,
  tasteCategoryLabel,
  tasteTags,
  tasteTagLabel,
} from "@workspace/taste-catalog";

export type TasteSelection = {
  categories: string[];
  tags: string[];
};

export type CreatorTasteProfile = {
  categories: string[];
  tasteTags: string[];
};

type SharedTaste = {
  id: string;
  label: string;
  labelAr: string;
  type: "category" | "tag";
};

export type TransparentTasteMatch = {
  state: "ready" | "incomplete" | "signed_out";
  score: number | null;
  sharedTastes: SharedTaste[];
  explanation: string;
  explanationAr: string;
};

function orderByCatalog(values: readonly string[], catalog: readonly { id: string }[]) {
  const valuesSet = new Set(values);
  return catalog.filter((item) => valuesSet.has(item.id)).map((item) => item.id);
}

function sharedTastes(preferences: TasteSelection, creator: CreatorTasteProfile): SharedTaste[] {
  const sharedTags = orderByCatalog(sharedUnique(preferences.tags, creator.tasteTags), tasteTags).map((id) => ({
    id,
    label: tasteTagLabel(id),
    labelAr: tasteTagLabel(id, "ar"),
    type: "tag" as const,
  }));
  const sharedCategories = orderByCatalog(sharedUnique(preferences.categories, creator.categories), tasteCategories).map((id) => ({
    id,
    label: tasteCategoryLabel(id),
    labelAr: tasteCategoryLabel(id, "ar"),
    type: "category" as const,
  }));
  return [...sharedTags, ...sharedCategories].slice(0, 3);
}

function explanationFor(shared: SharedTaste[]) {
  if (!shared.length) {
    return {
      explanation: "Your saved tastes are complete, but this creator starts from different references.",
      explanationAr: "تفضيلاتك المكتملة تبدأ من مراجع مختلفة عن هذا المبدع.",
    };
  }
  if (shared.length === 1) {
    return {
      explanation: `You both return to ${shared[0].label}.`,
      explanationAr: `تلتقي اختياراتكما عند ${shared[0].labelAr}.`,
    };
  }
  const names = shared.slice(0, 2);
  return {
    explanation: `You both return to ${names[0].label} and ${names[1].label}.`,
    explanationAr: `تلتقي اختياراتكما عند ${names[0].labelAr} و${names[1].labelAr}.`,
  };
}

export function calculateTasteMatch(
  preferences: TasteSelection | null,
  creator: CreatorTasteProfile,
  authenticated: boolean,
): TransparentTasteMatch {
  if (!authenticated) {
    return {
      state: "signed_out",
      score: null,
      sharedTastes: [],
      explanation: "Sign in to discover your Taste Match.",
      explanationAr: "سجّل الدخول لاكتشاف تطابق ذوقك.",
    };
  }
  if (!preferences || !isCompleteTasteProfile(preferences.categories, preferences.tags)) {
    return {
      state: "incomplete",
      score: null,
      sharedTastes: [],
      explanation: "Build your taste profile to see a transparent Taste Match.",
      explanationAr: "أكمل ملف ذوقك لرؤية تطابق ذوق شفاف.",
    };
  }

  const score = Math.round(
    (jaccardOverlap(preferences.categories, creator.categories) * 0.35
      + jaccardOverlap(preferences.tags, creator.tasteTags) * 0.65) * 100,
  );
  const shared = sharedTastes(preferences, creator);
  return { state: "ready", score, sharedTastes: shared, ...explanationFor(shared) };
}

export function tasteReasons(match: TransparentTasteMatch) {
  return match.sharedTastes.slice(0, 2).map((item) => `Shared: ${item.label}`);
}