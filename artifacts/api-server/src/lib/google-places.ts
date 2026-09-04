const PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
export const GOOGLE_PLACES_TIMEOUT_MS = 8_000;
export const GOOGLE_PLACES_MAX_RESULTS = 5;
const MAX_QUERY_LENGTH = 300;

// Minimal field mask — only what KIN Travel ever renders. Every field
// costs money on Google's Places API (New) pricing tiers, so nothing
// beyond this list is ever requested.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.websiteUri",
  "places.googleMapsUri",
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

export type GooglePlace = {
  placeId: string;
  name: string;
  formattedAddress: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  websiteUrl: string | null;
  mapsUrl: string | null;
};

export type GooglePlacesResult =
  | { status: "ok"; places: GooglePlace[] }
  | { status: "unavailable"; reason: string };

/**
 * Only ever reads fields Google's own typed response actually supplied —
 * anything absent is omitted (null), never defaulted or guessed. No place
 * lacking both an id and a name is ever kept, since that would produce a
 * card with nothing genuine to show.
 */
function normalizePlacesResponse(payload: unknown): GooglePlace[] {
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
    });
    if (places.length >= GOOGLE_PLACES_MAX_RESULTS) break;
  }
  return places;
}

function placesBaseUrl(): string {
  return process.env.GOOGLE_PLACES_BASE_URL?.trim() || PLACES_SEARCH_TEXT_URL;
}

/**
 * Places API (New) Text Search, server-side only. No client-side retry —
 * a single short-timeout attempt; a failure or timeout is surfaced as
 * "unavailable" rather than silently retried at multiplied cost/latency.
 */
export async function searchPlaces(query: string): Promise<GooglePlacesResult> {
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
      body: JSON.stringify({ textQuery: trimmed, maxResultCount: GOOGLE_PLACES_MAX_RESULTS }),
      signal: AbortSignal.timeout(GOOGLE_PLACES_TIMEOUT_MS),
    });
    if (!response.ok) return { status: "unavailable", reason: `HTTP ${response.status}` };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "unavailable", reason: "malformed response" };
    }
    return { status: "ok", places: normalizePlacesResponse(payload) };
  } catch (error) {
    const reason = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError") ? "timeout" : "network error";
    return { status: "unavailable", reason };
  }
}
