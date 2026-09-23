import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import sharp from "sharp";

import { fetchProductImagesFor } from "./link-preview";
import { logger } from "./logger";

const MAX_ERROR_LENGTH = 200;
const MAX_PROVIDER_MESSAGE_LENGTH = 200;

/**
 * Never persist a raw error's message/stack — only a short, fixed
 * -vocabulary reason, bounded in length. Mirrors the identical helper in
 * closet-media-upload.ts; kept as its own small copy here rather than an
 * import so this module has no dependency on the closet feature.
 */
function sanitizeErrorReason(prefix: string, error: unknown): string {
  let reason = "unknown error";
  if (error instanceof Error) {
    const httpMatch = error.message.match(/\((\d{3})\)/) ?? error.message.match(/HTTP (\d{3})/);
    if (httpMatch) reason = `HTTP ${httpMatch[1]}`;
    else if (error.name === "AbortError" || /timeout/i.test(error.message)) reason = "timeout";
    else if (error.name === "TypeError" && /fetch/i.test(error.message)) reason = "network error";
    else reason = "error";
  }
  return `${prefix}: ${reason}`.slice(0, MAX_ERROR_LENGTH);
}

/**
 * Strips anything that could leak a secret, URL, or identifier from a
 * provider-authored error message before it's ever logged. This text
 * comes from Anthropic, never from user input, but is redacted anyway as
 * defense in depth — a provider error is never trusted to be safe to log
 * verbatim. Hard-truncated afterward, independent of what redaction
 * removed, so a single field can never make the log line unbounded.
 */
function redactProviderMessage(raw: string): string {
  const redacted = raw
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, "[redacted-key]")
    .replace(/bearer\s+\S+/gi, "bearer [redacted-token]")
    .replace(/\b[A-Za-z0-9+/_-]{24,}\b/g, "[redacted-token]");
  return redacted.slice(0, MAX_PROVIDER_MESSAGE_LENGTH);
}

/** Anthropic's own error body, insofar as this module ever reads it: `{ type: "error", error: { type, message } }`. Read defensively — never assumed. */
function extractProviderMessage(error: APIError): string {
  const body = error.error as { error?: { message?: unknown } } | undefined;
  const nested = body?.error?.message;
  return typeof nested === "string" && nested.length > 0 ? nested : error.message;
}

/** A request that never got an HTTP response at all (timeout/connection failure) — no status, type, or request id exist to log. */
function logProviderConnectionFailure(error: APIConnectionError, errorType: "timeout" | "network_error", context: { model: string; webSearchEnabled: boolean; correlationId?: string }): void {
  logger.warn({
    provider: "anthropic",
    status: null,
    errorType,
    requestId: null,
    message: redactProviderMessage(error.message),
    model: context.model,
    webSearchEnabled: context.webSearchEnabled,
    correlationId: context.correlationId ?? null,
  }, "KIN search: Anthropic provider error");
}

/**
 * Structured, safe diagnostics for a failed Anthropic call — logged
 * server-side only, never returned to the client (the client always gets
 * the fixed `{ status: "unavailable", reason: "unavailable" }` shape,
 * unchanged by this). Only ever reads APIError's own typed fields
 * (status/type/requestID) or a redacted, truncated message — never the
 * raw headers, the full request/response body, the prompt, an image, or
 * the API key.
 */
function logProviderError(error: unknown, context: { model: string; webSearchEnabled: boolean; correlationId?: string }): void {
  // APIConnectionTimeoutError/APIConnectionError are themselves APIError
  // subclasses (no HTTP response was ever received, so status/type/
  // requestID are all unset on them) — checked first so a request that
  // never reached Anthropic is never mislabeled with a real response's
  // (absent) error.type.
  if (error instanceof APIConnectionTimeoutError) {
    logProviderConnectionFailure(error, "timeout", context);
    return;
  }
  if (error instanceof APIConnectionError) {
    logProviderConnectionFailure(error, "network_error", context);
    return;
  }
  if (error instanceof APIError) {
    logger.warn({
      provider: "anthropic",
      status: error.status ?? null,
      errorType: error.type ?? null,
      requestId: error.requestID ?? null,
      message: redactProviderMessage(extractProviderMessage(error)),
      model: context.model,
      webSearchEnabled: context.webSearchEnabled,
      correlationId: context.correlationId ?? null,
    }, "KIN search: Anthropic provider error");
    return;
  }
  const isTimeout = error instanceof Error && (error.name === "AbortError" || /timeout/i.test(error.message));
  const isNetworkError = error instanceof Error && error.name === "TypeError" && /fetch/i.test(error.message);
  logger.warn({
    provider: "anthropic",
    status: null,
    errorType: isTimeout ? "timeout" : isNetworkError ? "network_error" : "unknown",
    requestId: null,
    message: redactProviderMessage(error instanceof Error ? error.message : String(error)),
    model: context.model,
    webSearchEnabled: context.webSearchEnabled,
    correlationId: context.correlationId ?? null,
  }, "KIN search: Anthropic provider error");
}

