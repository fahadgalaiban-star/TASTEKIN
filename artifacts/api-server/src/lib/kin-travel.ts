import { computeRoute } from "./google-routes";
import {
  GOOGLE_PLACES_MAX_RESULTS,
  isGooglePlacesConfigured,
  resolvePlacePhotoUrl,
  searchPlaces,
  type GooglePlace,
  type GooglePlaceOpeningPeriod,
  type GooglePlaceTypeFilter,
} from "./google-places";
import { runKinSearch, type KinSearchCitation, type KinSearchRequest, type KinTravelInterest } from "./kin-search";

const MAX_TRIP_DAYS = 10;
const MAX_FOOD_CANDIDATES_PER_SLOT = 20;

export type KinTravelSlot = "COFFEE" | "BREAKFAST" | "LUNCH" | "DINNER";

export type KinTravelPlace = Omit<GooglePlace, "photoRef" | "openingPeriods" | "primaryType" | "types"> & {
  photoUrl: string | null;
  photoAttribution: string | null;
  slot: KinTravelSlot | null;
  activityInterest?: ActivityInterest;
  openingHours: string | null;
};

type TravelPlaceCandidate = GooglePlace & { requestedSlot: KinTravelSlot | null; activityInterest?: ActivityInterest };

/**
 * Resolves at most one real photo per place (Google's photos[0]) to an
 * actual, temporary media URL — never fabricated, and simply null when the
 * place has no photo or the resolve call fails. Attribution text travels
 * alongside the URL since Google's ToS requires it be shown with the photo.
 */
async function resolvePlace(place: TravelPlaceCandidate, date: string | null): Promise<KinTravelPlace | null> {
  const { photoRef, openingPeriods, primaryType: _primaryType, types: _types, requestedSlot, activityInterest, ...rest } = place;
  if (requestedSlot && !isOpenForSlot(requestedSlot, date, openingPeriods)) return null;
  const photoUrl = photoRef ? await resolvePlacePhotoUrl(photoRef.name) : null;
  return {
    ...rest,
    photoUrl,
    photoAttribution: photoUrl ? photoRef!.attributionText : null,
    slot: requestedSlot,
    ...(activityInterest ? { activityInterest } : {}),
    openingHours: openingHoursForDate(date, openingPeriods),
  };
}

export type KinTravelRoute = { fromPlaceId: string; toPlaceId: string; distanceMeters: number; durationSeconds: number };

export type KinTravelDay = {
  dayIndex: number;
  date: string | null;
  places: KinTravelPlace[];
  routes: KinTravelRoute[];
};

export type KinTravelPlan = {
  destination: string;
  narrative: string;
  citations: KinSearchCitation[];
  days: KinTravelDay[];
};

export type KinTravelResult =
  | { status: "ok"; plan: KinTravelPlan }
  | { status: "unavailable"; reason: string };

function dayCountFor(startDate?: string, endDate?: string): number {
  if (!startDate || !endDate) return 1;
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  const diffDays = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
  return Math.min(Math.max(diffDays, 1), MAX_TRIP_DAYS);
}

