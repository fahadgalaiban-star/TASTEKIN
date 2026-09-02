import { ANALYTICS_EVENT_NAMES, type AnalyticsEventName } from "@workspace/db";

/**
 * Strict per-event metadata allowlist. This is the single place that
 * decides what shape of metadata is ever accepted for a given event name —
 * anything not explicitly validated here is rejected, not merely dropped,
 * so a client bug can never silently smuggle unexpected fields into
 * storage. Every validator here only ever returns small, categorical,
 * non-identifying values: never message contents, report/mute/block
 * targets, passwords, emails, or raw free-text (including search text).
 */
type Validator = (metadata: Record<string, unknown>) => Record<string, unknown> | null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeIdString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(value);
}

const noMetadata: Validator = (metadata) => (Object.keys(metadata).length === 0 ? {} : null);

const homeViewed: Validator = (metadata) => {
  const keys = Object.keys(metadata);
  if (keys.length === 0) return {};
  if (keys.length !== 1 || !isSafeIdString(metadata.tab)) return null;
  return { tab: metadata.tab };
};

const exploreSearchPerformed: Validator = (metadata) => {
  const keys = new Set(Object.keys(metadata));
  if (!keys.has("hasQuery") || typeof metadata.hasQuery !== "boolean") return null;
  keys.delete("hasQuery");
  const result: Record<string, unknown> = { hasQuery: metadata.hasQuery };
  if (keys.has("category")) {
    if (metadata.category !== null && !isSafeIdString(metadata.category)) return null;
    result.category = metadata.category;
    keys.delete("category");
  }
  if (keys.size > 0) return null;
  return result;
};

const creatorProfileViewed: Validator = (metadata) => {
  const keys = new Set(Object.keys(metadata));
  if (!keys.has("creatorId") || !isSafeIdString(metadata.creatorId)) return null;
  keys.delete("creatorId");
  if (keys.size > 0) return null;
  return { creatorId: metadata.creatorId };
};

const editViewed: Validator = (metadata) => {
  const keys = new Set(Object.keys(metadata));
  if (!keys.has("editId") || !isSafeIdString(metadata.editId)) return null;
  keys.delete("editId");
  if (keys.has("creatorId")) {
    if (!isSafeIdString(metadata.creatorId)) return null;
    keys.delete("creatorId");
  }
  if (keys.size > 0) return null;
  const result: Record<string, unknown> = { editId: metadata.editId };
  if ("creatorId" in metadata) result.creatorId = metadata.creatorId;
  return result;
};

const EVENT_VALIDATORS: Record<AnalyticsEventName, Validator> = {
  onboarding_started: noMetadata,
  onboarding_completed: noMetadata,
  home_viewed: homeViewed,
  explore_viewed: noMetadata,
  explore_search_performed: exploreSearchPerformed,
  creator_profile_viewed: creatorProfileViewed,
  edit_viewed: editViewed,
  save_added: editViewed,
  save_removed: editViewed,
  follow_added: creatorProfileViewed,
  follow_removed: creatorProfileViewed,
  subscription_started: noMetadata,
  subscription_completed: noMetadata,
};

const EVENT_NAME_SET = new Set<string>(ANALYTICS_EVENT_NAMES);

export function isKnownAnalyticsEvent(name: string): name is AnalyticsEventName {
  return EVENT_NAME_SET.has(name);
}

/** Returns the sanitized metadata object to store, or null if invalid. */
export function validateAnalyticsMetadata(name: AnalyticsEventName, metadata: unknown): Record<string, unknown> | null {
  if (!isPlainObject(metadata)) return null;
  return EVENT_VALIDATORS[name](metadata);
}

const DEDUPE_WINDOW_MS = 2_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_EVENTS = 120;

const recentEventKeys = new Map<string, number>();
const rateLimitBuckets = new Map<string, { windowStart: number; count: number }>();

function subjectKey(userId: string | null, req: { ip?: string }): string {
  return userId ?? `anon:${req.ip ?? "unknown"}`;
}

/**
 * Best-effort in-process duplicate + rate guards. Deliberately lightweight
 * (no advisory locks, no cross-instance coordination) because analytics is
 * not safety-critical: an occasional race just means one extra or one
 * fewer row, never an inconsistent or unsafe state.
 */
export function shouldAcceptAnalyticsEvent(name: string, userId: string | null, req: { ip?: string }): boolean {
  const subject = subjectKey(userId, req);
  const now = Date.now();

  const bucket = rateLimitBuckets.get(subject);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(subject, { windowStart: now, count: 1 });
  } else {
    bucket.count += 1;
    if (bucket.count > RATE_LIMIT_MAX_EVENTS) return false;
  }

  const dedupeKey = `${subject}:${name}`;
  const lastSeen = recentEventKeys.get(dedupeKey);
  if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) return false;
  recentEventKeys.set(dedupeKey, now);

  if (recentEventKeys.size > 10_000) {
    for (const [key, seenAt] of recentEventKeys) {
      if (now - seenAt > DEDUPE_WINDOW_MS) recentEventKeys.delete(key);
    }
  }
  if (rateLimitBuckets.size > 10_000) {
    for (const [key, value] of rateLimitBuckets) {
      if (now - value.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitBuckets.delete(key);
    }
  }

  return true;
}
