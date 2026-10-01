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
import {
  runKinSearch,
  runKinStayReasons,
  type KinAccommodationRequest,
  type KinSearchCitation,
  type KinSearchRequest,
  type KinStayBudget,
  type KinStayReasonInput,
  type KinTravelInterest,
} from "./kin-search";
import { logger } from "./logger";
import { venueKindFor, type KinReferralLink, type KinVenueKind } from "./kin-referrals";

const MAX_TRIP_DAYS = 10;
const MAX_FOOD_CANDIDATES_PER_SLOT = 20;

export type KinTravelSlot = "COFFEE" | "BREAKFAST" | "LUNCH" | "DINNER";

export type KinTravelPlace = Omit<GooglePlace, "photoRef" | "openingPeriods" | "primaryType" | "types" | "priceLevel"> & {
  photoUrl: string | null;
  photoAttribution: string | null;
  slot: KinTravelSlot | null;
  activityInterest?: ActivityInterest;
  openingHours: string | null;
  /** Derived from Google's own place types: "restaurant" | "cafe" for somewhere a table can be reserved, null for every other kind of place. */
  venueKind: KinVenueKind | null;
  /** External reservation referral — present only when the kin_travel_restaurant_reservations flag is on AND a partner URL is configured AND the place is a restaurant/café (see lib/kin-referrals.ts). Never emitted otherwise. */
  reservation?: KinReferralLink;
};

type TravelPlaceCandidate = GooglePlace & { requestedSlot: KinTravelSlot | null; activityInterest?: ActivityInterest };

/**
 * Resolves at most one real photo per place (Google's photos[0]) to an
 * actual, temporary media URL — never fabricated, and simply null when the
 * place has no photo or the resolve call fails. Attribution text travels
 * alongside the URL since Google's ToS requires it be shown with the photo.
 */
async function resolvePlace(place: TravelPlaceCandidate, date: string | null): Promise<KinTravelPlace | null> {
  const { photoRef, openingPeriods, primaryType, types, priceLevel: _priceLevel, requestedSlot, activityInterest, ...rest } = place;
  if (requestedSlot && !isOpenForSlot(requestedSlot, date, openingPeriods)) return null;
  const photoUrl = photoRef ? await resolvePlacePhotoUrl(photoRef.name) : null;
  return {
    ...rest,
    photoUrl,
    photoAttribution: photoUrl ? photoRef!.attributionText : null,
    slot: requestedSlot,
    ...(activityInterest ? { activityInterest } : {}),
    openingHours: openingHoursForDate(date, openingPeriods),
    venueKind: venueKindFor(primaryType, types),
  };
}

export type KinTravelRoute = { fromPlaceId: string; toPlaceId: string; distanceMeters: number; durationSeconds: number };

export type KinTravelDay = {
  dayIndex: number;
  date: string | null;
  places: KinTravelPlace[];
  routes: KinTravelRoute[];
};

export type KinStayKind = "hotel" | "apartment";

/** One real Google place offered as somewhere to stay. reason is KIN's one-sentence explanation, or null when none could be produced — never fabricated. */
export type KinTravelStay = {
  kind: KinStayKind;
  placeId: string;
  name: string;
  formattedAddress: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  /** Google's own price level 1–4 (see google-places.ts) — the only price signal available; never a nightly rate. */
  priceLevel: number | null;
  websiteUrl: string | null;
  mapsUrl: string | null;
  photoUrl: string | null;
  photoAttribution: string | null;
  reason: string | null;
  /** Only present when the independent hotel-offers flag is on and a partner match and rate are verified. */
  hotelOffers?: import("./kin-hotel-offers").HotelPriceOffer[];
};

export type KinTravelStayGroup = { items: KinTravelStay[]; hasMore: boolean };

/** Present on a plan only when the member picked Hotels and/or Apartments & Homes; each key only when that kind was picked. */
export type KinTravelStays = { hotels?: KinTravelStayGroup; apartments?: KinTravelStayGroup };

