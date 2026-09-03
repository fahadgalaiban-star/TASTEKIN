// Automated regression coverage for the closet_item_analysis feature: Claude
// vision suggestions for My Things' Add Item flow. Runs the compiled
// api-server against a REAL Postgres database (point DATABASE_URL at a
// disposable/test database — this creates real rows) and drives it over real
// HTTP. Never calls the real Anthropic API — a fake in-process HTTP server
// stands in for it, reached via the ANTHROPIC_BASE_URL env var (the
// @anthropic-ai/sdk client reads this the same way it reads
// ANTHROPIC_API_KEY, so no test-only code path exists in closet-image
// -analysis.ts).
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:closet-analysis
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closetItems, closetMediaUploads, db } from "@workspace/db";
import { eq } from "drizzle-orm";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

// --- fake object-storage sidecar (same pattern as verify-my-things.ts) -----

const store = new Map<string, Buffer>();

function startFakeSidecar(): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        if (req.method === "POST" && req.url === "/object-storage/signed-object-url") {
          const parsed = JSON.parse(body.toString("utf8")) as { bucket_name: string; object_name: string; method: string };
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
// Implements only what the SDK actually calls: POST /v1/messages. Returns a
// Message-shaped JSON body with a single text block carrying the JSON
// suggestions payload, matching what analyzeClosetImage expects to parse.

type Suggestion = { value: string; confidence: number } | null;
type FakeAnthropicMode =
  | { kind: "ok"; suggestions: Record<string, Suggestion> }
  | { kind: "malformed" }
  | { kind: "http_error"; status: number }
  | { kind: "timeout" }
  | { kind: "refusal" };

const FULL_CONFIDENCE_SUGGESTIONS: Record<string, Suggestion> = {
  itemType: { value: "shirt", confidence: 0.95 },
  primaryColor: { value: "blue", confidence: 0.9 },
  style: { value: "casual", confidence: 0.85 },
  occasion: { value: "everyday", confidence: 0.8 },
  season: { value: "all_season", confidence: 0.75 },
};
const MIXED_CONFIDENCE_SUGGESTIONS: Record<string, Suggestion> = {
  itemType: { value: "jeans", confidence: 0.9 },
  primaryColor: { value: "black", confidence: 0.2 }, // below threshold
  style: { value: "smart_casual", confidence: 0.7 },
  occasion: { value: "work", confidence: 0.1 }, // below threshold
  season: { value: "all_season", confidence: 0.65 },
};

let fakeAnthropicMode: FakeAnthropicMode = { kind: "ok", suggestions: FULL_CONFIDENCE_SUGGESTIONS };
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
          id: "msg_fake", type: "message", role: "assistant", model: "claude-haiku-4-5-20251001",
          stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 },
        };
        if (mode.kind === "refusal") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ...base, content: [], stop_reason: "refusal" }));
          return;
        }
        if (mode.kind === "malformed") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ...base, content: [{ type: "text", text: "not valid json {{{" }], stop_reason: "end_turn" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...base, content: [{ type: "text", text: JSON.stringify(mode.suggestions) }], stop_reason: "end_turn" }));
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

