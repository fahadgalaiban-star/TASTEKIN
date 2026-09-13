import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Video Foundation, Phase 1 — a server-only wrapper around Bunny Stream's
 * Video Library REST API. Mirrors this codebase's existing provider-wrapper
 * shape (see google-places.ts): config is read lazily (never at module
 * import time, so a missing BUNNY_STREAM_API_KEY/BUNNY_STREAM_LIBRARY_ID
 * can never crash server startup), every network call has a bounded
 * timeout, and every function returns a typed `{status:"ok",...} |
 * {status:"unavailable", reason}` result rather than throwing — a failure
 * or missing configuration is a normal, testable outcome, never a crash.
 *
 * The Bunny private API key is only ever read from server-side
 * configuration (or, for tests, an explicitly injected BunnyStreamDeps
 * value) and is never included in any returned value, log line, or thrown
 * error message — see the individual functions below for exactly what is
 * and isn't ever logged.
 *
 * No route in this phase calls any of this — see the Phase 1 scope notes
 * in feature-flags.ts's "video_upload" definition. This file exists so a
 * later phase's upload-authorization and status-reconciliation endpoints
 * have a tested foundation to build on.
 */

const DEFAULT_BASE_URL = "https://video.bunnycdn.com";
export const BUNNY_STREAM_TIMEOUT_MS = 8_000;

/**
 * Bunny's single global TUS resumable-upload endpoint (not scoped by
 * library — that's what AuthorizationSignature/LibraryId in the upload's
 * TUS metadata are for). Published here, not called from this file: no
 * TUS client is implemented in this codebase yet, so this is only ever
 * handed to an API response for a future client to use directly with a
 * TUS library of its own.
 */
export const BUNNY_TUS_UPLOAD_ENDPOINT = "https://video.bunnycdn.com/tusupload";

export type BunnyStreamDeps = {
  baseUrl?: string;
  apiKey?: string;
  libraryId?: string;
  timeoutMs?: number;
};

type ResolvedBunnyConfig = {
  baseUrl: string;
  apiKey: string;
  libraryId: string;
  timeoutMs: number;
};

/**
 * Lazily read, never at module import time — a missing key must never
 * crash server startup, and video_upload being disabled must never depend
 * on these being set at all. Never logged, never echoed in any response.
 */
function resolveConfig(deps?: BunnyStreamDeps): ResolvedBunnyConfig | null {
  const apiKey = deps?.apiKey ?? process.env.BUNNY_STREAM_API_KEY?.trim();
  const libraryId = deps?.libraryId ?? process.env.BUNNY_STREAM_LIBRARY_ID?.trim();
  if (!apiKey || !libraryId) return null;
  return {
    apiKey,
    libraryId,
    baseUrl: deps?.baseUrl ?? (process.env.BUNNY_STREAM_BASE_URL?.trim() || DEFAULT_BASE_URL),
    // BUNNY_STREAM_TIMEOUT_MS_OVERRIDE exists only so regression tests can
    // exercise the timeout path in milliseconds instead of real seconds —
    // never set in any real environment, exactly like index.ts's own
    // MIGRATIONS_FOLDER_OVERRIDE.
    timeoutMs: deps?.timeoutMs ?? (Number(process.env.BUNNY_STREAM_TIMEOUT_MS_OVERRIDE) || BUNNY_STREAM_TIMEOUT_MS),
  };
}

export function isBunnyStreamConfigured(deps?: BunnyStreamDeps): boolean {
  return resolveConfig(deps) !== null;
}

function requestHeaders(config: ResolvedBunnyConfig): Record<string, string> {
  return {
    AccessKey: config.apiKey,
    Accept: "application/json",
  };
}

/** True only for a plausible, non-empty Bunny video GUID — never trusts an arbitrary string through unchecked. */
function isPlausibleVideoId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function timeoutReason(error: unknown): string {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError") ? "timeout" : "network error";
}

export type BunnyCreateVideoResult =
  | { status: "ok"; videoId: string }
  | { status: "unavailable"; reason: string };

