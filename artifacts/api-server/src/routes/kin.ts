import { closetItems, db, kinSavedRecommendations, kinTripItems, kinTrips } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import express, { Router, type IRouter, type NextFunction, type Request, type Response } from "express";

import {
  MAX_UPLOAD_BYTES,
  decodeAndReencodeClosetImage,
  sanitizeErrorReason,
} from "../lib/closet-media-upload";
import { isFeatureEnabled } from "../lib/feature-flags";
import { getClosetMediaDownloadURL } from "../lib/private-media-storage";
import {
  isValidHttpsUrl,
  runKinSearch,
  validateKinSearchRequest,
  type KinLooksOption,
  type KinSearchCitation,
  type KinSearchResultCard,
} from "../lib/kin-search";
import { reserveKinSearchAttempt } from "../lib/kin-search-usage";
import { runKinTravelPlan, swapPlace } from "../lib/kin-travel";
import { requireUser } from "./engagement";

const router: IRouter = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH = 200;
const MAX_NOTES_LENGTH = 1000;
const MAX_ANSWER_LENGTH = 6000;

function requireUserMw(req: Request, res: Response, next: NextFunction) {
  const user = requireUser(req, res);
  if (!user) return;
  next();
}

async function kinSearchFlagMw(_req: Request, res: Response, next: NextFunction) {
  if (!(await isFeatureEnabled("kin_search"))) {
    res.status(403).json({ error: "KIN is not available right now" });
    return;
  }
  next();
}

/**
 * Scoped to the requesting user regardless of whether my_things itself is
 * currently enabled: the item already belongs to them either way, and
 * my_things's flag only gates the My Things UI/API surface, not whether an
 * owner's own existing data can be referenced elsewhere. Always includes
 * imageObjectKey so a Looks request can fetch the real image — a Travel
 * request that only needs the taxonomy text simply never reads it.
 */
async function lookupMyThingsItem(ownerUserId: string, itemId: string) {
  const [item] = await db
    .select({
      itemType: closetItems.itemType, primaryColor: closetItems.primaryColor,
      style: closetItems.style, occasion: closetItems.occasion,
      season: closetItems.season, brand: closetItems.brand,
      imageObjectKey: closetItems.imageObjectKey,
    })
    .from(closetItems)
    .where(and(eq(closetItems.id, itemId), eq(closetItems.ownerUserId, ownerUserId)));
  if (!item) return null;
  const parts = [item.itemType, item.primaryColor];
  if (item.style) parts.push(item.style);
  if (item.occasion) parts.push(item.occasion);
  if (item.season) parts.push(item.season);
  if (item.brand) parts.push(item.brand);
  return { context: parts.join(", "), imageObjectKey: item.imageObjectKey };
}

/**
 * Best-effort: a storage hiccup fetching the actual image never fails the
 * whole request — the taxonomy-text context alone is still useful, and the
 * caller degrades to a text-only styling answer rather than a 5xx.
 */
async function fetchOwnedItemImage(imageObjectKey: string, req: Request, userId: string): Promise<Buffer | undefined> {
  try {
    const signedUrl = await getClosetMediaDownloadURL(imageObjectKey);
    const stored = await fetch(signedUrl, { signal: AbortSignal.timeout(10_000) });
    if (!stored.ok) throw new Error(`HTTP ${stored.status}`);
    return Buffer.from(await stored.arrayBuffer());
  } catch (error) {
    req.log.warn({ reason: sanitizeErrorReason("kin item image fetch failed", error), userId }, "Unable to fetch My Things image for KIN Looks");
    return undefined;
  }
}

function daily429(res: Response) {
  res.status(429).json({ error: "Daily KIN search limit reached. Try again tomorrow.", reason: "daily_limit_exceeded" });
}

