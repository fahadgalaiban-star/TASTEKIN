// Automated regression coverage for KIN core search (PR 1 of the KIN
// stage): the authenticated POST /kin/search endpoint backing KIN Looks
// and KIN Travel. Runs the compiled api-server against a REAL Postgres
// database (point DATABASE_URL at a disposable/test database) and drives
// it over real HTTP. Never calls the real Anthropic API — a fake
// in-process HTTP server stands in for it, reached via ANTHROPIC_BASE_URL
// (the same mechanism used by verify-closet-analysis.ts).
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:kin-search
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closetItems, closetMediaUploads, db, kinSavedRecommendations, kinSearchUsage, kinTripItems, kinTrips } from "@workspace/db";
import { eq } from "drizzle-orm";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

// --- fake object-storage sidecar (needed only so /closet-items/media still
// works for the "existing My Things item as context" fixture) -------------

const store = new Map<string, Buffer>();
const FAKE_SIDECAR_PORT = 1116;

function startFakeSidecar(): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        if (req.method === "POST" && req.url === "/object-storage/signed-object-url") {
          const parsed = JSON.parse(body.toString("utf8")) as { bucket_name: string; object_name: string };
          const key = encodeURIComponent(`${parsed.bucket_name}/${parsed.object_name}`);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ signed_url: `http://127.0.0.1:${FAKE_SIDECAR_PORT}/storage-object/${key}` }));
          return;
        }
        const match = req.url?.match(/^\/storage-object\/(.+)$/);
        if (match) {
          const key = decodeURIComponent(match[1]);
          if (req.method === "PUT") { store.set(key, body); res.writeHead(200); res.end(); return; }
          if (req.method === "GET") {
            const stored = store.get(key);
            if (!stored) { res.writeHead(404); res.end(); return; }
            res.writeHead(200); res.end(stored);
            return;
          }
        }
        res.writeHead(404); res.end();
      });
    });
    server.listen(FAKE_SIDECAR_PORT, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

// --- fake Anthropic provider -------------------------------------------------
//
// Implements only what the SDK actually calls: POST /v1/messages. Returns
// a Message-shaped JSON body whose content mirrors what a real web-search
// -grounded response looks like: a server_tool_use block, a
// web_search_tool_result block, and a text block carrying a citation.

type FakeAnthropicMode =
  | { kind: "ok" }
  | { kind: "no_results" }
  | { kind: "refusal" }
  | { kind: "http_error"; status: number; message?: string; errorType?: string }
  | { kind: "timeout" }
  | { kind: "bad_and_excess_urls" }
  | { kind: "looks_options" }
  | { kind: "looks_product_page" }
  | { kind: "looks_arabic" }
  | { kind: "travel_progress" }
  | { kind: "web_search_error" };

let fakeAnthropicMode: FakeAnthropicMode = { kind: "ok" };
let lastAnthropicRequestBody = "";
let anthropicRequestCount = 0;
// Set once the fake HTTPS product-page server is listening (see main()) —
// only "looks_product_page" mode reads this.
let fakeProductPageBaseUrl = "";

function startFakeAnthropic(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        if (req.method !== "POST" || req.url !== "/v1/messages") { res.writeHead(404); res.end(); return; }
        lastAnthropicRequestBody = Buffer.concat(chunks).toString("utf8");
        anthropicRequestCount += 1;
        const mode = fakeAnthropicMode;
        if (mode.kind === "timeout") return; // never respond — the client's own request timeout must fire
        if (mode.kind === "http_error") {
          res.writeHead(mode.status, { "content-type": "application/json", "request-id": "req_test_fake123" });
          res.end(JSON.stringify({ type: "error", error: { type: mode.errorType ?? "api_error", message: mode.message ?? "fake provider failure" } }));
          return;
        }
        const base = {
          id: "msg_fake", type: "message", role: "assistant", model: "claude-sonnet-5",
          stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 },
        };
        if (mode.kind === "refusal") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ...base, content: [], stop_reason: "refusal" }));
          return;
        }
        if (mode.kind === "no_results") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ...base, content: [{ type: "text", text: "", citations: null }], stop_reason: "end_turn" }));
          return;
        }
        if (mode.kind === "looks_options") {
          const answer = [
            "###SIGNATURE###",
            "Your classic tailored look works perfectly here.",
            "OWNED: navy blazer, white shirt",
            "MISSING: brown loafers",
            "###SAFE###",
            "A relaxed, easy pairing that never misses.",
            "OWNED: jeans",
            "###BOLD###",
            "A statement piece for a memorable entrance.",
            "MISSING: silk scarf, patent boots",
          ].join("\n");
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ...base, stop_reason: "end_turn", content: [{ type: "text", text: answer, citations: null }] }));
          return;
        }
        if (mode.kind === "looks_arabic") {
          // A real model, instructed to "write in the member's language",
          // would answer an Arabic query in Arabic — this mirrors that,
          // rather than always returning the fixed English canned text.
          const answer = [
            "###SIGNATURE###",
            "بليزر كحلي مصمم مع قميص أبيض هو اختيار كلاسيكي أنيق لهذه المناسبة — خطوط نظيفة وأناقة بلا مجهود.",
            "OWNED: بليزر كحلي, قميص أبيض",
            "MISSING: حذاء جلدي بني",
          ].join("\n");
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ...base, stop_reason: "end_turn", content: [{ type: "text", text: answer, citations: null }] }));
          return;
        }
        if (mode.kind === "travel_progress") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            ...base,
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Continuaré buscando. No puedo acceder a la búsqueda en tiempo real.", citations: null }],
          }));
          return;
        }
        if (mode.kind === "looks_product_page") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            ...base,
            stop_reason: "end_turn",
            content: [
              { type: "server_tool_use", id: "srvtoolu_photo", name: "web_search", input: { query: "fake query" } },
              {
                type: "web_search_tool_result", tool_use_id: "srvtoolu_photo",
                content: [
                  { type: "web_search_result", title: "Real Product Page", url: `${fakeProductPageBaseUrl}/product-with-image`, encrypted_content: "enc", page_age: null },
                  { type: "web_search_result", title: "Product Page Without Image", url: `${fakeProductPageBaseUrl}/product-no-image`, encrypted_content: "enc2", page_age: null },
                  { type: "web_search_result", title: "Blocked Loopback Target", url: "https://127.0.0.2:1/blocked", encrypted_content: "enc3", page_age: null },
                ],
              },
              { type: "text", text: "Here is a real, verified option.", citations: null },
            ],
          }));
          return;
        }
        if (mode.kind === "bad_and_excess_urls") {
          const results = [
            ...Array.from({ length: 7 }, (_, i) => ({ type: "web_search_result", title: `Store ${i}`, url: `https://store${i}.example.com/item`, encrypted_content: "enc", page_age: null })),
            { type: "web_search_result", title: "Insecure Store", url: "http://insecure.example.com/item", encrypted_content: "enc", page_age: null },
            { type: "web_search_result", title: "Not a URL", url: "not-a-url", encrypted_content: "enc", page_age: null },
          ];
          const citations = [
            ...Array.from({ length: 6 }, (_, i) => ({ type: "web_search_result_location", cited_text: "x", encrypted_index: `idx${i}`, title: `Store ${i}`, url: `https://store${i}.example.com/item` })),
            { type: "web_search_result_location", cited_text: "x", encrypted_index: "idx-bad", title: "Insecure Store", url: "http://insecure.example.com/item" },
          ];
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            ...base,
            stop_reason: "end_turn",
            content: [
              { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "fake query" } },
              { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: results },
              { type: "text", text: "Several options were found.", citations },
            ],
          }));
          return;
        }
        if (mode.kind === "web_search_error") {
          // The web_search tool itself failing structurally (rate limited,
          // unavailable, ...) — WebSearchToolResultBlockContent's error
          // variant, not an array of results. The model still answers in
          // plain text despite the search failing (a real model degrading
          // gracefully to general knowledge/reasoning) — this is exactly
          // the "web enrichment fails, text is still useful" case, and
          // must be detected from this structural shape, never by
          // scanning the answer text for phrases like "I couldn't search".
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            ...base,
            stop_reason: "end_turn",
            content: [
              { type: "server_tool_use", id: "srvtoolu_err", name: "web_search", input: { query: "fake query" } },
              { type: "web_search_tool_result", tool_use_id: "srvtoolu_err", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
              { type: "text", text: "###SIGNATURE###\nA tailored navy blazer with a crisp white shirt is a dependable, classic choice for this.", citations: null },
            ],
          }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          ...base,
          stop_reason: "end_turn",
          content: [
            { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "fake query" } },
            {
              type: "web_search_tool_result", tool_use_id: "srvtoolu_1",
              content: [
                { type: "web_search_result", title: "Example Boutique", url: "https://example.com/item-1", encrypted_content: "enc", page_age: null },
                { type: "web_search_result", title: "Second Store", url: "https://second.example.com/item-2", encrypted_content: "enc2", page_age: "2 days ago" },
              ],
            },
            {
              type: "text", text: "Here is a warm, editorial answer grounded in what was just found.",
              citations: [{ type: "web_search_result_location", cited_text: "great pick", encrypted_index: "idx1", title: "Example Boutique", url: "https://example.com/item-1" }],
            },
          ],
        }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve({ server, port: address.port });
      else reject(new Error("failed to bind fake Anthropic server"));
    });
    server.on("error", reject);
  });
}

// --- fake Google Places / Routes providers ---------------------------------

type FakeGooglePlacesMode =
  | { kind: "ok" }
  | { kind: "cross_day_collision" }
  | { kind: "empty_type"; includedType: string }
  | { kind: "overnight" }
  | { kind: "malformed" }
  | { kind: "http_error"; status: number }
  | { kind: "timeout" };
type FakeGoogleRoutesMode = { kind: "ok" } | { kind: "malformed" } | { kind: "http_error"; status: number } | { kind: "timeout" };

let fakeGooglePlacesMode: FakeGooglePlacesMode = { kind: "ok" };
let fakeGoogleRoutesMode: FakeGoogleRoutesMode = { kind: "ok" };
let lastPlacesFieldMask = "";
let lastPlacesRequestBody = "";
let placesRequestBodies: string[] = [];
let lastRoutesFieldMask = "";
let lastRoutesRequestBody = "";
let googlePlacesRequestCount = 0;
let googleRoutesRequestCount = 0;

function startFakeGooglePlaces(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        if (req.method !== "POST") { res.writeHead(404); res.end(); return; }
        googlePlacesRequestCount += 1;
        lastPlacesFieldMask = String(req.headers["x-goog-fieldmask"] || "");
        lastPlacesRequestBody = Buffer.concat(chunks).toString("utf8");
        placesRequestBodies.push(lastPlacesRequestBody);
        const parsedRequest = JSON.parse(lastPlacesRequestBody) as { includedType?: string; textQuery?: string };
        const mode = fakeGooglePlacesMode;
        if (mode.kind === "timeout") return;
        if (mode.kind === "http_error") { res.writeHead(mode.status); res.end(); return; }
        if (mode.kind === "malformed") { res.writeHead(200, { "content-type": "application/json" }); res.end("{not json"); return; }
        if (mode.kind === "empty_type" && parsedRequest.includedType === mode.includedType) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ places: [] }));
          return;
        }
        const coordinateOffsets = [0, 0.04, 0.001, 0.041, 0.002, 0.042, 0.003];
        const crossDayIds = /breakfast/i.test(parsedRequest.textQuery ?? "")
          ? ["breakfast-day-1", "shared-cross-day"]
          : ["shared-cross-day", "shopping-alternative"];
        const placeIds = mode.kind === "cross_day_collision"
          ? crossDayIds
          : Array.from({ length: 7 }, (_, i) => `place-${i}`);
        const places = placeIds.map((placeId, i) => ({
          id: placeId,
          displayName: { text: `Fake Place ${i}` },
          formattedAddress: i === 2 ? undefined : `${i} Example Street`,
          location: { latitude: 48.85 + coordinateOffsets[i], longitude: 2.35 + coordinateOffsets[i] },
          rating: i % 2 === 0 ? 4.5 : undefined,
          primaryType: parsedRequest.includedType ?? "tourist_attraction",
          types: [parsedRequest.includedType ?? "tourist_attraction"],
          regularOpeningHours: {
            periods: mode.kind === "overnight" ? [
              { open: { day: 3, hour: 20, minute: 0 }, close: { day: 4, hour: 9, minute: 0 } },
              { open: { day: 4, hour: 18, minute: 0 }, close: { day: 5, hour: 2, minute: 0 } },
            ] : Array.from({ length: 7 }, (_, day) => ({
              open: { day, hour: 8, minute: 0 },
              close: { day, hour: 23, minute: 0 },
            })),
          },
          websiteUri: i === 0 ? "https://fakeplace0.example.com" : undefined,
          googleMapsUri: `https://maps.google.com/?cid=${i}`,
          photos: i === 3 ? undefined : [{
            name: `places/place-${i}/photos/photo-${i}`,
            authorAttributions: [{ displayName: `Fake Photographer ${i}`, uri: "https://google.com/maps/contrib/fake" }],
          }],
        }));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ places }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve({ server, port: address.port });
      else reject(new Error("failed to bind fake Google Places server"));
    });
    server.on("error", reject);
  });
}