export type KinTravelPlan = {
  destination: string;
  narrative: string;
  citations: KinSearchCitation[];
  days: KinTravelDay[];
  stays?: KinTravelStays;
  /** External referrals — present only when the corresponding flag is on AND a partner is configured (see lib/kin-referrals.ts). */
  referrals?: { carRental?: KinReferralLink };
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
  avoidPlaceIds: ReadonlySet<string> = new Set(),
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
  const preferred: TravelPlaceCandidate[] = [];
  const colliding: TravelPlaceCandidate[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status !== "ok") continue;
    for (const place of result.places) {
      if (!seen.has(place.placeId)) {
        seen.add(place.placeId);
        const candidate = { ...place, requestedSlot: null, activityInterest: activityInterests[index] };
        (avoidPlaceIds.has(place.placeId) ? colliding : preferred).push(candidate);
      }
    }
  }
  // Food is assigned first for combined plans. Prefer activity candidates
  // that are unused anywhere in that meal schedule; only fall back to
  // colliding real results when the provider supplied no distinct activity.
  const candidates = preferred.length > 0 ? preferred : colliding;
  return { status: "ok", buckets: distributePlaces(candidates, dayCount) };
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

  if (foodIntents.length === 0) {
    if (activityInterests.length === 0) {
      const result = await searchPlaces(`top attractions and things to do in ${request.destination}`);
      return result.status === "ok"
        ? { status: "ok", buckets: distributePlaces(result.places.map((place) => ({ ...place, requestedSlot: null })), dayCount), expectedSlots: null }
        : result;
    }
    const activityResult = await activityBucketsForInterests(request.destination!, dayCount, activityInterests);
    if (activityResult.status !== "ok") return activityResult;
    return { status: "ok", buckets: activityResult.buckets, expectedSlots: null };
  }

  const foodResult = await foodBucketsForIntents(request.destination!, request.startDate, dayCount, foodIntents);
  if (foodResult.status !== "ok") return foodResult;
  const tripFoodIds = new Set(foodResult.buckets.flatMap((bucket) => bucket.map((place) => place.placeId)));
  const activityResult = await activityBucketsForInterests(request.destination!, dayCount, activityInterests, tripFoodIds);
  if (activityResult.status !== "ok") return activityResult;

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
 * Combines real Google Places/Routes data with a single Anthropic web-search
 * call (optional supporting narrative) into a day-by-day itinerary. Requires
 * Google Maps to be configured — without real places this endpoint has
 * nothing genuine to add over plain KIN Travel search, so it reports
 * unavailable rather than fabricating an itinerary.
 */
export async function runKinTravelPlan(request: KinSearchRequest, userId: string, myThingsItemContext?: string, correlationId?: string): Promise<KinTravelResult> {
  if (!request.destination) return { status: "unavailable", reason: "destination required" };
  if (!isGooglePlacesConfigured()) return { status: "unavailable", reason: "not configured" };

  const dayCount = dayCountFor(request.startDate, request.endDate);
  const placesResult = await placeBucketsForRequest(request, dayCount);
  if (placesResult.status !== "ok") return { status: "unavailable", reason: placesResult.reason };

  // Stays are looked up alongside the narrative call, not after it — they
  // are independent (different Google queries, their own reasons call), so
  // there is no reason to serialize the two round-trips.
  const [searchResult, stays] = await Promise.all([
    runKinSearch(request, myThingsItemContext, undefined, correlationId),
    request.accommodation ? staysForPlan(userId, request.destination, request.accommodation, request.locale, correlationId) : Promise.resolve(undefined),
  ]);
  if (searchResult.status !== "ok") return { status: "unavailable", reason: searchResult.reason ?? "incomplete recommendation" };

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
  if (!days.some((day) => day.places.length > 0)) return { status: "unavailable", reason: "no places available" };

  return {
    status: "ok",
    plan: { destination: request.destination, narrative: searchResult.answer, citations: searchResult.citations, days, ...(stays ? { stays } : {}) },
  };
}

// --- stays: optional Hotels / Apartments & Homes ---------------------------

export const STAY_PAGE_SIZE = 3;
// Google Text Search's maximum. The whole pool is fetched in one request so
// "Show more stays" pages through real, distinct results by exclusion
// rather than re-querying with a different (invented) query, and hasMore
// turns false the moment the pool is exhausted.
const STAY_CANDIDATE_POOL_SIZE = 20;