function dateForDay(startDate: string | undefined, dayIndex: number): string | null {
  if (!startDate) return null;
  const start = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const date = new Date(start.getTime() + dayIndex * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

type FoodIntent = { slot: KinTravelSlot; type: GooglePlaceTypeFilter; query: string };
const SLOT_ORDER: Record<KinTravelSlot, number> = { BREAKFAST: 0, COFFEE: 1, LUNCH: 2, DINNER: 3 };

export function foodIntentsForRequest(query: string): FoodIntent[] {
  const intents: FoodIntent[] = [];
  const add = (intent: FoodIntent) => {
    if (!intents.some((existing) => existing.slot === intent.slot)) intents.push(intent);
  };
  if (/\b(coffee|café|cafe|espresso|tea|teahouse)\b|قهوة|مقهى|كافيه|شاي/iu.test(query)) add({ slot: "COFFEE", type: "cafe", query: "coffee and tea shops" });
  if (/\b(breakfast|brunch|bakery|pastry|pastries)\b|فطور|إفطار|مخبز|معجنات/iu.test(query)) add({ slot: "BREAKFAST", type: "bakery", query: "breakfast and bakeries" });
  if (/\b(lunch)\b|غداء/iu.test(query)) add({ slot: "LUNCH", type: "restaurant", query: "restaurants for lunch" });
  if (/\b(dinner|supper|restaurant|restaurants|drink|drinks|cocktails|bar|pub)\b|عشاء|مطعم|مطاعم|مشروبات/iu.test(query)) add({ slot: "DINNER", type: "restaurant", query: "restaurants for dinner and drinks" });
  if (
    intents.length === 0
    && /\b(food|eat|eating|dining|cuisine|culinary|meal|meals|sushi|pizza|pasta|burger|seafood|steak|tacos?)\b|طعام|أكل|مأكولات|وجبة|وجبات/iu.test(query)
  ) {
    add({ slot: "LUNCH", type: "restaurant", query: "restaurants and local food" });
  }
  return intents;
}

/**
 * Deterministic, structured counterpart to foodIntentsForRequest — driven
 * by the guided flow's own interest chips rather than regex over free
 * text. Only breakfast/cafes/dinner are time-slotted (an actual meal
 * schedule); lunch is not one of the approved chips, so it is never
 * produced here — the regex-based legacy path is untouched and keeps its
 * own lunch handling for older clients that still send a free-text query.
 */
function foodIntentsForInterests(interests: KinTravelInterest[]): FoodIntent[] {
  const intents: FoodIntent[] = [];
  if (interests.includes("breakfast")) intents.push({ slot: "BREAKFAST", type: "bakery", query: "breakfast and bakeries" });
  if (interests.includes("cafes")) intents.push({ slot: "COFFEE", type: "cafe", query: "coffee and tea shops" });
  if (interests.includes("dinner")) intents.push({ slot: "DINNER", type: "restaurant", query: "restaurants for dinner and drinks" });
  return intents;
}

export type ActivityInterest = Exclude<KinTravelInterest, "breakfast" | "dinner" | "cafes">;
const ACTIVITY_INTEREST_QUERY: Record<ActivityInterest, { query: string; type?: GooglePlaceTypeFilter }> = {
  museums: { query: "museums", type: "museum" },
  parks: { query: "parks", type: "park" },
  shopping: { query: "shopping areas and markets" },
  hidden_gems: { query: "hidden gems and local favorite spots" },
  gyms: { query: "gyms and fitness centers", type: "gym" },
  pilates: { query: "pilates studios" },
  walking_places: { query: "scenic walking areas and promenades" },
};
function isActivityInterest(interest: KinTravelInterest): interest is ActivityInterest {
  return interest in ACTIVITY_INTEREST_QUERY;
}

const SLOT_WINDOW: Record<KinTravelSlot, { start: number; end: number }> = {
  BREAKFAST: { start: 7 * 60, end: 11 * 60 },
  COFFEE: { start: 8 * 60, end: 17 * 60 },
  LUNCH: { start: 12 * 60, end: 15 * 60 + 30 },
  DINNER: { start: 17 * 60 + 30, end: 22 * 60 + 30 },
};

function formatMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function openingHoursForDate(date: string | null, periods: GooglePlaceOpeningPeriod[]): string | null {
  if (periods.length === 0 || !date) return null;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const intervals = openingIntervalsForWeekday(weekday, periods);
  if (intervals.length === 0) return null;
  if (intervals.some((interval) => interval.start === 0 && interval.end === 24 * 60)) return "Open 24 hours";
  return intervals.map((interval) => `${formatMinutes(interval.start)}–${formatMinutes(interval.end)}`).join(", ");
}

function isOpenForSlot(slot: KinTravelSlot, date: string | null, periods: GooglePlaceOpeningPeriod[]): boolean {
  if (periods.length === 0 || !date) return true;
  const window = SLOT_WINDOW[slot];
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return openingIntervalsForWeekday(weekday, periods).some((interval) =>
    Math.max(interval.start, window.start) < Math.min(interval.end, window.end),
  );
}

function openingIntervalsForWeekday(
  weekday: number,
  periods: GooglePlaceOpeningPeriod[],
): Array<{ start: number; end: number }> {
  if (periods.some((period) => period.close === null)) return [{ start: 0, end: 24 * 60 }];
  const intervals: Array<{ start: number; end: number }> = [];
  for (const period of periods) {
    if (!period.close) continue;
    if (period.open.day === weekday) {
      const start = period.open.hour * 60 + period.open.minute;
      const end = period.close.day === weekday
        ? period.close.hour * 60 + period.close.minute
        : 24 * 60;
      if (end > start) intervals.push({ start, end });
    }
    if (period.close.day === weekday && period.open.day !== weekday) {
      const end = period.close.hour * 60 + period.close.minute;
      if (end > 0) intervals.push({ start: 0, end });
    }
  }
  return intervals.sort((a, b) => a.start - b.start);
}

/**
 * Shared day-by-day meal scheduler — used by both the legacy regex-derived
 * food intents (free-text query) and the new structured interest chips.
 * Each requested slot must resolve to a real, open, not-yet-used-that-day
 * place for every day of the trip; a slot with no eligible candidate fails
 * the whole request rather than silently omitting a meal.
 */
async function foodBucketsForIntents(
  destination: string,
  startDate: string | undefined,
  dayCount: number,
  intents: FoodIntent[],
): Promise<{ status: "ok"; buckets: TravelPlaceCandidate[][]; orderedSlots: KinTravelSlot[] } | { status: "unavailable"; reason: string }> {
  const orderedIntents = [...intents].sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
  const results = await Promise.all(orderedIntents.map((intent) =>
    searchPlaces(`${intent.query} in ${destination}`, MAX_FOOD_CANDIDATES_PER_SLOT, intent.type, false)
      .then((result) => ({ intent, result })),
  ));
  if (results.some(({ result }) => result.status !== "ok")) {
    return { status: "unavailable", reason: "food places unavailable" };
  }

  const buckets: TravelPlaceCandidate[][] = [];
  const usedAcrossTrip = new Set<string>();
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const date = dateForDay(startDate, dayIndex);
    const usedToday = new Set<string>();
    const dayPlaces: TravelPlaceCandidate[] = [];
    for (const { intent, result } of results) {
      if (result.status !== "ok") continue;
      const eligible = result.places.filter((candidate) =>
        !usedToday.has(candidate.placeId)
        && isOpenForSlot(intent.slot, date, candidate.openingPeriods),
      );
      const unused = eligible.filter((candidate) => !usedAcrossTrip.has(candidate.placeId));
      const candidates = unused.length > 0 ? unused : eligible;
      const previous = dayPlaces.at(-1);
      const place = previous && candidates.length > 0
        ? orderPlacesNearestNeighbour([previous, ...candidates])[1]
        : candidates[0];
      if (!place) return { status: "unavailable", reason: `no place available for ${intent.slot.toLowerCase()}` };
      usedToday.add(place.placeId);
      usedAcrossTrip.add(place.placeId);
      dayPlaces.push({ ...place, requestedSlot: intent.slot });
    }
    if (dayPlaces.length !== orderedIntents.length) return { status: "unavailable", reason: "incomplete food schedule" };
    buckets.push(dayPlaces);
  }
  return { status: "ok", buckets, orderedSlots: orderedIntents.map((intent) => intent.slot) };
}

/**
 * Non-time-windowed activity places (museums, parks, shopping, hidden
 * gems, gyms, pilates, walking places) — one search per selected activity
 * interest, merged and deduplicated, then distributed across days the same
 * way the generic "top attractions" fallback already does. These never
 * carry a requestedSlot, so they are never subject to the meal-time
 * opening-hours check in resolvePlace/isOpenForSlot.
 */
async function activityBucketsForInterests(
  destination: string,
  dayCount: number,
  activityInterests: ActivityInterest[],
): Promise<{ status: "ok"; buckets: TravelPlaceCandidate[][] } | { status: "unavailable"; reason: string }> {
  if (activityInterests.length === 0) return { status: "ok", buckets: Array.from({ length: dayCount }, () => []) };
  const results = await Promise.all(activityInterests.map((interest) => {
    const config = ACTIVITY_INTEREST_QUERY[interest];
    return searchPlaces(`${config.query} in ${destination}`, GOOGLE_PLACES_MAX_RESULTS, config.type, false);
  }));
  if (results.some((result) => result.status !== "ok")) {
    return { status: "unavailable", reason: "activity places unavailable" };
  }
  const seen = new Set<string>();
  const merged: TravelPlaceCandidate[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status !== "ok") continue;
    for (const place of result.places) {
      if (!seen.has(place.placeId)) {
        seen.add(place.placeId);
        merged.push({ ...place, requestedSlot: null, activityInterest: activityInterests[index] });
      }
    }
  }
  return { status: "ok", buckets: distributePlaces(merged, dayCount) };
}