/**
 * Authenticated KIN search foundation for KIN Looks and KIN Travel. Never
 * persists a search — only an explicit POST /kin/saved call (below) does
 * that, and only what the member chose to keep. Always responds 200 with
 * `{ status: "ok", ... }` or `{ status: "unavailable", reason }` for any
 * well-formed, authorized, in-quota request; the other responses are
 * validation (400), auth (401), the feature flag (403), and the daily
 * quota (429).
 */
router.post("/kin/search", requireUserMw, kinSearchFlagMw, async (req, res) => {
  const user = req.user!;
  const validated = validateKinSearchRequest(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  let itemContext: string | undefined;
  let imageBuffer: Buffer | undefined;
  if (validated.value.myThingsItemId) {
    const item = await lookupMyThingsItem(user.id, validated.value.myThingsItemId);
    if (!item) {
      res.status(400).json({ error: "Selected item not found" });
      return;
    }
    itemContext = item.context;
    if (validated.value.mode === "looks") {
      imageBuffer = await fetchOwnedItemImage(item.imageObjectKey, req, user.id);
    }
  }

  // Reserved after input validation (a malformed request never touches the
  // quota) but before any Anthropic call — a provider failure or timeout
  // on the search that follows still spent real request cost, so it must
  // still consume the one reserved attempt.
  const reservation = await reserveKinSearchAttempt(user.id);
  if ("rateLimited" in reservation) {
    daily429(res);
    return;
  }

  const result = await runKinSearch(validated.value, itemContext, imageBuffer);
  if (result.status !== "ok") {
    if (result.reason !== "not configured") {
      req.log.warn({ reason: result.reason, userId: user.id, mode: validated.value.mode }, "KIN search unavailable");
    }
    res.json({ status: "unavailable", reason: "unavailable" });
    return;
  }
  res.json(result);
});

/**
 * A new, not-yet-saved clothing photo (camera or upload), never a remote
 * URL. The image is validated and re-encoded exactly like a My Things
 * upload (decodeAndReencodeClosetImage, the same MAX_UPLOAD_BYTES ceiling)
 * but is never written to object storage — it lives only as an in-memory
 * buffer for the single Anthropic call below, then is discarded. Because
 * the body is the raw image, the rest of the request (query, location,
 * budget, currency, size, occasion) travels as query-string parameters.
 */
async function looksPhotoParserRejectionHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const httpError = err as { status?: number; type?: string } | undefined;
  const status = httpError?.status === 413 || httpError?.type === "entity.too.large" ? 413 : 400;
  res.status(status).json({ error: status === 413 ? "Image is too large" : "Could not read the uploaded image" });
}

function stringQueryParam(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function looksPhotoHandler(req: Request, res: Response) {
    const user = req.user!;
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(422).json({ error: "Could not process this image" });
      return;
    }
    const decoded = await decodeAndReencodeClosetImage(body);
    if (!decoded) {
      res.status(422).json({ error: "Could not process this image" });
      return;
    }

    const candidate: Record<string, unknown> = { mode: "looks", query: stringQueryParam(req.query.query) ?? "" };
    const location = stringQueryParam(req.query.location);
    if (location !== undefined) candidate.location = location;
    const budgetRaw = stringQueryParam(req.query.budget);
    if (budgetRaw !== undefined && budgetRaw !== "") candidate.budget = Number(budgetRaw);
    const currency = stringQueryParam(req.query.currency);
    if (currency !== undefined) candidate.currency = currency;
    const size = stringQueryParam(req.query.size);
    if (size !== undefined) candidate.size = size;
    const occasion = stringQueryParam(req.query.occasion);
    if (occasion !== undefined) candidate.occasion = occasion;
    const locale = stringQueryParam(req.query.locale);
    if (locale !== undefined) candidate.locale = locale;

    const validated = validateKinSearchRequest(candidate);
    if (!validated.ok) {
      res.status(400).json({ error: validated.error });
      return;
    }

    let itemContext: string | undefined;
    if (validated.value.myThingsItemId) {
      const item = await lookupMyThingsItem(user.id, validated.value.myThingsItemId);
      if (!item) {
        res.status(400).json({ error: "Selected item not found" });
        return;
      }
      itemContext = item.context;
    }

    const reservation = await reserveKinSearchAttempt(user.id);
    if ("rateLimited" in reservation) {
      daily429(res);
      return;
    }

    const result = await runKinSearch(validated.value, itemContext, decoded.buffer);
    if (result.status !== "ok") {
      if (result.reason !== "not configured") {
        req.log.warn({ reason: result.reason, userId: user.id, mode: "looks" }, "KIN Looks photo search unavailable");
      }
      res.json({ status: "unavailable", reason: "unavailable" });
      return;
    }
    res.json(result);
}

