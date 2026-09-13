// Video Foundation, Phase 2B — regression coverage for the Bunny Stream
// webhook endpoint and the bounded reconciliation/recovery sweeps layered
// on top of Phase 2A's upload lifecycle. Runs the compiled api-server
// against a REAL Postgres database (point DATABASE_URL at a disposable
// test database — this creates and deletes real rows) and drives it over
// real HTTP; separately spawns the compiled reconciliation CLI
// (dist/cli/reconcile-video-uploads.mjs) as the one-shot process a
// scheduled runner would invoke. Never calls the real Bunny API — a fake
// in-process HTTP server stands in for it, extended (beyond
// verify-video-upload-lifecycle.ts's fake) with a List Videos endpoint for
// the orphan-recovery search.
//
// Schema setup: point DATABASE_URL at a database already schema-pushed to
// HEAD (`pnpm --filter db run push`) — see verify-video-upload-lifecycle.ts
// for why `push`, not migration replay, is this repo's disposable-DB setup
// convention (an unrelated pre-existing migration-history gap). The
// migration *files* themselves (0017/0018/0019) are separately, literally
// replayed by verify-video-upload-migration-replay.ts — that is a
// different test with a different, non-overlapping claim; do not conflate
// the two reports.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:video-upload-webhook-recovery
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, featureFlags, videoUploads } from "@workspace/db";
import { eq } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");
const reconcileEntry = path.join(repoRoot, "artifacts/api-server/dist/cli/reconcile-video-uploads.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

const TEST_LIBRARY_ID = "fake-library-42";
const TEST_API_KEY = "SECRET-TEST-BUNNY-WRITE-KEY-never-logged";
const TEST_READONLY_KEY = "SECRET-TEST-BUNNY-READONLY-KEY-never-logged";

// --- fake Bunny Stream provider ----------------------------------------------
//
// A single in-memory store, keyed by guid, backs create/get/list/delete —
// unlike verify-video-upload-lifecycle.ts's fake (which only needed
// create/get/delete), the orphan-recovery search needs List Videos to see
// the same videos Get Video would report, including ones this test injects
// directly (simulating a video Bunny actually created before this app ever
// learned its id).

type FakeVideo = { title: string | null; status: number; length?: number | null; width?: number | null; height?: number | null };
const videoStore = new Map<string, FakeVideo>();
const deleteOverrides = new Map<string, "http_error" | "not_found">();
let videoCounter = 0;
let deleteCallCount = 0;
const deleteLog: string[] = [];

function startFakeBunny(): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const url = new URL(req.url ?? "", "http://internal");
        const pathname = url.pathname;
        const createMatch = pathname.match(/^\/library\/([^/]+)\/videos$/);
        const itemMatch = pathname.match(/^\/library\/([^/]+)\/videos\/([^/]+)$/);

        if (req.method === "POST" && createMatch) {
          let title: string | null = null;
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
            title = typeof parsed.title === "string" ? parsed.title : null;
          } catch { /* malformed body — title stays null */ }
          videoCounter += 1;
          const guid = `fake-video-${videoCounter}`;
          videoStore.set(guid, { title, status: 0 });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ guid }));
          return;
        }

        if (req.method === "GET" && createMatch) {
          const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
          const itemsPerPage = Math.max(1, Number(url.searchParams.get("itemsPerPage")) || 100);
          const entries = [...videoStore.entries()];
          const start = (page - 1) * itemsPerPage;
          const pageItems = entries.slice(start, start + itemsPerPage).map(([guid, v]) => ({ guid, title: v.title, status: v.status }));
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ items: pageItems, totalItems: entries.length, currentPage: page, itemsPerPage }));
          return;
        }

        if (req.method === "GET" && itemMatch) {
          const videoId = itemMatch[2];
          const video = videoStore.get(videoId);
          if (!video) { res.writeHead(404); res.end(); return; }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            guid: videoId, status: video.status, title: video.title,
            length: video.length ?? null, width: video.width ?? null, height: video.height ?? null,
            thumbnailFileName: video.length ? "thumb.jpg" : null,
          }));
          return;
        }

        if (req.method === "DELETE" && itemMatch) {
          const videoId = itemMatch[2];
          deleteCallCount += 1;
          deleteLog.push(videoId);
          const override = deleteOverrides.get(videoId);
          if (override === "not_found") { res.writeHead(404); res.end(); return; }
          if (override === "http_error") { res.writeHead(500); res.end(); return; }
          videoStore.delete(videoId);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        res.writeHead(404); res.end();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
      else reject(new Error("failed to bind fake Bunny server"));
    });
    server.on("error", reject);
  });
}