const STAY_BUDGET_QUERY_WORDS: Record<KinStayBudget, string> = { 1: "budget-friendly", 2: "mid-range", 3: "luxury" };

type StayIntent = { query: string; type: GooglePlaceTypeFilter; budget: KinStayBudget | undefined };

/**
 * Deterministic mapping from the closed preference enums to one Google
 * Places text search per kind. Star class is not a field Places API (New)
 * exposes, so the star preference shapes the query text ("4-star hotels")
 * and the card shows Google's real user rating, never a claimed class.
 */
export function stayIntentFor(kind: KinStayKind, accommodation: KinAccommodationRequest, destination: string): StayIntent {
  if (kind === "hotel") {
    const prefs = accommodation.hotels ?? {};
    const words = [prefs.budget ? STAY_BUDGET_QUERY_WORDS[prefs.budget] : null, prefs.stars ? `${prefs.stars}-star` : null, "hotels"].filter(Boolean);
    return { query: `${words.join(" ")} in ${destination}`, type: "hotel", budget: prefs.budget };
  }
  const prefs = accommodation.apartments ?? {};
  const subject = prefs.stayType === "entire_home" ? "entire home vacation rentals"
    : prefs.stayType === "private_room" ? "private room guest houses and bed and breakfasts"
    : prefs.stayType === "apartment" ? "serviced apartments and apartment hotels"
    : "apartments and vacation rentals";
  const words = [prefs.budget ? STAY_BUDGET_QUERY_WORDS[prefs.budget] : null, subject].filter(Boolean);
  return { query: `${words.join(" ")} in ${destination}`, type: prefs.stayType === "private_room" ? "guest_house" : "lodging", budget: prefs.budget };
}

/** $ ↔ Google "inexpensive", $$ ↔ "moderate", $$$ ↔ "expensive"/"very expensive"; an unknown level never disqualifies a real place. */
function matchesStayBudget(budget: KinStayBudget | undefined, priceLevel: number | null): boolean {
  if (budget === undefined || priceLevel === null) return true;
  return budget === 3 ? priceLevel >= 3 : priceLevel === budget;
}

/** Stable: Google's own relevance order is kept, but places whose real price level contradicts the stated budget move after the ones that fit or are unknown. */
function rankStayCandidates(candidates: GooglePlace[], budget: KinStayBudget | undefined): GooglePlace[] {
  return [
    ...candidates.filter((candidate) => matchesStayBudget(budget, candidate.priceLevel)),
    ...candidates.filter((candidate) => !matchesStayBudget(budget, candidate.priceLevel)),
  ];
}

async function resolveStay(kind: KinStayKind, place: GooglePlace): Promise<KinTravelStay> {
  const photoUrl = place.photoRef ? await resolvePlacePhotoUrl(place.photoRef.name) : null;
  return {
    kind,
    placeId: place.placeId,
    name: place.name,
    formattedAddress: place.formattedAddress,
    lat: place.lat,
    lng: place.lng,
    rating: place.rating,
    priceLevel: place.priceLevel,
    websiteUrl: place.websiteUrl,
    mapsUrl: place.mapsUrl,
    photoUrl,
    photoAttribution: photoUrl ? place.photoRef!.attributionText : null,
    reason: null,
  };
}

/**
 * The candidate pool for one (member, destination, kind, preferences,
 * locale): Google's ranked results plus KIN's reason for every one of them,
 * produced once. "Show more stays" pages through this — it never re-runs
 * the Places search or the reasons call while the pool is alive, and it
 * consumes no daily-quota attempt on a hit (see routes/kin.ts). Kept in
 * process memory with a TTL and a size cap; on a miss (expired, evicted,
 * or another autoscale instance) the providers are called once more, and
 * that miss is the only case that costs a quota attempt.
 */
type StayPool = { candidates: GooglePlace[]; reasons: Map<string, string | null>; expiresAt: number };
const STAY_POOL_TTL_MS = 60 * 60 * 1000;
const STAY_POOL_MAX_ENTRIES = 500;
const stayPools = new Map<string, StayPool>();