// claude-sonnet-5, not an Opus-tier model: KIN search is a routine,
// high-volume mobile request (natural-language question + a few grounded
// web searches), not a hard long-horizon reasoning task, so Sonnet 5 is
// the appropriate tier. output_config.effort: "low" is the conservative,
// SDK-confirmed-supported pairing for it (@anthropic-ai/sdk 0.123.0's
// messages.d.ts: OutputConfig.effort accepts 'low'|'medium'|'high'|
// 'xhigh'|'max'; Sonnet 5's only "on" thinking mode is
// ThinkingConfigAdaptive, `{type: "adaptive"}` — there is no
// budget_tokens-style field for this model, so none is guessed here).
export const DEFAULT_KIN_SEARCH_MODEL = "claude-sonnet-5";
export const DEFAULT_KIN_SEARCH_MAX_WEB_USES = 3;
export const KIN_SEARCH_TIMEOUT_MS = 45_000;
// A hard ceiling sized for a concise mobile answer plus a short list of
// citations/results — not a target length, just a cost/latency backstop.
const MAX_OUTPUT_TOKENS = 1024;
const MAX_QUERY_LENGTH = 2000;
const MAX_TEXT_FIELD_LENGTH = 200;
// Caps on what ever reaches the client, independent of max_uses (one
// search call can return several results) — keeps a mobile results list
// short and bounds response size regardless of how much the model found.
const MAX_RESULTS = 5;
const MAX_CITATIONS = 5;
// Re-compresses an already-validated image (see decodeAndReencodeClosetImage
// in closet-media-upload.ts, which every caller runs first) down to a size
// appropriate for a single Anthropic request — the same resize-then-webp
// shape as closet-image-analysis.ts's CLOSET_ANALYSIS_MAX_DIMENSION, kept as
// its own local constant so this module still has no import dependency on
// the closet feature.
const KIN_LOOKS_IMAGE_MAX_DIMENSION = 1024;
const KIN_LOOKS_IMAGE_WEBP_QUALITY = 82;
const MAX_LOOKS_ITEM_LIST_LENGTH = 20;
// A bounded, best-effort enhancement — real product photos for a Looks
// answer's shopping results, fetched from the same https pages Anthropic's
// web search already verified. Capped independent of how many results
// came back, so one search can never fan out into an unbounded number of
// outbound page fetches.
const MAX_PRODUCT_IMAGE_LOOKUPS = 3;

/**
 * Lazily constructed, never at module import time — a missing
 * ANTHROPIC_API_KEY must never crash server startup. Cached after the
 * first check, matching the identical precedent in
 * closet-image-analysis.ts / googleAuthConfigured(). This is a fresh,
 * independent client instance (not imported from closet-image-analysis.ts)
 * so this PR never touches that file's behavior.
 */
let cachedClient: Anthropic | null | undefined;
function anthropicClient(): Anthropic | null {
  if (cachedClient !== undefined) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  cachedClient = apiKey ? new Anthropic({ apiKey }) : null;
  return cachedClient;
}

export function isKinSearchConfigured(): boolean {
  return anthropicClient() !== null;
}

function kinSearchModel(): string {
  return process.env.KIN_SEARCH_MODEL?.trim() || DEFAULT_KIN_SEARCH_MODEL;
}

/** Central, configurable cap on Anthropic web-search tool calls per request. */
function maxWebUses(): number {
  const raw = process.env.KIN_SEARCH_MAX_WEB_USES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_KIN_SEARCH_MAX_WEB_USES;
}

function kinSearchTimeoutMs(): number {
  const raw = process.env.KIN_SEARCH_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : KIN_SEARCH_TIMEOUT_MS;
}

// --- shared request/response contracts -------------------------------------
//
// These are the typed shapes KIN Looks and KIN Travel (the next PRs) are
// expected to build on: one request shape gated by `mode`, one normalized
// response shape that never leaks provider-internal fields (encrypted
// content, tool_use ids, raw citation block types) to the client.

export type KinSearchMode = "looks" | "travel";

/**
 * Structured KIN Travel interest chips — the guided 3-screen flow's
 * "Choose your interests" screen. Sport itself is a UI-only grouping (it
 * expands to reveal gyms/pilates/walking_places); only its subchoices are
 * ever sent here. Each maps deterministically to a real Google Places
 * query in kin-travel.ts — never a free-text/inferred category.
 */
export const KIN_TRAVEL_INTERESTS = [
  "breakfast", "dinner", "cafes", "shopping", "museums", "parks", "hidden_gems", "gyms", "pilates", "walking_places",
] as const;
export type KinTravelInterest = (typeof KIN_TRAVEL_INTERESTS)[number];
const MAX_TRAVEL_ITEMS = 6;

/**
 * Optional accommodation preferences from the guided flow's Hotels /
 * Apartments & Homes cards. Every value is a closed enum the server maps to
 * its own Google Places query — never free text. Absent entirely when the
 * member picked neither card, in which case the itinerary is unchanged.
 */
export const KIN_HOTEL_STARS = [3, 4, 5] as const;
export type KinHotelStars = (typeof KIN_HOTEL_STARS)[number];
export const KIN_STAY_BUDGETS = [1, 2, 3] as const;
export type KinStayBudget = (typeof KIN_STAY_BUDGETS)[number];
export const KIN_APARTMENT_STAY_TYPES = ["entire_home", "apartment", "private_room"] as const;
export type KinApartmentStayType = (typeof KIN_APARTMENT_STAY_TYPES)[number];
export type KinHotelPreferences = { stars?: KinHotelStars; budget?: KinStayBudget };
export type KinApartmentPreferences = { stayType?: KinApartmentStayType; budget?: KinStayBudget };
export type KinAccommodationRequest = { hotels?: KinHotelPreferences; apartments?: KinApartmentPreferences };