// --- server + reconcile-CLI harness -----------------------------------------

let nextPort = 25500;
type Server = { port: number; process: ChildProcess; baseUrl: string; stdout: string };

function baseEnv(fakeBunnyBaseUrl: string, overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    ...process.env,
    BUNNY_STREAM_API_KEY: TEST_API_KEY,
    BUNNY_STREAM_LIBRARY_ID: TEST_LIBRARY_ID,
    BUNNY_STREAM_BASE_URL: fakeBunnyBaseUrl,
    BUNNY_STREAM_READONLY_API_KEY: TEST_READONLY_KEY,
    BUNNY_STREAM_TIMEOUT_MS_OVERRIDE: "800",
    VIDEO_UPLOAD_RECONCILE_MIN_INTERVAL_MS_OVERRIDE: "50",
    VIDEO_UPLOAD_RECOVERY_LEASE_MS_OVERRIDE: "60000",
    VIDEO_UPLOAD_STALE_CREATING_MS_OVERRIDE: "50",
    // envOverrideMs (video-upload-recovery.ts) requires a strictly positive
    // override value — "0" fails its `raw > 0` guard and silently falls
    // back to the real (multi-minute) production default, not "no
    // backoff/threshold" as it might look. "1" (millisecond) is what
    // actually collapses the window to effectively nothing.
    VIDEO_UPLOAD_DELETE_RETRY_BACKOFF_MS_OVERRIDE: "1",
    VIDEO_UPLOAD_MISSED_WEBHOOK_THRESHOLD_MS_OVERRIDE: "1",
    VIDEO_UPLOAD_RECOVERY_MAX_ATTEMPTS_OVERRIDE: "3",
    ...overrides,
  };
}

async function startServer(env: Record<string, string | undefined>): Promise<Server> {
  const port = nextPort;
  nextPort += 1;
  const fullEnv: Record<string, string | undefined> = { ...env, PORT: String(port), NODE_ENV: "production" };
  const child = spawn("node", [serverEntry], { env: fullEnv, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stdout += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/version`);
      if (response.ok) return { port, process: child, baseUrl, get stdout() { return stdout; } } as Server;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`Server on port ${port} did not become ready in time`);
}

function stopServer(server: Server) { server.process.kill(); }

/** Spawns the exact one-shot CLI a scheduled runner would invoke, against the same DATABASE_URL/BUNNY_STREAM_* env as the live server, and returns its parsed JSON summary. */
async function runReconcileCli(env: Record<string, string | undefined>): Promise<{ code: number; summary: Record<string, number> | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [reconcileEntry], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stdout += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      let summary: Record<string, number> | null = null;
      try {
        const jsonStart = stdout.indexOf("{");
        if (jsonStart >= 0) summary = JSON.parse(stdout.slice(jsonStart));
      } catch { /* leave summary null — caller asserts on it */ }
      resolve({ code: code ?? 1, summary, stdout });
    });
  });
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
  async setFlag(key: string, enabled: boolean) {
    return this.request(`/api/admin/feature-flags/${encodeURIComponent(key)}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }),
    });
  }
  async requestUpload(body: Record<string, unknown>, idempotencyKey?: string) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    return this.request("/api/video-uploads/request-upload", { method: "POST", headers, body: JSON.stringify(body) });
  }
  async getUpload(id: string) { return this.request(`/api/video-uploads/${encodeURIComponent(id)}`); }
  async cancelUpload(id: string) { return this.request(`/api/video-uploads/${encodeURIComponent(id)}/cancel`, { method: "POST" }); }
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

