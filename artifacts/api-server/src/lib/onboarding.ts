import { creatorWorkspaces, db, userTastePreferences, usersTable } from "@workspace/db";
import { isCompleteTasteProfile } from "@workspace/taste-catalog";
import { eq } from "drizzle-orm";

export const ONBOARDING_STEPS = ["basics", "photo", "city", "taste", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

function isKnownStep(value: string): value is OnboardingStep {
  return (ONBOARDING_STEPS as readonly string[]).includes(value);
}

/**
 * Onboarding must never be forced on an existing user. Admin and verified
 * accounts are exempt outright (explicit product requirement, checked first
 * so it never depends on workspace data existing).
 *
 * Real edits/collections are the one other signal used here, because
 * onboarding itself can never produce them — the wizard only ever touches
 * profile fields (displayName/username/city/avatar) and taste preferences,
 * so a workspace with actual published content is unambiguous evidence of
 * an account that predates this feature.
 *
 * Deliberately NOT used here: creator_workspaces.revision or saved taste
 * preferences. Both of those are things onboarding's own steps legitimately
 * produce as a new user progresses (the basics step's own save bumps
 * revision; the taste step's own save is what fills user_taste_preferences)
 * — treating either as "already established" would retroactively complete
 * onboarding out from under a user who is still in the middle of it. The
 * remaining gap (an existing account that saved a profile once, long ago,
 * but has no edits/admin/verified flag) is covered by the one-time,
 * operator-run scripts/src/backfill-onboarding.ts instead.
 */
async function isEstablishedAccount(userId: string, account: { isAdmin: boolean; isVerified: boolean }) {
  if (account.isAdmin || account.isVerified) return true;

  const [workspace] = await db.select({
    edits: creatorWorkspaces.edits,
    collections: creatorWorkspaces.collections,
  }).from(creatorWorkspaces).where(eq(creatorWorkspaces.ownerUserId, userId)).limit(1);
  if (workspace && (workspace.edits.length > 0 || workspace.collections.length > 0)) return true;

  return false;
}

export type OnboardingStatus = { needsOnboarding: boolean; step: OnboardingStep };

export async function resolveOnboardingStatus(userId: string): Promise<OnboardingStatus> {
  const [account] = await db.select({
    isAdmin: usersTable.isAdmin,
    isVerified: usersTable.isVerified,
    onboardingStep: usersTable.onboardingStep,
    onboardingCompletedAt: usersTable.onboardingCompletedAt,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!account) return { needsOnboarding: false, step: "done" };
  if (account.onboardingCompletedAt) return { needsOnboarding: false, step: "done" };

  if (await isEstablishedAccount(userId, account)) {
    await db.update(usersTable)
      .set({ onboardingStep: "done", onboardingCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
    return { needsOnboarding: false, step: "done" };
  }

  const step = isKnownStep(account.onboardingStep) ? account.onboardingStep : "basics";
  return { needsOnboarding: step !== "done", step };
}

export type AdvanceResult =
  | { ok: true; step: OnboardingStep; completed: boolean }
  | { ok: false; error: string };

/**
 * Advances the caller's own onboarding by exactly one step, from whatever
 * step the server currently has on record — never a step the client names,
 * so a request can only ever move forward from truth already stored server-
 * side. Each step's precondition is re-checked here, not trusted from the
 * client, matching the rest of this app's server-authorized posture.
 */
export async function advanceOnboardingStep(userId: string): Promise<AdvanceResult> {
  const status = await resolveOnboardingStatus(userId);
  if (!status.needsOnboarding) return { ok: true, step: "done", completed: true };

  if (status.step === "basics") {
    const [workspace] = await db.select({ revision: creatorWorkspaces.revision, profile: creatorWorkspaces.profile })
      .from(creatorWorkspaces).where(eq(creatorWorkspaces.ownerUserId, userId)).limit(1);
    const savedAtLeastOnce = Boolean(workspace && workspace.revision > 1 && workspace.profile.displayName.trim());
    if (!savedAtLeastOnce) return { ok: false, error: "Save your display name and username first." };
  }

  if (status.step === "taste") {
    const [taste] = await db.select({ categories: userTastePreferences.categories, tags: userTastePreferences.tags })
      .from(userTastePreferences).where(eq(userTastePreferences.userId, userId)).limit(1);
    if (!taste || !isCompleteTasteProfile(taste.categories, taste.tags)) {
      return { ok: false, error: "Choose at least one taste category to continue." };
    }
  }

  const currentIndex = ONBOARDING_STEPS.indexOf(status.step);
  const next = ONBOARDING_STEPS[currentIndex + 1];
  const completed = next === "done";
  await db.update(usersTable)
    .set({ onboardingStep: next, onboardingCompletedAt: completed ? new Date() : null, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));
  return { ok: true, step: next, completed };
}