export type KinSearchRequest = {
  mode: KinSearchMode;
  query: string;
  myThingsItemId?: string;
  /**
   * Additive alternative to myThingsItemId for KIN Travel's "Choose from My
   * Things" screen, which allows selecting more than one owned item. When
   * present and non-empty, the caller (routes/kin.ts) prefers this over the
   * singular field; existing callers that only ever send myThingsItemId are
   * completely unaffected.
   */
  myThingsItemIds?: string[];
  interests?: KinTravelInterest[];
  location?: string;
  budget?: number;
  currency?: string;
  size?: string;
  occasion?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  /**
   * The UI's own displayed locale, sent explicitly by the client rather
   * than inferred from the query text — so the answer language follows
   * what the member is reading the app in, not whatever language they
   * happened to type or paste in this one request. Only ever consumed for
   * `mode: "looks"` (see looksSystemPrompt below); accepted here on the
   * shared request shape purely so validation is one codepath, but KIN
   * Travel's own prompt is untouched by this field.
   */
  locale?: "en" | "ar";
  /** Travel only — see KinAccommodationRequest. Never affects Looks. */
  accommodation?: KinAccommodationRequest;
};

export type KinSearchCitation = { title: string | null; url: string };

/**
 * price/currency/imageUrl are always present in the contract (for the
 * Looks/Travel PRs that will populate them from a dedicated extraction
 * step) but this PR only ever fills them from data Anthropic's web_search
 * tool actually returns — which never includes price or an image — so
 * they are always null here. Never a fabricated/guessed value.
 */
export type KinSearchResultCard = {
  title: string;
  source: string;
  url: string;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
};

/**
 * One of KIN Looks' three styling options. reasoning/ownedItems/missingItems
 * are extracted from the model's free-form answer via fixed literal
 * delimiters (see parseLooksOptions) — a mechanical split, not a trust
 * decision about model prose. When the model doesn't follow the requested
 * format, the affected arrays are simply empty rather than guessed.
 */
export type KinLooksOption = {
  label: "signature" | "safe" | "bold";
  reasoning: string;
  ownedItems: string[];
  missingItems: string[];
};

export type KinSearchResult =
  | {
      status: "ok" | "partial"; answer: string; citations: KinSearchCitation[]; results: KinSearchResultCard[]; options?: KinLooksOption[];
      reason?: "incomplete_recommendation";
      /**
       * True only when Anthropic's own web_search tool reported a
       * structural error on at least one call (rate limited, unavailable,
       * etc. — see WebSearchToolResultError) — never inferred from the
       * model's prose. The text answer above is still real and usable;
       * this only tells the caller that any current-price/availability
       * grounding it depends on may be incomplete.
       */
      webSearchDegraded: boolean;
    }
  | { status: "unavailable"; reason: string };

// --- input validation --------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_RE = /^[A-Z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type KinSearchValidationResult =
  | { ok: true; value: KinSearchRequest }
  | { ok: false; error: string };

function optionalTrimmedString(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return trimmed.length > maxLength ? null : undefined;
  return trimmed;
}

/**
 * Every field the client can send is validated here before anything is
 * ever sent to Anthropic — malformed input is rejected with a 400 by the
 * caller, never silently coerced or passed through.
 */