router.post(
  "/kin/looks/photo",
  requireUserMw,
  kinSearchFlagMw,
  express.raw({ type: "image/*", limit: MAX_UPLOAD_BYTES }),
  looksPhotoParserRejectionHandler,
  looksPhotoHandler,
);

/**
 * KIN Travel's day-by-day itinerary: real Google Places results and
 * real Routes distance/duration between them, combined with one Anthropic
 * web-search call for the narrative/weather-aware styling notes. Requires
 * a destination; unlike /kin/search's travel mode (a plain grounded
 * answer), this always needs Google Maps configured, since a day-by-day
 * plan with no real places would have nothing genuine to show.
 */
router.post("/kin/travel/plan", requireUserMw, kinSearchFlagMw, async (req, res) => {
  const user = req.user!;
  const validated = validateKinSearchRequest({ ...(req.body && typeof req.body === "object" ? req.body : {}), mode: "travel" });
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }
  if (!validated.value.destination) {
    res.status(400).json({ error: "destination is required" });
    return;
  }

  let itemContext: string | undefined;
  if (validated.value.myThingsItemId) {
    const item = await lookupMyThingsItem(user.id, validated.value.myThingsItemId);
    if (!item) {
      res.status(400).json({ error: "Selected item not found" });
      return;
    }
    itemContext = item.context;
  }

  const reservation = await reserveKinSearchAttempt(user.id);
  if ("rateLimited" in reservation) {
    daily429(res);
    return;
  }

  const result = await runKinTravelPlan(validated.value, itemContext);
  if (result.status !== "ok") {
    if (result.reason !== "not configured") {
      req.log.warn({ reason: result.reason, userId: user.id }, "KIN travel plan unavailable");
    }
    res.json({ status: "unavailable", reason: "unavailable" });
    return;
  }
  res.json({ status: "ok", plan: result.plan });
});

/**
 * Swaps one itinerary stop for a different real place at the same
 * destination — one additional Google Places lookup, excluding every
 * placeId already shown anywhere in the current itinerary so the
 * replacement is never a duplicate. Counts against the same daily quota
 * as every other KIN action (it still spends real request cost even
 * though it never calls Anthropic).
 */
router.post("/kin/travel/swap-place", requireUserMw, kinSearchFlagMw, async (req, res) => {
  const user = req.user!;
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const destination = typeof body.destination === "string" ? body.destination.trim() : "";
  if (!destination || destination.length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: "destination is required" });
    return;
  }
  const excludePlaceIds = Array.isArray(body.excludePlaceIds)
    ? body.excludePlaceIds.filter((id): id is string => typeof id === "string").slice(0, 20)
    : [];

  const reservation = await reserveKinSearchAttempt(user.id);
  if ("rateLimited" in reservation) {
    daily429(res);
    return;
  }

  const result = await swapPlace(destination, excludePlaceIds);
  if (result.status !== "ok") {
    if (result.reason !== "not configured" && result.reason !== "no alternative available") {
      req.log.warn({ reason: result.reason, userId: user.id }, "KIN travel swap-place unavailable");
    }
    res.json({ status: "unavailable", reason: "unavailable" });
    return;
  }
  res.json({ status: "ok", place: result.place });
});