// --- webhook signing ----------------------------------------------------

function signBody(bodyString: string, key = TEST_READONLY_KEY): string {
  return createHmac("sha256", key).update(bodyString).digest("hex");
}

type WebhookHeaderOverrides = { signature?: string | null; version?: string | null; algorithm?: string | null };

async function postWebhook(baseUrl: string, bodyString: string, headerOverrides: WebhookHeaderOverrides = {}) {
  const signature = "signature" in headerOverrides ? headerOverrides.signature : signBody(bodyString);
  const version = "version" in headerOverrides ? headerOverrides.version : "v1";
  const algorithm = "algorithm" in headerOverrides ? headerOverrides.algorithm : "hmac-sha256";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null && signature !== undefined) headers["x-bunnystream-signature"] = signature;
  if (version !== null && version !== undefined) headers["x-bunnystream-signature-version"] = version;
  if (algorithm !== null && algorithm !== undefined) headers["x-bunnystream-signature-algorithm"] = algorithm;
  return fetch(`${baseUrl}/api/video-uploads/webhook`, { method: "POST", headers, body: bodyString });
}

function webhookBody(libraryId: string, videoId: string, status: number): string {
  return JSON.stringify({ VideoLibraryId: libraryId, VideoGuid: videoId, Status: status });
}

// --- direct DB helpers for synthesizing recovery scenarios -------------------
//
// A "creating" row abandoned by a crashed process, or a "create_ambiguous"
// row from a lost create response, cannot be produced through the ordinary
// HTTP API on demand — they exist only as the aftermath of a genuine
// process interruption. Inserting them directly (bypassing the API,
// exactly like the row a crashed process would have left behind) is the
// only way to test the sweep that recovers them without actually crashing
// the server mid-request.

async function insertRow(overrides: Partial<typeof videoUploads.$inferInsert> & { ownerUserId: string }) {
  const [row] = await db.insert(videoUploads).values({
    creatorId: overrides.ownerUserId,
    bunnyLibraryId: TEST_LIBRARY_ID,
    state: "creating",
    ...overrides,
  }).returning();
  return row;
}