export function validateKinSearchRequest(body: unknown): KinSearchValidationResult {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request body" };
  const record = body as Record<string, unknown>;

  if (record.mode !== "looks" && record.mode !== "travel") return { ok: false, error: "mode must be 'looks' or 'travel'" };
  const mode = record.mode;

  if (typeof record.query !== "string") return { ok: false, error: "query is required" };
  const query = record.query.trim();
  if (!query) return { ok: false, error: "query is required" };
  if (query.length > MAX_QUERY_LENGTH) return { ok: false, error: `query must be ${MAX_QUERY_LENGTH} characters or fewer` };

  const value: KinSearchRequest = { mode, query };

  if (record.myThingsItemId !== undefined) {
    if (typeof record.myThingsItemId !== "string" || !UUID_RE.test(record.myThingsItemId)) {
      return { ok: false, error: "myThingsItemId must be a valid id" };
    }
    value.myThingsItemId = record.myThingsItemId;
  }

  if (record.myThingsItemIds !== undefined) {
    if (!Array.isArray(record.myThingsItemIds) || record.myThingsItemIds.length === 0 || record.myThingsItemIds.length > MAX_TRAVEL_ITEMS) {
      return { ok: false, error: `myThingsItemIds must be an array of 1-${MAX_TRAVEL_ITEMS} valid ids` };
    }
    const ids: string[] = [];
    for (const raw of record.myThingsItemIds) {
      if (typeof raw !== "string" || !UUID_RE.test(raw)) return { ok: false, error: "myThingsItemIds must be valid ids" };
      if (!ids.includes(raw)) ids.push(raw);
    }
    value.myThingsItemIds = ids;
  }

  if (record.interests !== undefined) {
    if (!Array.isArray(record.interests)) return { ok: false, error: "interests must be an array" };
    const interests: KinTravelInterest[] = [];
    for (const raw of record.interests) {
      if (typeof raw !== "string" || !(KIN_TRAVEL_INTERESTS as readonly string[]).includes(raw)) {
        return { ok: false, error: "interests contains an invalid value" };
      }
      if (!interests.includes(raw as KinTravelInterest)) interests.push(raw as KinTravelInterest);
    }
    value.interests = interests;
  }

  const location = optionalTrimmedString(record.location, MAX_TEXT_FIELD_LENGTH);
  if (location === null) return { ok: false, error: "location is too long" };
  if (location) value.location = location;

  if (record.budget !== undefined) {
    if (typeof record.budget !== "number" || !Number.isFinite(record.budget) || record.budget < 0) {
      return { ok: false, error: "budget must be a non-negative number" };
    }
    value.budget = record.budget;
  }

  if (record.currency !== undefined) {
    if (typeof record.currency !== "string" || !CURRENCY_RE.test(record.currency)) {
      return { ok: false, error: "currency must be a 3-letter code, e.g. USD" };
    }
    value.currency = record.currency;
  }

  const size = optionalTrimmedString(record.size, MAX_TEXT_FIELD_LENGTH);
  if (size === null) return { ok: false, error: "size is too long" };
  if (size) value.size = size;

  const occasion = optionalTrimmedString(record.occasion, MAX_TEXT_FIELD_LENGTH);
  if (occasion === null) return { ok: false, error: "occasion is too long" };
  if (occasion) value.occasion = occasion;

  const destination = optionalTrimmedString(record.destination, MAX_TEXT_FIELD_LENGTH);
  if (destination === null) return { ok: false, error: "destination is too long" };
  if (destination) value.destination = destination;

  if (record.locale !== undefined) {
    if (record.locale !== "en" && record.locale !== "ar") return { ok: false, error: "locale must be 'en' or 'ar'" };
    value.locale = record.locale;
  }

  if (record.startDate !== undefined) {
    if (typeof record.startDate !== "string" || !DATE_RE.test(record.startDate)) return { ok: false, error: "startDate must be YYYY-MM-DD" };
    value.startDate = record.startDate;
  }
  if (record.endDate !== undefined) {
    if (typeof record.endDate !== "string" || !DATE_RE.test(record.endDate)) return { ok: false, error: "endDate must be YYYY-MM-DD" };
    value.endDate = record.endDate;
  }
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    return { ok: false, error: "endDate must not be before startDate" };
  }

  if (record.accommodation !== undefined) {
    if (mode !== "travel") return { ok: false, error: "accommodation is only valid for travel" };
    const accommodation = validateAccommodation(record.accommodation);
    if (!accommodation.ok) return accommodation;
    value.accommodation = accommodation.value;
  }

  return { ok: true, value };
}

function validateStayBudget(value: unknown): { ok: true; value: KinStayBudget | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "number" || !(KIN_STAY_BUDGETS as readonly number[]).includes(value)) return { ok: false, error: "budget must be 1, 2, or 3" };
  return { ok: true, value: value as KinStayBudget };
}

/**
 * Closed-enum validation for the Hotels / Apartments & Homes preference
 * sheets — shared by the plan request and the "Show more stays" endpoint
 * so both accept exactly the same shape. At least one of hotels/apartments
 * must be present; every field inside is optional (the sheets have no
 * required choice), but anything present must be one of the fixed values.
 */
export function validateAccommodation(raw: unknown): { ok: true; value: KinAccommodationRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "accommodation must be an object" };
  const record = raw as Record<string, unknown>;
  const value: KinAccommodationRequest = {};
  if (record.hotels !== undefined) {
    if (!record.hotels || typeof record.hotels !== "object" || Array.isArray(record.hotels)) return { ok: false, error: "accommodation.hotels must be an object" };
    const hotels = record.hotels as Record<string, unknown>;
    const prefs: KinHotelPreferences = {};
    if (hotels.stars !== undefined) {
      if (typeof hotels.stars !== "number" || !(KIN_HOTEL_STARS as readonly number[]).includes(hotels.stars)) return { ok: false, error: "stars must be 3, 4, or 5" };
      prefs.stars = hotels.stars as KinHotelStars;
    }
    const budget = validateStayBudget(hotels.budget);
    if (!budget.ok) return budget;
    if (budget.value !== undefined) prefs.budget = budget.value;
    value.hotels = prefs;
  }
  if (record.apartments !== undefined) {
    if (!record.apartments || typeof record.apartments !== "object" || Array.isArray(record.apartments)) return { ok: false, error: "accommodation.apartments must be an object" };
    const apartments = record.apartments as Record<string, unknown>;
    const prefs: KinApartmentPreferences = {};
    if (apartments.stayType !== undefined) {
      if (typeof apartments.stayType !== "string" || !(KIN_APARTMENT_STAY_TYPES as readonly string[]).includes(apartments.stayType)) {
        return { ok: false, error: "stayType must be entire_home, apartment, or private_room" };
      }
      prefs.stayType = apartments.stayType as KinApartmentStayType;
    }
    const budget = validateStayBudget(apartments.budget);
    if (!budget.ok) return budget;
    if (budget.value !== undefined) prefs.budget = budget.value;
    value.apartments = prefs;
  }
  if (!value.hotels && !value.apartments) return { ok: false, error: "accommodation must include hotels or apartments" };
  return { ok: true, value };
}