// --- persistence: saved recommendations, trips, trip items ----------------

function optionalString(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return null;
  return trimmed || undefined;
}

type ValidatedCitation = KinSearchCitation;
type ValidatedResultCard = KinSearchResultCard;

function validateCitations(value: unknown): ValidatedCitation[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const citations: ValidatedCitation[] = [];
  for (const raw of value.slice(0, 5)) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    if (typeof item.url !== "string" || !isValidHttpsUrl(item.url)) return null;
    if (item.title !== null && typeof item.title !== "string") return null;
    citations.push({ title: item.title ?? null, url: item.url });
  }
  return citations;
}

function validateResults(value: unknown): ValidatedResultCard[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const results: ValidatedResultCard[] = [];
  for (const raw of value.slice(0, 5)) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    if (typeof item.title !== "string" || typeof item.source !== "string") return null;
    if (typeof item.url !== "string" || !isValidHttpsUrl(item.url)) return null;
    if (item.price !== null && typeof item.price !== "number") return null;
    if (item.currency !== null && typeof item.currency !== "string") return null;
    if (item.imageUrl !== null && typeof item.imageUrl !== "string") return null;
    results.push({
      title: item.title, source: item.source, url: item.url,
      price: (item.price as number | null) ?? null,
      currency: (item.currency as string | null) ?? null,
      imageUrl: (item.imageUrl as string | null) ?? null,
    });
  }
  return results;
}

function validateOptions(value: unknown): KinLooksOption[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return null;
  const options: KinLooksOption[] = [];
  for (const raw of value.slice(0, 3)) {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    if (item.label !== "signature" && item.label !== "safe" && item.label !== "bold") return null;
    if (typeof item.reasoning !== "string") return null;
    if (!Array.isArray(item.ownedItems) || !item.ownedItems.every((v) => typeof v === "string")) return null;
    if (!Array.isArray(item.missingItems) || !item.missingItems.every((v) => typeof v === "string")) return null;
    options.push({
      label: item.label, reasoning: item.reasoning.slice(0, 2000),
      ownedItems: (item.ownedItems as string[]).slice(0, 20),
      missingItems: (item.missingItems as string[]).slice(0, 20),
    });
  }
  return options;
}

type ValidatedSave = {
  mode: "looks" | "travel";
  query: string;
  answer: string;
  options: KinLooksOption[] | null;
  citations: ValidatedCitation[];
  results: ValidatedResultCard[];
};

function validateSaveBody(body: unknown): ValidatedSave | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.mode !== "looks" && record.mode !== "travel") return null;
  if (typeof record.query !== "string" || !record.query.trim() || record.query.length > 2000) return null;
  if (typeof record.answer !== "string" || !record.answer.trim() || record.answer.length > MAX_ANSWER_LENGTH) return null;
  const citations = validateCitations(record.citations);
  if (citations === null) return null;
  const results = validateResults(record.results);
  if (results === null) return null;
  let options: KinLooksOption[] | null = null;
  if (record.mode === "looks" && record.options !== undefined) {
    options = validateOptions(record.options);
    if (options === null && record.options !== null) return null;
  }
  return { mode: record.mode, query: record.query.trim(), answer: record.answer.trim(), options, citations, results };
}

function serializeSavedRecommendation(row: typeof kinSavedRecommendations.$inferSelect) {
  return {
    id: row.id, mode: row.mode, query: row.query, answer: row.answer,
    options: row.options ?? null, citations: row.citations, results: row.results,
    createdAt: row.createdAt,
  };
}

router.post("/kin/saved", requireUserMw, kinSearchFlagMw, async (req, res) => {
  const user = req.user!;
  const parsed = validateSaveBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: "Invalid recommendation" });
    return;
  }
  const [row] = await db.insert(kinSavedRecommendations).values({
    ownerUserId: user.id, mode: parsed.mode, query: parsed.query, answer: parsed.answer,
    options: parsed.options, citations: parsed.citations, results: parsed.results,
  }).returning();
  res.status(201).json(serializeSavedRecommendation(row));
});