function startFakeGoogleRoutes(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        if (req.method !== "POST") { res.writeHead(404); res.end(); return; }
        googleRoutesRequestCount += 1;
        lastRoutesFieldMask = String(req.headers["x-goog-fieldmask"] || "");
        lastRoutesRequestBody = Buffer.concat(chunks).toString("utf8");
        const mode = fakeGoogleRoutesMode;
        if (mode.kind === "timeout") return;
        if (mode.kind === "http_error") { res.writeHead(mode.status); res.end(); return; }
        if (mode.kind === "malformed") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ routes: [{ distanceMeters: 1200 }] })); // duration missing on purpose
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ routes: [{ distanceMeters: 850, duration: "600s" }] }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve({ server, port: address.port });
      else reject(new Error("failed to bind fake Google Routes server"));
    });
    server.on("error", reject);
  });
}

// --- fake Places Photo (New) media endpoint --------------------------------

let placesPhotoRequestCount = 0;
let lastPlacesPhotoApiKey = "";

function startFakeGooglePlacesPhoto(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "GET" || !req.url?.includes("/media")) { res.writeHead(404); res.end(); return; }
      placesPhotoRequestCount += 1;
      lastPlacesPhotoApiKey = String(req.headers["x-goog-api-key"] || "");
      const match = req.url.match(/^\/v1\/(places\/[^/]+\/photos\/[^/]+)\/media/);
      const photoName = match ? match[1] : "unknown";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ photoUri: `https://lh3.googleusercontent.com/fake/${encodeURIComponent(photoName)}` }));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve({ server, port: address.port });
      else reject(new Error("failed to bind fake Places Photo server"));
    });
    server.on("error", reject);
  });
}

// --- fake HTTPS product page (for og:image extraction) ---------------------
//
// A real (if self-signed) HTTPS server is used here — the link-preview
// fetcher only ever calls https:// URLs, so this proves the whole extraction
// path (not just a mocked HTTP shortcut). The self-signed cert is only
// trusted by the disposable test server process below via
// NODE_TLS_REJECT_UNAUTHORIZED=0, scoped to the one sub-server that talks to
// it — never the app's real runtime configuration.
const FAKE_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCpMxX2p+d29+h/
KhbxwPnml1emOH/fDhaDAEWLWm3W4A3V+gQD7c/dF7IL0kNVAJB89TJN/YmRmLd7
MR/7qSgXrAE/LMkOUR3AfW5PRwu0AR35TlDuVmWit1/Osi7XKh+mWdok9TjE1vBM
e/dqPLQx8dhGjwYAP5XK5QKkjJSYJtGclw9srk/WbFBBacOfAQCo9gQs1udedZS2
Gx853wlL+jUwvzZqr+mLnKg5HtjvcqXQZYhddJl8ppIXdXyZ0oe359i6WHLFctYY
E0680J4KuYG94RXwWEEl4CRQUcTojfZVBiDeB7A90FVKc+aolqCtZBgtqrpxd1Pl
9qeibTanAgMBAAECggEASUcNqRBYp2aAc6pn23WnBR3gYOWxQ4oXZ87TT6HvVhMd
CuHHoWf6ERe1DXeXn5Wp/eQ3UB2Q2dSZCiphXp2I9o+Qzqp3vNKWnwnznzP2tpOR
RqqLVF1okQr33E3BCYB9yo65ci4d0un/kjBSG9mEdOj3sL86axsepYt/FIKpzCa3
c5I6kT2TVtStEBdznNx7dlZrDlD4ZSMTdaLJi1+1O6rvxOaEbc9nJiRDbWH0YW/l
5gb6wvI9G/3GUunQsI8PhXJbGSgmyE+1HgNxTJMq+2PZdVdoZFcYh8zG7/H0cY1R
ws4yQB/wkwneoG0HcCknTDO7pIlTFJ2fEPEKvcPeWQKBgQDSEKOC3c6JY4az4sOu
nvxJoeqDYzbtspReD2io4jUI3G1BXg8jZdYMt3NmPOO4UUdCLycLOpD1IbwjTwTi
LgQiNz6dokOWbOb97JiiPYKOGUu8M1ZVrr01pMDn7E12Ri23VbwF1Va16rO/mIeP
zONSklQbnWRJlV+QqARGuacu2wKBgQDOMtCPrLNEkIjo1sicfOkMnXImeAjPs+lv
EhSza8HX/32yUOLFFCGtFW5zOdADoC2maSl7/dGzpm2Lz3uZ/muRvRMdWio8yXvb
p2SQclAKonSp9Td1Xql6LvOlqNrAOugV8H0nxoy7Mo5sM+Wl5zsiZzIU5U1YHq1m
FWvYx6qjJQKBgQCGCr37tMOlIZAD21BYbfS4m4xEeJvFQ22vM4/qLCYBWH6S9o0c
XlAe3zTQ6Uu6AotA7Uuxu5ZiBTvDIBoSpaBXoP7goXkVVLp1D3M6G5viRrvwBKYz
mIP95fp+Q2gOb6ueUCPhaQein3hBavgdx3TK7LqkwGMNHTbU3JGV+8N1fwKBgHrE
roCcpq+wDpPzLcZeaLNmGszksvpXeCj1bvXUtrlQGRrOJfaJIfPXysc4KK2/9O4b
tuNoIC8CbD7N7h2l6Y4AMR1MzdEbdW82nx2Rsi5iw2td4QM0tVtWESMVAglqCTzm
zt2bzba3Ry0NSTIaFo9JOfxO+ln5Cey53FhZqTMxAoGAHc48Sf0TseGSZhfnqPFR
2h1gTUmElpZDFt3bWnLGo5GAhkHE3hBWbpt9zd90gAdTFtIu7diTLiPUI39yJWd5
5gkAYASZXyDpZ1JiIgJ6+tgLMfVhnV1TqdC9iLCMaSJ1IPZ4JvA5Ss89OERyrw9Q
/1KYejTh5pKNBS/QuiXoPlo=
-----END PRIVATE KEY-----`;
const FAKE_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUb310kOHb57wzss42f1XTCrhOrlwwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDkwNDIxMTA1OVoXDTM2MDkw
MTIxMTA1OVowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAqTMV9qfndvfofyoW8cD55pdXpjh/3w4WgwBFi1pt1uAN
1foEA+3P3ReyC9JDVQCQfPUyTf2JkZi3ezEf+6koF6wBPyzJDlEdwH1uT0cLtAEd
+U5Q7lZlordfzrIu1yofplnaJPU4xNbwTHv3ajy0MfHYRo8GAD+VyuUCpIyUmCbR
nJcPbK5P1mxQQWnDnwEAqPYELNbnXnWUthsfOd8JS/o1ML82aq/pi5yoOR7Y73Kl
0GWIXXSZfKaSF3V8mdKHt+fYulhyxXLWGBNOvNCeCrmBveEV8FhBJeAkUFHE6I32
VQYg3gewPdBVSnPmqJagrWQYLaq6cXdT5fanom02pwIDAQABo1MwUTAdBgNVHQ4E
FgQUT3/UBkFwZUfFgUmwz1taWUi8ZQEwHwYDVR0jBBgwFoAUT3/UBkFwZUfFgUmw
z1taWUi8ZQEwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEApmTy
VCqm7UZ0f+Ponn14OStTkmZEqelRqP/cXb4PK1bytwmC3wQTO2B4r6Q9lJ3NhXZg
E+CKREx66gSQ881PUfe2J4+Efb6UhJJayhSKnpmnbMu5Bb4adXA/9UANWN7H1B5F
E4r8tt0i8M16mmAVRWup57s6je0X4QU43ZZu+7iCgx0TVGJ0Mk+T43A0qkJyWH7c
LV8Cym1T6ua1WG4O/lFoUPc1F+RqtEgkcibSg/W+NZ1LOjP0q+yHmw6Z+CVuOi4Z
C1IzMcpZQUeKRhE7XTBjv+ztRbUEvTF6y8Zhc1Byn6LkMSBfJSmDCSe5GSXtV4PR
JRapiBLL3Jx+B/wVJg==
-----END CERTIFICATE-----`;

function startFakeProductPageHttps(): Promise<{ server: https.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = https.createServer({ key: FAKE_TLS_KEY, cert: FAKE_TLS_CERT }, (req, res) => {
      if (req.url === "/product-with-image") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><head><meta property="og:image" content="https://cdn.example.com/fake-product.jpg"></head><body>Product</body></html>`);
        return;
      }
      if (req.url === "/product-no-image") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><head><title>No image here</title></head><body>Product</body></html>`);
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve({ server, port: address.port });
      else reject(new Error("failed to bind fake product-page HTTPS server"));
    });
    server.on("error", reject);
  });
}

// --- server harness (same pattern as every other verify-*.ts script) -------------

let nextPort = 25300;
type Server = { port: number; process: ChildProcess; baseUrl: string; takeLog: () => string };

