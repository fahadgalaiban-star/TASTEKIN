import { computeRoute } from "./google-routes";
import { isGooglePlacesConfigured, resolvePlacePhotoUrl, searchPlaces, type GooglePlace } from "./google-places";
import { runKinSearch, type KinSearchCitation, type KinSearchRequest } from "./kin-search";

const MAX_TRIP_DAYS = 10;

export type KinTravelPlace = Omit<GooglePlace, "photoRef"> & { photoUrl: string | null; photoAttribution: string | null };

/**
 * Resolves at most one real photo per place (Google's photos[0]) to an
 * actual, temporary media URL — never fabricated, and simply null when the
 * place has no photo or the resolve call fails. Attribution text travels
 * alongside the URL since Google's ToS requires it be shown with the photo.
 */
async function resolvePlace(place: GooglePlace): Promise<KinTravelPlace> {
  const { photoRef, ...rest } = place;
  const photoUrl = photoRef ? await resolvePlacePhotoUrl(photoRef.name) : null;
  return { ...rest, photoUrl, photoAttribution: photoUrl ? photoRef!.attributionText : null };
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

function coordinateDistanceSquared(a: KinTravelPlace, b: KinTravelPlace): number {
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return Number.POSITIVE_INFINITY;
  const latScale = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const lat = a.lat - b.lat;
  const lng = (a.lng - b.lng) * latScale;
  return lat * lat + lng * lng;
}

/** Keeps the first result as the anchor, then follows the nearest unused place. */
export function orderPlacesNearestNeighbour(places: KinTravelPlace[]): KinTravelPlace[] {
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
function distributePlaces(places: KinTravelPlace[], dayCount: number): KinTravelPlace[][] {
  const buckets: KinTravelPlace[][] = Array.from({ length: dayCount }, () => []);
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

  const placesResult = await searchPlaces(`top attractions and things to do in ${request.destination}`);
  if (placesResult.status !== "ok") return { status: "unavailable", reason: placesResult.reason };

  const searchResult = await runKinSearch(request, myThingsItemContext, undefined, correlationId);
  if (searchResult.status !== "ok") return { status: "unavailable", reason: searchResult.reason ?? "incomplete recommendation" };
  if (!isValidTravelNarrative(searchResult.answer)) return { status: "unavailable", reason: "invalid travel narrative" };

  const resolvedPlaces = await Promise.all(placesResult.places.map(resolvePlace));
  if (resolvedPlaces.length === 0) return { status: "unavailable", reason: "invalid travel narrative" };
  const dayCount = dayCountFor(request.startDate, request.endDate);
  const buckets = distributePlaces(resolvedPlaces, dayCount);
  const days: KinTravelDay[] = [];
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const dayPlaces = buckets[dayIndex];
    days.push({
      dayIndex,
      date: dateForDay(request.startDate, dayIndex),
      places: dayPlaces,
      routes: await routesForDay(dayPlaces),
    });
  }

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

export async function swapPlace(destination: string, excludePlaceIds: string[]): Promise<KinTravelSwapResult> {
  if (!isGooglePlacesConfigured()) return { status: "unavailable", reason: "not configured" };
  // A larger candidate pool than the itinerary's own 5 — otherwise every
  // "swap" would just re-see the same 5 places already shown and never
  // find a genuine alternative. Still capped (10, not unbounded), and the
  // member is never shown more than one of these at a time.
  const placesResult = await searchPlaces(`top attractions and things to do in ${destination}`, SWAP_CANDIDATE_POOL_SIZE);
  if (placesResult.status !== "ok") return { status: "unavailable", reason: placesResult.reason };
  const excluded = new Set(excludePlaceIds);
  const alternative = placesResult.places.find((place) => !excluded.has(place.placeId));
  if (!alternative) return { status: "unavailable", reason: "no alternative available" };
  return { status: "ok", place: await resolvePlace(alternative) };
}
