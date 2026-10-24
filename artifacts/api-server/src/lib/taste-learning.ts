import { tasteCategoryIds, tasteTagIds } from "@workspace/taste-catalog";
// Type-only imports, so the unit tests can load this file straight from source.
import type { TasteSelection } from "./taste-match";

/**
 * Taste that learns from the member's OWN behaviour (feature flag
 * taste_learning). Saves, likes, follows, Circle membership, views, time an
 * Edit stayed on screen and "Not interested" become weighted, time-decayed
 * votes on the tags and categories of the Edits involved. The votes are
 * turned into an implicit taste selection that scoreEditWithLearning (in
 * taste-ranking.ts) blends with the explicit picks (60% explicit / 40%
 * implicit) through the same per-Edit scorer as PR A, so the rules of that
 * scorer still hold: no count of any kind, and nothing about other members,
 * ever enters the result.
 */

export const TASTE_LEARNING = {
  windowDays: 90,
  halfLifeDays: 30,
  weights: { save: 3, circle: 3, like: 2, follow: 2, view: 0.5, dwell: 1, notInterested: -4 },
  /** Views count per creator at most this many times, so one binge cannot dominate. */
  viewCapPerCreator: 3,
  /** Dwell seconds → vote weight: 2s is the minimum the client reports, 60s the cap. */
  dwellFullWeightSeconds: 20,
  /** A tag/category needs at least this much decayed weight to join the implicit selection. */
  minImplicitWeight: 1,
  maxImplicitTags: 6,
  maxImplicitCategories: 2,
  /** Below this decayed weight a tag counts as rejected: Edits sharing it lose points (see TASTE_LEARNING_BLEND). */
  negativeTagWeight: -2,
} as const;

export type EditFacts = { editId: string; creatorId: string; category: string; tasteTags: readonly string[] };
export type CreatorFacts = { creatorId: string; categories: readonly string[]; tasteTags: readonly string[] };

export type TasteSignal =
  | { kind: "save" | "like" | "view" | "notInterested"; editId: string; at: Date }
  | { kind: "dwell"; editId: string; at: Date; seconds: number }
  | { kind: "follow" | "circle"; creatorId: string; at: Date };

export type ImplicitTaste = {
  tags: Record<string, number>;
  categories: Record<string, number>;
  dismissedEditIds: Set<string>;
  /** Tags whose decayed weight fell below negativeTagWeight. */
  rejectedTags: Set<string>;
  /** The implicit selection fed to the scorer (empty when nothing qualifies). */
  selection: TasteSelection;
};

export function decayFactor(at: Date, now: Date, halfLifeDays = TASTE_LEARNING.halfLifeDays): number {
  const ageDays = Math.max(0, (now.getTime() - at.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function signalWeight(signal: TasteSignal): number {
  const w = TASTE_LEARNING.weights;
  switch (signal.kind) {
    case "save": return w.save;
    case "circle": return w.circle;
    case "like": return w.like;
    case "follow": return w.follow;
    case "view": return w.view;
    case "notInterested": return w.notInterested;
    case "dwell": return w.dwell * Math.min(1, Math.max(0, signal.seconds) / TASTE_LEARNING.dwellFullWeightSeconds);
  }
}

/** Pure: turns the member's signals into decayed tag/category votes and an implicit selection. */
export function implicitTaste(
  signals: readonly TasteSignal[],
  editsById: ReadonlyMap<string, EditFacts>,
  creatorsById: ReadonlyMap<string, CreatorFacts>,
  now = new Date(),
): ImplicitTaste {
  const tags: Record<string, number> = {};
  const categories: Record<string, number> = {};
  const dismissedEditIds = new Set<string>();
  const viewsPerCreator = new Map<string, number>();
  const vote = (tagList: readonly string[], category: string | null, weight: number) => {
    for (const tag of tagList) tags[tag] = (tags[tag] ?? 0) + weight;
    if (category) categories[category] = (categories[category] ?? 0) + weight;
  };
  // Newest first so the per-creator view cap keeps the most recent views.
  const ordered = [...signals].sort((left, right) => right.at.getTime() - left.at.getTime());
  for (const signal of ordered) {
    const decayed = signalWeight(signal) * decayFactor(signal.at, now);
    if (!("editId" in signal)) {
      const creator = creatorsById.get(signal.creatorId);
      if (!creator) continue;
      // A creator vote spreads over what they publish; split so a prolific
      // creator does not outweigh a single save.
      const share = decayed / Math.max(1, creator.tasteTags.length || 1);
      for (const tag of creator.tasteTags) tags[tag] = (tags[tag] ?? 0) + share;
      for (const category of creator.categories) categories[category] = (categories[category] ?? 0) + decayed / Math.max(1, creator.categories.length);
    } else {
      const edit = editsById.get(signal.editId);
      if (signal.kind === "notInterested") dismissedEditIds.add(signal.editId);
      if (!edit) continue;
      if (signal.kind === "view") {
        const seen = viewsPerCreator.get(edit.creatorId) ?? 0;
        if (seen >= TASTE_LEARNING.viewCapPerCreator) continue;
        viewsPerCreator.set(edit.creatorId, seen + 1);
      }
      vote(edit.tasteTags, edit.category, decayed);
    }
  }
  const rejectedTags = new Set(Object.entries(tags).filter(([, weight]) => weight <= TASTE_LEARNING.negativeTagWeight).map(([tag]) => tag));
  const pick = (table: Record<string, number>, known: readonly string[], max: number) =>
    Object.entries(table)
      .filter(([id, weight]) => weight >= TASTE_LEARNING.minImplicitWeight && known.includes(id))
      .sort((left, right) => right[1] - left[1])
      .slice(0, max)
      .map(([id]) => id);
  const selection: TasteSelection = {
    categories: pick(categories, tasteCategoryIds, TASTE_LEARNING.maxImplicitCategories),
    tags: pick(tags, tasteTagIds, TASTE_LEARNING.maxImplicitTags),
  };
  return { tags, categories, dismissedEditIds, rejectedTags, selection };
}