router.get("/kin/saved", requireUserMw, kinSearchFlagMw, async (req, res) => {
  const user = req.user!;
  const rows = await db.select().from(kinSavedRecommendations)
    .where(eq(kinSavedRecommendations.ownerUserId, user.id))
    .orderBy(desc(kinSavedRecommendations.createdAt))
    .limit(50);
  res.json({ items: rows.map(serializeSavedRecommendation) });
});

router.delete("/kin/saved/:id", requireUserMw, kinSearchFlagMw, async (req, res) => {
  const user = req.user!;
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Not found" }); return; }
  const [deleted] = await db.delete(kinSavedRecommendations)
    .where(and(eq(kinSavedRecommendations.id, id), eq(kinSavedRecommendations.ownerUserId, user.id)))
    .returning({ id: kinSavedRecommendations.id });
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(200).json({ status: "removed" });
});

function validateTripBody(body: unknown): { destination: string; startDate?: string; endDate?: string; budget?: number; currency?: string } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const destination = optionalString(record.destination, MAX_TEXT_LENGTH);
  if (!destination) return null;
  const value: { destination: string; startDate?: string; endDate?: string; budget?: number; currency?: string } = { destination };
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (record.startDate !== undefined) {
    if (typeof record.startDate !== "string" || !DATE_RE.test(record.startDate)) return null;
    value.startDate = record.startDate;
  }
  if (record.endDate !== undefined) {
    if (typeof record.endDate !== "string" || !DATE_RE.test(record.endDate)) return null;
    value.endDate = record.endDate;
  }
  if (record.budget !== undefined) {
    if (typeof record.budget !== "number" || !Number.isFinite(record.budget) || record.budget < 0) return null;
    value.budget = record.budget;
  }
  if (record.currency !== undefined) {
    if (typeof record.currency !== "string" || !/^[A-Z]{3}$/.test(record.currency)) return null;
    value.currency = record.currency;
  }
  return value;
}

function serializeTrip(row: typeof kinTrips.$inferSelect) {
  return {
    id: row.id, destination: row.destination, startDate: row.startDate, endDate: row.endDate,
    budget: row.budget, currency: row.currency, createdAt: row.createdAt,
  };
}

function serializeTripItem(row: typeof kinTripItems.$inferSelect) {
  return {
    id: row.id, tripId: row.tripId, dayIndex: row.dayIndex, placeId: row.placeId, name: row.name,
    formattedAddress: row.formattedAddress, lat: row.lat, lng: row.lng, notes: row.notes, createdAt: row.createdAt,
  };
}

router.post("/kin/trips", requireUserMw, kinSearchFlagMw, async (req, res) => {
  const user = req.user!;
  const parsed = validateTripBody(req.body);
  if (!parsed) { res.status(400).json({ error: "Invalid trip" }); return; }
  const [row] = await db.insert(kinTrips).values({ ownerUserId: user.id, ...parsed }).returning();
  res.status(201).json(serializeTrip(row));
});

router.get("/kin/trips", requireUserMw, kinSearchFlagMw, async (req, res) => {
  const user = req.user!;
  const rows = await db.select().from(kinTrips)
    .where(eq(kinTrips.ownerUserId, user.id))
    .orderBy(desc(kinTrips.createdAt));
  res.json({ items: rows.map(serializeTrip) });
});

