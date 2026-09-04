import Anthropic from "@anthropic-ai/sdk";

const MAX_ERROR_LENGTH = 200;

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

export const DEFAULT_KIN_SEARCH_MODEL = "claude-opus-5";
export const DEFAULT_KIN_SEARCH_MAX_WEB_USES = 3;
export const KIN_SEARCH_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 2048;
const MAX_QUERY_LENGTH = 2000;
const MAX_TEXT_FIELD_LENGTH = 200;

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

export type KinSearchRequest = {
  mode: KinSearchMode;
  query: string;
  myThingsItemId?: string;
  location?: string;
  budget?: number;
  currency?: string;
  size?: string;
  occasion?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
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

export type KinSearchResult =
  | { status: "ok"; answer: string; citations: KinSearchCitation[]; results: KinSearchResultCard[] }
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

  return { ok: true, value };
}

// --- prompting -----------------------------------------------------------

const LOOKS_SYSTEM_PROMPT = [
  "You are KIN, TASTEKIN's personal styling assistant.",
  "The member describes what they need in natural language; use the web_search tool to ground any specific, current claim — prices, availability, what's in season, retailer stock — in a real search result. Never state a specific price, availability, or product detail you did not find in a search result.",
  "If the member gave an existing wardrobe item as context, build the recommendation around it rather than replacing it.",
  "Write a warm, concise, editorial answer in the member's language. Never invent a URL, retailer name, or product.",
].join(" ");

const TRAVEL_SYSTEM_PROMPT = [
  "You are KIN, TASTEKIN's travel planning assistant.",
  "The member describes the trip they want in natural language; use the web_search tool to ground any specific, current claim — opening hours, weather, current events, reservations, prices — in a real search result. Never state a specific fact you did not find in a search result.",
  "Write a warm, concise, editorial answer in the member's language, organized around what the member actually asked for. Never invent a URL, venue name, or event.",
].join(" ");

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
  }
  if (myThingsItemContext) context.push(`Existing wardrobe item to consider: ${myThingsItemContext}`);

  const parts = [request.query];
  if (context.length) parts.push(`Context:\n${context.map((line) => `- ${line}`).join("\n")}`);
  return parts.join("\n\n");
}

// --- response normalization ------------------------------------------------

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
 * than by a schema check after the fact.
 */
function normalizeAnthropicResponse(response: Anthropic.Message): { answer: string; citations: KinSearchCitation[]; results: KinSearchResultCard[] } {
  let answer = "";
  const citationsByUrl = new Map<string, KinSearchCitation>();
  const resultsByUrl = new Map<string, KinSearchResultCard>();

  for (const block of response.content) {
    if (block.type === "text") {
      answer += block.text;
      for (const citation of block.citations ?? []) {
        if (citation.type === "web_search_result_location" && !citationsByUrl.has(citation.url)) {
          citationsByUrl.set(citation.url, { title: citation.title, url: citation.url });
        }
      }
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const item of block.content) {
        if (!resultsByUrl.has(item.url)) {
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

  return { answer: answer.trim(), citations: [...citationsByUrl.values()], results: [...resultsByUrl.values()] };
}

/**
 * Runs one KIN search turn. Web search is a server-side Anthropic tool —
 * the provider executes searches and appends results within this single
 * request/response, so no client-side tool loop is needed here (unlike a
 * user-defined tool).
 */
export async function runKinSearch(request: KinSearchRequest, myThingsItemContext?: string): Promise<KinSearchResult> {
  const client = anthropicClient();
  if (!client) return { status: "unavailable", reason: "not configured" };

  try {
    // maxRetries: 0 — the SDK's default retry-on-timeout behavior would
    // otherwise multiply KIN_SEARCH_TIMEOUT_MS by up to 3x (see the
    // identical reasoning in closet-image-analysis.ts).
    const response = await client.messages.create(
      {
        model: kinSearchModel(),
        max_tokens: MAX_OUTPUT_TOKENS,
        system: request.mode === "looks" ? LOOKS_SYSTEM_PROMPT : TRAVEL_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(request, myThingsItemContext) }],
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxWebUses() }],
      },
      { timeout: kinSearchTimeoutMs(), maxRetries: 0 },
    );

    if (response.stop_reason === "refusal") return { status: "unavailable", reason: "refusal" };
    return { status: "ok", ...normalizeAnthropicResponse(response) };
  } catch (error) {
    return { status: "unavailable", reason: sanitizeErrorReason("kin search request failed", error) };
  }
}
