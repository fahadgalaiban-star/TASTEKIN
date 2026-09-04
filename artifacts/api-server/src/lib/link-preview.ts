import dns from "node:dns";
import net from "node:net";

export const LINK_PREVIEW_TIMEOUT_MS = 4_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 300_000;
const MAX_CONCURRENT_LOOKUPS = 3;

/** true only for a well-formed https:// URL. */
function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * True if the address is loopback, private, link-local, CGNAT, multicast,
 * or otherwise non-public — a page whose hostname resolves here must never
 * be fetched, since that would let a malicious (or merely misconfigured)
 * search result reach internal infrastructure from our server.
 */
function isDisallowedIp(address: string): boolean {
  const kind = net.isIP(address);
  if (kind === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (kind === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local fe80::/10
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isDisallowedIp(mapped[1]);
    return false;
  }
  return true; // couldn't parse as an IP at all — refuse rather than guess
}

/**
 * Test-only escape hatch, off by default in every real deployment: an
 * explicit, exact-hostname allowlist (never a range) so the disposable
 * test harness can point this fetcher at its own local fixture server
 * without weakening the actual private/loopback-IP check for anything
 * else — the same env-var-override pattern already used for
 * ANTHROPIC_BASE_URL / GOOGLE_PLACES_BASE_URL to redirect outbound calls
 * to fakes in tests.
 */
function isAllowedTestHost(hostname: string): boolean {
  const allowlist = process.env.LINK_PREVIEW_ALLOW_HOSTS?.split(",").map((h) => h.trim()).filter(Boolean) ?? [];
  return allowlist.includes(hostname);
}

/**
 * Resolves every address a hostname maps to and refuses if any of them is
 * non-public. This still leaves a narrow DNS-rebinding window between this
 * check and the actual TCP connect a moment later (Node's fetch doesn't
 * expose per-request IP pinning) — a known, accepted limitation of this
 * lightweight mitigation, not a claim of complete SSRF immunity.
 */
async function hostnameResolvesPublicly(hostname: string): Promise<boolean> {
  if (isAllowedTestHost(hostname)) return true;
  if (net.isIP(hostname)) return !isDisallowedIp(hostname);
  try {
    const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0) return false;
    return records.every((record) => !isDisallowedIp(record.address));
  } catch {
    return false;
  }
}

/** Extracts a relative-or-absolute image URL from an og:image/twitter:image meta tag, if present — never guessed. */
function extractImageMetaUrl(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Reads at most maxBytes from a response body, then aborts the connection — never buffers an unbounded reply. */
async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let received = 0;
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

/**
 * Best-effort, safety-bounded fetch of a real product page's og:image (or
 * twitter:image) meta tag — used only to show a genuine photo for a
 * shopping result Anthropic's web search already returned, never to
 * fabricate one. Manually follows redirects (capped, each hop re-checked)
 * rather than letting fetch auto-follow, so a redirect can't be used to
 * reach a disallowed address after the initial hostname passed the check.
 * Returns null on any failure, timeout, disallowed host, non-HTML
 * response, or missing tag — the caller must treat null as "no image",
 * never retry, and never invent a fallback.
 */
export async function fetchProductImageUrl(pageUrl: string): Promise<string | null> {
  let currentUrl = pageUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isHttpsUrl(currentUrl)) return null;
    const parsed = new URL(currentUrl);
    if (!(await hostnameResolvesPublicly(parsed.hostname))) return null;

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; TastekinLinkPreview/1.0)" },
        signal: AbortSignal.timeout(LINK_PREVIEW_TIMEOUT_MS),
      });
    } catch {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return null;
      }
      continue;
    }

    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) return null;

    const html = await readBounded(response, MAX_RESPONSE_BYTES);
    const rawImageUrl = extractImageMetaUrl(html);
    if (!rawImageUrl) return null;
    try {
      const resolved = new URL(rawImageUrl, currentUrl).toString();
      return isHttpsUrl(resolved) ? resolved : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Resolves product images for up to `limit` result URLs, with bounded
 * concurrency so this never turns one search into an unbounded fan-out of
 * outbound requests. Failures are independent — one slow/broken page never
 * blocks or nulls out the others.
 */
export async function fetchProductImagesFor(urls: string[], limit: number): Promise<Map<string, string>> {
  const targets = urls.slice(0, limit);
  const results = new Map<string, string>();
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const url = targets[index];
      const imageUrl = await fetchProductImageUrl(url).catch(() => null);
      if (imageUrl) results.set(url, imageUrl);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_LOOKUPS, targets.length) }, worker));
  return results;
}
