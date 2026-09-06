import { computeRoute } from "./google-routes";
import {
  isGooglePlacesConfigured,
  resolvePlacePhotoUrl,
  searchPlaces,
  type GooglePlace,
  type GooglePlaceOpeningPeriod,
  type GooglePlaceTypeFilter,
} from "./google-places";
import { runKinSearch, type KinSearchCitation, type KinSearchRequest } from "./kin-search";

const MAX_TRIP_DAYS = 10;

export type KinTravelSlot = "COFFEE" | "BREAKFAST" | "LUNCH" | "DINNER";

export type KinTravelPlace = Omit<GooglePlace, "photoRef" | "openingPeriods" | "primaryType" | "types"> & {
  photoUrl: string | null;
  photoAttribution: string | null;
  slot: KinTravelSlot | null;
  suggestedTime: string | null;
};

type TravelPlaceCandidate = GooglePlace & { requestedSlot: KinTravelSlot | null };

/**
 * Resolves at most one real photo per place (Google's photos[0]) to an
 * actual, temporary media URL — never fabricated, and simply null when the
 * place has no photo or the resolve call fails. Attribution text travels
 * alongside the URL since Google's ToS requires it be shown with the photo.
 */
async function resolvePlace(place: TravelPlaceCandidate, date: string | null): Promise<KinTravelPlace | null> {
  const { photoRef, openingPeriods, primaryType: _primaryType, types: _types, requestedSlot, ...rest } = place;
  const suggestedTime = requestedSlot ? suggestedTimeForSlot(requestedSlot, date, openingPeriods) : null;
  if (requestedSlot && openingPeriods.length > 0 && suggestedTime === null) return null;
  const photoUrl = photoRef ? await resolvePlacePhotoUrl(photoRef.name) : null;
  return { ...rest, photoUrl, photoAttribution: photoUrl ? photoRef!.attributionText : null, slot: requestedSlot, suggestedTime };
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

const SLOT_TIME: Record<KinTravelSlot, { defaultMinutes: number; windowStart: number; windowEnd: number }> = {
  BREAKFAST: { defaultMinutes: 9 * 60, windowStart: 7 * 60, windowEnd: 11 * 60 },
  COFFEE: { defaultMinutes: 10 * 60 + 30, windowStart: 8 * 60, windowEnd: 17 * 60 },
  LUNCH: { defaultMinutes: 13 * 60, windowStart: 12 * 60, windowEnd: 15 * 60 + 30 },
  DINNER: { defaultMinutes: 19 * 60 + 30, windowStart: 17 * 60 + 30, windowEnd: 22 * 60 + 30 },
};

function formatMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function suggestedTimeForSlot(slot: KinTravelSlot, date: string | null, periods: GooglePlaceOpeningPeriod[]): string | null {
  const timing = SLOT_TIME[slot];
  if (periods.length === 0 || !date) return formatMinutes(timing.defaultMinutes);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const dayPeriods = periods.filter((period) => period.open.day === weekday);
  if (dayPeriods.length === 0) return null;
  for (const period of dayPeriods) {
    const open = period.open.hour * 60 + period.open.minute;
    const close = period.close
      ? (period.close.day === weekday ? period.close.hour * 60 + period.close.minute : 24 * 60)
      : 24 * 60;
    if (timing.defaultMinutes >= open && timing.defaultMinutes < close) return formatMinutes(timing.defaultMinutes);
    const adjusted = Math.max(open, timing.windowStart);
    if (adjusted < Math.min(close, timing.windowEnd)) return formatMinutes(adjusted);
  }
  return null;
}

async function placesForRequest(request: KinSearchRequest): Promise<{ status: "ok"; places: TravelPlaceCandidate[] } | { status: "unavailable"; reason: string }> {
  const intents = foodIntentsForRequest(request.query);
  if (intents.length === 0) {
    const result = await searchPlaces(`top attractions and things to do in ${request.destination}`);
    return result.status === "ok"
      ? { status: "ok", places: result.places.map((place) => ({ ...place, requestedSlot: null })) }
      : result;
  }

  const results = await Promise.all(intents.map((intent) =>
    searchPlaces(`${intent.query} in ${request.destination}`, 5, intent.type)
      .then((result) => ({ intent, result })),
  ));
  const places: TravelPlaceCandidate[] = [];
  const used = new Set<string>();
  for (const { intent, result } of results) {
    if (result.status !== "ok") continue;
    const place = result.places.find((candidate) =>
      !used.has(candidate.placeId)
      && (candidate.primaryType === intent.type || candidate.types.includes(intent.type)),
    );
    if (!place) continue;
    used.add(place.placeId);
    places.push({ ...place, requestedSlot: intent.slot });
  }
  return places.length > 0 ? { status: "ok", places } : { status: "unavailable", reason: "no matching food places" };
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
 * more than a handful of legs (at most GOOGLE_PLACES_MAX_RESULTS - 1 per
 * day), so there is no latency benefit worth the added request-spike risk.
 * A leg Google can't resolve is omitted entirely — never a guessed distance
 * or duration.
 */
async function routesForDay(places: KinTravelPlace[]): Promise<KinTravelRoute[]> {
  const routes: KinTravelRoute[] = [];
  for (let i = 0; i < places.length - 1; i++) {
    const from = places[i];
    const to = places[i + 1];
    if (from.lat === null || from.lng === null || to.lat === null || to.lng === null) continue;
    const result = await computeRoute({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng });
    if (result.status === "ok" && result.route) {
      routes.push({ fromPlaceId: from.placeId, toPlaceId: to.placeId, distanceMeters: result.route.distanceMeters, durationSeconds: result.route.durationSeconds });
    }
  }
  return routes;
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

  const placesResult = await placesForRequest(request);
  if (placesResult.status !== "ok") return { status: "unavailable", reason: placesResult.reason };

  const searchResult = await runKinSearch(request, myThingsItemContext, undefined, correlationId);
  if (searchResult.status !== "ok") return { status: "unavailable", reason: searchResult.reason ?? "incomplete recommendation" };
  if (!isValidTravelNarrative(searchResult.answer)) return { status: "unavailable", reason: "invalid travel narrative" };

  const candidates = placesResult.places;
  const dayCount = dayCountFor(request.startDate, request.endDate);
  const buckets = distributePlaces(candidates, dayCount);
  const days: KinTravelDay[] = [];
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const date = dateForDay(request.startDate, dayIndex);
    const resolved = await Promise.all(buckets[dayIndex].map((place) => resolvePlace(place, date)));
    const dayPlaces = resolved.filter((place): place is KinTravelPlace => place !== null);
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
  | { status: "ok"; place: KinTravelPlace }
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
  }[slot] : null;
  const placesResult = await searchPlaces(
    intent ? `${intent.query} in ${destination}` : `top attractions and things to do in ${destination}`,
    SWAP_CANDIDATE_POOL_SIZE,
    intent?.type as GooglePlaceTypeFilter | undefined,
  );
  if (placesResult.status !== "ok") return { status: "unavailable", reason: placesResult.reason };
  const excluded = new Set(excludePlaceIds);
  const alternatives = placesResult.places.filter((place) => !excluded.has(place.placeId));
  for (const alternative of alternatives) {
    if (intent && alternative.primaryType !== intent.type && !alternative.types.includes(intent.type)) continue;
    const place = await resolvePlace({ ...alternative, requestedSlot: slot }, date);
    if (place) return { status: "ok", place };
  }
  return { status: "unavailable", reason: "no alternative available" };
}