router.get("/kin/trips/:id", requireUserMw, kinSearchFlagMw, async (req, res) => {
  const user = req.user!;
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Trip not found" }); return; }
  const [trip] = await db.select().from(kinTrips).where(and(eq(kinTrips.id, id), eq(kinTrips.ownerUserId, user.id)));
  if (!trip) { res.status(404).json({ error: "Trip not found" }); return; }
  const items = await db.select().from(kinTripItems)
    .where(and(eq(kinTripItems.tripId, id), eq(kinTripItems.ownerUserId, user.id)))
    .orderBy(kinTripItems.dayIndex, kinTripItems.createdAt);
  res.json({ ...serializeTrip(trip), items: items.map(serializeTripItem) });
});

router.delete("/kin/trips/:id", requireUserMw, kinSearchFlagMw, async (req, res) => {
  const user = req.user!;
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Trip not found" }); return; }
  const [deleted] = await db.delete(kinTrips)
    .where(and(eq(kinTrips.id, id), eq(kinTrips.ownerUserId, user.id)))
    .returning({ id: kinTrips.id });
  if (!deleted) { res.status(404).json({ error: "Trip not found" }); return; }
  res.status(200).json({ status: "removed" });
});

function validateTripItemBody(body: unknown): { dayIndex: number; placeId: string | undefined; name: string; formattedAddress: string | undefined; lat: number | undefined; lng: number | undefined; notes: string | undefined } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const name = optionalString(record.name, MAX_TEXT_LENGTH);
  if (!name) return null;
  let dayIndex = 0;
  if (record.dayIndex !== undefined) {
    if (typeof record.dayIndex !== "number" || !Number.isInteger(record.dayIndex) || record.dayIndex < 0 || record.dayIndex > 30) return null;
    dayIndex = record.dayIndex;
  }
  const placeId = optionalString(record.placeId, 255);
  if (placeId === null) return null;
  const formattedAddress = optionalString(record.formattedAddress, 500);
  if (formattedAddress === null) return null;
  const notes = optionalString(record.notes, MAX_NOTES_LENGTH);
  if (notes === null) return null;
  let lat: number | undefined;
  let lng: number | undefined;
  if (record.lat !== undefined) {
    if (typeof record.lat !== "number" || !Number.isFinite(record.lat) || record.lat < -90 || record.lat > 90) return null;
    lat = record.lat;
  }
  if (record.lng !== undefined) {
    if (typeof record.lng !== "number" || !Number.isFinite(record.lng) || record.lng < -180 || record.lng > 180) return null;
    lng = record.lng;
  }
  return { dayIndex, placeId, name, formattedAddress, lat, lng, notes };
}

router.post("/kin/trips/:id/items", requireUserMw, kinSearchFlagMw, async (req, res) => {
  const user = req.user!;
  const tripId = String(req.params.id);
  if (!UUID_RE.test(tripId)) { res.status(404).json({ error: "Trip not found" }); return; }
  const [trip] = await db.select({ id: kinTrips.id }).from(kinTrips).where(and(eq(kinTrips.id, tripId), eq(kinTrips.ownerUserId, user.id)));
  if (!trip) { res.status(404).json({ error: "Trip not found" }); return; }
  const parsed = validateTripItemBody(req.body);
  if (!parsed) { res.status(400).json({ error: "Invalid itinerary item" }); return; }
  const [row] = await db.insert(kinTripItems).values({ tripId, ownerUserId: user.id, ...parsed }).returning();
  res.status(201).json(serializeTripItem(row));
});

router.delete("/kin/trips/:id/items/:itemId", requireUserMw, kinSearchFlagMw, async (req, res) => {
  const user = req.user!;
  const tripId = String(req.params.id);
  const itemId = String(req.params.itemId);
  if (!UUID_RE.test(tripId) || !UUID_RE.test(itemId)) { res.status(404).json({ error: "Not found" }); return; }
  const [deleted] = await db.delete(kinTripItems)
    .where(and(eq(kinTripItems.id, itemId), eq(kinTripItems.tripId, tripId), eq(kinTripItems.ownerUserId, user.id)))
    .returning({ id: kinTripItems.id });
  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(200).json({ status: "removed" });
});

export default router;