/**
 * Structured-interests path: combines a meal schedule (breakfast/cafes/
 * dinner, if selected) with activity places (if selected) for each day.
 * Within a day, breakfast anchors the start and dinner the end, with
 * activities and coffee ordered by geographic proximity in between —
 * deterministic, not a temporal-reasoning attempt.
 */
async function placeBucketsForInterests(
  request: KinSearchRequest,
  dayCount: number,
  interests: KinTravelInterest[],
): Promise<{ status: "ok"; buckets: TravelPlaceCandidate[][]; expectedSlots: KinTravelSlot[] | null } | { status: "unavailable"; reason: string }> {
  const foodIntents = foodIntentsForInterests(interests);
  const activityInterests = interests.filter(isActivityInterest);

  const activityResult = await activityBucketsForInterests(request.destination!, dayCount, activityInterests);
  if (activityResult.status !== "ok") return activityResult;

  if (foodIntents.length === 0) {
    if (activityInterests.length === 0) {
      const result = await searchPlaces(`top attractions and things to do in ${request.destination}`);
      return result.status === "ok"
        ? { status: "ok", buckets: distributePlaces(result.places.map((place) => ({ ...place, requestedSlot: null })), dayCount), expectedSlots: null }
        : result;
    }
    return { status: "ok", buckets: activityResult.buckets, expectedSlots: null };
  }

  const foodResult = await foodBucketsForIntents(request.destination!, request.startDate, dayCount, foodIntents);
  if (foodResult.status !== "ok") return foodResult;

  const buckets: TravelPlaceCandidate[][] = [];
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const dayFood = foodResult.buckets[dayIndex] ?? [];
    const breakfast = dayFood.find((place) => place.requestedSlot === "BREAKFAST");
    const dinner = dayFood.find((place) => place.requestedSlot === "DINNER");
    const foodIds = new Set(dayFood.map((place) => place.placeId));
    const seen = new Set<string>();
    const middle = [...(activityResult.buckets[dayIndex] ?? []).filter((place) => !foodIds.has(place.placeId)), ...dayFood.filter((place) => place.requestedSlot !== "BREAKFAST" && place.requestedSlot !== "DINNER")]
      .filter((place) => !seen.has(place.placeId) && Boolean(seen.add(place.placeId)));
    const orderedMiddle = breakfast
      ? orderPlacesNearestNeighbour([breakfast, ...middle]).slice(1)
      : orderPlacesNearestNeighbour(middle);
    buckets.push([...(breakfast ? [breakfast] : []), ...orderedMiddle, ...(dinner ? [dinner] : [])]);
  }
  return { status: "ok", buckets, expectedSlots: foodResult.orderedSlots };
}