// --- prompting -----------------------------------------------------------

const LOOKS_OPTION_MARKERS: { marker: string; label: KinLooksOption["label"] }[] = [
  { marker: "###SIGNATURE###", label: "signature" },
  { marker: "###SAFE###", label: "safe" },
  { marker: "###BOLD###", label: "bold" },
];

/**
 * Built per-request (never a shared constant) because the language
 * instruction depends on the UI's own explicit locale, not on anything
 * inferable from the query text alone — a member reading the app in
 * English may still type or paste a request in Arabic (or vice versa),
 * and the answer should follow what they're reading the app in, not what
 * they happened to type this once. Falls back to "the member's language"
 * only for the (should-never-happen from this app's own UI) case of no
 * locale being sent at all, so this function is still total.
 */
function looksSystemPrompt(locale: "en" | "ar" | undefined): string {
  const languageLine = locale === "ar"
    ? "Respond entirely in Arabic — regardless of the language the member's own message is written in, or the language of any source you search. Keep product names, brand names, and place names exactly as they are normally spelled; do not translate or transliterate them."
    : locale === "en"
      ? "Respond entirely in English — regardless of the language the member's own message is written in, or the language of any source you search. Keep product names, brand names, and place names exactly as they are normally spelled; do not translate or transliterate them."
      : "Write in the member's language.";
  return [
    "You are KIN, TASTEKIN's personal styling assistant.",
    "The member describes what they need in natural language; use the web_search tool to ground any specific, current claim — prices, availability, what's in season, retailer stock — in a real search result. Never state a specific price, availability, or product detail you did not find in a search result.",
    "You are only ever given a photo when the member actually attached one to this exact message. If an image is included with this message, actually look at it — its cut, color, fabric, and condition — and combine that with any taxonomy details given, rather than styling from the taxonomy alone. If no image is included, you have not seen a photo — describe your reasoning from the text details given, and never write as if you are looking at, or describing the visual appearance of, a photo that was not sent to you.",
    "If the member gave an existing wardrobe item as context, build the recommendation around it rather than replacing it.",
    "Always structure your answer as exactly three options, each introduced by one of these exact literal markers on its own line, in this order: ###SIGNATURE### (their classic, reliable self), ###SAFE### (a lower-risk, easy-to-wear option), ###BOLD### (a more daring, statement option).",
    "Within each option, explain in 1-3 sentences why it matches the request. Then, only if relevant, add a line starting with exactly \"OWNED:\" listing (comma-separated) pieces the member already owns that this option uses, and a line starting with exactly \"MISSING:\" listing pieces they would still need. Omit either line entirely if it doesn't apply — never write a line with nothing after the colon.",
    "Give a complete, final answer in this one response — never progress narration (\"searching for...\", \"let me look into...\") and never a promise to keep researching or follow up later.",
    "When you draw on something a source said, put it in your own words — never copy a sentence or passage verbatim from a search result.",
    languageLine,
    "Never invent a URL, retailer name, product, or owned/missing item.",
  ].join(" ");
}

function travelSystemPrompt(locale: "en" | "ar" | undefined): string {
  const languageLine = locale === "ar"
    ? "Respond entirely in Arabic, while keeping proper names in their usual spelling."
    : locale === "en"
      ? "Respond entirely in English, while keeping proper names in their usual spelling."
      : "Write in the member's language.";
  return [
    "You are KIN, TASTEKIN's travel planning assistant.",
    "The member describes the trip they want in natural language; use the web_search tool to ground any specific, current claim — opening hours, weather, current events, reservations, prices — in a real search result. Never state a specific fact you did not find in a search result.",
    "When you can find current weather or climate information for the destination and dates, briefly suggest what to wear day to day, referencing any existing wardrobe item given as context rather than replacing it.",
    "Return a complete, final travel plan in this response. Never narrate your search process, say that you will resume or continue searching, promise a later answer, or discuss an inability to access real-time search.",
    "Write a warm, concise, editorial plan organized around what the member actually asked for. Never invent a URL, venue name, or event.",
    "If the context lists accommodation preferences, you may acknowledge the kind of stay the member wants in one short sentence, but never name, price, rate, or describe any specific hotel or rental — the app shows real stay options separately, from its own data.",
    languageLine,
  ].join(" ");
}

const STAY_BUDGET_WORDS: Record<KinStayBudget, string> = { 1: "budget-friendly", 2: "mid-range", 3: "luxury" };
const APARTMENT_STAY_TYPE_WORDS: Record<KinApartmentStayType, string> = { entire_home: "entire home", apartment: "apartment", private_room: "private room" };

function accommodationContextLines(accommodation: KinAccommodationRequest): string[] {
  const lines: string[] = [];
  if (accommodation.hotels) {
    const details = [accommodation.hotels.stars ? `${accommodation.hotels.stars}-star` : null, accommodation.hotels.budget ? STAY_BUDGET_WORDS[accommodation.hotels.budget] : null].filter(Boolean);
    lines.push(`Accommodation preference: hotels${details.length ? ` (${details.join(", ")})` : ""}`);
  }
  if (accommodation.apartments) {
    const details = [accommodation.apartments.stayType ? APARTMENT_STAY_TYPE_WORDS[accommodation.apartments.stayType] : null, accommodation.apartments.budget ? STAY_BUDGET_WORDS[accommodation.apartments.budget] : null].filter(Boolean);
    lines.push(`Accommodation preference: apartments and homes${details.length ? ` (${details.join(", ")})` : ""}`);
  }
  return lines;
}

