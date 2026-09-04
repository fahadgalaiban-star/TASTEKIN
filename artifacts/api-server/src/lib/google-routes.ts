const ROUTES_COMPUTE_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
export const GOOGLE_ROUTES_TIMEOUT_MS = 8_000;

// Minimal field mask — distance and duration only, nothing else this
// feature ever renders (no polyline, no turn-by-turn steps).
const FIELD_MASK = "routes.distanceMeters,routes.duration";

function googleMapsApiKey(): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  return key || null;
}

export function isGoogleRoutesConfigured(): boolean {
  return googleMapsApiKey() !== null;
}

export type GoogleRoute = { distanceMeters: number; durationSeconds: number };

export type GoogleRouteResult =
  | { status: "ok"; route: GoogleRoute | null }
  | { status: "unavailable"; reason: string };

type LatLng = { lat: number; lng: number };

/** "1234s" -> 1234. Anything else (missing, malformed) is never guessed at — the route is simply omitted. */
function parseDurationSeconds(duration: unknown): number | null {
  if (typeof duration !== "string") return null;
  const match = duration.match(/^(\d+)s$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function normalizeRouteResponse(payload: unknown): GoogleRoute | null {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { routes?: unknown }).routes)) return null;
  const [route] = (payload as { routes: unknown[] }).routes;
  if (!route || typeof route !== "object") return null;
  const record = route as Record<string, unknown>;
  const distanceMeters = typeof record.distanceMeters === "number" ? record.distanceMeters : null;
  const durationSeconds = parseDurationSeconds(record.duration);
  if (distanceMeters === null || durationSeconds === null) return null;
  return { distanceMeters, durationSeconds };
}

function routesBaseUrl(): string {
  return process.env.GOOGLE_ROUTES_BASE_URL?.trim() || ROUTES_COMPUTE_URL;
}

/**
 * Routes API, server-side only. travelMode defaults to WALK — KIN Travel's
 * itinerary points are same-destination attractions, not intercity legs.
 * A single short-timeout attempt, no client-side retry.
 */
export async function computeRoute(origin: LatLng, destination: LatLng, travelMode: "WALK" | "DRIVE" = "WALK"): Promise<GoogleRouteResult> {
  const apiKey = googleMapsApiKey();
  if (!apiKey) return { status: "unavailable", reason: "not configured" };

  try {
    const response = await fetch(routesBaseUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode,
      }),
      signal: AbortSignal.timeout(GOOGLE_ROUTES_TIMEOUT_MS),
    });
    if (!response.ok) return { status: "unavailable", reason: `HTTP ${response.status}` };
    const payload = await response.json().catch(() => null);
    return { status: "ok", route: normalizeRouteResponse(payload) };
  } catch (error) {
    const reason = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError") ? "timeout" : "network error";
    return { status: "unavailable", reason };
  }
}