async function placeBucketsForRequest(
  request: KinSearchRequest,
  dayCount: number,
): Promise<{ status: "ok"; buckets: TravelPlaceCandidate[][]; expectedSlots: KinTravelSlot[] | null } | { status: "unavailable"; reason: string }> {
  if (request.interests && request.interests.length > 0) {
    return placeBucketsForInterests(request, dayCount, request.interests);
  }

  // Legacy path: no structured interests were sent (an older client) —
  // derive food intents from the free-text query exactly as before.
  const intents = foodIntentsForRequest(request.query);
  if (intents.length === 0) {
    const result = await searchPlaces(`top attractions and things to do in ${request.destination}`);
    return result.status === "ok"
      ? {
          status: "ok",
          buckets: distributePlaces(result.places.map((place) => ({ ...place, requestedSlot: null })), dayCount),
          expectedSlots: null,
        }
      : result;
  }

  const foodResult = await foodBucketsForIntents(request.destination!, request.startDate, dayCount, intents);
  if (foodResult.status !== "ok") return foodResult;
  return { status: "ok", buckets: foodResult.buckets, expectedSlots: foodResult.orderedSlots };
}

type LocatedPlace = { lat: number | null; lng: number | null };

function coordinateDistanceSquared(a: LocatedPlace, b: LocatedPlace): number {
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return Number.POSITIVE_INFINITY;
  const latScale = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const lat = a.lat - b.lat;
  const lng = (a.lng - b.lng) * latScale;
  return lat * lat + lng * lng;
}