function stayPoolKey(userId: string, destination: string, kind: KinStayKind, accommodation: KinAccommodationRequest, locale: "en" | "ar" | undefined): string {
  const prefs = kind === "hotel" ? accommodation.hotels ?? {} : accommodation.apartments ?? {};
  return [userId, destination.trim().toLowerCase(), kind, JSON.stringify(prefs), locale ?? ""].join("|");
}

function getStayPool(key: string): StayPool | null {
  const pool = stayPools.get(key);
  if (!pool) return null;
  if (pool.expiresAt <= Date.now()) { stayPools.delete(key); return null; }
  return pool;
}

function setStayPool(key: string, pool: StayPool): void {
  if (!stayPools.has(key) && stayPools.size >= STAY_POOL_MAX_ENTRIES) {
    const oldest = stayPools.keys().next().value;
    if (oldest !== undefined) stayPools.delete(oldest);
  }
  stayPools.set(key, pool);
}

/** Whether "Show more stays" can be served without any provider call — the route reserves a quota attempt only when this is false. */
export function hasCachedStayPool(userId: string, destination: string, kind: KinStayKind, accommodation: KinAccommodationRequest, locale: "en" | "ar" | undefined): boolean {
  return getStayPool(stayPoolKey(userId, destination, kind, accommodation, locale)) !== null;
}

/** An offer refresh may only use a Google hotel previously found in this member's cached hotel search. */
export function getCachedHotelPlace(
  userId: string,
  destination: string,
  accommodation: KinAccommodationRequest,
  locale: "en" | "ar" | undefined,
  googlePlaceId: string,
): GooglePlace | null {
  const pool = getStayPool(stayPoolKey(userId, destination, "hotel", accommodation, locale));
  return pool?.candidates.find((place) => place.placeId === googlePlaceId) ?? null;
}

/** Test-only: forget every cached pool so a fresh process state can be simulated. */
export function clearStayPoolsForTests(): void {
  stayPools.clear();
}

type StayCandidatesResult = { status: "ok"; candidates: GooglePlace[] } | { status: "unavailable"; reason: string };

/** One Google Places text search for the whole ranked, deduplicated pool of one kind. */
async function fetchStayCandidates(destination: string, kind: KinStayKind, accommodation: KinAccommodationRequest): Promise<StayCandidatesResult> {
  const intent = stayIntentFor(kind, accommodation, destination);
  const result = await searchPlaces(intent.query, STAY_CANDIDATE_POOL_SIZE, intent.type, false);
  if (result.status !== "ok") return { status: "unavailable", reason: `${kind} stays unavailable: ${result.reason}` };
  const seen = new Set<string>();
  const candidates = rankStayCandidates(result.places, intent.budget).filter((place) => !seen.has(place.placeId) && Boolean(seen.add(place.placeId)));
  return { status: "ok", candidates };
}

/**
 * One Anthropic call for every candidate of every pool given — never one
 * per stay, per page, or per kind. Keyed by kind + placeId (the same place
 * can legitimately appear in both kinds' pools). A line the model skipped
 * is null, never invented.
 */
async function reasonsForPools(
  destination: string,
  accommodation: KinAccommodationRequest,
  locale: "en" | "ar" | undefined,
  pools: Array<{ kind: KinStayKind; candidates: GooglePlace[] }>,
  correlationId?: string,
): Promise<Map<string, string | null>> {
  const inputs = pools.flatMap(({ kind, candidates }) => candidates.map((place) => ({ kind, place })));
  const byKey = new Map<string, string | null>();
  if (inputs.length === 0) return byKey;
  const stays: KinStayReasonInput[] = inputs.map(({ kind, place }) => ({
    kind, name: place.name, formattedAddress: place.formattedAddress, rating: place.rating, priceLevel: place.priceLevel, types: place.types,
  }));
  const reasons = await runKinStayReasons({ destination, accommodation, locale, stays }, correlationId);
  inputs.forEach(({ kind, place }, index) => byKey.set(`${kind}:${place.placeId}`, reasons.get(index) ?? null));
  return byKey;
}

function poolReasonsForKind(byKey: Map<string, string | null>, kind: KinStayKind, candidates: GooglePlace[]): Map<string, string | null> {
  return new Map(candidates.map((place) => [place.placeId, byKey.get(`${kind}:${place.placeId}`) ?? null]));
}

