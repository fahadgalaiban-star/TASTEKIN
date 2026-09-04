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
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closetItems, closetMediaUploads, db } from "@workspace/db";
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
          res.end(JSON.stringify({ signed_url: `http://127.0.0.1:1106/storage-object/${key}` }));
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
    server.listen(1106, "127.0.0.1", () => resolve(server));
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
  | { kind: "http_error"; status: number }
  | { kind: "timeout" };

let fakeAnthropicMode: FakeAnthropicMode = { kind: "ok" };
let lastAnthropicRequestBody = "";
let anthropicRequestCount = 0;

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
          res.writeHead(mode.status, { "content-type": "application/json" });
          res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "fake provider failure" } }));
          return;
        }
        const base = {
          id: "msg_fake", type: "message", role: "assistant", model: "claude-opus-5",
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

// --- server harness (same pattern as every other verify-*.ts script) -------------

let nextPort = 25300;
type Server = { port: number; process: ChildProcess; baseUrl: string };

async function startServer(env: Record<string, string | undefined> = {}): Promise<Server> {
  const port = nextPort;
  nextPort += 1;
  const fullEnv: Record<string, string | undefined> = {
    ...process.env, ...env, PORT: String(port), NODE_ENV: "production",
    PRIVATE_OBJECT_DIR: "/closet-test-bucket/my-things",
  };
  const child = spawn("node", [serverEntry], { env: fullEnv, stdio: ["ignore", "pipe", "pipe"] });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/version`);
      if (response.ok) return { port, process: child, baseUrl };
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`Server on port ${port} did not become ready in time`);
}

function stopServer(server: Server) { server.process.kill(); }

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
  await db.delete(closetItems);
  await db.delete(closetMediaUploads);
}

async function main() {
  await resetData();
  const sidecar = await startFakeSidecar();
  const fakeAnthropic = await startFakeAnthropic();
  const anthropicBaseUrl = `http://127.0.0.1:${fakeAnthropic.port}`;

  const server = await startServer({ ANTHROPIC_API_KEY: "fake-test-key", ANTHROPIC_BASE_URL: anthropicBaseUrl });
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
    await check("a valid myThingsItemId is accepted and its attributes (never the image) reach the provider as text context", async () => {
      fakeAnthropicMode = { kind: "ok" };
      const response = await userA.kinSearch({ mode: "looks", query: "style this with something", myThingsItemId: itemId });
      await expectStatus(response, 200);
      assert.ok(lastAnthropicRequestBody.includes("shirt"), "the item's taxonomy attributes should reach the model as text context");
      assert.ok(!lastAnthropicRequestBody.includes("image"), "no image content block should ever be sent for My Things context");
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
    await check("provider non-2xx: 200 with status 'unavailable', never a 5xx surfaced to the client", async () => {
      fakeAnthropicMode = { kind: "http_error", status: 500 };
      const response = await userA.kinSearch({ mode: "looks", query: "ok" });
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { status: "unavailable", reason: "unavailable" });
    });
    await check("provider timeout: 200 with status 'unavailable' after the hard timeout elapses", async () => {
      fakeAnthropicMode = { kind: "timeout" };
      const started = Date.now();
      const response = await userA.kinSearch({ mode: "looks", query: "ok" });
      const elapsedMs = Date.now() - started;
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { status: "unavailable", reason: "unavailable" });
      assert.ok(elapsedMs < 55_000, `timeout path took unexpectedly long (retries not disabled?): ${elapsedMs}ms`);
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
