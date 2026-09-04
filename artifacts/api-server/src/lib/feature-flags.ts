import { db, featureFlags } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Every flag a client or server code path may ever query is declared here
 * first. A row in the `feature_flags` table only ever overrides an already
 * -declared definition's default; an unknown key is always rejected as
 * "unknown flag" by both the admin routes and isFeatureEnabled below.
 *
 * Report, Block, and Mute are intentionally never declared here — that is
 * the structural guarantee that they cannot be disabled through this
 * system, not merely a policy choice enforced at request time. See also
 * PROTECTED_FLAG_KEYS, a defense-in-depth check against ever registering
 * (or being asked to toggle) one of those subsystems by name.
 *
 * defaultEnabled is `true` for every flag defined so far so that existing
 * production behavior is unaffected until an admin deliberately disables
 * one — this registry is a kill switch, not a rollout mechanism.
 */
export const FEATURE_FLAG_DEFINITIONS = [
  {
    key: "google_sign_in",
    description: "Show and allow Google sign-in/sign-up. When disabled, only email/password auth is offered, regardless of Google OAuth environment configuration.",
    defaultEnabled: true,
  },
  {
    key: "notification_preferences",
    description: "Allow members to change their push/email notification preferences in Settings. When disabled, existing stored preferences are left untouched and further changes to them are rejected server-side.",
    defaultEnabled: true,
  },
  {
    key: "my_things",
    description: "Private per-user closet (My Things): a My Things screen under You where members photograph, tag (item type, primary color, optional style/occasion/season/brand), view, and delete their own private closet items. Fully gates both the API and the UI when disabled.",
    defaultEnabled: false,
  },
  {
    key: "closet_item_analysis",
    description: "Automatic clothing-photo analysis in My Things' Add Item: after uploading a photo, suggests item type, primary color, style, occasion, and season via Claude, always shown as editable pre-fills the member must review before saving — never auto-created or auto-saved. Requires my_things to also be enabled. Each upload may be analyzed at most once, enforced durably in the database (closet_media_uploads.analysis_attempted_at).",
    defaultEnabled: false,
  },
  {
    key: "kin_search",
    description: "KIN: the central nav entry point for natural-language Looks/Travel requests, backed by an authenticated server endpoint that calls Claude with Anthropic's live web-search tool. Nothing is persisted — no search text, results, or wardrobe context is stored anywhere. Has no per-request/per-user rate limit yet beyond this flag, so keep disabled outside of controlled testing until a durable limiter (mirroring closet_item_analysis's) ships in a follow-up PR.",
    defaultEnabled: false,
  },
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_DEFINITIONS)[number]["key"];

const DEFINITIONS_BY_KEY = new Map<string, (typeof FEATURE_FLAG_DEFINITIONS)[number]>(
  FEATURE_FLAG_DEFINITIONS.map((definition) => [definition.key, definition]),
);

/**
 * Defense-in-depth only: these keys can never be registered as flags above
 * without also editing this file, and the PUT handler rejects any of them
 * outright even if a future edit ever added one by mistake. The actual
 * guarantee is structural (they are simply never declared above).
 */
export const PROTECTED_FLAG_KEYS = new Set(["report", "reports", "block", "blocks", "mute", "mutes"]);

export function isKnownFlagKey(key: string): key is FeatureFlagKey {
  return DEFINITIONS_BY_KEY.has(key);
}

export function featureFlagDefinition(key: string) {
  return DEFINITIONS_BY_KEY.get(key);
}

/**
 * Falls back to the definition's default (never throws) if the database is
 * unreachable — a flag check must never be a new way for the rest of the
 * app to break. GET /me's signed-out branch in particular must stay a
 * dependency-free 200 even when the database is down, exactly like every
 * other value on that response.
 */
export async function isFeatureEnabled(key: FeatureFlagKey): Promise<boolean> {
  const definition = DEFINITIONS_BY_KEY.get(key);
  if (!definition) return false;
  try {
    const [row] = await db.select({ enabled: featureFlags.enabled }).from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
    return row ? row.enabled : definition.defaultEnabled;
  } catch {
    return definition.defaultEnabled;
  }
}

export async function currentFlagStates(): Promise<Record<FeatureFlagKey, boolean>> {
  const states = {} as Record<FeatureFlagKey, boolean>;
  for (const definition of FEATURE_FLAG_DEFINITIONS) states[definition.key] = definition.defaultEnabled;
  try {
    const rows = await db.select({ key: featureFlags.key, enabled: featureFlags.enabled }).from(featureFlags);
    for (const row of rows) {
      if (row.key in states) states[row.key as FeatureFlagKey] = row.enabled;
    }
  } catch {
    // Fall back to the defaults already populated above.
  }
  return states;
}