/**
 * Creates a new (empty) video object in the configured library — the
 * first step before a client can be authorized to upload bytes to it via
 * TUS (see createBunnyTusUploadAuthorization). `title` is stored by Bunny
 * only for the library owner's own dashboard; it is never shown to end
 * users by this codebase in this phase.
 */
export async function createBunnyVideo(title: string, deps?: BunnyStreamDeps): Promise<BunnyCreateVideoResult> {
  const config = resolveConfig(deps);
  if (!config) return { status: "unavailable", reason: "not configured" };
  const trimmedTitle = title.trim().slice(0, 200) || "Untitled";
  try {
    const response = await fetch(`${config.baseUrl}/library/${encodeURIComponent(config.libraryId)}/videos`, {
      method: "POST",
      headers: { ...requestHeaders(config), "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmedTitle }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) return { status: "unavailable", reason: `HTTP ${response.status}` };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "unavailable", reason: "malformed response" };
    }
    const videoId = payload && typeof payload === "object" ? (payload as { guid?: unknown }).guid : undefined;
    if (!isPlausibleVideoId(videoId)) return { status: "unavailable", reason: "malformed response" };
    return { status: "ok", videoId };
  } catch (error) {
    return { status: "unavailable", reason: timeoutReason(error) };
  }
}

export type BunnyVideoMetadata = {
  videoId: string;
  /**
   * Bunny's own raw numeric status code — this wrapper deliberately does
   * not interpret or map it onto video_uploads' own
   * uploading/processing/ready/failed/deleted states; that reconciliation
   * belongs to the (not-yet-implemented) Phase 2 webhook/status handler,
   * which can apply its own defensive mapping and log the raw code
   * whenever it sees an unrecognized value.
   */
  bunnyStatus: number;
  title: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  thumbnailFileName: string | null;
};

export type BunnyGetVideoResult =
  | { status: "ok"; video: BunnyVideoMetadata }
  | { status: "unavailable"; reason: string };

/** Fetches the current status and metadata Bunny holds for one video. */
export async function getBunnyVideoStatus(videoId: string, deps?: BunnyStreamDeps): Promise<BunnyGetVideoResult> {
  const config = resolveConfig(deps);
  if (!config) return { status: "unavailable", reason: "not configured" };
  if (!isPlausibleVideoId(videoId)) return { status: "unavailable", reason: "invalid video id" };
  try {
    const response = await fetch(`${config.baseUrl}/library/${encodeURIComponent(config.libraryId)}/videos/${encodeURIComponent(videoId)}`, {
      method: "GET",
      headers: requestHeaders(config),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (response.status === 404) return { status: "unavailable", reason: "not found" };
    if (!response.ok) return { status: "unavailable", reason: `HTTP ${response.status}` };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "unavailable", reason: "malformed response" };
    }
    if (!payload || typeof payload !== "object") return { status: "unavailable", reason: "malformed response" };
    const record = payload as Record<string, unknown>;
    if (!isPlausibleVideoId(record.guid) || typeof record.status !== "number") {
      return { status: "unavailable", reason: "malformed response" };
    }
    return {
      status: "ok",
      video: {
        videoId: record.guid,
        bunnyStatus: record.status,
        title: typeof record.title === "string" ? record.title : null,
        durationSeconds: typeof record.length === "number" ? record.length : null,
        width: typeof record.width === "number" ? record.width : null,
        height: typeof record.height === "number" ? record.height : null,
        thumbnailFileName: typeof record.thumbnailFileName === "string" ? record.thumbnailFileName : null,
      },
    };
  } catch (error) {
    return { status: "unavailable", reason: timeoutReason(error) };
  }
}

export type BunnyDeleteVideoResult =
  | { status: "ok" }
  | { status: "unavailable"; reason: string };

/**
 * Deletes a video object. Idempotent — a 404 (already deleted, or never
 * existed) is treated as success, matching this codebase's existing
 * deletePrivateMedia/deleteClosetMedia convention, so a retried cleanup
 * attempt is always safe.
 */
export async function deleteBunnyVideo(videoId: string, deps?: BunnyStreamDeps): Promise<BunnyDeleteVideoResult> {
  const config = resolveConfig(deps);
  if (!config) return { status: "unavailable", reason: "not configured" };
  if (!isPlausibleVideoId(videoId)) return { status: "unavailable", reason: "invalid video id" };
  try {
    const response = await fetch(`${config.baseUrl}/library/${encodeURIComponent(config.libraryId)}/videos/${encodeURIComponent(videoId)}`, {
      method: "DELETE",
      headers: requestHeaders(config),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok && response.status !== 404) return { status: "unavailable", reason: `HTTP ${response.status}` };
    return { status: "ok" };
  } catch (error) {
    return { status: "unavailable", reason: timeoutReason(error) };
  }
}

/**
 * The official Bunny Stream TUS resumable-upload signature:
 * SHA256(libraryId + apiKey + expirationTime + videoId), hex-encoded.
 * Pure and deterministic — no I/O, no config lookup — so it can be tested
 * directly against a known input/output pair without touching the
 * network or any environment variable. Never log the returned value: it
 * is a bearer credential for uploading to this exact video for as long as
 * expirationTime allows.
 */
export function computeBunnyTusSignature(params: { libraryId: string; apiKey: string; expirationTime: number; videoId: string }): string {
  const { libraryId, apiKey, expirationTime, videoId } = params;
  return createHash("sha256").update(`${libraryId}${apiKey}${expirationTime}${videoId}`).digest("hex");
}

export type BunnyTusUploadAuthorization = {
  libraryId: string;
  videoId: string;
  expirationTime: number;
  signature: string;
};

export type BunnyTusUploadAuthorizationResult =
  | { status: "ok"; authorization: BunnyTusUploadAuthorization }
  | { status: "unavailable"; reason: string };

/**
 * Convenience wrapper around computeBunnyTusSignature for real (or
 * fake-provider-configured) use: reads the library id/api key from
 * config, picks a bounded expiration, and returns everything a future
 * TUS-client caller needs — except the api key itself, which never
 * leaves this function.
 */
export function createBunnyTusUploadAuthorization(
  videoId: string,
  ttlSeconds = 60 * 60,
  deps?: BunnyStreamDeps,
): BunnyTusUploadAuthorizationResult {
  const config = resolveConfig(deps);
  if (!config) return { status: "unavailable", reason: "not configured" };
  if (!isPlausibleVideoId(videoId)) return { status: "unavailable", reason: "invalid video id" };
  const expirationTime = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds));
  const signature = computeBunnyTusSignature({ libraryId: config.libraryId, apiKey: config.apiKey, expirationTime, videoId });
  return { status: "ok", authorization: { libraryId: config.libraryId, videoId, expirationTime, signature } };
}

export type BunnyListVideosItem = { videoId: string; title: string | null; bunnyStatus: number };
export type BunnyListVideosPageResult =
  | { status: "ok"; items: BunnyListVideosItem[]; totalItems: number; currentPage: number; itemsPerPage: number }
  | { status: "unavailable"; reason: string };

const LIST_VIDEOS_MAX_ITEMS_PER_PAGE = 1000;

/**
 * Fetches one page of Bunny's List Videos response for the configured
 * library — used only by video-upload-recovery.ts's orphan search
 * (findOrphanCandidateByTitle), never by ordinary create/status/cancel
 * flows. Defensively validates every item's shape exactly like
 * getBunnyVideoStatus, since this response drives an identity match that
 * a later step may act on (adopting or deleting a video) — a malformed
 * item is never silently skipped or coerced, the whole page is rejected.
 */
export async function listBunnyVideosPage(page: number, itemsPerPage: number, deps?: BunnyStreamDeps): Promise<BunnyListVideosPageResult> {
  const config = resolveConfig(deps);
  if (!config) return { status: "unavailable", reason: "not configured" };
  if (!Number.isInteger(page) || page < 1) return { status: "unavailable", reason: "invalid page" };
  if (!Number.isInteger(itemsPerPage) || itemsPerPage < 1 || itemsPerPage > LIST_VIDEOS_MAX_ITEMS_PER_PAGE) {
    return { status: "unavailable", reason: "invalid itemsPerPage" };
  }
  try {
    const url = new URL(`${config.baseUrl}/library/${encodeURIComponent(config.libraryId)}/videos`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("itemsPerPage", String(itemsPerPage));
    const response = await fetch(url, {
      method: "GET",
      headers: requestHeaders(config),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) return { status: "unavailable", reason: `HTTP ${response.status}` };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "unavailable", reason: "malformed response" };
    }
    if (!payload || typeof payload !== "object") return { status: "unavailable", reason: "malformed response" };
    const record = payload as Record<string, unknown>;
    if (!Array.isArray(record.items) || typeof record.totalItems !== "number" || typeof record.currentPage !== "number" || typeof record.itemsPerPage !== "number") {
      return { status: "unavailable", reason: "malformed response" };
    }
    const items: BunnyListVideosItem[] = [];
    for (const raw of record.items) {
      if (!raw || typeof raw !== "object") return { status: "unavailable", reason: "malformed response" };
      const item = raw as Record<string, unknown>;
      if (!isPlausibleVideoId(item.guid) || typeof item.status !== "number") return { status: "unavailable", reason: "malformed response" };
      items.push({ videoId: item.guid, title: typeof item.title === "string" ? item.title : null, bunnyStatus: item.status });
    }
    return { status: "ok", items, totalItems: record.totalItems, currentPage: record.currentPage, itemsPerPage: record.itemsPerPage };
  } catch (error) {
    return { status: "unavailable", reason: timeoutReason(error) };
  }
}

const ORPHAN_SEARCH_PAGE_SIZE = 100;
const ORPHAN_SEARCH_MAX_PAGES = 50;

export type BunnyOrphanLookupResult =
  | { status: "found"; videoId: string; bunnyStatus: number }
  | { status: "not_found" }
  | { status: "ambiguous"; count: number }
  | { status: "unavailable"; reason: string };

/**
 * Pages through every video in `libraryId` looking for an *exact* title
 * match — used by video-upload-recovery.ts to find a possible orphan left
 * by an ambiguous create (see routes/video-uploads.ts: the Bunny video's
 * title is always the video_uploads row's own stable UUID, never the
 * user's filename, precisely so this search can be exact rather than a
 * fuzzy/substring guess). `libraryId` is always the caller's own
 * parameter, never overridable via `deps` — the same "never trust a
 * possibly-stale env var over the row's own persisted library id"
 * discipline the rest of this file already follows for reconcile/cancel.
 *
 * Never returns a match on anything less than full, successful
 * pagination: running out of the page budget, a provider error on any
 * page, or more than one exact match all come back as "unavailable" /
 * "ambiguous" rather than guessing — the caller (recoverAmbiguousUpload)
 * treats every one of those the same way: leave the row's state
 * unresolved and try again later, never adopt or delete on a guess.
 */
export async function findOrphanCandidateByTitle(
  libraryId: string,
  title: string,
  deps?: Omit<BunnyStreamDeps, "libraryId">,
): Promise<BunnyOrphanLookupResult> {
  const matches: BunnyListVideosItem[] = [];
  for (let page = 1; page <= ORPHAN_SEARCH_MAX_PAGES; page += 1) {
    const result = await listBunnyVideosPage(page, ORPHAN_SEARCH_PAGE_SIZE, { ...deps, libraryId });
    if (result.status !== "ok") return { status: "unavailable", reason: result.reason };
    for (const item of result.items) {
      if (item.title === title) matches.push(item);
    }
    const totalPages = Math.max(1, Math.ceil(result.totalItems / result.itemsPerPage));
    if (page >= totalPages) {
      if (matches.length === 0) return { status: "not_found" };
      if (matches.length > 1) return { status: "ambiguous", count: matches.length };
      return { status: "found", videoId: matches[0].videoId, bunnyStatus: matches[0].bunnyStatus };
    }
  }
  return { status: "unavailable", reason: "incomplete pagination" };
}

// --- Webhook signature verification -----------------------------------------
//
// Bunny Stream signs webhook deliveries with three headers:
// X-BunnyStream-Signature-Version ("v1"), X-BunnyStream-Signature-Algorithm
// ("hmac-sha256"), and X-BunnyStream-Signature (a lowercase-hex HMAC-SHA256
// of the exact raw request body, keyed with the library's Read-Only API
// key). This is a distinct, lower-privilege credential from
// BUNNY_STREAM_API_KEY (which can create/delete videos) — never fall back
// to reusing the write key here. Deliberately unable to verify egress
// documentation live in this environment; if Bunny's dashboard ever shows
// different header names for a specific library, update
// BUNNY_WEBHOOK_SIGNATURE_HEADER et al. below rather than the callers.

export const BUNNY_WEBHOOK_SIGNATURE_VERSION = "v1";
export const BUNNY_WEBHOOK_SIGNATURE_ALGORITHM = "hmac-sha256";
export const BUNNY_WEBHOOK_SIGNATURE_HEADER = "x-bunnystream-signature";
export const BUNNY_WEBHOOK_SIGNATURE_VERSION_HEADER = "x-bunnystream-signature-version";
export const BUNNY_WEBHOOK_SIGNATURE_ALGORITHM_HEADER = "x-bunnystream-signature-algorithm";

export type BunnyWebhookDeps = { readOnlyApiKey?: string };

/** Lazily read, never at module import time — same discipline as resolveConfig above, and a wholly separate credential from it. */
function resolveWebhookSecret(deps?: BunnyWebhookDeps): string | null {
  const key = deps?.readOnlyApiKey ?? process.env.BUNNY_STREAM_READONLY_API_KEY?.trim();
  return key || null;
}

export function isBunnyWebhookConfigured(deps?: BunnyWebhookDeps): boolean {
  return resolveWebhookSecret(deps) !== null;
}

const HEX64_RE = /^[0-9a-f]{64}$/i;

/** Constant-time hex comparison — never short-circuits on the first differing byte, and never throws on mismatched lengths (checked explicitly first). */
function safeCompareHex(expectedHex: string, providedHex: string): boolean {
  if (expectedHex.length !== providedHex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(providedHex, "hex"));
  } catch {
    return false;
  }
}