function buildUserMessage(request: KinSearchRequest, myThingsItemContext?: string): string {
  const context: string[] = [];
  if (request.location) context.push(`Location/country: ${request.location}`);
  if (request.budget !== undefined) context.push(`Budget: ${request.budget}${request.currency ? ` ${request.currency}` : ""}`);
  if (request.size) context.push(`Size: ${request.size}`);
  if (request.occasion) context.push(`Occasion: ${request.occasion}`);
  if (request.mode === "travel") {
    if (request.destination) context.push(`Destination: ${request.destination}`);
    if (request.startDate) context.push(`Start date: ${request.startDate}`);
    if (request.endDate) context.push(`End date: ${request.endDate}`);
    if (request.accommodation) context.push(...accommodationContextLines(request.accommodation));
  }
  if (myThingsItemContext) context.push(`Existing wardrobe item to consider: ${myThingsItemContext}`);

  const parts = [request.query];
  if (context.length) parts.push(`Context:\n${context.map((line) => `- ${line}`).join("\n")}`);
  return parts.join("\n\n");
}

// --- response normalization ------------------------------------------------

/**
 * Deterministic, mechanical split on fixed literal markers — never a trust
 * decision about model prose. A marker the model omits simply produces one
 * fewer option; a line that isn't a recognized OWNED:/MISSING: prefix is
 * folded into the reasoning text as-is. Both item lists are capped
 * independent of anything the model wrote, as defense in depth.
 */
function parseLooksOptions(answer: string): KinLooksOption[] {
  const options: KinLooksOption[] = [];
  for (let i = 0; i < LOOKS_OPTION_MARKERS.length; i++) {
    const { marker, label } = LOOKS_OPTION_MARKERS[i];
    const start = answer.indexOf(marker);
    if (start === -1) continue;
    const contentStart = start + marker.length;
    let end = answer.length;
    for (let j = i + 1; j < LOOKS_OPTION_MARKERS.length; j++) {
      const nextIndex = answer.indexOf(LOOKS_OPTION_MARKERS[j].marker, contentStart);
      if (nextIndex !== -1) { end = nextIndex; break; }
    }
    const section = answer.slice(contentStart, end).trim();
    const reasoningLines: string[] = [];
    const ownedItems: string[] = [];
    const missingItems: string[] = [];
    for (const rawLine of section.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const ownedMatch = line.match(/^OWNED:\s*(.*)$/i);
      const missingMatch = line.match(/^MISSING:\s*(.*)$/i);
      if (ownedMatch) ownedItems.push(...ownedMatch[1].split(",").map((s) => s.trim()).filter(Boolean));
      else if (missingMatch) missingItems.push(...missingMatch[1].split(",").map((s) => s.trim()).filter(Boolean));
      else reasoningLines.push(line);
    }
    options.push({
      label,
      reasoning: reasoningLines.join(" ").trim(),
      ownedItems: ownedItems.slice(0, MAX_LOOKS_ITEM_LIST_LENGTH),
      missingItems: missingItems.slice(0, MAX_LOOKS_ITEM_LIST_LENGTH),
    });
  }
  return options;
}

export function buildKinLooksResult(normalized: { answer: string; citations: KinSearchCitation[]; results: KinSearchResultCard[]; webSearchDegraded: boolean }): KinSearchResult {
  const options = parseLooksOptions(normalized.answer);
  const expected: KinLooksOption["label"][] = ["signature", "safe", "bold"];
  const complete = options.length === expected.length
    && options.every((option, index) => option.label === expected[index] && option.reasoning.trim().length >= 20);
  return complete
    ? { status: "ok", ...normalized, options }
    : { status: "partial", reason: "incomplete_recommendation", ...normalized, options };
}

/**
 * Resizes an already-validated (decodeAndReencodeClosetImage'd) image
 * buffer down to a size appropriate for a single Anthropic request. Callers
 * always pass an ephemeral, in-memory buffer here — this module never
 * touches object storage itself, so it stays independent of the closet/My
 * Things feature's storage code.
 */