/** The next STAY_PAGE_SIZE candidates not already shown, with only their photos resolved now (Google photo URLs are short-lived, so they are never cached). */
async function pageFromPool(kind: KinStayKind, pool: StayPool, excludePlaceIds: ReadonlySet<string>): Promise<KinTravelStayGroup> {
  const fresh = pool.candidates.filter((place) => !excludePlaceIds.has(place.placeId));
  const page = fresh.slice(0, STAY_PAGE_SIZE);
  const items = await Promise.all(page.map((place) => resolveStay(kind, place)));
  for (const stay of items) stay.reason = pool.reasons.get(stay.placeId) ?? null;
  return { items, hasMore: fresh.length > page.length };
}

/**
 * The plan's initial stays: one pool per picked kind, fetched in parallel,
 * then a single reasons call covering every candidate of both — cached so
 * paging costs nothing further. A kind whose lookup fails is returned
 * empty (and logged) rather than failing the itinerary — the member still
 * gets their days; the section simply has nothing to show.
 */
async function staysForPlan(userId: string, destination: string, accommodation: KinAccommodationRequest, locale: "en" | "ar" | undefined, correlationId?: string): Promise<KinTravelStays> {
  const kinds: KinStayKind[] = [...(accommodation.hotels ? ["hotel" as const] : []), ...(accommodation.apartments ? ["apartment" as const] : [])];
  const results = await Promise.all(kinds.map((kind) => fetchStayCandidates(destination, kind, accommodation)));
  const fetched = kinds.map((kind, index) => ({ kind, result: results[index] }));
  const byKey = await reasonsForPools(
    destination, accommodation, locale,
    fetched.flatMap(({ kind, result }) => result.status === "ok" ? [{ kind, candidates: result.candidates }] : []),
    correlationId,
  );
  const groups = await Promise.all(fetched.map(async ({ kind, result }): Promise<[KinStayKind, KinTravelStayGroup]> => {
    if (result.status !== "ok") {
      logger.warn({ correlationId: correlationId ?? null, kind, reason: result.reason }, "KIN travel: stay lookup unavailable");
      return [kind, { items: [], hasMore: false }];
    }
    const pool: StayPool = { candidates: result.candidates, reasons: poolReasonsForKind(byKey, kind, result.candidates), expiresAt: Date.now() + STAY_POOL_TTL_MS };
    setStayPool(stayPoolKey(userId, destination, kind, accommodation, locale), pool);
    return [kind, await pageFromPool(kind, pool, new Set())];
  }));
  const stays: KinTravelStays = {};
  for (const [kind, group] of groups) {
    if (kind === "hotel") stays.hotels = group; else stays.apartments = group;
  }
  return stays;
}

export type KinTravelStaysResult = { status: "ok"; group: KinTravelStayGroup } | { status: "unavailable"; reason: string };

/**
 * "Show more stays": the next page of one kind from the cached pool,
 * excluding everything already shown. Only on a pool miss are the Places
 * search and the reasons call made (once, for the whole pool). Never
 * touches the itinerary.
 */
export async function searchStays(
  userId: string,
  destination: string,
  kind: KinStayKind,
  accommodation: KinAccommodationRequest,
  excludePlaceIds: ReadonlySet<string>,
  locale: "en" | "ar" | undefined,
  correlationId?: string,
): Promise<KinTravelStaysResult> {
  if (!isGooglePlacesConfigured()) return { status: "unavailable", reason: "not configured" };
  const key = stayPoolKey(userId, destination, kind, accommodation, locale);
  let pool = getStayPool(key);
  if (!pool) {
    const result = await fetchStayCandidates(destination, kind, accommodation);
    if (result.status !== "ok") return result;
    const byKey = await reasonsForPools(destination, accommodation, locale, [{ kind, candidates: result.candidates }], correlationId);
    pool = { candidates: result.candidates, reasons: poolReasonsForKind(byKey, kind, result.candidates), expiresAt: Date.now() + STAY_POOL_TTL_MS };
    setStayPool(key, pool);
  }
  return { status: "ok", group: await pageFromPool(kind, pool, excludePlaceIds) };
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