async function startServer(env: Record<string, string | undefined> = {}): Promise<Server> {
  const port = nextPort;
  nextPort += 1;
  const fullEnv: Record<string, string | undefined> = {
    ...process.env, ...env, PORT: String(port), NODE_ENV: "production",
    PRIVATE_OBJECT_DIR: "/closet-test-bucket/my-things",
  };
  const child = spawn("node", [serverEntry], { env: fullEnv, stdio: ["ignore", "pipe", "pipe"] });
  // Captured for tests that need to inspect the server's own stdout (pino
  // JSON lines) — e.g. asserting a diagnostic log line's shape/redaction
  // without ever needing to expose that data over HTTP.
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/version`);
      if (response.ok) {
        let cursor = stdout.length;
        // Consuming read: returns only what's been logged since the last
        // call (or since the server became ready, on the first call) — so
        // one check's log lines never leak into the next check's assertions.
        const takeLog = () => { const chunk = stdout.slice(cursor); cursor = stdout.length; return chunk; };
        return { port, process: child, baseUrl, takeLog };
      }
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`Server on port ${port} did not become ready in time`);
}

function stopServer(server: Server) { server.process.kill(); }

/** Finds the last pino JSON log line (one object per line) whose `msg` matches. Last, not first, so a check that fires its own request only ever sees that request's own entry, never an earlier one still sitting in the same captured chunk. */
function findLogLine(log: string, msg: string): Record<string, unknown> | null {
  const lines = log.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as Record<string, unknown>;
      if (parsed.msg === msg) return parsed;
    } catch {
      // not a JSON line (e.g. a stray non-pino write) — skip it
    }
  }
  return null;
}

async function expectStatus(response: Response, expected: number) {
  if (response.status !== expected) {
    const text = await response.text().catch(() => "");
    throw new Error(`expected status ${expected}, got ${response.status}: ${text}`);
  }
}

class Session {
  cookie: string | null = null;
  constructor(private baseUrl: string) {}
  async request(pathName: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    const response = await fetch(`${this.baseUrl}${pathName}`, { ...init, headers, redirect: "manual" });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    return response;
  }
  async signup(email: string, password: string) {
    const response = await this.request("/api/auth/signup", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    await expectStatus(response, 201);
    return (await response.json()) as { user: { id: string; email: string } };
  }
  async kinSearch(body: Record<string, unknown>) {
    return this.request("/api/kin/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  async kinLooksPhoto(buffer: Buffer, params: Record<string, string> = {}, contentType = "image/jpeg") {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/kin/looks/photo${query ? `?${query}` : ""}`, { method: "POST", headers: { "content-type": contentType }, body: buffer });
  }
  async kinTravelPlan(body: Record<string, unknown>) {
    return this.request("/api/kin/travel/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  async saveRecommendation(body: Record<string, unknown>) {
    return this.request("/api/kin/saved", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  async listSaved() {
    return this.request("/api/kin/saved");
  }
  async deleteSaved(id: string) {
    return this.request(`/api/kin/saved/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  async createTrip(body: Record<string, unknown>) {
    return this.request("/api/kin/trips", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  async listTrips() {
    return this.request("/api/kin/trips");
  }
  async getTrip(id: string) {
    return this.request(`/api/kin/trips/${encodeURIComponent(id)}`);
  }
  async deleteTrip(id: string) {
    return this.request(`/api/kin/trips/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  async addTripItem(tripId: string, body: Record<string, unknown>) {
    return this.request(`/api/kin/trips/${encodeURIComponent(tripId)}/items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  async deleteTripItem(tripId: string, itemId: string) {
    return this.request(`/api/kin/trips/${encodeURIComponent(tripId)}/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
  }
  async uploadMedia(buffer: Buffer, contentType = "image/jpeg") {
    return this.request("/api/closet-items/media", { method: "POST", headers: { "content-type": contentType }, body: buffer });
  }
  async createItem(uploadId: string, fields: Record<string, unknown>) {
    return this.request("/api/closet-items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadId, ...fields }) });
  }
  async setFlag(key: string, enabled: boolean) {
    return this.request(`/api/admin/feature-flags/${encodeURIComponent(key)}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }),
    });
  }
}

const tsxBin = path.join(repoRoot, "scripts/node_modules/.bin/tsx");
async function runScript(scriptPath: string, args: string[]) {
  return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    const child = spawn(tsxBin, [scriptPath, ...args], { cwd: path.join(repoRoot, "scripts"), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stdout += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

async function validJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 180, g: 60, b: 60 } } }).jpeg().toBuffer();
}

const OVERSIZED_IMAGE_BYTES = 10 * 1024 * 1024 + 1024;

const suffix = Date.now();
const PASSWORD = "regression-test-1234";
const results: Array<{ name: string; ok: boolean; error?: string }> = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok — ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
    console.log(`  FAIL — ${name}`);
    console.log(`    ${error instanceof Error ? error.message : error}`);
  }
}

async function resetData() {
  await db.delete(kinTripItems);
  await db.delete(kinTrips);
  await db.delete(kinSavedRecommendations);
  await db.delete(closetItems);
  await db.delete(closetMediaUploads);
  await db.delete(kinSearchUsage);
}

async function main() {
  await resetData();
  const sidecar = await startFakeSidecar();
  process.env.OBJECT_STORAGE_SIDECAR_ENDPOINT = `http://127.0.0.1:${FAKE_SIDECAR_PORT}`;
  const fakeAnthropic = await startFakeAnthropic();
  const anthropicBaseUrl = `http://127.0.0.1:${fakeAnthropic.port}`;
  const fakeGooglePlaces = await startFakeGooglePlaces();
  const fakeGoogleRoutes = await startFakeGoogleRoutes();
  const fakeGooglePlacesPhoto = await startFakeGooglePlacesPhoto();
  const fakeProductPage = await startFakeProductPageHttps();
  fakeProductPageBaseUrl = `https://127.0.0.1:${fakeProductPage.port}`;
  const googlePlacesBaseUrl = `http://127.0.0.1:${fakeGooglePlaces.port}`;
  const googleRoutesBaseUrl = `http://127.0.0.1:${fakeGoogleRoutes.port}`;
  const googlePlacesPhotoBaseUrl = `http://127.0.0.1:${fakeGooglePlacesPhoto.port}`;

  // A high daily limit on the main server — the functional/validation
  // checks below make far more than DEFAULT_KIN_SEARCH_DAILY_LIMIT (10)
  // requests against the same user and must never themselves trip the
  // quota. The quota's own behavior is exercised separately below against
  // a dedicated low-limit server instance.
  const server = await startServer({
    ANTHROPIC_API_KEY: "fake-test-key", ANTHROPIC_BASE_URL: anthropicBaseUrl, KIN_SEARCH_DAILY_LIMIT: "1000",
    GOOGLE_MAPS_API_KEY: "fake-google-key", GOOGLE_PLACES_BASE_URL: `${googlePlacesBaseUrl}/places:searchText`, GOOGLE_ROUTES_BASE_URL: `${googleRoutesBaseUrl}/computeRoutes`,
    GOOGLE_PLACES_PHOTO_BASE_URL: googlePlacesPhotoBaseUrl,
  });
  try {
    const admin = new Session(server.baseUrl);
    const adminAccount = await admin.signup(`kin-admin-${suffix}@example.com`, PASSWORD);
    const grant = await runScript(path.join(repoRoot, "scripts/src/admin-grant.ts"), ["--user-id", adminAccount.user.id, "--yes"]);
    assert.equal(grant.code, 0, `admin-grant should exit 0: ${grant.stdout}`);

    // Force known state regardless of any prior run against this database.
    await expectStatus(await admin.setFlag("kin_search", false), 200);
    await expectStatus(await admin.setFlag("my_things", false), 200);

    const userA = new Session(server.baseUrl);
    const userAAccount = await userA.signup(`kin-a-${suffix}@example.com`, PASSWORD);

    // --- flag + auth gating ---
    await check("kin_search OFF: search is rejected with 403", async () => {
      assert.equal((await userA.kinSearch({ mode: "looks", query: "a dinner outfit" })).status, 403);
    });

    await expectStatus(await admin.setFlag("kin_search", true), 200);

    await check("unauthenticated: search is rejected with 401, flag notwithstanding", async () => {
      const anon = new Session(server.baseUrl);
      assert.equal((await anon.kinSearch({ mode: "looks", query: "a dinner outfit" })).status, 401);
    });

    // --- request validation ---
    await check("missing mode is rejected with 400", async () => {
      assert.equal((await userA.kinSearch({ query: "a dinner outfit" })).status, 400);
    });
    await check("invalid mode is rejected with 400", async () => {
      assert.equal((await userA.kinSearch({ mode: "shopping", query: "a dinner outfit" })).status, 400);
    });
    await check("missing query is rejected with 400", async () => {
      assert.equal((await userA.kinSearch({ mode: "looks" })).status, 400);
    });
    await check("blank query is rejected with 400", async () => {
      assert.equal((await userA.kinSearch({ mode: "looks", query: "   " })).status, 400);
    });
    await check("an over-length query is rejected with 400", async () => {
      assert.equal((await userA.kinSearch({ mode: "looks", query: "x".repeat(2001) })).status, 400);
    });
    await check("a malformed myThingsItemId is rejected with 400", async () => {
      assert.equal((await userA.kinSearch({ mode: "looks", query: "ok", myThingsItemId: "not-a-uuid" })).status, 400);
    });
    await check("a well-formed but nonexistent myThingsItemId is rejected with 400", async () => {
      assert.equal((await userA.kinSearch({ mode: "looks", query: "ok", myThingsItemId: "00000000-0000-0000-0000-000000000000" })).status, 400);
    });
    await check("a negative budget is rejected with 400", async () => {
      assert.equal((await userA.kinSearch({ mode: "looks", query: "ok", budget: -5 })).status, 400);
    });
    await check("a non-3-letter currency is rejected with 400", async () => {
      assert.equal((await userA.kinSearch({ mode: "looks", query: "ok", currency: "dollars" })).status, 400);
    });
    await check("a malformed startDate is rejected with 400", async () => {
      assert.equal((await userA.kinSearch({ mode: "travel", query: "ok", startDate: "12/25/2026" })).status, 400);
    });
    await check("endDate before startDate is rejected with 400", async () => {
      assert.equal((await userA.kinSearch({ mode: "travel", query: "ok", startDate: "2026-06-10", endDate: "2026-06-01" })).status, 400);
    });

    // --- successful search: normalization, citations, external URLs ---
    await check("a valid Looks request reaches the fake provider and returns a normalized ok response", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const before = anthropicRequestCount;
      const response = await userA.kinSearch({ mode: "looks", query: "a dinner outfit in Paris" });
      await expectStatus(response, 200);
      assert.equal(anthropicRequestCount, before + 1, "a valid request must reach the provider exactly once");
      const payload = await response.json() as { status: string; answer: string; citations: Array<{ title: string | null; url: string }>; results: Array<Record<string, unknown>> };
      assert.equal(payload.status, "ok");
      assert.ok(payload.answer.length > 0, "answer must be populated");
      assert.equal(payload.citations.length, 1);
      assert.equal(payload.citations[0].url, "https://example.com/item-1");
      assert.equal(payload.citations[0].title, "Example Boutique");
      assert.equal(payload.results.length, 2, "both distinct web_search_result URLs must appear as result cards");
      const first = payload.results[0];
      assert.equal(first.url, "https://example.com/item-1");
      assert.equal(first.source, "example.com");
      assert.equal(first.title, "Example Boutique");
      assert.equal(first.price, null, "price is never fabricated — it is null until a real source supplies it");
      assert.equal(first.currency, null);
      assert.equal(first.imageUrl, null, "image is never fabricated — the client falls back to the branded placeholder");
    });

    await check("a valid Travel request with dates/destination also succeeds", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinSearch({ mode: "travel", query: "4 slow days in Paris", destination: "Paris", startDate: "2026-10-12", endDate: "2026-10-15" });
      await expectStatus(response, 200);
      const payload = await response.json() as { status: string };
      assert.equal(payload.status, "ok");
    });

    // --- max_uses comes from central config ---
    await check("the outbound web_search tool max_uses matches the default central config (3)", async () => {
      fakeAnthropicMode = { kind: "ok" };
      await expectStatus(await userA.kinSearch({ mode: "looks", query: "ok" }), 200);
      const parsed = JSON.parse(lastAnthropicRequestBody) as { tools: Array<{ type: string; max_uses: number }> };
      assert.equal(parsed.tools.length, 1);
      assert.equal(parsed.tools[0].type, "web_search_20260209");
      assert.equal(parsed.tools[0].max_uses, 3);
    });

    // --- Sonnet 5 model + conservative thinking/effort configuration ---
    await check("the request uses claude-sonnet-5 with adaptive thinking and low effort", async () => {
      fakeAnthropicMode = { kind: "ok" };
      await expectStatus(await userA.kinSearch({ mode: "looks", query: "ok" }), 200);
      const parsed = JSON.parse(lastAnthropicRequestBody) as {
        model: string; thinking: { type: string }; output_config: { effort: string }; max_tokens: number;
      };
      assert.equal(parsed.model, "claude-sonnet-5");
      assert.equal(parsed.thinking.type, "adaptive");
      assert.equal(parsed.output_config.effort, "low");
      assert.ok(parsed.max_tokens <= 1024, `max_tokens should be a concise mobile-sized cap, got ${parsed.max_tokens}`);
    });

    // --- payload sent to the provider never contains user identity ---
    await check("the request sent to the provider never contains the caller's email or user id", async () => {
      fakeAnthropicMode = { kind: "ok" };
      await expectStatus(await userA.kinSearch({ mode: "looks", query: "ok" }), 200);
      assert.ok(!lastAnthropicRequestBody.includes(userAAccount.user.email), "provider payload must never contain the caller's email");
      assert.ok(!lastAnthropicRequestBody.includes(userAAccount.user.id), "provider payload must never contain the caller's user id");
    });

    // --- My Things item as optional context ---
    let itemId = "";
    await check("fixture: user A has one My Things item", async () => {
      await expectStatus(await admin.setFlag("my_things", true), 200);
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      await expectStatus(uploadResponse, 201);
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const createResponse = await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "blue", style: "casual" });
      await expectStatus(createResponse, 201);
      const item = await createResponse.json() as { id: string };
      itemId = item.id;
    });
    await check("a valid myThingsItemId is accepted and its taxonomy attributes reach the provider as text context", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinSearch({ mode: "looks", query: "style this with something", myThingsItemId: itemId });
      await expectStatus(response, 200);
      assert.ok(lastAnthropicRequestBody.includes("shirt"), "the item's taxonomy attributes should reach the model as text context");
    });
    const userB = new Session(server.baseUrl);
    await userB.signup(`kin-b-${suffix}@example.com`, PASSWORD);
    await check("cross-user: B cannot use A's My Things item as context — 400, never silently ignored", async () => {
      const response = await userB.kinSearch({ mode: "looks", query: "ok", myThingsItemId: itemId });
      assert.equal(response.status, 400);
    });

    // --- provider failure modes all collapse to the same structured unavailable response ---
    await check("provider refusal: 200 with status 'unavailable'", async () => {
      fakeAnthropicMode = { kind: "refusal" };
      const response = await userA.kinSearch({ mode: "looks", query: "ok" });
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { status: "unavailable", reason: "unavailable" });
    });
    await check("provider non-2xx: 200 with status 'unavailable', never a 5xx surfaced to the client, and no secrets leaked", async () => {
      fakeAnthropicMode = { kind: "http_error", status: 500 };
      const response = await userA.kinSearch({ mode: "looks", query: "ok" });
      await expectStatus(response, 200);
      const text = await response.text();
      assert.equal(text, JSON.stringify({ status: "unavailable", reason: "unavailable" }));
      assert.ok(!text.includes("fake-test-key"), "the API key must never appear in the response");
      assert.ok(!text.toLowerCase().includes("fake provider failure"), "the raw provider error message must never reach the client");
    });
    await check("a provider HTTP error logs safe, structured diagnostics server-side — status, error type, request id, model, web-search flag, and a redacted message — while the client still only ever sees the fixed 'unavailable' shape", async () => {
      server.takeLog(); // drain anything logged by earlier checks (e.g. the plain 500 above) before capturing this one
      const sensitiveMessage = "invalid x-api-key: sk-ant-FAKESECRET1234567890ABCDEF, see https://console.anthropic.com/account/keys or email ops@example.com for help";
      fakeAnthropicMode = { kind: "http_error", status: 401, errorType: "authentication_error", message: sensitiveMessage };
      const response = await userA.kinSearch({ mode: "looks", query: "ok" });
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { status: "unavailable", reason: "unavailable" }, "the user-facing fallback must be unaffected by this diagnostics logging");

      const log = server.takeLog();
      const entry = findLogLine(log, "KIN search: Anthropic provider error");
      assert.ok(entry, "the diagnostic log line must be emitted");
      assert.equal(entry!.status, 401, "the Anthropic HTTP status must be logged");
      assert.equal(entry!.errorType, "authentication_error", "the Anthropic error type must be logged");
      assert.equal(entry!.requestId, "req_test_fake123", "the Anthropic request id must be logged");
      assert.equal(entry!.model, "claude-sonnet-5", "the configured KIN model must be logged");
      assert.equal(entry!.webSearchEnabled, true, "whether web search was enabled must be logged");
      const loggedMessage = String(entry!.message);
      assert.ok(loggedMessage.length > 0, "a short provider message must still be logged");
      assert.ok(!loggedMessage.includes("sk-ant-FAKESECRET1234567890ABCDEF"), "the raw API-key-like token must never be logged");
      assert.ok(!loggedMessage.includes("https://console.anthropic.com"), "URLs must never be logged");
      assert.ok(!loggedMessage.includes("ops@example.com"), "email addresses must never be logged");
      assert.ok(loggedMessage.length <= 200, "the logged message must be bounded in length");
      // Defense in depth: none of these must leak anywhere in the server's
      // entire log output for this request, not just the one structured field.
      assert.ok(!log.includes("fake-test-key"), "the real ANTHROPIC_API_KEY must never appear in any log line");
      assert.ok(!log.includes("sk-ant-FAKESECRET1234567890ABCDEF"), "the API-key-like token must never appear in any log line");
      assert.ok(!log.includes("https://console.anthropic.com"), "the URL must never appear in any log line");
      assert.ok(!log.includes("ops@example.com"), "the email must never appear in any log line");
    });
    await check("provider timeout: 200 with status 'unavailable' after the hard timeout elapses", async () => {
      fakeAnthropicMode = { kind: "timeout" };
      const started = Date.now();
      const response = await userA.kinSearch({ mode: "looks", query: "ok" });
      const elapsedMs = Date.now() - started;
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { status: "unavailable", reason: "unavailable" });
      assert.ok(elapsedMs < 55_000, `timeout path took unexpectedly long (retries not disabled?): ${elapsedMs}ms`);
    });
    await check("a provider timeout logs diagnostics with a null status/request-id and an errorType of 'timeout', never a raw stack trace", async () => {
      const log = server.takeLog();
      const entry = findLogLine(log, "KIN search: Anthropic provider error");
      assert.ok(entry, "the diagnostic log line must be emitted for a timeout too");
      assert.equal(entry!.status, null, "a timeout never has an HTTP status");
      assert.equal(entry!.errorType, "timeout", "a timeout must be distinguishable from an API error in the log");
      assert.equal(entry!.requestId, null, "a timeout never has an Anthropic request id");
      assert.equal(entry!.model, "claude-sonnet-5");
      assert.equal(entry!.webSearchEnabled, true);
      assert.ok(!Object.prototype.hasOwnProperty.call(entry!, "stack"), "a raw stack trace must never be logged");
      fakeAnthropicMode = { kind: "ok" };
    });
    await check("empty search results: ok status with an empty answer/results, not an error", async () => {
      fakeAnthropicMode = { kind: "no_results" };
      const response = await userA.kinSearch({ mode: "looks", query: "something with no results" });
      await expectStatus(response, 200);
      const payload = await response.json() as { status: string; answer: string; citations: unknown[]; results: unknown[] };
      assert.equal(payload.status, "ok");
      assert.equal(payload.answer, "");
      assert.equal(payload.citations.length, 0);
      assert.equal(payload.results.length, 0);
      fakeAnthropicMode = { kind: "ok" };
    });

    // --- URL validation: https-only, capped counts ---
    await check("non-https/malformed URLs are excluded, and results/citations are capped at 5 each", async () => {
      fakeAnthropicMode = { kind: "bad_and_excess_urls" };
      const response = await userA.kinSearch({ mode: "looks", query: "many options" });
      await expectStatus(response, 200);
      const payload = await response.json() as { status: string; citations: Array<{ url: string }>; results: Array<{ url: string }> };
      assert.equal(payload.status, "ok");
      assert.equal(payload.results.length, 5, "results must be capped at MAX_RESULTS even though 9 were offered");
      assert.equal(payload.citations.length, 5, "citations must be capped at MAX_CITATIONS even though 7 were offered");
      assert.ok(payload.results.every((r) => r.url.startsWith("https://")), "every kept result URL must be https");
      assert.ok(payload.citations.every((c) => c.url.startsWith("https://")), "every kept citation URL must be https");
      assert.ok(!payload.results.some((r) => r.url.includes("insecure.example.com")), "the http:// result must be excluded");
      assert.ok(!payload.citations.some((c) => c.url.includes("insecure.example.com")), "the http:// citation must be excluded");
      assert.ok(!payload.results.some((r) => r.url === "not-a-url"), "a malformed URL must be excluded, never passed through");
      fakeAnthropicMode = { kind: "ok" };
    });

    // --- no persistence ---
    await check("a search never writes to closet_items or closet_media_uploads", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const itemsBefore = (await db.select().from(closetItems)).length;
      const uploadsBefore = (await db.select().from(closetMediaUploads)).length;
      await expectStatus(await userA.kinSearch({ mode: "looks", query: "ok" }), 200);
      const itemsAfter = (await db.select().from(closetItems)).length;
      const uploadsAfter = (await db.select().from(closetMediaUploads)).length;
      assert.equal(itemsAfter, itemsBefore);
      assert.equal(uploadsAfter, uploadsBefore);
    });

    // --- durable, database-backed daily quota (KIN_SEARCH_DAILY_LIMIT) ---
    await check("daily quota: within-limit searches succeed and each durably records exactly one usage row", async () => {
      const quotaServer = await startServer({ ANTHROPIC_API_KEY: "fake-test-key", ANTHROPIC_BASE_URL: anthropicBaseUrl, KIN_SEARCH_DAILY_LIMIT: "3" });
      try {
        const session = new Session(quotaServer.baseUrl);
        const account = await session.signup(`kin-quota-ok-${suffix}@example.com`, PASSWORD);
        fakeAnthropicMode = { kind: "ok" };
        await expectStatus(await session.kinSearch({ mode: "looks", query: "ok" }), 200);
        const rows = await db.select().from(kinSearchUsage).where(eq(kinSearchUsage.ownerUserId, account.user.id));
        assert.equal(rows.length, 1, "exactly one usage row must be recorded per attempt");
      } finally {
        stopServer(quotaServer);
      }
    });
    await check("daily quota: exhausting the limit returns 429 with a stable machine-readable reason, and stops calling the provider", async () => {
      const quotaServer = await startServer({ ANTHROPIC_API_KEY: "fake-test-key", ANTHROPIC_BASE_URL: anthropicBaseUrl, KIN_SEARCH_DAILY_LIMIT: "3" });
      try {
        const session = new Session(quotaServer.baseUrl);
        await session.signup(`kin-quota-exhaust-${suffix}@example.com`, PASSWORD);
        fakeAnthropicMode = { kind: "ok" };
        for (let i = 0; i < 3; i += 1) await expectStatus(await session.kinSearch({ mode: "looks", query: "ok" }), 200);
        const before = anthropicRequestCount;
        const fourth = await session.kinSearch({ mode: "looks", query: "ok" });
        assert.equal(fourth.status, 429);
        const payload = await fourth.json() as { reason: string };
        assert.equal(payload.reason, "daily_limit_exceeded", "the 429 body must carry a stable, machine-readable reason");
        assert.equal(anthropicRequestCount, before, "a quota-exceeded request must never reach the provider");
      } finally {
        stopServer(quotaServer);
      }
    });
    await check("daily quota: a provider failure still permanently consumes the attempt (counts attempted calls, not just successes)", async () => {
      const quotaServer = await startServer({ ANTHROPIC_API_KEY: "fake-test-key", ANTHROPIC_BASE_URL: anthropicBaseUrl, KIN_SEARCH_DAILY_LIMIT: "1" });
      try {
        const session = new Session(quotaServer.baseUrl);
        fakeAnthropicMode = { kind: "http_error", status: 500 };
        await session.signup(`kin-quota-failure-${suffix}@example.com`, PASSWORD);
        await expectStatus(await session.kinSearch({ mode: "looks", query: "ok" }), 200);
        fakeAnthropicMode = { kind: "ok" };
        const retry = await session.kinSearch({ mode: "looks", query: "ok" });
        assert.equal(retry.status, 429, "the single allowed attempt was already spent on the failed call");
      } finally {
        stopServer(quotaServer);
      }
    });
    await check("daily quota: concurrent requests admit exactly the configured limit and reject the rest with 429", async () => {
      const quotaServer = await startServer({ ANTHROPIC_API_KEY: "fake-test-key", ANTHROPIC_BASE_URL: anthropicBaseUrl, KIN_SEARCH_DAILY_LIMIT: "3" });
      try {
        const session = new Session(quotaServer.baseUrl);
        const account = await session.signup(`kin-quota-concurrent-${suffix}@example.com`, PASSWORD);
        fakeAnthropicMode = { kind: "ok" };
        const statuses = await Promise.all(Array.from({ length: 8 }, () => session.kinSearch({ mode: "looks", query: "ok" }).then((r) => r.status)));
        const admitted = statuses.filter((s) => s === 200);
        const limited = statuses.filter((s) => s === 429);
        assert.equal(admitted.length, 3, `expected exactly 3 admitted, got statuses: ${statuses.join(",")}`);
        assert.equal(limited.length, 5, `expected exactly 5 rejected with 429, got statuses: ${statuses.join(",")}`);
        const rows = await db.select().from(kinSearchUsage).where(eq(kinSearchUsage.ownerUserId, account.user.id));
        assert.equal(rows.length, 3, "the ledger must record exactly 3 attempts regardless of request concurrency");
      } finally {
        stopServer(quotaServer);
      }
    });
    await check("daily quota: /kin/travel/plan reserves before any Google/Anthropic call — concurrent requests admit exactly the limit, and provider calls never exceed admitted count", async () => {
      const quotaServer = await startServer({
        ANTHROPIC_API_KEY: "fake-test-key", ANTHROPIC_BASE_URL: anthropicBaseUrl, KIN_SEARCH_DAILY_LIMIT: "3",
        GOOGLE_MAPS_API_KEY: "fake-google-key", GOOGLE_PLACES_BASE_URL: `${googlePlacesBaseUrl}/places:searchText`, GOOGLE_ROUTES_BASE_URL: `${googleRoutesBaseUrl}/computeRoutes`,
      });
      try {
        const session = new Session(quotaServer.baseUrl);
        const account = await session.signup(`kin-quota-travel-concurrent-${suffix}@example.com`, PASSWORD);
        fakeAnthropicMode = { kind: "ok" };
        fakeGooglePlacesMode = { kind: "ok" };
        fakeGoogleRoutesMode = { kind: "ok" };
        const placesBefore = googlePlacesRequestCount;
        const anthropicBefore = anthropicRequestCount;
        const statuses = await Promise.all(Array.from({ length: 8 }, () => session.kinTravelPlan({ query: "plan my trip", destination: "Paris" }).then((r) => r.status)));
        const admitted = statuses.filter((s) => s === 200);
        const limited = statuses.filter((s) => s === 429);
        assert.equal(admitted.length, 3, `expected exactly 3 admitted, got statuses: ${statuses.join(",")}`);
        assert.equal(limited.length, 5, `expected exactly 5 rejected with 429, got statuses: ${statuses.join(",")}`);
        const rows = await db.select().from(kinSearchUsage).where(eq(kinSearchUsage.ownerUserId, account.user.id));
        assert.equal(rows.length, 3, "the ledger must record exactly 3 attempts regardless of request concurrency");
        assert.equal(googlePlacesRequestCount - placesBefore, 3, "Google Places must never be called more times than the quota admitted — a rejected request must never reach Google");
        assert.equal(anthropicRequestCount - anthropicBefore, 3, "Anthropic must never be called more times than the quota admitted");
      } finally {
        stopServer(quotaServer);
      }
    });

    // --- KIN Looks: signature/safe/bold structured options ---
    await check("looks options: a three-marker answer is parsed into signature/safe/bold with owned/missing items", async () => {
      fakeAnthropicMode = { kind: "looks_options" };
      const response = await userA.kinSearch({ mode: "looks", query: "style me for a gala" });
      await expectStatus(response, 200);
      const payload = await response.json() as { status: string; options: Array<{ label: string; reasoning: string; ownedItems: string[]; missingItems: string[] }> };
      assert.equal(payload.status, "ok");
      assert.equal(payload.options.length, 3);
      assert.deepEqual(payload.options.map((o) => o.label), ["signature", "safe", "bold"]);
      assert.deepEqual(payload.options[0].ownedItems, ["navy blazer", "white shirt"]);
      assert.deepEqual(payload.options[0].missingItems, ["brown loafers"]);
      assert.ok(payload.options[0].reasoning.includes("classic tailored"));
      assert.deepEqual(payload.options[1].ownedItems, ["jeans"]);
      assert.deepEqual(payload.options[1].missingItems, []);
      fakeAnthropicMode = { kind: "ok" };
    });
    await check("a travel-mode response never carries a looks 'options' field", async () => {
      fakeAnthropicMode = { kind: "looks_options" };
      const response = await userA.kinSearch({ mode: "travel", query: "plan my trip" });
      await expectStatus(response, 200);
      const payload = await response.json() as { options?: unknown };
      assert.equal(payload.options, undefined);
      fakeAnthropicMode = { kind: "ok" };
    });
    await check("an Arabic query gets a real Arabic-language Looks result, never English reasoning text", async () => {
      fakeAnthropicMode = { kind: "looks_arabic" };
      const response = await userA.kinSearch({ mode: "looks", query: "إطلالة عشاء أنيقة وغير رسمية" });
      await expectStatus(response, 200);
      const payload = await response.json() as { status: string; options: Array<{ label: string; reasoning: string; ownedItems: string[] }> };
      assert.equal(payload.status, "ok");
      const signature = payload.options.find((o) => o.label === "signature");
      assert.ok(signature, "the Arabic response must still parse into structured options");
      const arabicPattern = /[؀-ۿ]/;
      assert.ok(arabicPattern.test(signature!.reasoning), "the reasoning text for an Arabic query must contain real Arabic content, not the fixed English canned text");
      assert.ok(signature!.ownedItems.some((item) => arabicPattern.test(item)), "owned items for an Arabic query must also be in Arabic");
      fakeAnthropicMode = { kind: "ok" };
    });

    // --- KIN Looks: explicit UI locale, independent of the query's own language ---
    await check("locale: 'ar' with an English-language query instructs the model to answer in Arabic anyway", async () => {
      fakeAnthropicMode = { kind: "looks_arabic" };
      const response = await userA.kinSearch({ mode: "looks", query: "a smart casual dinner outfit", locale: "ar" });
      await expectStatus(response, 200);
      const parsed = JSON.parse(lastAnthropicRequestBody) as { system: string };
      assert.ok(parsed.system.includes("Respond entirely in Arabic"), "the system prompt must carry an explicit Arabic instruction, not just 'write in the member's language'");
      assert.ok(parsed.system.includes("regardless of the language"), "the instruction must say to answer in that locale regardless of the query's own language");
      fakeAnthropicMode = { kind: "ok" };
    });
    await check("locale: 'en' with an Arabic-language query instructs the model to answer in English anyway", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinSearch({ mode: "looks", query: "إطلالة عشاء أنيقة", locale: "en" });
      await expectStatus(response, 200);
      const parsed = JSON.parse(lastAnthropicRequestBody) as { system: string };
      assert.ok(parsed.system.includes("Respond entirely in English"), "the system prompt must carry an explicit English instruction");
      assert.ok(parsed.system.includes("Keep product names, brand names, and place names exactly as they are normally spelled"), "the instruction must preserve exact product/brand names alongside the language switch");
    });
    await check("the same explicit locale is honored on the photo endpoint (query string, not just the JSON body)", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinLooksPhoto(await validJpeg(), { query: "style this", locale: "ar" });
      await expectStatus(response, 200);
      const parsed = JSON.parse(lastAnthropicRequestBody) as { system: string };
      assert.ok(parsed.system.includes("Respond entirely in Arabic"), "the photo endpoint must also carry the explicit locale through to the system prompt");
    });
    await check("an invalid locale value is rejected with 400, never silently ignored or passed through", async () => {
      const response = await userA.kinSearch({ mode: "looks", query: "ok", locale: "fr" });
      assert.equal(response.status, 400);
    });
    await check("the system prompt instructs paraphrasing and a final answer, never copied passages or progress narration", async () => {
      fakeAnthropicMode = { kind: "ok" };
      await expectStatus(await userA.kinSearch({ mode: "looks", query: "a check on prompt composition", locale: "en" }), 200);
      const parsed = JSON.parse(lastAnthropicRequestBody) as { system: string };
      assert.ok(parsed.system.includes("own words"), "the prompt must instruct paraphrasing rather than copying source text");
      assert.ok(parsed.system.includes("never a promise to keep researching"), "the prompt must forbid progress narration / promises to keep searching");
    });
    await check("the system prompt never claims to see a photo that wasn't actually sent", async () => {
      fakeAnthropicMode = { kind: "ok" };
      await expectStatus(await userA.kinSearch({ mode: "looks", query: "no photo this time", locale: "en" }), 200);
      const parsed = JSON.parse(lastAnthropicRequestBody) as { system: string; messages: Array<{ content: unknown }> };
      assert.ok(!Array.isArray(parsed.messages[0].content), "a request with no image must send plain text content, not a content-block array with an image");
      assert.ok(parsed.system.includes("you have not seen a photo"), "the prompt must explicitly forbid describing a photo when none was attached to this message");
    });

    // --- KIN Looks: web search failing structurally is distinct from the whole provider call failing ---
    await check("the web_search tool erroring structurally still returns a usable text answer, flagged as degraded — never inferred from the model's prose", async () => {
      fakeAnthropicMode = { kind: "web_search_error" };
      const response = await userA.kinSearch({ mode: "looks", query: "a dinner outfit", locale: "en" });
      await expectStatus(response, 200);
      const payload = await response.json() as { status: string; webSearchDegraded: boolean; options: Array<{ reasoning: string }> };
      assert.equal(payload.status, "ok", "a web-search-tool-level error must not fail the whole request");
      assert.equal(payload.webSearchDegraded, true, "the structural search-tool error must be surfaced");
      assert.ok(payload.options[0]?.reasoning.includes("navy blazer"), "the model's real text answer must still come through");
      fakeAnthropicMode = { kind: "ok" };
    });
    await check("an incomplete Looks recommendation with verified results is partial and remains search-degraded", async () => {
      fakeAnthropicMode = { kind: "travel_progress" };
      const response = await userA.kinSearch({ mode: "looks", query: "find verified pieces", locale: "en" });
      await expectStatus(response, 200);
      const payload = await response.json() as { status: string; reason: string; webSearchDegraded: boolean };
      assert.equal(payload.status, "partial");
      assert.equal(payload.reason, "incomplete_recommendation");
      fakeAnthropicMode = { kind: "ok" };
    });
    await check("a normal successful search is never flagged as degraded", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinSearch({ mode: "looks", query: "a dinner outfit", locale: "en" });
      await expectStatus(response, 200);
      const payload = await response.json() as { webSearchDegraded: boolean };
      assert.equal(payload.webSearchDegraded, false);
    });
    await check("a full provider failure still returns the generic unavailable shape (unaffected by the webSearchDegraded field)", async () => {
      fakeAnthropicMode = { kind: "http_error", status: 500 };
      const response = await userA.kinSearch({ mode: "looks", query: "a dinner outfit", locale: "en" });
      await expectStatus(response, 200);
      const payload = await response.json() as { status: string };
      assert.equal(payload.status, "unavailable");
      fakeAnthropicMode = { kind: "ok" };
    });

    // --- KIN Looks: real image analysis (new photo, never persisted) ---
    await check("a new clothing photo reaches the provider as a real image content block", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinLooksPhoto(await validJpeg(), { query: "style this top" });
      await expectStatus(response, 200);
      const parsed = JSON.parse(lastAnthropicRequestBody) as { messages: Array<{ content: Array<{ type: string; source?: { media_type: string } }> }> };
      const content = parsed.messages[0].content;
      assert.ok(Array.isArray(content), "content must be a content-block array when an image is sent");
      const imageBlock = content.find((block) => block.type === "image");
      assert.ok(imageBlock, "an image content block must be present");
      assert.equal(imageBlock!.source!.media_type, "image/webp");
    });
    await check("a new clothing photo is never written to closet_items or closet_media_uploads (ephemeral only)", async () => {
      const uploadsBefore = (await db.select().from(closetMediaUploads)).length;
      const itemsBefore = (await db.select().from(closetItems)).length;
      await expectStatus(await userA.kinLooksPhoto(await validJpeg(), { query: "ephemeral check" }), 200);
      assert.equal((await db.select().from(closetMediaUploads)).length, uploadsBefore);
      assert.equal((await db.select().from(closetItems)).length, itemsBefore);
    });
    await check("an oversized photo upload is rejected with 413 and never reaches the provider", async () => {
      const before = anthropicRequestCount;
      const response = await userA.kinLooksPhoto(Buffer.alloc(OVERSIZED_IMAGE_BYTES, 1), { query: "too big" });
      assert.equal(response.status, 413);
      assert.equal(anthropicRequestCount, before);
    });
    await check("an invalid image format is rejected with 422 and never reaches the provider", async () => {
      const before = anthropicRequestCount;
      const response = await userA.kinLooksPhoto(Buffer.from("not an image"), { query: "bad format" }, "image/gif");
      assert.equal(response.status, 422);
      assert.equal(anthropicRequestCount, before);
    });
    await check("a valid photo upload still consumes the daily quota (ledger row recorded)", async () => {
      const before = (await db.select().from(kinSearchUsage).where(eq(kinSearchUsage.ownerUserId, userAAccount.user.id))).length;
      await expectStatus(await userA.kinLooksPhoto(await validJpeg(), { query: "quota check" }), 200);
      const after = (await db.select().from(kinSearchUsage).where(eq(kinSearchUsage.ownerUserId, userAAccount.user.id))).length;
      assert.equal(after, before + 1);
    });

    // --- KIN Looks: real image analysis for an owned My Things item ---
    let itemWithImageId = "";
    await check("fixture: user A has a My Things item with real stored image bytes", async () => {
      const jpeg = await validJpeg();
      const uploadResponse = await userA.uploadMedia(jpeg);
      await expectStatus(uploadResponse, 201);
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const createResponse = await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "green", style: "casual" });
      await expectStatus(createResponse, 201);
      itemWithImageId = (await createResponse.json() as { id: string }).id;
    });
    await check("myThingsItemId + Looks mode fetches the real stored image and sends it as an image content block", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinSearch({ mode: "looks", query: "style this", myThingsItemId: itemWithImageId });
      await expectStatus(response, 200);
      const parsed = JSON.parse(lastAnthropicRequestBody) as { messages: Array<{ content: Array<{ type: string }> }> };
      const content = parsed.messages[0].content;
      assert.ok(Array.isArray(content) && content.some((block) => block.type === "image"), "the owned item's real image must be sent, not just taxonomy text");
    });
    await check("myThingsItemId + Travel mode never fetches or sends an image (text context only)", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinSearch({ mode: "travel", query: "plan around this", myThingsItemId: itemWithImageId, destination: "Rome" });
      await expectStatus(response, 200);
      assert.ok(!lastAnthropicRequestBody.includes('"type":"image"'), "travel mode must never send image content");
    });
    await check("cross-user: B cannot use A's item's image via the photo-less Looks path either", async () => {
      const response = await userB.kinSearch({ mode: "looks", query: "ok", myThingsItemId: itemWithImageId });
      assert.equal(response.status, 400);
    });

    // --- KIN Travel: Google Places + Routes day-by-day plan ---
    await check("without GOOGLE_MAPS_API_KEY configured, travel plan reports unavailable rather than fabricating places", async () => {
      const noGoogleServer = await startServer({
        ANTHROPIC_API_KEY: "fake-test-key",
        ANTHROPIC_BASE_URL: anthropicBaseUrl,
        GOOGLE_MAPS_API_KEY: undefined,
      });
      try {
        const session = new Session(noGoogleServer.baseUrl);
        await session.signup(`kin-nogoogle-${suffix}@example.com`, PASSWORD);
        fakeAnthropicMode = { kind: "ok" };
        const response = await session.kinTravelPlan({ query: "plan my trip", destination: "Paris" });
        await expectStatus(response, 200);
        assert.deepEqual(await response.json(), { status: "unavailable", reason: "unavailable" });
      } finally {
        stopServer(noGoogleServer);
      }
    });
    await check("travel plan without a destination is rejected with 400", async () => {
      assert.equal((await userA.kinTravelPlan({ query: "plan my trip" })).status, 400);
    });
    let lastPlan: { destination: string; narrative: string; citations: unknown[]; days: Array<{ dayIndex: number; date: string | null; places: Array<{ placeId: string; name: string; rating: number | null; formattedAddress: string | null; slot: string | null; openingHours: string | null }>; routes: Array<{ distanceMeters: number; durationSeconds: number }> }> } | null = null;
    await check("a valid travel plan combines real Places results, Routes legs, and the Anthropic narrative into day-by-day itinerary", async () => {
      fakeAnthropicMode = { kind: "ok" };
      fakeGooglePlacesMode = { kind: "ok" };
      fakeGoogleRoutesMode = { kind: "ok" };
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris", startDate: "2026-10-01", endDate: "2026-10-02" });
      await expectStatus(response, 200);
      const payload = await response.json() as { status: string; plan: typeof lastPlan };
      assert.equal(payload.status, "ok");
      lastPlan = payload.plan;
      assert.equal(lastPlan!.destination, "Paris");
      assert.ok(lastPlan!.narrative.length > 0, "narrative must come from the Anthropic call");
      assert.equal(lastPlan!.days.length, 2, "a 2-day date range must produce 2 days");
      const totalPlaces = lastPlan!.days.reduce((sum, day) => sum + day.places.length, 0);
      assert.equal(totalPlaces, 5, "at most GOOGLE_PLACES_MAX_RESULTS (5) places must ever appear, none fabricated");
      assert.deepEqual(lastPlan!.days[0].places.map((place) => place.placeId), ["place-0", "place-2", "place-4"], "nearest neighbours must remain together in the first contiguous day group");
      assert.deepEqual(lastPlan!.days[1].places.map((place) => place.placeId), ["place-1", "place-3"], "places must be geographically ordered, not distributed round-robin");
      assert.ok(lastPlan!.days.some((day) => day.routes.length > 0), "at least one day must have a real route leg between two places");
      for (const day of lastPlan!.days) for (const route of day.routes) {
        assert.equal(route.distanceMeters, 850);
        assert.equal(route.durationSeconds, 600);
      }
    });
    await check("Google Places request uses a minimal field mask and caps results at 5", async () => {
      assert.ok(lastPlacesFieldMask.includes("places.id") && lastPlacesFieldMask.includes("places.displayName"));
      assert.ok(!lastPlacesFieldMask.includes("*"), "the field mask must never be a wildcard");
      const parsedBody = JSON.parse(lastPlacesRequestBody) as { maxResultCount: number };
      assert.equal(parsedBody.maxResultCount, 5);
    });
    await check("food and drink intent uses typed Places searches and never asks for tourist attractions", async () => {
      placesRequestBodies = [];
      const response = await userA.kinTravelPlan({
        query: "nice places for coffee and great restaurants for breakfast and dinner",
        destination: "London",
        startDate: "2026-10-01",
        endDate: "2026-10-02",
      });
      await expectStatus(response, 200);
      const payload = await response.json() as {
        status: string;
        plan: { days: Array<{ places: Array<{ slot: string; openingHours: string | null; suggestedTime?: string }> }> };
      };
      assert.equal(payload.status, "ok");
      const requests = placesRequestBodies.map((body) => JSON.parse(body) as { textQuery: string; includedType?: string; strictTypeFiltering?: boolean });
      assert.deepEqual(requests.map((request) => request.includedType).sort(), ["bakery", "cafe", "restaurant"]);
      assert.ok(requests.every((request) => request.strictTypeFiltering === false));
      assert.ok(requests.every((request) => !/attractions|things to do/i.test(request.textQuery)));
      assert.equal(payload.plan.days.length, 2);
      for (const [dayIndex, day] of payload.plan.days.entries()) {
        assert.equal(day.places.length, 3, "every day must contain one stop for every requested slot");
        assert.deepEqual(day.places.map((stop) => stop.slot), ["BREAKFAST", "COFFEE", "DINNER"]);
        assert.deepEqual(day.places.map((stop) => stop.openingHours), ["08:00–23:00", "08:00–23:00", "08:00–23:00"]);
        assert.ok(day.places.every((stop) => !("suggestedTime" in stop)), "invented stop times must not be returned");
        assert.deepEqual(
          day.places.map((stop) => (stop as { placeId?: string }).placeId),
          dayIndex === 0 ? ["place-0", "place-2", "place-4"] : ["place-1", "place-3", "place-5"],
          "each next slot must select the nearest unused Google candidate",
        );
      }
    });
    await check("ordinary food, dining, tea, and cuisine wording never falls back to attractions", async () => {
      for (const query of ["a food tour", "places to eat", "local dining", "afternoon tea", "sushi spots", "where for a drink?"]) {
        placesRequestBodies = [];
        const response = await userA.kinTravelPlan({ query, destination: "London", startDate: "2026-10-01", endDate: "2026-10-01" });
        await expectStatus(response, 200);
        assert.ok(placesRequestBodies.length > 0);
        const requests = placesRequestBodies.map((body) => JSON.parse(body) as { textQuery: string; includedType?: string; strictTypeFiltering?: boolean });
        assert.ok(requests.every((request) => request.includedType && request.strictTypeFiltering === false));
        assert.ok(requests.every((request) => !/attractions|things to do/i.test(request.textQuery)));
      }
    });
    await check("travel stops expose Google's opening hours for that day instead of an invented visit time", async () => {
      const response = await userA.kinTravelPlan({
        query: "coffee and dinner",
        destination: "London",
        startDate: "2026-10-01",
        endDate: "2026-10-01",
      });
      await expectStatus(response, 200);
      const payload = await response.json() as {
        status: string;
        plan: { days: Array<{ places: Array<{ openingHours: string | null; suggestedTime?: string }> }> };
      };
      assert.equal(payload.status, "ok");
      for (const stop of payload.plan.days.flatMap((day) => day.places)) {
        assert.equal(stop.openingHours, "08:00–23:00");
        assert.ok(!("suggestedTime" in stop));
      }
    });
    await check("opening hours include Google periods carried over from the previous day", async () => {
      fakeGooglePlacesMode = { kind: "overnight" };
      const response = await userA.kinTravelPlan({
        query: "breakfast",
        destination: "London",
        startDate: "2026-10-01",
        endDate: "2026-10-01",
      });
      await expectStatus(response, 200);
      const payload = await response.json() as {
        status: string;
        plan: { days: Array<{ places: Array<{ slot: string; openingHours: string | null }> }> };
      };
      assert.equal(payload.status, "ok");
      assert.equal(payload.plan.days[0].places[0].slot, "BREAKFAST");
      assert.equal(payload.plan.days[0].places[0].openingHours, "00:00–09:00, 18:00–24:00");
      fakeGooglePlacesMode = { kind: "ok" };
    });
    await check("a missing requested food slot rejects the whole multi-day plan instead of returning partial days", async () => {
      fakeGooglePlacesMode = { kind: "empty_type", includedType: "bakery" };
      const response = await userA.kinTravelPlan({
        query: "coffee, breakfast and dinner",
        destination: "London",
        startDate: "2026-10-01",
        endDate: "2026-10-02",
      });
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { status: "unavailable", reason: "unavailable" });
      fakeGooglePlacesMode = { kind: "ok" };
    });
    await check("Google Routes request uses a minimal field mask", async () => {
      assert.ok(lastRoutesFieldMask.includes("distanceMeters") && lastRoutesFieldMask.includes("duration"));
      assert.ok(!lastRoutesFieldMask.includes("polyline"), "the field mask must never request the polyline or turn-by-turn steps");
      assert.equal((JSON.parse(lastRoutesRequestBody) as { travelMode: string }).travelMode, "DRIVE", "KIN Travel must request driving routes, never walking estimates");
    });
    await check("Travel prompt requires a final plan and forbids progress narration", async () => {
      const parsed = JSON.parse(lastAnthropicRequestBody) as { system: string };
      assert.match(parsed.system, /complete, final travel plan/i);
      assert.match(parsed.system, /Never narrate your search process/i);
      assert.match(parsed.system, /Never.*resume or continue searching/i);
    });
    await check("a seven-day Paris itinerary remains valid when the optional travel narrative is malformed", async () => {
      fakeAnthropicMode = { kind: "travel_progress" };
      const response = await userA.kinTravelPlan({
        query: "plan my trip",
        destination: "Paris",
        startDate: "2026-09-15",
        endDate: "2026-09-21",
        interests: ["breakfast", "dinner", "cafes", "shopping", "pilates"],
      });
      await expectStatus(response, 200);
      const payload = await response.json() as {
        status: string;
        plan: { narrative: string; days: Array<{ date: string | null; places: Array<{ slot: string | null; placeId: string }> }> };
      };
      assert.equal(payload.status, "ok");
      assert.equal(payload.plan.days.length, 7);
      assert.deepEqual(payload.plan.days.map((day) => day.date), [
        "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21",
      ]);
      for (const day of payload.plan.days) {
        assert.deepEqual(
          day.places.filter((place) => place.slot !== null).map((place) => place.slot),
          ["BREAKFAST", "COFFEE", "DINNER"],
          "real meal places must remain complete and ordered despite malformed optional narrative",
        );
        assert.equal(new Set(day.places.map((place) => place.placeId)).size, day.places.length, "places must remain deduplicated within each day");
      }
      fakeAnthropicMode = { kind: "ok" };
    });
    await check("an undated Google-backed itinerary remains valid when the optional travel narrative is empty", async () => {
      fakeAnthropicMode = { kind: "no_results" };
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris", interests: ["shopping"] });
      await expectStatus(response, 200);
      const payload = await response.json() as {
        status: string;
        plan: { narrative: string; days: Array<{ date: string | null; places: Array<{ placeId: string; mapsUrl: string }> }> };
      };
      assert.equal(payload.status, "ok");
      assert.equal(payload.plan.narrative, "");
      assert.equal(payload.plan.days.length, 1);
      assert.equal(payload.plan.days[0].date, null);
      assert.ok(payload.plan.days[0].places.length > 0, "an empty narrative must not bypass the requirement for real Google places");
      assert.ok(payload.plan.days[0].places.every((place) => {
        const mapsUrl = new URL(place.mapsUrl);
        return mapsUrl.protocol === "https:" && mapsUrl.hostname === "maps.google.com";
      }), "accepted provider Maps URLs must be preserved as secure Google Maps links");
      fakeAnthropicMode = { kind: "ok" };
    });
    await check("a place missing an address never gets a fabricated one (omitted, not guessed)", async () => {
      assert.ok(lastPlan!.days.some((day) => day.places.some((place) => place.formattedAddress === null)), "the 7th fake place has no address and must surface as null");
    });
    await check("Google Places malformed response: travel plan reports unavailable, never a fabricated itinerary", async () => {
      fakeGooglePlacesMode = { kind: "malformed" };
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris" });
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { status: "unavailable", reason: "unavailable" });
      fakeGooglePlacesMode = { kind: "ok" };
    });
    await check("Google Places timeout: travel plan reports unavailable after the short timeout, not a hang", async () => {
      fakeGooglePlacesMode = { kind: "timeout" };
      const started = Date.now();
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris" });
      const elapsedMs = Date.now() - started;
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { status: "unavailable", reason: "unavailable" });
      assert.ok(elapsedMs < 15_000, `Places timeout path took unexpectedly long: ${elapsedMs}ms`);
      fakeGooglePlacesMode = { kind: "ok" };
    });
    await check("Google Routes malformed/missing duration: the leg is omitted, itinerary still returned with real places", async () => {
      fakeGoogleRoutesMode = { kind: "malformed" };
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris" });
      await expectStatus(response, 200);
      const payload = await response.json() as { status: string; plan: { days: Array<{ places: unknown[]; routes: unknown[] }> } };
      assert.equal(payload.status, "ok");
      assert.ok(payload.plan.days.some((day) => day.places.length > 0));
      assert.ok(payload.plan.days.every((day) => day.routes.length === 0), "a malformed route response must never be guessed at — omitted entirely");
      fakeGoogleRoutesMode = { kind: "ok" };
    });
    await check("no Google or Anthropic API key ever appears in a travel response", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris" });
      const text = await response.text();
      assert.ok(!text.includes("fake-google-key") && !text.includes("fake-test-key"));
    });

    // --- Google Places Photos (New): real place photography ---
    await check("Google Places field mask includes photos, and each place resolves a real photo URL with author attribution", async () => {
      fakeAnthropicMode = { kind: "ok" };
      fakeGooglePlacesMode = { kind: "ok" };
      const photosBefore = placesPhotoRequestCount;
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris" });
      await expectStatus(response, 200);
      assert.ok(lastPlacesFieldMask.includes("places.photos"), "the field mask must request photos to show real place imagery");
      const payload = await response.json() as { status: string; plan: { days: Array<{ places: Array<{ photoUrl: string | null; photoAttribution: string | null }> }> } };
      assert.equal(payload.status, "ok");
      const places = payload.plan.days.flatMap((d) => d.places);
      assert.ok(places.some((p) => p.photoUrl?.startsWith("https://lh3.googleusercontent.com/")), "at least one place must carry a real resolved photo URL");
      assert.ok(places.some((p) => p.photoAttribution === "Fake Photographer 0"), "photo attribution must be carried through, not dropped");
      assert.ok(placesPhotoRequestCount > photosBefore, "the Places Photo media endpoint must actually have been called");
    });
    await check("a place with no photos field never gets a fabricated photoUrl", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris" });
      await expectStatus(response, 200);
      const payload = await response.json() as { plan: { days: Array<{ places: Array<{ placeId: string; photoUrl: string | null }> }> } };
      const places = payload.plan.days.flatMap((d) => d.places);
      const noPhotoPlace = places.find((p) => p.placeId === "place-3");
      assert.ok(noPhotoPlace, "fixture place-3 (no photos field) must still appear in the itinerary");
      assert.equal(noPhotoPlace!.photoUrl, null, "a place Google never supplied a photo for must never get a fabricated one");
    });
    await check("no Google Places Photo API key ever appears in a travel response", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris" });
      const text = await response.text();
      assert.ok(!text.includes("fake-google-key"));
      assert.equal(lastPlacesPhotoApiKey, "fake-google-key", "the key must reach Google server-side...");
      assert.ok(!text.includes("X-Goog-Api-Key") && !text.includes("key=fake-google-key"), "...but never inside the response body itself");
    });

    // --- KIN Travel guided flow: structured `interests` + `myThingsItemIds` ---
    await check("an invalid interests value is rejected with 400", async () => {
      assert.equal((await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris", interests: ["not-a-real-interest"] })).status, 400);
    });
    await check("interests: breakfast + museums resolve typed Places searches, never a generic attractions search", async () => {
      fakeAnthropicMode = { kind: "ok" };
      fakeGooglePlacesMode = { kind: "ok" };
      placesRequestBodies = [];
      const response = await userA.kinTravelPlan({
        query: "plan my trip", destination: "London", interests: ["breakfast", "museums"], startDate: "2026-10-01", endDate: "2026-10-01",
      });
      await expectStatus(response, 200);
      const payload = await response.json() as { status: string; plan: { days: Array<{ places: Array<{ slot: string | null }> }> } };
      assert.equal(payload.status, "ok");
      const requests = placesRequestBodies.map((body) => JSON.parse(body) as { textQuery: string; includedType?: string });
      assert.deepEqual(requests.map((request) => request.includedType).sort(), ["bakery", "museum"]);
      assert.ok(requests.every((request) => !/attractions|things to do/i.test(request.textQuery)), "structured interests must never fall back to a generic attractions search");
      assert.ok(requests.some((request) => request.includedType === "museum" && /museum/i.test(request.textQuery)));
    });
    await check("interests: shopping and hidden_gems resolve real place searches with no type restriction, never a product/affiliate search", async () => {
      fakeGooglePlacesMode = { kind: "ok" };
      placesRequestBodies = [];
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Rome", interests: ["shopping", "hidden_gems"] });
      await expectStatus(response, 200);
      assert.equal((await response.json() as { status: string }).status, "ok");
      const requests = placesRequestBodies.map((body) => JSON.parse(body) as { textQuery: string; includedType?: string });
      assert.ok(requests.every((request) => request.includedType === undefined), "shopping/hidden_gems must search real places, not a typed category");
      assert.ok(requests.some((request) => /shopping/i.test(request.textQuery)));
      assert.ok(requests.some((request) => /hidden gems|local favorite/i.test(request.textQuery)));
      assert.ok(requests.every((request) => !/product|buy now|affiliate/i.test(request.textQuery)), "shopping must resolve places, never products or affiliate links");
    });
    await check("Sport subchoices (gyms/pilates/walking_places) resolve distinct real place searches, and gyms is type-filtered", async () => {
      fakeGooglePlacesMode = { kind: "ok" };
      placesRequestBodies = [];
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Berlin", interests: ["gyms", "pilates", "walking_places"] });
      await expectStatus(response, 200);
      assert.equal((await response.json() as { status: string }).status, "ok");
      const requests = placesRequestBodies.map((body) => JSON.parse(body) as { textQuery: string; includedType?: string });
      assert.equal(requests.filter((request) => request.includedType !== undefined).length, 1, "only the gyms interest is type-filtered; pilates/walking_places search by text");
      assert.ok(requests.some((request) => request.includedType === "gym"));
      assert.ok(requests.some((request) => /gym|fitness/i.test(request.textQuery)));
      assert.ok(requests.some((request) => /pilates/i.test(request.textQuery)));
      assert.ok(requests.some((request) => /walking|promenade/i.test(request.textQuery)));
    });
    await check("combined guided days deduplicate by Google placeId while keeping breakfast first, dinner last, and coffee before dinner", async () => {
      fakeGooglePlacesMode = { kind: "ok" };
      const response = await userA.kinTravelPlan({
        query: "plan my trip",
        destination: "London",
        interests: ["breakfast", "cafes", "dinner", "museums"],
        startDate: "2026-10-01",
        endDate: "2026-10-01",
      });
      await expectStatus(response, 200);
      const payload = await response.json() as {
        status: string;
        plan: { days: Array<{ places: Array<{ placeId: string; slot: string | null; activityInterest?: string }> }> };
      };
      assert.equal(payload.status, "ok");
      const places = payload.plan.days[0].places;
      assert.equal(new Set(places.map((place) => place.placeId)).size, places.length, "one day must never return the same stable Google placeId twice");
      assert.equal(places[0].slot, "BREAKFAST", "breakfast must remain the first stop");
      assert.equal(places.at(-1)?.slot, "DINNER", "dinner must remain the last stop");
      assert.ok(places.findIndex((place) => place.slot === "COFFEE") < places.findIndex((place) => place.slot === "DINNER"), "coffee must never be ordered after dinner");
      assert.ok(places.some((place) => place.activityInterest === "museums"), "activity stops must retain their originating server category");
    });
    await check("multi-day guided plans avoid cross-day food/activity placeId collisions when real alternatives exist", async () => {
      fakeGooglePlacesMode = { kind: "cross_day_collision" };
      const response = await userA.kinTravelPlan({
        query: "plan my trip",
        destination: "London",
        interests: ["breakfast", "shopping"],
        startDate: "2026-10-01",
        endDate: "2026-10-02",
      });
      await expectStatus(response, 200);
      const payload = await response.json() as {
        status: string;
        plan: { days: Array<{ places: Array<{ placeId: string; slot: string | null; activityInterest?: string }> }> };
      };
      assert.equal(payload.status, "ok");
      const [dayOne, dayTwo] = payload.plan.days;
      const places = payload.plan.days.flatMap((day) => day.places);
      const sharedOccurrences = places.filter((place) => place.placeId === "shared-cross-day");
      assert.equal(sharedOccurrences.length, 1, "the shared Google placeId must appear exactly once across the trip");
      assert.equal(new Set(places.map((place) => place.placeId)).size, places.length, "unused candidates must prevent avoidable cross-day duplicates");
      assert.ok(!dayOne.places.some((place) => place.placeId === "shared-cross-day" && place.activityInterest === "shopping"), "the cross-day collision must not survive as a first-day activity");
      assert.ok(dayTwo.places.some((place) => place.placeId === "shared-cross-day" && place.slot === "BREAKFAST"), "the shared provider result must remain the valid second-day breakfast");
      assert.ok(places.some((place) => place.placeId === "shopping-alternative" && place.activityInterest === "shopping"), "the unused Shopping alternative must be preferred");
      assert.ok(payload.plan.days.every((day) => day.places[0]?.slot === "BREAKFAST"), "breakfast must remain first on both days");
      assert.ok(places.every((place) => ["breakfast-day-1", "shared-cross-day", "shopping-alternative"].includes(place.placeId)), "every returned place must come from the provider fixture");
      fakeGooglePlacesMode = { kind: "ok" };
    });
    await check("an activity provider failure makes the guided plan honestly unavailable", async () => {
      fakeGooglePlacesMode = { kind: "http_error", status: 503 };
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Rome", interests: ["parks"] });
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { status: "unavailable", reason: "unavailable" });
      fakeGooglePlacesMode = { kind: "ok" };
    });
    await check("with no dates supplied, a structured-interests plan still returns a single sensible day, never inventing a duration", async () => {
      fakeGooglePlacesMode = { kind: "ok" };
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Lisbon", interests: ["parks"] });
      await expectStatus(response, 200);
      const payload = await response.json() as { status: string; plan: { days: Array<{ date: string | null }> } };
      assert.equal(payload.status, "ok");
      assert.equal(payload.plan.days.length, 1, "no dates means exactly one undated day — never a fabricated multi-day duration");
      assert.equal(payload.plan.days[0].date, null, "no date was supplied, so none must be invented");
    });

    // --- KIN Travel guided flow: multi-item "Choose from My Things" -----------
    let ownedItemA = ""; let ownedItemB = ""; let consideringItemA = ""; let userBOwnedItem = "";
    await check("fixture: user A has two owned items and one considering item; user B has one owned item", async () => {
      const jpeg = await validJpeg();
      const uploadA1 = await (await userA.uploadMedia(jpeg)).json() as { uploadId: string };
      ownedItemA = (await (await userA.createItem(uploadA1.uploadId, { itemType: "jacket", primaryColor: "black" })).json() as { id: string }).id;
      const uploadA2 = await (await userA.uploadMedia(jpeg)).json() as { uploadId: string };
      ownedItemB = (await (await userA.createItem(uploadA2.uploadId, { itemType: "sneakers", primaryColor: "white" })).json() as { id: string }).id;
      const uploadA3 = await (await userA.uploadMedia(jpeg)).json() as { uploadId: string };
      const consideringResponse = await userA.createItem(uploadA3.uploadId, { itemType: "coat", primaryColor: "gray", ownershipStatus: "considering" });
      await expectStatus(consideringResponse, 201);
      consideringItemA = (await consideringResponse.json() as { id: string }).id;
      const uploadB = await (await userB.uploadMedia(jpeg)).json() as { uploadId: string };
      userBOwnedItem = (await (await userB.createItem(uploadB.uploadId, { itemType: "shirt", primaryColor: "blue" })).json() as { id: string }).id;
    });
    await check("myThingsItemIds: both selected owned items reach the plan request, not reduced to one", async () => {
      fakeAnthropicMode = { kind: "ok" };
      fakeGooglePlacesMode = { kind: "ok" };
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris", myThingsItemIds: [ownedItemA, ownedItemB] });
      await expectStatus(response, 200);
      assert.equal((await response.json() as { status: string }).status, "ok");
      assert.ok(lastAnthropicRequestBody.includes("jacket") && lastAnthropicRequestBody.includes("sneakers"), "both selected items' context must reach the model, not just the first one");
    });
    await check("Looks securely accepts one to six owned myThingsItemIds and sends every selected item's metadata to the model", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinSearch({ mode: "looks", query: "style these together", myThingsItemIds: [ownedItemA, ownedItemB] });
      await expectStatus(response, 200);
      assert.ok(["ok", "partial"].includes((await response.json() as { status: string }).status));
      assert.ok(lastAnthropicRequestBody.includes("jacket") && lastAnthropicRequestBody.includes("sneakers"), "every authorized selected item must enter the Looks context");
    });
    for (const [label, rejectedId] of [
      ["considering", consideringItemA],
      ["cross-user", userBOwnedItem],
      ["nonexistent", randomUUID()],
    ] as const) {
      await check(`Looks plural selection rejects a ${label} id with the generic response`, async () => {
        const response = await userA.kinSearch({ mode: "looks", query: "style these", myThingsItemIds: [ownedItemA, rejectedId] });
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: "Selected item not found" });
      });
    }
    await check("Looks plural selection rejects malformed, empty, and over-six lists before item lookup", async () => {
      const malformed = await userA.kinSearch({ mode: "looks", query: "style these", myThingsItemIds: ["not-a-uuid"] });
      assert.equal(malformed.status, 400);
      const empty = await userA.kinSearch({ mode: "looks", query: "style these", myThingsItemIds: [] });
      assert.equal(empty.status, 400);
      const sevenIds = Array.from({ length: 7 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
      const overSix = await userA.kinSearch({ mode: "looks", query: "style these", myThingsItemIds: sevenIds });
      assert.equal(overSix.status, 400);
    });
    await check("myThingsItemIds: a considering-status item is rejected, never treated as owned travel context", async () => {
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris", myThingsItemIds: [ownedItemA, consideringItemA] });
      assert.equal(response.status, 400);
    });
    await check("myThingsItemIds: a cross-user item id is rejected safely, not silently dropped or leaked", async () => {
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris", myThingsItemIds: [ownedItemA, userBOwnedItem] });
      assert.equal(response.status, 400);
    });
    await check("myThingsItemIds: a well-formed but nonexistent id is rejected with 400", async () => {
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris", myThingsItemIds: ["00000000-0000-0000-0000-000000000000"] });
      assert.equal(response.status, 400);
    });
    await check("myThingsItemIds: a malformed id is rejected with 400", async () => {
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris", myThingsItemIds: ["not-a-uuid"] });
      assert.equal(response.status, 400);
    });
    await check("myThingsItemIds: an empty array is rejected with 400 (use the singular field's absence, or omit it, to mean zero items)", async () => {
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris", myThingsItemIds: [] });
      assert.equal(response.status, 400);
    });
    await check("myThingsItemIds: seven syntactically valid ids are rejected before private item lookup", async () => {
      const sevenIds = Array.from({ length: 7 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris", myThingsItemIds: sevenIds });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "myThingsItemIds must be an array of 1-6 valid ids" });
    });
    await check("myThingsItemIds takes precedence over the legacy singular myThingsItemId when both are sent", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris", myThingsItemId: ownedItemB, myThingsItemIds: [ownedItemA] });
      await expectStatus(response, 200);
      assert.equal((await response.json() as { status: string }).status, "ok");
      assert.ok(lastAnthropicRequestBody.includes("jacket"), "the plural field must win");
      assert.ok(!lastAnthropicRequestBody.includes("sneakers"), "the singular field must be ignored once the plural field is present");
    });
    await check("omitting myThingsItemIds and myThingsItemId entirely still plans a trip with zero items (Skip for now)", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris" });
      await expectStatus(response, 200);
      assert.equal((await response.json() as { status: string }).status, "ok");
    });

    // --- swap-place: a real alternate stop, never a fabricated one ---
    let firstTripPlaceIds: string[] = [];
    await check("swap-place returns a real alternate place excluding every placeId already used in the trip", async () => {
      fakeAnthropicMode = { kind: "ok" };
      fakeGooglePlacesMode = { kind: "ok" };
      const planResponse = await userA.kinTravelPlan({ query: "plan my trip", destination: "Paris" });
      await expectStatus(planResponse, 200);
      const plan = (await planResponse.json() as { plan: { days: Array<{ places: Array<{ placeId: string }> }> } }).plan;
      firstTripPlaceIds = plan.days.flatMap((d) => d.places.map((p) => p.placeId));
      assert.equal(firstTripPlaceIds.length, 5, "fixture returns exactly 5 places to fill the trip");
      const response = await userA.request("/api/kin/travel/swap-place", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          destination: "Paris",
          excludePlaceIds: firstTripPlaceIds,
          previousPlace: { placeId: "before", lat: 48.84, lng: 2.34 },
          nextPlace: { placeId: "after", lat: 48.9, lng: 2.4 },
        }),
      });
      await expectStatus(response, 200);
      const payload = await response.json() as {
        status: string;
        place: { placeId: string; photoUrl: string | null };
        routes: Array<{ fromPlaceId: string; toPlaceId: string; durationSeconds: number }>;
      };
      assert.equal(payload.status, "ok");
      assert.ok(!firstTripPlaceIds.includes(payload.place.placeId), "the swap result must never duplicate a place already in the trip");
      assert.equal(payload.place.placeId, "place-5", "with 7 fake places and 5 excluded, the first non-excluded one must be chosen — never invented");
      assert.deepEqual(
        payload.routes.map((route) => [route.fromPlaceId, route.toPlaceId, route.durationSeconds]),
        [["before", "place-5", 600], ["place-5", "after", 600]],
        "the swap must return fresh DRIVE legs to both displayed neighbours",
      );
    });
    await check("swap-place reports unavailable (never fabricates a place) when every real result is already in use", async () => {
      const allSevenIds = Array.from({ length: 7 }, (_, i) => `place-${i}`);
      const response = await userA.request("/api/kin/travel/swap-place", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination: "Paris", excludePlaceIds: allSevenIds }),
      });
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { status: "unavailable", reason: "unavailable" });
    });
    await check("an undated food stop swaps through Google Places without inventing a date", async () => {
      fakeGooglePlacesMode = { kind: "ok" };
      const planResponse = await userA.kinTravelPlan({
        query: "plan my trip",
        destination: "Lisbon",
        interests: ["breakfast"],
      });
      await expectStatus(planResponse, 200);
      const planPayload = await planResponse.json() as {
        status: string;
        plan: { days: Array<{ date: string | null; places: Array<{ placeId: string; slot: string | null }> }> };
      };
      assert.equal(planPayload.status, "ok");
      const day = planPayload.plan.days[0];
      assert.equal(day.date, null);
      const breakfast = day.places.find((place) => place.slot === "BREAKFAST");
      assert.ok(breakfast);
      placesRequestBodies = [];
      const response = await userA.request("/api/kin/travel/swap-place", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          destination: "Lisbon",
          excludePlaceIds: day.places.map((place) => place.placeId),
          slot: breakfast!.slot,
          date: day.date,
        }),
      });
      await expectStatus(response, 200);
      const payload = await response.json() as { status: string; place?: { placeId: string; slot: string | null; date?: string } };
      assert.equal(payload.status, "ok");
      assert.ok(payload.place && payload.place.placeId !== breakfast!.placeId, "the replacement must be a different provider result");
      assert.equal(payload.place!.slot, "BREAKFAST");
      assert.ok(!Object.prototype.hasOwnProperty.call(payload.place, "date"), "the swap must not invent a date");
      const providerRequest = JSON.parse(placesRequestBodies.at(-1)!) as { textQuery: string; includedType?: string };
      assert.match(providerRequest.textQuery, /breakfast/i);
      assert.equal(providerRequest.includedType, "bakery");
    });
    await check("swap-place rejects a malformed supplied date while continuing to accept an absent date", async () => {
      const response = await userA.request("/api/kin/travel/swap-place", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination: "Lisbon", slot: "BREAKFAST", date: "not-a-date" }),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "date must be a valid YYYY-MM-DD value when supplied" });
    });
    await check("activity swaps use only the seven validated server-controlled category searches", async () => {
      const cases = [
        ["museums", /museums/i, "museum"],
        ["parks", /parks/i, "park"],
        ["shopping", /shopping areas|markets/i, undefined],
        ["hidden_gems", /hidden gems|local favorite/i, undefined],
        ["gyms", /gyms|fitness centers/i, "gym"],
        ["pilates", /pilates studios/i, undefined],
        ["walking_places", /walking areas|promenades/i, undefined],
      ] as const;
      for (const [activityInterest, queryPattern, includedType] of cases) {
        placesRequestBodies = [];
        const response = await userA.request("/api/kin/travel/swap-place", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ destination: "Paris", activityInterest }),
        });
        await expectStatus(response, 200);
        assert.equal((await response.json() as { status: string }).status, "ok");
        const request = JSON.parse(placesRequestBodies.at(-1)!) as { textQuery: string; includedType?: string };
        assert.match(request.textQuery, queryPattern);
        assert.equal(request.includedType, includedType);
      }
      const invalid = await userA.request("/api/kin/travel/swap-place", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination: "Paris", activityInterest: "user supplied arbitrary query" }),
      });
      assert.equal(invalid.status, 400);
    });
    await check("swap-place is auth+flag gated and consumes the daily KIN quota like every other action", async () => {
      const anon = new Session(server.baseUrl);
      assert.equal((await anon.request("/api/kin/travel/swap-place", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ destination: "Paris" }) })).status, 401);
      const quotaServer = await startServer({
        ANTHROPIC_API_KEY: "fake-test-key", ANTHROPIC_BASE_URL: anthropicBaseUrl, KIN_SEARCH_DAILY_LIMIT: "1",
        GOOGLE_MAPS_API_KEY: "fake-google-key", GOOGLE_PLACES_BASE_URL: `${googlePlacesBaseUrl}/places:searchText`, GOOGLE_ROUTES_BASE_URL: `${googleRoutesBaseUrl}/computeRoutes`,
        GOOGLE_PLACES_PHOTO_BASE_URL: googlePlacesPhotoBaseUrl,
      });
      try {
        const session = new Session(quotaServer.baseUrl);
        await session.signup(`kin-swap-quota-${suffix}@example.com`, PASSWORD);
        await expectStatus(await session.request("/api/kin/travel/swap-place", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ destination: "Paris" }) }), 200);
        const second = await session.request("/api/kin/travel/swap-place", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ destination: "Paris" }) });
        assert.equal(second.status, 429);
      } finally {
        stopServer(quotaServer);
      }
    });

    // --- KIN Looks: real product imagery from the page Anthropic already found ---
    await check("a Looks product result's og:image is fetched from the same https page and attached as a real imageUrl", async () => {
      const tlsRelaxedServer = await startServer({
        ANTHROPIC_API_KEY: "fake-test-key", ANTHROPIC_BASE_URL: anthropicBaseUrl,
        // Both scoped to only this disposable sub-server: trusts the fake
        // self-signed product-page cert, and allowlists the *exact* host
        // 127.0.0.1 (never the whole loopback range) so the fixture server
        // itself is reachable — see isAllowedTestHost in link-preview.ts.
        // 127.0.0.2 below is deliberately NOT allowlisted, so it still
        // exercises the real SSRF guard.
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        LINK_PREVIEW_ALLOW_HOSTS: "127.0.0.1",
      });
      try {
        const session = new Session(tlsRelaxedServer.baseUrl);
        await session.signup(`kin-og-image-${suffix}@example.com`, PASSWORD);
        fakeAnthropicMode = { kind: "looks_product_page" };
        const response = await session.kinSearch({ mode: "looks", query: "a real product" });
        await expectStatus(response, 200);
        const payload = await response.json() as { status: string; results: Array<{ url: string; imageUrl: string | null }> };
        assert.equal(payload.status, "ok");
        const withImage = payload.results.find((r) => r.url.endsWith("/product-with-image"));
        const withoutImage = payload.results.find((r) => r.url.endsWith("/product-no-image"));
        const blocked = payload.results.find((r) => r.url.includes("127.0.0.2"));
        assert.equal(withImage?.imageUrl, "https://cdn.example.com/fake-product.jpg", "a real og:image tag on the page must be attached");
        assert.equal(withoutImage?.imageUrl, null, "a real page with no og:image tag must stay null, never a guessed image");
        assert.equal(blocked?.imageUrl, null, "a citation pointing at a non-allowlisted loopback address must never be fetched at all (SSRF guard)");
        fakeAnthropicMode = { kind: "ok" };
      } finally {
        stopServer(tlsRelaxedServer);
      }
    });

    // --- feature flag OFF also gates the new endpoints ---
    await check("kin_search OFF also rejects the Looks photo endpoint, travel plan, and persistence routes with 403", async () => {
      await expectStatus(await admin.setFlag("kin_search", false), 200);
      assert.equal((await userA.kinLooksPhoto(await validJpeg(), { query: "ok" })).status, 403);
      assert.equal((await userA.kinTravelPlan({ query: "ok", destination: "Paris" })).status, 403);
      assert.equal((await userA.saveRecommendation({ mode: "looks", query: "ok", answer: "ok" })).status, 403);
      assert.equal((await userA.listTrips()).status, 403);
      await expectStatus(await admin.setFlag("kin_search", true), 200);
    });

    // --- persistence: saved recommendations (explicit opt-in only) ---
    let savedId = "";
    await check("saving a recommendation persists exactly what was passed, scoped to the owner", async () => {
      const response = await userA.saveRecommendation({
        completionStatus: "ok",
        mode: "looks", query: "a dinner outfit", answer: "Wear the navy blazer.",
        options: [
          { label: "signature", reasoning: "A complete signature recommendation with balanced proportions.", ownedItems: ["blazer"], missingItems: [] },
          { label: "safe", reasoning: "A complete safe recommendation with versatile neutral layers.", ownedItems: [], missingItems: [] },
          { label: "bold", reasoning: "A complete bold recommendation with deliberate visual contrast.", ownedItems: [], missingItems: [] },
        ],
        citations: [{ title: "Store", url: "https://example.com/a" }],
        results: [{ title: "Item", source: "example.com", url: "https://example.com/a", price: null, currency: null, imageUrl: null }],
      });
      await expectStatus(response, 201);
      const payload = await response.json() as { id: string; mode: string };
      savedId = payload.id;
      const rows = await db.select().from(kinSavedRecommendations).where(eq(kinSavedRecommendations.id, savedId));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].ownerUserId, userAAccount.user.id);
    });
    await check("a recommendation without an explicit completed-result marker cannot be saved", async () => {
      const response = await userA.saveRecommendation({ mode: "looks", query: "partial", answer: "incomplete" });
      assert.equal(response.status, 400);
    });
    await check("a saved recommendation with a non-https citation URL is rejected with 400", async () => {
      const response = await userA.saveRecommendation({
        completionStatus: "ok", mode: "looks", query: "ok", answer: "ok", citations: [{ title: null, url: "http://insecure.example.com" }], results: [],
      });
      assert.equal(response.status, 400);
    });
    await check("listing saved recommendations only returns the caller's own", async () => {
      const listA = await userA.listSaved();
      await expectStatus(listA, 200);
      const payloadA = await listA.json() as { items: Array<{ id: string }> };
      assert.ok(payloadA.items.some((item) => item.id === savedId));
      const listB = await userB.listSaved();
      await expectStatus(listB, 200);
      const payloadB = await listB.json() as { items: Array<{ id: string }> };
      assert.ok(!payloadB.items.some((item) => item.id === savedId));
    });
    await check("cross-user: B cannot delete A's saved recommendation (404, not deleted)", async () => {
      const response = await userB.deleteSaved(savedId);
      assert.equal(response.status, 404);
      const rows = await db.select().from(kinSavedRecommendations).where(eq(kinSavedRecommendations.id, savedId));
      assert.equal(rows.length, 1);
    });
    await check("the owner can delete their own saved recommendation", async () => {
      await expectStatus(await userA.deleteSaved(savedId), 200);
      const rows = await db.select().from(kinSavedRecommendations).where(eq(kinSavedRecommendations.id, savedId));
      assert.equal(rows.length, 0);
    });

    // --- persistence: trips and itinerary items (Add to Trip) ---
    let tripId = "";
    await check("creating a trip persists it scoped to the owner", async () => {
      const response = await userA.createTrip({ destination: "Paris", startDate: "2026-10-01", endDate: "2026-10-03", budget: 2000, currency: "USD" });
      await expectStatus(response, 201);
      tripId = (await response.json() as { id: string }).id;
      const rows = await db.select().from(kinTrips).where(eq(kinTrips.id, tripId));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].ownerUserId, userAAccount.user.id);
    });
    await check("cross-user: B cannot read A's trip (404)", async () => {
      assert.equal((await userB.getTrip(tripId)).status, 404);
    });
    let tripItemId = "";
    await check("adding an itinerary item requires trip ownership and persists it", async () => {
      const denied = await userB.addTripItem(tripId, { name: "Louvre", dayIndex: 0 });
      assert.equal(denied.status, 404);
      const response = await userA.addTripItem(tripId, { name: "Louvre", dayIndex: 0, placeId: "place-0", lat: 48.86, lng: 2.34, formattedAddress: "Rue de Rivoli" });
      await expectStatus(response, 201);
      tripItemId = (await response.json() as { id: string }).id;
      const trip = await userA.getTrip(tripId);
      const payload = await trip.json() as { items: Array<{ id: string }> };
      assert.ok(payload.items.some((item) => item.id === tripItemId));
    });
    await check("cross-user: B cannot delete A's itinerary item (404, not deleted)", async () => {
      const response = await userB.deleteTripItem(tripId, tripItemId);
      assert.equal(response.status, 404);
      const rows = await db.select().from(kinTripItems).where(eq(kinTripItems.id, tripItemId));
      assert.equal(rows.length, 1);
    });
    await check("the owner can delete their own itinerary item and trip", async () => {
      await expectStatus(await userA.deleteTripItem(tripId, tripItemId), 200);
      await expectStatus(await userA.deleteTrip(tripId), 200);
      const rows = await db.select().from(kinTrips).where(eq(kinTrips.id, tripId));
      assert.equal(rows.length, 0);
    });

    // --- missing API key: server never crashes, consumes nothing, degrades gracefully ---
    await check("missing ANTHROPIC_API_KEY: server boots fine, search returns the structured unavailable response, and never reaches a provider", async () => {
      const noKeyServer = await startServer({ ANTHROPIC_API_KEY: undefined, ANTHROPIC_BASE_URL: anthropicBaseUrl });
      try {
        const session = new Session(noKeyServer.baseUrl);
        await session.signup(`kin-nokey-${suffix}@example.com`, PASSWORD);
        // kin_search is already enabled — a row in the same database this
        // second server process also connects to.
        const before = anthropicRequestCount;
        const response = await session.kinSearch({ mode: "looks", query: "ok" });
        await expectStatus(response, 200);
        assert.deepEqual(await response.json(), { status: "unavailable", reason: "unavailable" });
        assert.equal(anthropicRequestCount, before, "a missing API key must never reach the provider");
      } finally {
        stopServer(noKeyServer);
      }
    });
  } finally {
    stopServer(server);
    await new Promise<void>((resolve) => sidecar.close(() => resolve()));
    await new Promise<void>((resolve) => fakeAnthropic.server.close(() => resolve()));
    await new Promise<void>((resolve) => fakeGooglePlaces.server.close(() => resolve()));
    await new Promise<void>((resolve) => fakeGoogleRoutes.server.close(() => resolve()));
    await new Promise<void>((resolve) => fakeGooglePlacesPhoto.server.close(() => resolve()));
    await new Promise<void>((resolve) => fakeProductPage.server.close(() => resolve()));
    await resetData();
  }

  console.log("\nResults:");
  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`  ${result.ok ? "PASS" : "FAIL"} — ${result.name}`);
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} checks failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} KIN search regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