async function reencodeForAnthropic(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer)
    .resize({ width: KIN_LOOKS_IMAGE_MAX_DIMENSION, height: KIN_LOOKS_IMAGE_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .webp({ quality: KIN_LOOKS_IMAGE_WEBP_QUALITY })
    .toBuffer();
}

/** true only for a well-formed https:// URL — never http://, never a fabricated/relative path. */
export function isValidHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Only ever reads typed fields off the SDK's own typed response content
 * blocks (title/url from a web_search_result block, title/url from a
 * web_search_result_location citation) — nothing here ever JSON.parses or
 * otherwise trusts freeform model text, which is the "AI output
 * validation" for this endpoint: output is safe by construction rather
 * than by a schema check after the fact. Every URL is additionally
 * required to be https:// before it is ever kept, and both lists are
 * capped independently of max_uses so a client always gets a short,
 * bounded, mobile-appropriate list.
 */
function normalizeAnthropicResponse(response: Anthropic.Message): { answer: string; citations: KinSearchCitation[]; results: KinSearchResultCard[]; webSearchDegraded: boolean } {
  let answer = "";
  const citationsByUrl = new Map<string, KinSearchCitation>();
  const resultsByUrl = new Map<string, KinSearchResultCard>();
  // Set structurally, from the SDK's own typed error variant for this block
  // (WebSearchToolResultError) — never inferred from anything the model's
  // own prose says about whether a search worked.
  let webSearchDegraded = false;

  for (const block of response.content) {
    if (block.type === "text") {
      answer += block.text;
      for (const citation of block.citations ?? []) {
        if (
          citation.type === "web_search_result_location"
          && isValidHttpsUrl(citation.url)
          && !citationsByUrl.has(citation.url)
          && citationsByUrl.size < MAX_CITATIONS
        ) {
          citationsByUrl.set(citation.url, { title: citation.title, url: citation.url });
        }
      }
    } else if (block.type === "web_search_tool_result") {
      if (!Array.isArray(block.content)) {
        webSearchDegraded = true;
        continue;
      }
      for (const item of block.content) {
        if (
          isValidHttpsUrl(item.url)
          && !resultsByUrl.has(item.url)
          && resultsByUrl.size < MAX_RESULTS
        ) {
          resultsByUrl.set(item.url, {
            title: item.title,
            source: hostnameOf(item.url),
            url: item.url,
            price: null,
            currency: null,
            imageUrl: null,
          });
        }
      }
    }
  }

  return { answer: answer.trim(), citations: [...citationsByUrl.values()], results: [...resultsByUrl.values()], webSearchDegraded };
}

/**
 * Best-effort: attaches a real product photo to up to
 * MAX_PRODUCT_IMAGE_LOOKUPS results by fetching each page's own og:image
 * (see link-preview.ts, which enforces the https/SSRF/size/time bounds).
 * A result whose page has no such tag, or whose fetch fails, keeps
 * imageUrl: null — never a fabricated or generic photo.
 */
async function attachProductImages(results: KinSearchResultCard[]): Promise<KinSearchResultCard[]> {
  if (results.length === 0) return results;
  const imagesByUrl = await fetchProductImagesFor(results.map((result) => ({ url: result.url, title: result.title })), MAX_PRODUCT_IMAGE_LOOKUPS);
  return results.map((result) => imagesByUrl.has(result.url) ? { ...result, imageUrl: imagesByUrl.get(result.url)! } : result);
}

/**
 * Runs one KIN search turn. Web search is a server-side Anthropic tool —
 * the provider executes searches and appends results within this single
 * request/response, so no client-side tool loop is needed here (unlike a
 * user-defined tool).
 *
 * imageBuffer, when given, is an already-validated (decoded/re-encoded,
 * MIME- and size-checked by the caller) image buffer — either an ephemeral
 * new photo that is never persisted, or the actual bytes of an owned My
 * Things item fetched by the caller. This function never fetches or
 * decodes an image itself; it only resizes what it's handed for the
 * Anthropic request.
 */
export async function runKinSearch(request: KinSearchRequest, myThingsItemContext?: string, imageBuffer?: Buffer, correlationId?: string): Promise<KinSearchResult> {
  const client = anthropicClient();
  if (!client) return { status: "unavailable", reason: "not configured" };

  let content: string | Anthropic.MessageParam["content"] = buildUserMessage(request, myThingsItemContext);
  if (imageBuffer) {
    try {
      const resized = await reencodeForAnthropic(imageBuffer);
      content = [
        { type: "image", source: { type: "base64", media_type: "image/webp", data: resized.toString("base64") } },
        { type: "text", text: buildUserMessage(request, myThingsItemContext) },
      ];
    } catch (error) {
      return { status: "unavailable", reason: sanitizeErrorReason("image processing failed", error) };
    }
  }

  try {
    // maxRetries: 0 — the SDK's default retry-on-timeout behavior would
    // otherwise multiply KIN_SEARCH_TIMEOUT_MS by up to 3x (see the
    // identical reasoning in closet-image-analysis.ts).
    const response = await client.messages.create(
      {
        model: kinSearchModel(),
        max_tokens: MAX_OUTPUT_TOKENS,
        system: request.mode === "looks" ? looksSystemPrompt(request.locale) : travelSystemPrompt(request.locale),
        messages: [{ role: "user", content }],
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxWebUses() }],
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
      },
      { timeout: kinSearchTimeoutMs(), maxRetries: 0 },
    );

    logger.info({ correlationId: correlationId ?? null, providerRequestId: response.id, mode: request.mode, model: response.model, stopReason: response.stop_reason }, "KIN search: Anthropic completion");
    if (response.stop_reason === "refusal") return { status: "unavailable", reason: "refusal" };
    const normalized = normalizeAnthropicResponse(response);
    if (request.mode === "looks") {
      const withImages = await attachProductImages(normalized.results);
      return buildKinLooksResult({ ...normalized, results: withImages });
    }
    return { status: "ok", ...normalized };
  } catch (error) {
    logProviderError(error, { model: kinSearchModel(), webSearchEnabled: maxWebUses() > 0, correlationId });
    return { status: "unavailable", reason: sanitizeErrorReason("kin search request failed", error) };
  }
}