/** Keeps the first result as the anchor, then follows the nearest unused place. */
export function orderPlacesNearestNeighbour<T extends LocatedPlace>(places: T[]): T[] {
  if (places.length < 2) return [...places];
  const remaining = places.slice(1);
  const ordered = [places[0]];
  while (remaining.length > 0) {
    const current = ordered[ordered.length - 1];
    let nearestIndex = 0;
    let nearestDistance = coordinateDistanceSquared(current, remaining[0]);
    for (let index = 1; index < remaining.length; index++) {
      const distance = coordinateDistanceSquared(current, remaining[index]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    ordered.push(remaining.splice(nearestIndex, 1)[0]);
  }
  return ordered;
}

/** Splits one geographically ordered chain into contiguous, balanced day groups. */
function distributePlaces<T extends LocatedPlace>(places: T[], dayCount: number): T[][] {
  const buckets: T[][] = Array.from({ length: dayCount }, () => []);
  const ordered = orderPlacesNearestNeighbour(places);
  const baseSize = Math.floor(ordered.length / dayCount);
  const remainder = ordered.length % dayCount;
  let offset = 0;
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const size = baseSize + (dayIndex < remainder ? 1 : 0);
    buckets[dayIndex] = ordered.slice(offset, offset + size);
    offset += size;
  }
  return buckets;
}

const PROGRESS_NARRATION_PATTERNS = [
  /\b(?:i(?:'ll| will)|let me|i need to)\s+(?:resume|continue|start|try|search|look)\b/i,
  /\b(?:resume|continue|keep)\s+(?:searching|looking)\b/i,
  /\b(?:cannot|can't|unable to)\s+access\b.*\b(?:real[- ]?time|web|search)\b/i,
  /\b(?:reanudar[eé]|continuar[eé]|voy a)\b.*\b(?:buscar|b[uú]squeda)\b/i,
  /\bno puedo acceder\b.*\b(?:tiempo real|b[uú]squeda)\b/i,
  /\b(?:je vais|je dois)\b.*\b(?:chercher|rechercher)\b/i,
];

export function isValidTravelNarrative(narrative: string): boolean {
  const trimmed = narrative.trim();
  return trimmed.length >= 20 && !PROGRESS_NARRATION_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Sequential, not parallel — each leg is one Routes API call with its own
 * short timeout and no retry, and a same-destination itinerary never has
 * more than a handful of legs (at most one fewer than the requested slots
 * per food day), so there is no latency benefit worth the request spike.
 * A leg Google can't resolve is omitted entirely — never a guessed distance
 * or duration.
 */
async function routesForDay(places: KinTravelPlace[]): Promise<KinTravelRoute[]> {
  const routes: KinTravelRoute[] = [];
  for (let i = 0; i < places.length - 1; i++) {
    const route = await routeBetween(places[i], places[i + 1]);
    if (route) routes.push(route);
  }
  return routes;
}

type KinTravelNeighbour = { placeId: string; lat: number | null; lng: number | null };

async function routeBetween(from: KinTravelNeighbour, to: KinTravelNeighbour): Promise<KinTravelRoute | null> {
  if (from.lat === null || from.lng === null || to.lat === null || to.lng === null) return null;
  const result = await computeRoute({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng });
  return result.status === "ok" && result.route
    ? { fromPlaceId: from.placeId, toPlaceId: to.placeId, distanceMeters: result.route.distanceMeters, durationSeconds: result.route.durationSeconds }
    : null;
}

/**
 * Combines real Google Places/Routes data with a single Anthropic web
 * -search call (the narrative) into a day-by-day itinerary. Requires
 * Google Maps to be configured — without real places this endpoint has
 * nothing genuine to add over plain KIN Travel search, so it reports
 * unavailable rather than fabricating an itinerary.
 */
export async function runKinTravelPlan(request: KinSearchRequest, myThingsItemContext?: string, correlationId?: string): Promise<KinTravelResult> {
  if (!request.destination) return { status: "unavailable", reason: "destination required" };
  if (!isGooglePlacesConfigured()) return { status: "unavailable", reason: "not configured" };

  const dayCount = dayCountFor(request.startDate, request.endDate);
  const placesResult = await placeBucketsForRequest(request, dayCount);
  if (placesResult.status !== "ok") return { status: "unavailable", reason: placesResult.reason };

  const searchResult = await runKinSearch(request, myThingsItemContext, undefined, correlationId);
  if (searchResult.status !== "ok") return { status: "unavailable", reason: searchResult.reason ?? "incomplete recommendation" };
  if (!isValidTravelNarrative(searchResult.answer)) return { status: "unavailable", reason: "invalid travel narrative" };

  const days: KinTravelDay[] = [];
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const date = dateForDay(request.startDate, dayIndex);
    const resolved = await Promise.all(placesResult.buckets[dayIndex].map((place) => resolvePlace(place, date)));
    const seenPlaceIds = new Set<string>();
    const dayPlaces = resolved
      .filter((place): place is KinTravelPlace => place !== null)
      .filter((place) => !seenPlaceIds.has(place.placeId) && Boolean(seenPlaceIds.add(place.placeId)));
    // A day combining a meal schedule with activity interests legitimately
    // has more places than expectedSlots — this only verifies every
    // requested meal slot resolved to a real, open place, never that the
    // day contains nothing else.
    if (
      placesResult.expectedSlots
      && placesResult.expectedSlots.some((slot) => !dayPlaces.some((place) => place.slot === slot))
    ) {
      return { status: "unavailable", reason: "incomplete food schedule" };
    }
    days.push({
      dayIndex,
      date,
      places: dayPlaces,
      routes: await routesForDay(dayPlaces),
    });
  }
  if (!days.some((day) => day.places.length > 0)) return { status: "unavailable", reason: "invalid travel narrative" };

  return {
    status: "ok",
    plan: { destination: request.destination, narrative: searchResult.answer, citations: searchResult.citations, days },
  };
}

export type KinTravelSwapResult =
  | { status: "ok"; place: KinTravelPlace; routes: KinTravelRoute[] }
  | { status: "unavailable"; reason: string };

/**
 * One real, additional Google Places lookup for the same destination,
 * returning the first result not already present anywhere else in the
 * itinerary (excludePlaceIds). Never fabricates an alternative — if every
 * result Google returns is already in use, this reports unavailable
 * rather than inventing a new place.
 */
const SWAP_CANDIDATE_POOL_SIZE = 10;

export async function swapPlace(
  destination: string,
  excludePlaceIds: string[],
  slot: KinTravelSlot | null = null,
  date: string | null = null,
  previousPlace: KinTravelNeighbour | null = null,
  nextPlace: KinTravelNeighbour | null = null,
  activityInterest: ActivityInterest | null = null,
): Promise<KinTravelSwapResult> {
  if (!isGooglePlacesConfigured()) return { status: "unavailable", reason: "not configured" };
  // A larger candidate pool than the itinerary's own 5 — otherwise every
  // "swap" would just re-see the same 5 places already shown and never
  // find a genuine alternative. Still capped (10, not unbounded), and the
  // member is never shown more than one of these at a time.
  const intent = slot ? {
    COFFEE: { query: "coffee shops", type: "cafe" },
    BREAKFAST: { query: "breakfast and bakeries", type: "bakery" },
    LUNCH: { query: "restaurants for lunch", type: "restaurant" },
    DINNER: { query: "restaurants for dinner", type: "restaurant" },
  }[slot] : activityInterest ? ACTIVITY_INTEREST_QUERY[activityInterest] : null;
  const placesResult = await searchPlaces(
    intent ? `${intent.query} in ${destination}` : `top attractions and things to do in ${destination}`,
    SWAP_CANDIDATE_POOL_SIZE,
    intent?.type as GooglePlaceTypeFilter | undefined,
  );
  if (placesResult.status !== "ok") return { status: "unavailable", reason: placesResult.reason };
  const excluded = new Set(excludePlaceIds);
  const alternatives = placesResult.places.filter((place) => !excluded.has(place.placeId));
  for (const alternative of alternatives) {
    if (intent?.type && alternative.primaryType !== intent.type && !alternative.types.includes(intent.type)) continue;
    const place = await resolvePlace({ ...alternative, requestedSlot: slot, ...(activityInterest ? { activityInterest } : {}) }, date);
    if (place) {
      const routes: KinTravelRoute[] = [];
      if (previousPlace) {
        const previousRoute = await routeBetween(previousPlace, place);
        if (previousRoute) routes.push(previousRoute);
      }
      if (nextPlace) {
        const nextRoute = await routeBetween(place, nextPlace);
        if (nextRoute) routes.push(nextRoute);
      }
      return { status: "ok", place, routes };
    }
  }
  return { status: "unavailable", reason: "no alternative available" };
}