let nextPort = 25200;
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
  async uploadMedia(buffer: Buffer, contentType = "image/jpeg") {
    return this.request("/api/closet-items/media", { method: "POST", headers: { "content-type": contentType }, body: buffer });
  }
  async createItem(uploadId: string, fields: Record<string, unknown>) {
    return this.request("/api/closet-items", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uploadId, ...fields }),
    });
  }
  async analyze(uploadId: string) {
    return this.request(`/api/closet-items/media/${uploadId}/analyze`, { method: "POST" });
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

async function validJpeg(width = 40, height = 40): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 180, g: 60, b: 60 } } }).jpeg().toBuffer();
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
    const adminAccount = await admin.signup(`closet-analysis-admin-${suffix}@example.com`, PASSWORD);
    const grant = await runScript(path.join(repoRoot, "scripts/src/admin-grant.ts"), ["--user-id", adminAccount.user.id, "--yes"]);
    assert.equal(grant.code, 0, `admin-grant should exit 0: ${grant.stdout}`);

    // Feature flags are DB rows that outlive a single run of this script
    // against a reused disposable database — force both to a known OFF
    // state before the gating checks below, rather than assuming a fresh
    // database.
    await expectStatus(await admin.setFlag("my_things", false), 200);
    await expectStatus(await admin.setFlag("closet_item_analysis", false), 200);

    const userA = new Session(server.baseUrl);
    const userAAccount = await userA.signup(`closet-analysis-a-${suffix}@example.com`, PASSWORD);
    const userB = new Session(server.baseUrl);
    await userB.signup(`closet-analysis-b-${suffix}@example.com`, PASSWORD);

    async function freshUpload(session: Session) {
      const response = await session.uploadMedia(await validJpeg());
      await expectStatus(response, 201);
      const { uploadId } = (await response.json()) as { uploadId: string };
      return uploadId;
    }

    // --- flag gating ---
    await check("both flags OFF: analyze is rejected with 403", async () => {
      assert.equal((await userA.analyze("00000000-0000-0000-0000-000000000000")).status, 403);
    });

    await expectStatus(await admin.setFlag("my_things", true), 200);

    await check("my_things ON, closet_item_analysis OFF: analyze is still rejected with 403", async () => {
      const uploadId = await freshUpload(userA);
      assert.equal((await userA.analyze(uploadId)).status, 403);
    });

    await expectStatus(await admin.setFlag("closet_item_analysis", true), 200);

    await check("unauthenticated: analyze is rejected with 401", async () => {
      const anon = new Session(server.baseUrl);
      assert.equal((await anon.analyze("00000000-0000-0000-0000-000000000000")).status, 401);
    });

    // --- upload-state / ownership scoping ---
    await check("unknown/never-existed uploadId returns 404", async () => {
      assert.equal((await userA.analyze("00000000-0000-0000-0000-000000000000")).status, 404);
    });
    await check("a malformed (non-UUID) uploadId returns 404, not 500", async () => {
      assert.equal((await userA.analyze("not-a-uuid")).status, 404);
    });
    await check("cross-user: B cannot analyze A's unconsumed upload — 404", async () => {
      const uploadId = await freshUpload(userA);
      assert.equal((await userB.analyze(uploadId)).status, 404);
    });
    await check("an upload already attached to an item returns 404 (analysis is pre-creation only)", async () => {
      const uploadId = await freshUpload(userA);
      const createResponse = await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "black" });
      await expectStatus(createResponse, 201);
      assert.equal((await userA.analyze(uploadId)).status, 404);
    });

    // --- successful analysis ---
    await check("fully-confident fake response: all 5 fields populated with the exact suggested enum values", async () => {
      fakeAnthropicMode = { kind: "ok", suggestions: FULL_CONFIDENCE_SUGGESTIONS };
      const uploadId = await freshUpload(userA);
      const response = await userA.analyze(uploadId);
      await expectStatus(response, 200);
      const payload = (await response.json()) as { suggestions: Record<string, string | null> };
      assert.equal(payload.suggestions.itemType, "shirt");
      assert.equal(payload.suggestions.primaryColor, "blue");
      assert.equal(payload.suggestions.style, "casual");
      assert.equal(payload.suggestions.occasion, "everyday");
      assert.equal(payload.suggestions.season, "all_season");
    });
    await check("mixed-confidence fake response: below-threshold fields are null, others populated", async () => {
      fakeAnthropicMode = { kind: "ok", suggestions: MIXED_CONFIDENCE_SUGGESTIONS };
      const uploadId = await freshUpload(userA);
      const response = await userA.analyze(uploadId);
      await expectStatus(response, 200);
      const payload = (await response.json()) as { suggestions: Record<string, string | null> };
      assert.equal(payload.suggestions.itemType, "jeans");
      assert.equal(payload.suggestions.primaryColor, null, "0.2 confidence must be nulled out by the server-side threshold");
      assert.equal(payload.suggestions.style, "smart_casual");
      assert.equal(payload.suggestions.occasion, null, "0.1 confidence must be nulled out by the server-side threshold");
      assert.equal(payload.suggestions.season, "all_season");
    });
    await check("the response never includes a confidence number anywhere in the JSON", async () => {
      fakeAnthropicMode = { kind: "ok", suggestions: FULL_CONFIDENCE_SUGGESTIONS };
      const uploadId = await freshUpload(userA);
      const response = await userA.analyze(uploadId);
      const text = await response.text();
      assert.ok(!text.includes("confidence"), `response body must never expose a confidence field: ${text}`);
    });

    // --- provider failure modes all collapse to 200 { suggestions: null } ---
    await check("provider refusal: 200 with suggestions: null", async () => {
      fakeAnthropicMode = { kind: "refusal" };
      const uploadId = await freshUpload(userA);
      const response = await userA.analyze(uploadId);
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { suggestions: null });
    });
    await check("provider malformed JSON output: 200 with suggestions: null", async () => {
      fakeAnthropicMode = { kind: "malformed" };
      const uploadId = await freshUpload(userA);
      const response = await userA.analyze(uploadId);
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { suggestions: null });
    });
    await check("provider non-2xx: 200 with suggestions: null, never a 5xx surfaced to the client", async () => {
      fakeAnthropicMode = { kind: "http_error", status: 500 };
      const uploadId = await freshUpload(userA);
      const response = await userA.analyze(uploadId);
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { suggestions: null });
    });
    await check("provider timeout: 200 with suggestions: null after the hard timeout elapses", async () => {
      fakeAnthropicMode = { kind: "timeout" };
      const uploadId = await freshUpload(userA);
      const started = Date.now();
      const response = await userA.analyze(uploadId);
      const elapsedMs = Date.now() - started;
      await expectStatus(response, 200);
      assert.deepEqual(await response.json(), { suggestions: null });
      assert.ok(elapsedMs < 12_000, `timeout path took unexpectedly long (retries not disabled?): ${elapsedMs}ms`);
      fakeAnthropicMode = { kind: "ok", suggestions: FULL_CONFIDENCE_SUGGESTIONS };
    });

    // --- no side effects ---
    await check("analysis never creates or updates a closet_items row, and never persists its result", async () => {
      fakeAnthropicMode = { kind: "ok", suggestions: FULL_CONFIDENCE_SUGGESTIONS };
      const itemsBefore = (await db.select().from(closetItems).where(eq(closetItems.ownerUserId, userAAccount.user.id))).length;
      const uploadId = await freshUpload(userA);
      await expectStatus(await userA.analyze(uploadId), 200);
      const itemsAfter = (await db.select().from(closetItems).where(eq(closetItems.ownerUserId, userAAccount.user.id))).length;
      assert.equal(itemsAfter, itemsBefore, "analyze must never create a closet_items row");
      const [uploadRow] = await db.select().from(closetMediaUploads).where(eq(closetMediaUploads.id, uploadId));
      assert.equal(uploadRow.state, "uploaded", "analyze must never change the upload ledger's state");
    });

    // --- payload sent to the provider never contains user information ---
    await check("the request sent to the provider never contains the caller's email, user id, or object key", async () => {
      fakeAnthropicMode = { kind: "ok", suggestions: FULL_CONFIDENCE_SUGGESTIONS };
      const uploadId = await freshUpload(userA);
      await expectStatus(await userA.analyze(uploadId), 200);
      const [uploadRow] = await db.select().from(closetMediaUploads).where(eq(closetMediaUploads.id, uploadId));
      assert.ok(!lastAnthropicRequestBody.includes(userAAccount.user.email), "provider payload must never contain the caller's email");
      assert.ok(!lastAnthropicRequestBody.includes(userAAccount.user.id), "provider payload must never contain the caller's user id");
      assert.ok(!lastAnthropicRequestBody.includes(uploadRow.imageObjectKey ?? "__none__"), "provider payload must never contain the storage object key");
      assert.ok(!lastAnthropicRequestBody.toLowerCase().includes("filename"), "provider payload must never reference a filename");
    });

    // --- rate limiting: in-memory soft limit, 5/hour per user+upload ---
    await check("analysis soft limit: 5 attempts/hour per upload allowed, the 6th is rejected with 429", async () => {
      fakeAnthropicMode = { kind: "ok", suggestions: FULL_CONFIDENCE_SUGGESTIONS };
      const uploadId = await freshUpload(userA);
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) statuses.push((await userA.analyze(uploadId)).status);
      assert.ok(statuses.every((status) => status === 200), `expected all 5 to succeed, got ${statuses.join(",")}`);
      const requestsBeforeSixth = anthropicRequestCount;
      assert.equal((await userA.analyze(uploadId)).status, 429);
      assert.equal(anthropicRequestCount, requestsBeforeSixth, "a soft-limited attempt must never reach the provider");
    });

    // --- missing API key: server never crashes, always degrades gracefully ---
    await check("missing ANTHROPIC_API_KEY: server boots fine, analyze returns 200 with suggestions: null", async () => {
      const noKeyServer = await startServer({ ANTHROPIC_API_KEY: undefined, ANTHROPIC_BASE_URL: anthropicBaseUrl });
      try {
        const session = new Session(noKeyServer.baseUrl);
        await session.signup(`closet-analysis-nokey-${suffix}@example.com`, PASSWORD);
        // Both flags are already enabled — they are rows in the same
        // database this second server process also connects to, set
        // earlier via the admin session against the first server.
        const uploadResponse = await session.uploadMedia(await validJpeg());
        await expectStatus(uploadResponse, 201);
        const { uploadId } = (await uploadResponse.json()) as { uploadId: string };
        const response = await session.analyze(uploadId);
        await expectStatus(response, 200);
        assert.deepEqual(await response.json(), { suggestions: null });
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
  console.log(`\nAll ${results.length} closet-item-analysis regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