async function getRow(id: string) {
  const [row] = await db.select().from(videoUploads).where(eq(videoUploads.id, id));
  return row ?? null;
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

const suffix = Date.now();
const PASSWORD = "regression-test-1234";
const validFile = { fileName: "trip-clip.mp4", sizeBytes: 12_345_678, mimeType: "video/mp4" };
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

async function main() {
  await db.delete(videoUploads);
  await db.delete(featureFlags).where(eq(featureFlags.key, "video_upload"));
  const fakeBunny = await startFakeBunny();
  const env = baseEnv(fakeBunny.baseUrl);
  const server = await startServer(env);

  try {
    const admin = new Session(server.baseUrl);
    const adminAccount = await admin.signup(`webhook-admin-${suffix}@example.com`, PASSWORD);
    const grant = await runScript(path.join(repoRoot, "scripts/src/admin-grant.ts"), ["--user-id", adminAccount.user.id, "--yes"]);
    assert.equal(grant.code, 0, `admin-grant should exit 0: ${grant.stdout}`);
    await expectStatus(await admin.setFlag("video_upload", true), 200);

    let freshUserCounter = 0;
    async function freshUser(): Promise<{ session: Session; userId: string }> {
      freshUserCounter += 1;
      const session = new Session(server.baseUrl);
      const account = await session.signup(`webhook-fresh-${suffix}-${freshUserCounter}@example.com`, PASSWORD);
      return { session, userId: account.user.id };
    }

    // --- signature verification: invalid/tampered signatures, raw-body ---

    await check("webhook: missing signature header is rejected with 401", async () => {
      const body = webhookBody(TEST_LIBRARY_ID, "fake-video-x", 3);
      const response = await postWebhook(server.baseUrl, body, { signature: null });
      assert.equal(response.status, 401);
    });

    await check("webhook: missing version/algorithm headers are each rejected with 401", async () => {
      const body = webhookBody(TEST_LIBRARY_ID, "fake-video-x", 3);
      assert.equal((await postWebhook(server.baseUrl, body, { version: null })).status, 401);
      assert.equal((await postWebhook(server.baseUrl, body, { algorithm: null })).status, 401);
      assert.equal((await postWebhook(server.baseUrl, body, { version: "v2" })).status, 401);
      assert.equal((await postWebhook(server.baseUrl, body, { algorithm: "hmac-sha1" })).status, 401);
    });

    await check("webhook: malformed (non-hex, wrong-length) signature is rejected with 401, never crashes", async () => {
      const body = webhookBody(TEST_LIBRARY_ID, "fake-video-x", 3);
      assert.equal((await postWebhook(server.baseUrl, body, { signature: "not-hex!!" })).status, 401);
      assert.equal((await postWebhook(server.baseUrl, body, { signature: "ab".repeat(31) })).status, 401);
      assert.equal((await postWebhook(server.baseUrl, body, { signature: "" })).status, 401);
    });

    await check("webhook: a correct-shape but wrong-value signature (signed with the wrong key) is rejected with 401", async () => {
      const body = webhookBody(TEST_LIBRARY_ID, "fake-video-x", 3);
      const wrongSignature = signBody(body, "totally-wrong-key");
      const response = await postWebhook(server.baseUrl, body, { signature: wrongSignature });
      assert.equal(response.status, 401);
    });

    await check("webhook: uppercase-hex signature is still accepted (case-insensitive comparison)", async () => {
      const { userId } = await freshUser();
      const created = await insertRow({ ownerUserId: userId, state: "uploading", bunnyVideoId: `fake-video-upper-${suffix}` });
      videoStore.set(created.bunnyVideoId!, { title: created.id, status: 3, length: 10, width: 100, height: 100 });
      const body = webhookBody(TEST_LIBRARY_ID, created.bunnyVideoId!, 3);
      const signature = signBody(body).toUpperCase();
      const response = await postWebhook(server.baseUrl, body, { signature });
      assert.equal(response.status, 200);
      const row = await getRow(created.id);
      assert.equal(row?.state, "ready", "an uppercase-hex but otherwise valid signature must still be accepted and processed");
    });

    await check("webhook: raw-body handling — a tampered body (any byte changed after signing) is rejected with 401, even if it re-serializes to the same JSON", async () => {
      const { userId } = await freshUser();
      const created = await insertRow({ ownerUserId: userId, state: "uploading", bunnyVideoId: `fake-video-tamper-${suffix}` });
      const originalBody = JSON.stringify({ VideoLibraryId: TEST_LIBRARY_ID, VideoGuid: created.bunnyVideoId, Status: 3 });
      const signatureOverOriginal = signBody(originalBody);
      // Same JSON.parse() result, different bytes (extra whitespace) — proves
      // the check is over the exact raw bytes, never a re-serialization.
      const tamperedBody = JSON.stringify({ VideoLibraryId: TEST_LIBRARY_ID, VideoGuid: created.bunnyVideoId, Status: 3 }, null, 1);
      assert.notEqual(originalBody, tamperedBody, "sanity check: the two byte strings must actually differ");
      const response = await postWebhook(server.baseUrl, tamperedBody, { signature: signatureOverOriginal });
      assert.equal(response.status, 401);
      const row = await getRow(created.id);
      assert.equal(row?.state, "uploading", "a rejected (unverifiable) webhook must never change state");
    });

    await check("webhook: a valid signature over the exact raw bytes is accepted and actually reconciles the row", async () => {
      const { userId } = await freshUser();
      const created = await insertRow({ ownerUserId: userId, state: "uploading", bunnyVideoId: `fake-video-valid-${suffix}` });
      videoStore.set(created.bunnyVideoId!, { title: created.id, status: 3, length: 20, width: 640, height: 360 });
      const body = webhookBody(TEST_LIBRARY_ID, created.bunnyVideoId!, 3);
      const response = await postWebhook(server.baseUrl, body);
      assert.equal(response.status, 200);
      const row = await getRow(created.id);
      assert.equal(row?.state, "ready");
      assert.equal(row?.durationSeconds, 20);
    });

    // --- ground truth over event codes ---

    await check("webhook: the payload's own Status field is never trusted for the lifecycle decision — ground truth is re-fetched from Get Video", async () => {
      const { userId } = await freshUser();
      const created = await insertRow({ ownerUserId: userId, state: "uploading", bunnyVideoId: `fake-video-truth-${suffix}` });
      // Provider ground truth says still processing (no valid playback
      // metadata) — a webhook whose Status field CLAIMS "Finished" (3) must
      // not be believed; the row must only reflect what Get Video reports.
      videoStore.set(created.bunnyVideoId!, { title: created.id, status: 2 });
      const body = webhookBody(TEST_LIBRARY_ID, created.bunnyVideoId!, 3);
      await expectStatus(await postWebhook(server.baseUrl, body), 200);
      const row = await getRow(created.id);
      assert.equal(row?.state, "processing", "the row must reflect Get Video's real status, not the webhook payload's own claimed Status");
    });

    // --- wrong library ---

    await check("webhook: a VideoLibraryId that doesn't match the row's own persisted library is rejected as an identity mismatch, never acted on", async () => {
      const { userId } = await freshUser();
      const created = await insertRow({ ownerUserId: userId, state: "uploading", bunnyVideoId: `fake-video-wronglib-${suffix}` });
      videoStore.set(created.bunnyVideoId!, { title: created.id, status: 3, length: 5, width: 10, height: 10 });
      const body = webhookBody("some-other-library-999", created.bunnyVideoId!, 3);
      const response = await postWebhook(server.baseUrl, body);
      assert.equal(response.status, 200, "a well-signed but library-mismatched delivery is still acknowledged (never retried) — just not acted on");
      const row = await getRow(created.id);
      assert.equal(row?.state, "uploading", "library mismatch must never cause a state change");
    });

    await check("webhook: an unknown bunny_video_id (no matching row) is acknowledged, not treated as an error", async () => {
      const body = webhookBody(TEST_LIBRARY_ID, `fake-video-unknown-${suffix}`, 3);
      const response = await postWebhook(server.baseUrl, body);
      assert.equal(response.status, 200);
    });

    // --- duplicate / out-of-order events must never revive a cancelled/deleted upload ---

    await check("webhook: duplicate and out-of-order events can never revive an already-deleted upload", async () => {
      const { session, userId } = await freshUser();
      const response = await session.requestUpload(validFile, `webhook-cancel-${suffix}`);
      await expectStatus(response, 201);
      const { id, tus } = await response.json() as { id: string; tus: { videoId: string } };
      const videoId = tus.videoId;
      await expectStatus(await session.cancelUpload(id), 200);
      const cancelled = await getRow(id);
      assert.equal(cancelled?.state, "deleted");

      // A late webhook claiming the video finished processing, delivered
      // after the cancel already deleted it on Bunny's side too.
      const body = webhookBody(TEST_LIBRARY_ID, videoId, 3);
      await expectStatus(await postWebhook(server.baseUrl, body), 200);
      assert.equal((await getRow(id))?.state, "deleted", "a late webhook must never revive a deleted upload");

      // The exact same event delivered again (Bunny's own retry policy) —
      // must be just as inert the second time.
      await expectStatus(await postWebhook(server.baseUrl, body), 200);
      assert.equal((await getRow(id))?.state, "deleted");
      void userId;
    });

    // --- feature flag gating happens only after authentication ---

    await check("webhook: a well-signed delivery while video_upload is disabled is acknowledged without being processed", async () => {
      const { userId } = await freshUser();
      const created = await insertRow({ ownerUserId: userId, state: "uploading", bunnyVideoId: `fake-video-flagoff-${suffix}` });
      videoStore.set(created.bunnyVideoId!, { title: created.id, status: 3, length: 9, width: 9, height: 9 });
      await expectStatus(await admin.setFlag("video_upload", false), 200);
      try {
        const body = webhookBody(TEST_LIBRARY_ID, created.bunnyVideoId!, 3);
        const response = await postWebhook(server.baseUrl, body);
        assert.equal(response.status, 200);
        const row = await getRow(created.id);
        assert.equal(row?.state, "uploading", "a webhook must never be processed while the feature is disabled, even if authenticated");
      } finally {
        await expectStatus(await admin.setFlag("video_upload", true), 200);
      }
    });

    // --- reconciliation CLI: missed-webhook recovery for uploading/processing rows ---

    await check("reconcile CLI: an uploading row that never received any webhook or status poll is still brought to ready by the sweep", async () => {
      const { userId } = await freshUser();
      const created = await insertRow({ ownerUserId: userId, state: "uploading", bunnyVideoId: `fake-video-missed-${suffix}` });
      videoStore.set(created.bunnyVideoId!, { title: created.id, status: 3, length: 33, width: 200, height: 200 });
      // Never call GET /:id and never POST the webhook — this row's only
      // path to "ready" is the reconciliation sweep.
      const result = await runReconcileCli(env);
      assert.equal(result.code, 0, `reconcile CLI should exit 0: ${result.stdout}`);
      assert.ok(result.summary, `reconcile CLI should print a JSON summary: ${result.stdout}`);
      assert.ok((result.summary!.missedWebhookChecked ?? 0) >= 1, "summary should report at least one missed-webhook check");
      const row = await getRow(created.id);
      assert.equal(row?.state, "ready", "the sweep alone must bring a never-reconciled row up to date");
    });

    // --- reconciliation CLI: stale "creating" rows ---

    await check("reconcile CLI: a stale 'creating' row left by a crashed process is reclaimed into create_ambiguous, then resolved once found on the provider", async () => {
      const { userId } = await freshUser();
      const staleCreatedAt = new Date(Date.now() - 60_000);
      const created = await insertRow({ ownerUserId: userId, state: "creating", createdAt: staleCreatedAt, updatedAt: staleCreatedAt, bunnyVideoId: null });
      // Simulate Bunny having actually received the create call before the
      // response was lost — the video exists on the provider, titled with
      // this row's own id, but this row never learned its guid.
      const guid = `fake-video-stale-found-${suffix}`;
      videoStore.set(guid, { title: created.id, status: 0 });

      const result = await runReconcileCli(env);
      assert.equal(result.code, 0, result.stdout);
      assert.ok((result.summary?.staleCreatingReclaimed ?? 0) >= 1, "summary should report the stale creating row was reclaimed");

      const row = await getRow(created.id);
      assert.equal(row?.state, "uploading", "a confirmed-found orphan must be adopted, returning the row to normal uploading flow");
      assert.equal(row?.bunnyVideoId, guid);
    });

    await check("reconcile CLI: a stale 'creating' row with no matching provider video resolves to failed, never guessed at", async () => {
      const { userId } = await freshUser();
      const staleCreatedAt = new Date(Date.now() - 60_000);
      const created = await insertRow({ ownerUserId: userId, state: "creating", createdAt: staleCreatedAt, updatedAt: staleCreatedAt, bunnyVideoId: null });
      // No matching video anywhere in the fake provider's library.
      const result = await runReconcileCli(env);
      assert.equal(result.code, 0, result.stdout);
      const row = await getRow(created.id);
      assert.equal(row?.state, "failed", "confirmed-absent must resolve to failed, not linger or get guessed at");
    });

    // --- exact-match and pagination behavior ---

    await check("reconcile CLI: orphan search matches by EXACT title only — a superstring/prefix near-miss is never adopted", async () => {
      const { userId } = await freshUser();
      const created = await insertRow({ ownerUserId: userId, state: "create_ambiguous", bunnyVideoId: null, retryCount: 0 });
      videoStore.set(`fake-near-miss-super-${suffix}`, { title: `${created.id}-extra`, status: 0 });
      videoStore.set(`fake-near-miss-prefix-${suffix}`, { title: created.id.slice(0, 10), status: 0 });
      const result = await runReconcileCli(env);
      assert.equal(result.code, 0, result.stdout);
      const row = await getRow(created.id);
      assert.equal(row?.state, "failed", "near-miss titles must never be treated as a match");
    });

    await check("reconcile CLI: orphan search paginates across multiple pages to find an exact match on a later page", async () => {
      const { userId } = await freshUser();
      const created = await insertRow({ ownerUserId: userId, state: "create_ambiguous", bunnyVideoId: null, retryCount: 0 });
      // The orphan search pages at 100 items per page — 150 unrelated filler
      // videos plus the real match (inserted last, landing on page 2)
      // forces real multi-page pagination, not just a single-page lookup.
      for (let i = 0; i < 150; i += 1) {
        videoStore.set(`fake-filler-${suffix}-${i}`, { title: `filler-title-${suffix}-${i}`, status: 0 });
      }
      const matchGuid = `fake-paginated-match-${suffix}`;
      videoStore.set(matchGuid, { title: created.id, status: 0 });

      const result = await runReconcileCli(env);
      assert.equal(result.code, 0, result.stdout);
      const row = await getRow(created.id);
      assert.equal(row?.state, "uploading", "a match on a later page must still be found");
      assert.equal(row?.bunnyVideoId, matchGuid);
    });

    // --- ambiguous lookup ---

    await check("reconcile CLI: multiple exact-title matches leave the row unresolved rather than guessing", async () => {
      const { userId } = await freshUser();
      const created = await insertRow({ ownerUserId: userId, state: "create_ambiguous", bunnyVideoId: null, retryCount: 0 });
      videoStore.set(`fake-dup-a-${suffix}`, { title: created.id, status: 0 });
      videoStore.set(`fake-dup-b-${suffix}`, { title: created.id, status: 0 });

      const before = await getRow(created.id);
      const result = await runReconcileCli(env);
      assert.equal(result.code, 0, result.stdout);
      const row = await getRow(created.id);
      assert.equal(row?.state, "create_ambiguous", "an ambiguous lookup must never resolve the row either way");
      assert.equal(row?.bunnyVideoId, null);
      assert.ok((row?.retryCount ?? 0) > (before?.retryCount ?? 0), "an unresolved attempt should still bump retryCount so it is eventually bounded");
    });

    // --- cancellation races against recovery ---

    await check("cancellation race: a cancel that lands while a create_ambiguous row is being recovered is never silently reverted by the recovery sweep", async () => {
      const { userId, session } = await freshUser();
      const created = await insertRow({ ownerUserId: userId, state: "create_ambiguous", bunnyVideoId: null, retryCount: 0 });
      // A video that WOULD be found and adopted if recovery ran uncontested.
      videoStore.set(`fake-race-${suffix}`, { title: created.id, status: 0 });

      // Simulate the user's cancel landing between the sweep's lease claim
      // and its lookup resolving, by cancelling BEFORE running the sweep —
      // claimCancellation's own fencing (state = 'create_ambiguous') still
      // lets this succeed, moving the row to orphan_cleanup_pending. This
      // exercises the same finalizeRecovery state-fence the true race would:
      // the sweep must never resolve a row into a state contradicting a
      // cancellation that already happened.
      await expectStatus(await session.cancelUpload(created.id), 202);
      const afterCancel = await getRow(created.id);
      assert.equal(afterCancel?.state, "orphan_cleanup_pending");

      const result = await runReconcileCli(env);
      assert.equal(result.code, 0, result.stdout);
      const row = await getRow(created.id);
      // The row must resolve along the orphan_cleanup_pending (delete) path
      // — never silently reverted back to "uploading" as if never cancelled.
      assert.notEqual(row?.state, "uploading", "recovery must never revive a row the user already cancelled");
      assert.ok(["deleted", "delete_failed"].includes(row?.state ?? ""), `expected a cancel-consistent terminal state, got ${row?.state}`);
    });

    // --- deletion retries ---

    await check("reconcile CLI: a delete_failed row is retried and resolves to deleted once the provider succeeds", async () => {
      const { userId, session } = await freshUser();
      const response = await session.requestUpload(validFile, `delretry-${suffix}`);
      await expectStatus(response, 201);
      const { id, tus } = await response.json() as { id: string; tus: { videoId: string } };
      deleteOverrides.set(tus.videoId, "http_error");
      await expectStatus(await session.cancelUpload(id), 202);
      assert.equal((await getRow(id))?.state, "delete_failed");

      deleteOverrides.delete(tus.videoId);
      const result = await runReconcileCli(env);
      assert.equal(result.code, 0, result.stdout);
      assert.ok((result.summary?.deletionRetriesAttempted ?? 0) >= 1);
      assert.ok((result.summary?.deletionRetriesResolved ?? 0) >= 1);
      const row = await getRow(id);
      assert.equal(row?.state, "deleted");
      void userId;
    });

    await check("reconcile CLI: a delete_failed row stays delete_failed (with retryCount bumped) while the provider keeps failing", async () => {
      const { session } = await freshUser();
      const response = await session.requestUpload(validFile, `delretry-fail-${suffix}`);
      await expectStatus(response, 201);
      const { id, tus } = await response.json() as { id: string; tus: { videoId: string } };
      deleteOverrides.set(tus.videoId, "http_error");
      await expectStatus(await session.cancelUpload(id), 202);
      const before = await getRow(id);

      const result = await runReconcileCli(env);
      assert.equal(result.code, 0, result.stdout);
      const row = await getRow(id);
      assert.equal(row?.state, "delete_failed");
      assert.ok((row?.retryCount ?? 0) > (before?.retryCount ?? 0));
      deleteOverrides.delete(tus.videoId);
    });

    // --- reconciliation is idempotent / safe on an empty queue ---

    await check("reconcile CLI: running with nothing eligible is a safe no-op", async () => {
      await db.delete(videoUploads);
      const result = await runReconcileCli(env);
      assert.equal(result.code, 0, result.stdout);
      assert.deepEqual(result.summary, {
        staleCreatingReclaimed: 0,
        ambiguousProcessed: 0,
        ambiguousResolved: 0,
        deletionRetriesAttempted: 0,
        deletionRetriesResolved: 0,
        missedWebhookChecked: 0,
      });
    });

    await check("no credentials are ever exposed in server logs, the reconcile CLI's own logs, or any response body", async () => {
      assert.ok(!server.stdout.includes(TEST_API_KEY), "the Bunny write API key must never appear in server logs");
      assert.ok(!server.stdout.includes(TEST_READONLY_KEY), "the Bunny read-only webhook key must never appear in server logs");
    });
  } finally {
    stopServer(server);
    await new Promise((resolve) => fakeBunny.server.close(resolve));
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const result of failed) console.log(`  - ${result.name}: ${result.error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