// --- KIN Travel stays: one short "why KIN picked this" per real stay ------

// Sized for one sentence per candidate across a whole stay pool (up to 20
// per kind, both kinds in one call) — see staysForPlan in kin-travel.ts.
const MAX_STAY_REASON_TOKENS = 2000;
const MAX_STAY_REASON_LENGTH = 240;

/** The real, code-supplied facts about one stay — the only material the model may reason from. */
export type KinStayReasonInput = {
  kind: "hotel" | "apartment";
  name: string;
  formattedAddress: string | null;
  rating: number | null;
  priceLevel: number | null;
  types: string[];
};

function stayReasonsSystemPrompt(locale: "en" | "ar" | undefined): string {
  const languageLine = locale === "ar"
    ? "Write every sentence in Arabic, keeping the stay's own name exactly as given."
    : locale === "en"
      ? "Write every sentence in English, keeping the stay's own name exactly as given."
      : "Write in the member's language, keeping the stay's own name exactly as given.";
  return [
    "You are KIN, TASTEKIN's travel assistant. The member is choosing where to stay. Below is a numbered list of real places the app already found, each with the only facts available about it.",
    "For each numbered stay, write exactly one sentence (at most 25 words) explaining why it could suit this member's trip and stated preferences, using ONLY the facts given for that stay.",
    "Never invent or imply amenities, nightly prices, star classes, distances, availability, reviews, or anything not listed. If the facts are thin, keep the sentence general rather than guessing.",
    "Output exactly one line per stay, in the same order, in the form `<number>: <sentence>` — no headings, no extra lines, no markdown.",
    languageLine,
  ].join(" ");
}

const PRICE_LEVEL_WORDS: Record<number, string> = { 1: "inexpensive", 2: "moderate", 3: "expensive", 4: "very expensive" };

function stayReasonsUserMessage(destination: string, accommodation: KinAccommodationRequest, stays: KinStayReasonInput[]): string {
  const lines = [`Destination: ${destination}`, ...accommodationContextLines(accommodation), "", "Stays:"];
  stays.forEach((stay, index) => {
    const facts = [
      stay.kind === "hotel" ? "hotel" : "apartment or home",
      stay.formattedAddress ? `area: ${stay.formattedAddress}` : null,
      stay.rating !== null ? `Google rating ${stay.rating}` : null,
      stay.priceLevel !== null && PRICE_LEVEL_WORDS[stay.priceLevel] ? `price level: ${PRICE_LEVEL_WORDS[stay.priceLevel]}` : null,
      stay.types.length ? `place types: ${stay.types.slice(0, 4).join(", ")}` : null,
    ].filter(Boolean);
    lines.push(`${index + 1}. ${stay.name} — ${facts.join("; ")}`);
  });
  return lines.join("\n");
}

/**
 * Mechanical parse of `<number>: <sentence>` lines — the same fixed-delimiter
 * idea as parseLooksOptions. A stay the model skipped simply has no reason
 * (null on the card), never a fabricated one; anything past the cap is cut.
 */
export function parseStayReasons(answer: string, count: number): Map<number, string> {
  const reasons = new Map<number, string>();
  for (const rawLine of answer.split("\n")) {
    const match = rawLine.trim().match(/^(\d+)\s*[:.)-]\s*(.+)$/);
    if (!match) continue;
    const index = Number.parseInt(match[1], 10) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= count || reasons.has(index)) continue;
    const sentence = match[2].trim().replace(/\s+/g, " ").slice(0, MAX_STAY_REASON_LENGTH);
    if (sentence) reasons.set(index, sentence);
  }
  return reasons;
}

/**
 * One Anthropic call, no web search, for every stay in the list at once —
 * never one call per stay. Returns the reasons it could parse, keyed by
 * list index; any provider failure yields an empty map so the stays are
 * still shown (with no reason) rather than the whole plan failing. Never
 * retried — a retry is a second charge.
 */
export async function runKinStayReasons(
  input: { destination: string; accommodation: KinAccommodationRequest; stays: KinStayReasonInput[]; locale?: "en" | "ar" },
  correlationId?: string,
): Promise<Map<number, string>> {
  const client = anthropicClient();
  if (!client || input.stays.length === 0) return new Map();
  try {
    const response = await client.messages.create(
      {
        model: kinSearchModel(),
        max_tokens: MAX_STAY_REASON_TOKENS,
        system: stayReasonsSystemPrompt(input.locale),
        messages: [{ role: "user", content: stayReasonsUserMessage(input.destination, input.accommodation, input.stays) }],
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
      },
      { timeout: kinSearchTimeoutMs(), maxRetries: 0 },
    );
    logger.info({ correlationId: correlationId ?? null, providerRequestId: response.id, mode: "travel_stays", model: response.model, stopReason: response.stop_reason }, "KIN search: Anthropic completion");
    if (response.stop_reason === "refusal") return new Map();
    const answer = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map((block) => block.text).join("\n");
    return parseStayReasons(answer, input.stays.length);
  } catch (error) {
    logProviderError(error, { model: kinSearchModel(), webSearchEnabled: false, correlationId });
    return new Map();
  }
}