export type VerifyBunnyWebhookSignatureParams = {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  versionHeader: string | undefined;
  algorithmHeader: string | undefined;
};

export type VerifyBunnyWebhookSignatureResult =
  | { status: "ok" }
  | { status: "invalid"; reason: string };

/**
 * Verifies a webhook delivery's signature against the exact raw body
 * bytes as received — never a re-serialized JSON.stringify(req.body),
 * which is not guaranteed to reproduce Bunny's original byte-for-byte
 * payload (key order, whitespace, unicode escaping can all differ). The
 * signing secret is never logged; the provided/expected signatures are
 * never logged either (see routes/video-uploads.ts's webhook handler).
 */
export function verifyBunnyWebhookSignature(params: VerifyBunnyWebhookSignatureParams, deps?: BunnyWebhookDeps): VerifyBunnyWebhookSignatureResult {
  const secret = resolveWebhookSecret(deps);
  if (!secret) return { status: "invalid", reason: "not configured" };
  if (params.versionHeader !== BUNNY_WEBHOOK_SIGNATURE_VERSION) return { status: "invalid", reason: "unsupported signature version" };
  if (params.algorithmHeader !== BUNNY_WEBHOOK_SIGNATURE_ALGORITHM) return { status: "invalid", reason: "unsupported signature algorithm" };
  if (!params.signatureHeader || !HEX64_RE.test(params.signatureHeader)) return { status: "invalid", reason: "missing or malformed signature" };
  const expected = createHmac("sha256", secret).update(params.rawBody).digest("hex");
  if (!safeCompareHex(expected, params.signatureHeader.toLowerCase())) return { status: "invalid", reason: "signature mismatch" };
  return { status: "ok" };
}
