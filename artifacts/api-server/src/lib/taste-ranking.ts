import {
  TASTE_MATCH_WEIGHTS,
  inferTasteTags,
  isCompleteTasteProfile,
  jaccardOverlap,
  normalizeTasteTagIds,
  sharedUnique,
  tasteCategories,
  tasteCategoryLabel,
  tasteTags as tasteTagCatalog,
  tasteTagLabel,
  type TasteTagSource,
} from "@workspace/taste-catalog";
// Type-only, so the unit tests can import this file straight from source.
import type { TasteSelection } from "./taste-match";
import type { ImplicitTaste } from "./taste-learning";

/**
 * Per-Edit taste scoring and the "For you" ordering.
 *
 * "Follow your taste, not the numbers": the only inputs here are the
 * viewer's chosen tastes and what an Edit is about. There is deliberately
 * no field for likes, saves, views, followers or any other count, and the
 * ranking function's input type (RankableItem) cannot carry one. The tests
 * in scripts/tests/taste-ranking.test.mjs permute such counts on fixtures
 * and assert the order never moves.
 */

export type ScoredEditInput = {
  category: string;
  /** Tags this Edit speaks to (inferred from its words) plus the creator's picked tags. */
  tasteTags: readonly string[];
};

export type EditTasteMatch = {
  /** 0–100, or null when the viewer has no complete taste profile. */
  score: number | null;
  sharedTastes: Array<{ id: string; label: string; labelAr: string; type: "category" | "tag" }>;
};

export function hasCompleteTaste(preferences: TasteSelection | null | undefined): preferences is TasteSelection {
  return Boolean(preferences && isCompleteTasteProfile(preferences.categories, preferences.tags));
}

/** The tags an Edit is scored on: inferred from its own words, union the creator's picked profile tags. */
export function editTasteTags(edit: TasteTagSource, creatorTasteTags: readonly string[] = []): string[] {
  return normalizeTasteTagIds([...inferTasteTags(edit), ...creatorTasteTags], 16);
}

/**
 * 35% for the Edit's category being one the viewer chose, 65% for tag
 * overlap (Jaccard) between the viewer's tags and the Edit's tags. Same
 * weights as the creator-level Taste Match so the two numbers agree.
 */
export function scoreEditForViewer(preferences: TasteSelection | null | undefined, edit: ScoredEditInput): EditTasteMatch {
  if (!hasCompleteTaste(preferences)) return { score: null, sharedTastes: [] };
  const categoryHit = preferences.categories.includes(edit.category) ? 1 : 0;
  const tagOverlap = jaccardOverlap(preferences.tags, edit.tasteTags);
  const score = Math.round((categoryHit * TASTE_MATCH_WEIGHTS.categories + tagOverlap * TASTE_MATCH_WEIGHTS.tags) * 100);
  const sharedTagIds = new Set(sharedUnique(preferences.tags, edit.tasteTags));
  const sharedTags = tasteTagCatalog.filter((tag) => sharedTagIds.has(tag.id)).map((tag) => ({ id: tag.id, label: tag.en, labelAr: tag.ar, type: "tag" as const }));
  const sharedCategory = categoryHit
    ? tasteCategories.filter((category) => category.id === edit.category).map((category) => ({ id: category.id, label: tasteCategoryLabel(category.id), labelAr: tasteCategoryLabel(category.id, "ar"), type: "category" as const }))
    : [];
  return { score, sharedTastes: [...sharedTags, ...sharedCategory].slice(0, 3) };
}

/** How the learned (implicit) taste is blended in when the taste_learning flag is on. */
export const TASTE_LEARNING_BLEND = {
  explicit: 0.6,
  implicit: 0.4,
  /** Points taken off per tag the Edit shares with a tag the member rejected ("Not interested"). */
  rejectedTagPenalty: 15,
} as const;

/**
 * Blended per-Edit score: 60% from the explicit picks, 40% from the implicit
 * selection when there is one (the implicit selection needs at least one
 * category and two tags to be scored by the shared scorer; until then the
 * explicit score stands alone). Edits that share a rejected tag lose points.
 * Same inputs as scoreEditForViewer: still no counts, still nobody else's data.
 */
export function scoreEditWithLearning(explicit: TasteSelection | null | undefined, learned: ImplicitTaste, edit: ScoredEditInput): EditTasteMatch {
  const base = scoreEditForViewer(explicit, edit);
  if (base.score === null) return base;
  const implicitScorable = learned.selection.categories.length >= 1 && learned.selection.tags.length >= 2;
  const implicit = implicitScorable ? scoreEditForViewer(learned.selection, edit) : null;
  let score = implicit && implicit.score !== null
    ? base.score * TASTE_LEARNING_BLEND.explicit + implicit.score * TASTE_LEARNING_BLEND.implicit
    : base.score;
  const rejectedShared = edit.tasteTags.filter((tag) => learned.rejectedTags.has(tag)).length;
  score = Math.max(0, Math.round(score - rejectedShared * TASTE_LEARNING_BLEND.rejectedTagPenalty));
  const seen = new Set(base.sharedTastes.map((taste) => taste.id));
  const sharedTastes = [...base.sharedTastes, ...(implicit?.sharedTastes ?? []).filter((taste) => !seen.has(taste.id))].slice(0, 3);
  return { score, sharedTastes };
}

export type RankableItem = {
  id: string;
  creatorId: string;
  /** 0–100 taste score; null sorts last. */
  score: number | null;
  /** Recency tiebreak, newest first. */
  updatedAt: Date;
};

/**
 * "For you" order: taste score descending, newest first on ties, then a
 * diversity pass so the same creator never appears twice in a row while
 * another creator's Edit is available further down (it is pulled forward;
 * nothing is dropped). Stable for equal keys.
 */
export function rankForYou<T extends RankableItem>(items: readonly T[]): T[] {
  const sorted = [...items].sort((left, right) =>
    (right.score ?? -1) - (left.score ?? -1)
    || right.updatedAt.getTime() - left.updatedAt.getTime()
    || left.id.localeCompare(right.id));
  const result: T[] = [];
  const pending = sorted;
  while (pending.length) {
    const previous = result[result.length - 1];
    let pick = 0;
    if (previous && pending[0].creatorId === previous.creatorId) {
      const alternative = pending.findIndex((item) => item.creatorId !== previous.creatorId);
      if (alternative > 0) pick = alternative;
    }
    result.push(pending.splice(pick, 1)[0]);
  }
  return result;
}

export { tasteTagLabel };
