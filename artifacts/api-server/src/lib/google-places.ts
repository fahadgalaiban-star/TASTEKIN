const PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
export const GOOGLE_PLACES_TIMEOUT_MS = 8_000;
export const GOOGLE_PLACES_MAX_RESULTS = 5;
export const PLACES_PHOTO_MAX_WIDTH_PX = 800;
const MAX_QUERY_LENGTH = 300;

// Minimal field mask — only what KIN Travel ever renders. Every field
// costs money on Google's Places API (New) pricing tiers, so nothing
// beyond this list is ever requested. photos is included so a real place
// photo can be shown (see resolvePlacePhoto) — only photos[0]'s name and
// attribution are ever read.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.photos",
].join(",");

/**
 * Lazily read, never at module import time — a missing key must never
 * crash server startup. Never logged, never echoed in any response.
 */
function googleMapsApiKey(): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  return key || null;
}

export function isGooglePlacesConfigured(): boolean {
  return googleMapsApiKey() !== null;
}

/** true only for a well-formed https:// URL — mirrors kin-search.ts's identical check. */
function isValidHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Google requires the photo's author attribution to be shown alongside it
 * (Places API ToS) — carried through as plain text/link, never dropped.
 */
export type GooglePlacePhotoRef = { name: string; attributionText: string | null; attributionUri: string | null };

export type GooglePlace = {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  websiteUrl: string | null;
  mapsUrl: string | null;
  photoRef: GooglePlacePhotoRef | null;
};

export type GooglePlacesResult =
  | { status: "ok"; places: GooglePlace[] }
  | { status: "unavailable"; reason: string };

function firstPhotoRef(item: Record<string, unknown>): GooglePlacePhotoRef | null {
  const photos = item.photos;
  if (!Array.isArray(photos) || photos.length === 0) return null;
  const photo = photos[0] as Record<string, unknown> | undefined;
  if (!photo || typeof photo.name !== "string") return null;
  const attributions = photo.authorAttributions;
  const first = Array.isArray(attributions) ? (attributions[0] as Record<string, unknown> | undefined) : undefined;
  return {
    name: photo.name,
    attributionText: first && typeof first.displayName === "string" ? first.displayName : null,
    attributionUri: first && typeof first.uri === "string" && isValidHttpsUrl(first.uri) ? first.uri : null,
  };
}

/**
 * Only ever reads fields Google's own typed response actually supplied —
 * anything absent is omitted (null), never defaulted or guessed. No place
 * lacking both an id and a name is ever kept, since that would produce a
 * card with nothing genuine to show.
 */
function normalizePlacesResponse(payload: unknown, maxResults: number): GooglePlace[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { places?: unknown }).places)) {
    return [];
  }
  const places: GooglePlace[] = [];
  for (const raw of (payload as { places: unknown[] }).places) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const placeId = typeof item.id === "string" ? item.id : null;
    const displayName = item.displayName as { text?: unknown } | undefined;
    const name = displayName && typeof displayName.text === "string" ? displayName.text : null;
    if (!placeId || !name) continue;
    const location = item.location as { latitude?: unknown; longitude?: unknown } | undefined;
    places.push({
      placeId,
      name,
      formattedAddress: typeof item.formattedAddress === "string" ? item.formattedAddress : null,
      lat: location && typeof location.latitude === "number" ? location.latitude : null,
      lng: location && typeof location.longitude === "number" ? location.longitude : null,
      rating: typeof item.rating === "number" ? item.rating : null,
      websiteUrl: typeof item.websiteUri === "string" ? item.websiteUri : null,
      mapsUrl: typeof item.googleMapsUri === "string" ? item.googleMapsUri : null,
      photoRef: firstPhotoRef(item),
    });
    if (places.length >= maxResults) break;
  }
  return places;
}

function placesBaseUrl(): string {
  return process.env.GOOGLE_PLACES_BASE_URL?.trim() || PLACES_SEARCH_TEXT_URL;
}

function placesPhotoBaseUrl(): string {
  return process.env.GOOGLE_PLACES_PHOTO_BASE_URL?.trim() || "https://places.googleapis.com";
}

/**
 * Places API (New) Text Search, server-side only. No client-side retry —
 * a single short-timeout attempt; a failure or timeout is surfaced as
 * "unavailable" rather than silently retried at multiplied cost/latency.
 *
 * maxResults defaults to GOOGLE_PLACES_MAX_RESULTS (5) for every itinerary
 * -building call. swapPlace (kin-travel.ts) is the one exception — it asks
 * for a larger pool so it has real, distinct candidates to offer instead of
 * only ever re-seeing the same 5 places already in the itinerary — but it
 * still never shows the member more than 5 places at once; the itinerary
 * itself is never rendered with more than its original 5.
 */
export async function searchPlaces(query: string, maxResults: number = GOOGLE_PLACES_MAX_RESULTS): Promise<GooglePlacesResult> {
  const apiKey = googleMapsApiKey();
  if (!apiKey) return { status: "unavailable", reason: "not configured" };
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!trimmed) return { status: "ok", places: [] };

  try {
    const response = await fetch(placesBaseUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ textQuery: trimmed, maxResultCount: maxResults }),
      signal: AbortSignal.timeout(GOOGLE_PLACES_TIMEOUT_MS),
    });
    if (!response.ok) return { status: "unavailable", reason: `HTTP ${response.status}` };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "unavailable", reason: "malformed response" };
    }
    return { status: "ok", places: normalizePlacesResponse(payload, maxResults) };
  } catch (error) {
    const reason = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError") ? "timeout" : "network error";
    return { status: "unavailable", reason };
  }
}

/**
 * Resolves a place photo reference to a real, temporary media URL via
 * Places Photo (New) with skipHttpRedirect=true — Google returns
 * {photoUri: "https://lh3.googleusercontent.com/..."} as JSON instead of
 * redirecting, so the server-only API key is never embedded in a URL that
 * reaches the browser. That googleusercontent.com URL is short-lived
 * (Google-issued, not persisted or reused past the request that needed
 * it) and safe to hand to the client directly — the client fetches the
 * photo bytes straight from Google, never through this server.
 */
export async function resolvePlacePhotoUrl(photoName: string): Promise<string | null> {
  const apiKey = googleMapsApiKey();
  if (!apiKey) return null;
  try {
    const url = `${placesPhotoBaseUrl()}/v1/${photoName}/media?maxWidthPx=${PLACES_PHOTO_MAX_WIDTH_PX}&skipHttpRedirect=true`;
    const response = await fetch(url, {
      headers: { "X-Goog-Api-Key": apiKey },
      signal: AbortSignal.timeout(GOOGLE_PLACES_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as { photoUri?: unknown } | null;
    if (!payload || typeof payload.photoUri !== "string" || !isValidHttpsUrl(payload.photoUri)) return null;
    return payload.photoUri;
  } catch {
    return null;
  }
}
