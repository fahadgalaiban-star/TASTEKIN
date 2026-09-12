// Automated regression coverage for Video Foundation Phase 2A: the
// authenticated upload-lifecycle API (request-upload / status / cancel)
// layered on Phase 1's Bunny Stream wrapper and video_uploads ledger. Runs
// the compiled api-server against a REAL Postgres database (point
// DATABASE_URL at a disposable/test database — this creates real rows) and
// drives it over real HTTP. Never calls the real Bunny API — a fake
// in-process HTTP server stands in for it, reached via BUNNY_STREAM_BASE_URL
// (bunny-stream.ts reads this env var the same way it reads
// BUNNY_STREAM_API_KEY, so no test-only code path exists in that file).
//
// This repository's migration-file history has a pre-existing gap unrelated
// to video uploads: migrations 0000-0009 never create the closet_items /
// closet_media_uploads tables that later migrations (0010+) ALTER, so
// RUN_MIGRATIONS_ON_BOOT replay fails on a truly empty database. Until that
// is separately repaired, point the target database's schema at HEAD first
// with `DATABASE_URL=... pnpm --filter db run push` (drizzle-kit push reads
// the current TypeScript schema directly and does not depend on the
// migration-file/snapshot history at all) before running this suite.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:video-upload-lifecycle
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, featureFlags, videoUploads } from "@workspace/db";
import { eq } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

const TEST_LIBRARY_ID = "fake-library-42";
const TEST_API_KEY = "SECRET-TEST-BUNNY-KEY-never-logged";

// --- fake Bunny Stream provider ----------------------------------------------

type VideoState = { bunnyStatus: number; length?: number | null; width?: number | null; height?: number | null };
type Override = "not_found" | "http_error" | "timeout" | "malformed" | "wrong_identity";

let createMode: "ok" | "timeout" | "http_error" | "malformed" = "ok";
let videoCounter = 0;
let createCallCount = 0;
const videoStates = new Map<string, VideoState>();
const statusOverrides = new Map<string, Override>();
const deleteOverrides = new Map<string, Override>();
const requestLog: string[] = [];
let capturedAccessKeyHeader: string | null = null;

function startFakeBunny(): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        requestLog.push(`${req.method} ${req.url}`);
        capturedAccessKeyHeader = (req.headers.accesskey as string | undefined) ?? capturedAccessKeyHeader;
        const url = req.url ?? "";
        const createMatch = url.match(/^\/library\/([^/]+)\/videos$/);
        const itemMatch = url.match(/^\/library\/([^/]+)\/videos\/([^/]+)$/);

        if (req.method === "POST" && createMatch) {
          createCallCount += 1;
          if (createMode === "timeout") return; // never respond
          if (createMode === "http_error") { res.writeHead(500); res.end(); return; }
          if (createMode === "malformed") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({})); return; }
          videoCounter += 1;
          const guid = `fake-video-${videoCounter}`;
          videoStates.set(guid, { bunnyStatus: 0 });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ guid }));
          return;
        }

        if (req.method === "GET" && itemMatch) {
          const videoId = itemMatch[2];
          const override = statusOverrides.get(videoId);
          if (override === "not_found") { res.writeHead(404); res.end(); return; }
          if (override === "http_error") { res.writeHead(500); res.end(); return; }
          if (override === "timeout") return;
          if (override === "malformed") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ guid: videoId })); return; }
          if (override === "wrong_identity") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ guid: "some-other-video-entirely", status: 4, title: "x", length: 30, width: 100, height: 100, thumbnailFileName: "t.jpg" }));
            return;
          }
          const state = videoStates.get(videoId) ?? { bunnyStatus: 0 };
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            guid: videoId, status: state.bunnyStatus, title: "x",
            length: state.length ?? null, width: state.width ?? null, height: state.height ?? null,
            thumbnailFileName: state.length ? "thumb.jpg" : null,
          }));
          return;
        }

        if (req.method === "DELETE" && itemMatch) {
          const videoId = itemMatch[2];
          const override = deleteOverrides.get(videoId);
          if (override === "not_found") { res.writeHead(404); res.end(); return; }
          if (override === "http_error") { res.writeHead(500); res.end(); return; }
          if (override === "timeout") return;
          videoStates.delete(videoId);
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

// --- server harness (same pattern as every other verify-*.ts script) -------

let nextPort = 25300;
type Server = { port: number; process: ChildProcess; baseUrl: string; stdout: string };

async function startServer(env: Record<string, string | undefined> = {}): Promise<Server> {
  const port = nextPort;
  nextPort += 1;
  const fullEnv: Record<string, string | undefined> = { ...process.env, ...env, PORT: String(port), NODE_ENV: "production" };
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

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

const validFile = { fileName: "trip-clip.mp4", sizeBytes: 12_345_678, mimeType: "video/mp4" };

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

async function main() {
  await db.delete(videoUploads);
  // A previous run of this same disposable-DB suite may have left
  // video_upload enabled via the admin API — reset it to its true default
  // (disabled) so Phase 0's flag-off assertions below are not polluted by
  // state left over from a prior run against the same database.
  await db.delete(featureFlags).where(eq(featureFlags.key, "video_upload"));
  const fakeBunny = await startFakeBunny();

  // --- Phase 0: flag-off + missing Bunny configuration must never break
  // startup or crash a request — checked against a server that has NO
  // BUNNY_STREAM_* configuration at all, before the flag is ever enabled. ---
  {
    const server = await startServer();
    try {
      await check("server with zero Bunny configuration and the flag at its default (disabled) starts and serves unrelated routes normally", async () => {
        assert.equal((await fetch(`${server.baseUrl}/api/healthz`)).status, 200);
        assert.equal((await fetch(`${server.baseUrl}/api/version`)).status, 200);
      });
      await check("video_upload OFF (default): request-upload/status/cancel are all rejected with 403, not a crash", async () => {
        const session = new Session(server.baseUrl);
        await session.signup(`phase0-${suffix}@example.com`, PASSWORD);
        assert.equal((await session.requestUpload(validFile)).status, 403);
        const fakeId = "00000000-0000-0000-0000-000000000000";
        assert.equal((await session.getUpload(fakeId)).status, 403);
        assert.equal((await session.cancelUpload(fakeId)).status, 403);
      });
    } finally {
      stopServer(server);
    }
  }

  // --- Phase 1: full suite against a properly configured Bunny (fake) ------
  const server = await startServer({
    BUNNY_STREAM_API_KEY: TEST_API_KEY,
    BUNNY_STREAM_LIBRARY_ID: TEST_LIBRARY_ID,
    BUNNY_STREAM_BASE_URL: fakeBunny.baseUrl,
    BUNNY_STREAM_TIMEOUT_MS_OVERRIDE: "300",
    VIDEO_UPLOAD_RECONCILE_MIN_INTERVAL_MS_OVERRIDE: "50",
  });

  try {
    const admin = new Session(server.baseUrl);
    const adminAccount = await admin.signup(`video-admin-${suffix}@example.com`, PASSWORD);
    const grant = await runScript(path.join(repoRoot, "scripts/src/admin-grant.ts"), ["--user-id", adminAccount.user.id, "--yes"]);
    assert.equal(grant.code, 0, `admin-grant should exit 0: ${grant.stdout}`);
    await expectStatus(await admin.setFlag("video_upload", true), 200);

    const userA = new Session(server.baseUrl);
    const userAAccount = await userA.signup(`video-a-${suffix}@example.com`, PASSWORD);
    const userB = new Session(server.baseUrl);
    await userB.signup(`video-b-${suffix}@example.com`, PASSWORD);

    // Every independent scenario below gets its own fresh user so that
    // in-flight rows left behind by one check (by design — most scenarios
    // deliberately don't cancel what they create) can never accumulate
    // against VIDEO_UPLOAD_MAX_CONCURRENT and cause an unrelated later
    // check to fail. Only the handful of checks that intentionally share
    // state across two calls for the same owner (idempotency, the
    // create/cross-user/safe-fields trio) reuse a single session on purpose.
    let freshUserCounter = 0;
    async function freshUser(): Promise<Session> {
      freshUserCounter += 1;
      const session = new Session(server.baseUrl);
      await session.signup(`video-fresh-${suffix}-${freshUserCounter}@example.com`, PASSWORD);
      return session;
    }

    await check("unauthenticated requests are rejected with 401 on all three endpoints", async () => {
      const anon = new Session(server.baseUrl);
      assert.equal((await anon.requestUpload(validFile)).status, 401);
      const fakeId = "00000000-0000-0000-0000-000000000000";
      assert.equal((await anon.getUpload(fakeId)).status, 401);
      assert.equal((await anon.cancelUpload(fakeId)).status, 401);
    });

    await check("request validation: invalid fileName/sizeBytes/mimeType are rejected with 400", async () => {
      assert.equal((await userA.requestUpload({ fileName: "", sizeBytes: 100, mimeType: "video/mp4" })).status, 400);
      assert.equal((await userA.requestUpload({ fileName: "a.mp4", sizeBytes: -5, mimeType: "video/mp4" })).status, 400);
      assert.equal((await userA.requestUpload({ fileName: "a.mp4", sizeBytes: 100, mimeType: "application/octet-stream" })).status, 400);
      assert.equal((await userA.requestUpload({ fileName: "a.mp4", sizeBytes: 999_999_999_999, mimeType: "video/mp4" })).status, 400);
    });

    let firstUploadId = "";
    await check("a valid request-upload creates a video with Bunny, hitting the correct /library/{libraryId}/videos path, and returns scoped TUS credentials — never the API key", async () => {
      requestLog.length = 0;
      const response = await userA.requestUpload(validFile);
      await expectStatus(response, 201);
      const payload = await response.json() as Record<string, unknown>;
      firstUploadId = payload.id as string;
      assert.ok(typeof payload.id === "string" && payload.id.length > 0);
      const tus = payload.tus as Record<string, unknown>;
      assert.equal(tus.libraryId, TEST_LIBRARY_ID);
      assert.ok(typeof tus.videoId === "string" && tus.videoId.startsWith("fake-video-"));
      assert.match(tus.signature as string, /^[0-9a-f]{64}$/);
      assert.equal(tus.endpoint, "https://video.bunnycdn.com/tusupload");
      assert.ok(!JSON.stringify(payload).includes(TEST_API_KEY), "the API key must never appear in any response body");
      assert.ok(requestLog.some((line) => line === `POST /library/${TEST_LIBRARY_ID}/videos`), "must call the exact documented create-video path including the library id");
    });

    await check("cross-user access to another owner's upload is rejected with 404 (existence is never leaked)", async () => {
      assert.equal((await userB.getUpload(firstUploadId)).status, 404);
      assert.equal((await userB.cancelUpload(firstUploadId)).status, 404);
    });

    await check("GET status returns only safe fields — never the Bunny video/library id or any signature", async () => {
      const response = await userA.getUpload(firstUploadId);
      await expectStatus(response, 200);
      const payload = await response.json() as Record<string, unknown>;
      assert.equal(payload.state, "uploading");
      for (const forbidden of ["bunnyVideoId", "bunnyLibraryId", "signature", "tus"]) {
        assert.ok(!(forbidden in payload), `status response must never include ${forbidden}`);
      }
    });

    await check("processing-to-ready reconciliation happens without any webhook: uploading → processing → ready, with real Bunny metadata persisted", async () => {
      const owner = await freshUser();
      const response = await owner.requestUpload(validFile, `flow-${suffix}`);
      await expectStatus(response, 201);
      const { id, tus } = await response.json() as { id: string; tus: { videoId: string } };
      const videoId = tus.videoId;

      assert.equal((await (await owner.getUpload(id)).json() as { state: string }).state, "uploading");

      videoStates.set(videoId, { bunnyStatus: 2 });
      await sleep(80);
      assert.equal((await (await owner.getUpload(id)).json() as { state: string }).state, "processing");

      videoStates.set(videoId, { bunnyStatus: 4, length: 42, width: 1080, height: 1920 });
      await sleep(80);
      const ready = await (await owner.getUpload(id)).json() as Record<string, unknown>;
      assert.equal(ready.state, "ready");
      assert.equal(ready.durationSeconds, 42);
      assert.equal(ready.width, 1080);
      assert.equal(ready.height, 1920);
    });

    await check("a 'Finished' status without valid playback metadata is never marked ready", async () => {
      const owner = await freshUser();
      const response = await owner.requestUpload(validFile, `noplayback-${suffix}`);
      const { id, tus } = await response.json() as { id: string; tus: { videoId: string } };
      videoStates.set(tus.videoId, { bunnyStatus: 4, length: 0, width: null, height: null });
      await sleep(80);
      const status = await (await owner.getUpload(id)).json() as { state: string };
      assert.notEqual(status.state, "ready");
    });

    await check("a known Bunny failure status (5/6) marks the upload failed with a sanitized reason", async () => {
      const owner = await freshUser();
      const response = await owner.requestUpload(validFile, `fail-${suffix}`);
      const { id, tus } = await response.json() as { id: string; tus: { videoId: string } };
      videoStates.set(tus.videoId, { bunnyStatus: 6 });
      await sleep(80);
      const status = await (await owner.getUpload(id)).json() as { state: string; errorReason: string };
      assert.equal(status.state, "failed");
      assert.ok(status.errorReason && !status.errorReason.includes(TEST_API_KEY));
    });

    await check("wrong provider identity in the status response is rejected — never trusted, never changes state", async () => {
      const owner = await freshUser();
      const response = await owner.requestUpload(validFile, `identity-${suffix}`);
      const { id, tus } = await response.json() as { id: string; tus: { videoId: string } };
      statusOverrides.set(tus.videoId, "wrong_identity");
      try {
        await sleep(80);
        const status = await (await owner.getUpload(id)).json() as { state: string; width: unknown };
        assert.equal(status.state, "uploading");
        assert.equal(status.width, null);
      } finally {
        statusOverrides.delete(tus.videoId);
      }
    });

    await check("a transient provider outage (timeout) during reconciliation never declares the upload permanently failed", async () => {
      const owner = await freshUser();
      const response = await owner.requestUpload(validFile, `outage-${suffix}`);
      const { id, tus } = await response.json() as { id: string; tus: { videoId: string } };
      statusOverrides.set(tus.videoId, "timeout");
      try {
        await sleep(80);
        const afterOutage = await owner.getUpload(id);
        await expectStatus(afterOutage, 200);
        const status = await afterOutage.json() as { state: string };
        assert.equal(status.state, "uploading", "a timed-out reconciliation must never flip state to failed");
      } finally {
        statusOverrides.delete(tus.videoId);
      }
    });

    await check("a non-timeout, non-404 HTTP failure during reconciliation is also treated as a transient outage, not a failure", async () => {
      const owner = await freshUser();
      const response = await owner.requestUpload(validFile, `http500-${suffix}`);
      const { id, tus } = await response.json() as { id: string; tus: { videoId: string } };
      statusOverrides.set(tus.videoId, "http_error");
      try {
        await sleep(80);
        const status = await (await owner.getUpload(id)).json() as { state: string };
        assert.equal(status.state, "uploading");
      } finally {
        statusOverrides.delete(tus.videoId);
      }
    });

    await check("a genuine 404 from Bunny (the video is gone) is treated as a terminal failure", async () => {
      const owner = await freshUser();
      const response = await owner.requestUpload(validFile, `gone-${suffix}`);
      const { id, tus } = await response.json() as { id: string; tus: { videoId: string } };
      statusOverrides.set(tus.videoId, "not_found");
      try {
        await sleep(80);
        const status = await (await owner.getUpload(id)).json() as { state: string };
        assert.equal(status.state, "failed");
      } finally {
        statusOverrides.delete(tus.videoId);
      }
    });

    await check("idempotent replay: retrying the same Idempotency-Key while still in flight returns the same upload and never calls Bunny create again", async () => {
      const owner = await freshUser();
      const key = `retry-${suffix}`;
      const before = createCallCount;
      const first = await owner.requestUpload(validFile, key);
      await expectStatus(first, 201);
      const firstPayload = await first.json() as { id: string };
      const afterFirst = createCallCount;

      const second = await owner.requestUpload(validFile, key);
      await expectStatus(second, 201);
      const secondPayload = await second.json() as { id: string; replayed?: boolean };
      assert.equal(secondPayload.id, firstPayload.id, "a replay must return the same upload id");
      assert.equal(secondPayload.replayed, true);
      assert.equal(createCallCount, afterFirst, "replaying an in-flight idempotency key must never call Bunny create a second time");
      assert.equal(afterFirst, before + 1, "the original call must have created exactly one Bunny video");
    });

    await check("reusing an idempotency key whose upload already resolved (cancelled) is refused, never silently replayed", async () => {
      const owner = await freshUser();
      const key = `resolved-${suffix}`;
      const created = await owner.requestUpload(validFile, key);
      const { id } = await created.json() as { id: string };
      await expectStatus(await owner.cancelUpload(id), 200);
      const reused = await owner.requestUpload(validFile, key);
      assert.equal(reused.status, 409);
    });

    await check("an ambiguous provider-create timeout is recorded durably as failed, never silently retried, and the key is permanently spent", async () => {
      const owner = await freshUser();
      const key = `ambiguous-${suffix}`;
      const before = createCallCount;
      createMode = "timeout";
      let payload: { id: string };
      try {
        const response = await owner.requestUpload(validFile, key);
        assert.equal(response.status, 504);
        payload = await response.json() as { id: string };
        assert.ok(payload.id, "the durable intent row's id must still be returned even on an ambiguous create failure");
      } finally {
        createMode = "ok";
      }

      const [row] = await db.select().from(videoUploads).where(eq(videoUploads.id, payload.id));
      assert.equal(row.state, "failed");
      assert.equal(row.bunnyVideoId, null);

      const retried = await owner.requestUpload(validFile, key);
      assert.equal(retried.status, 409, "the same key must never be silently retried against a new Bunny video");
      assert.equal(createCallCount, before + 1, "an ambiguous timeout must count as exactly one create attempt, never more");

      const cancelled = await owner.cancelUpload(payload.id);
      await expectStatus(cancelled, 200);
      const cancelledBody = await cancelled.json() as { physicalDeletion: string };
      assert.equal(cancelledBody.physicalDeletion, "completed", "cancelling a row with no Bunny video yet must skip the provider call and finalize immediately");
    });

    await check("cancel retries: a failed Bunny delete leaves the row retryable, and a second cancel call succeeds", async () => {
      const owner = await freshUser();
      const response = await owner.requestUpload(validFile, `cancel-retry-${suffix}`);
      const { id, tus } = await response.json() as { id: string; tus: { videoId: string } };
      deleteOverrides.set(tus.videoId, "http_error");
      try {
        const first = await owner.cancelUpload(id);
        assert.equal(first.status, 202);
        assert.equal((await first.json() as { state: string }).state, "delete_failed");
      } finally {
        deleteOverrides.delete(tus.videoId);
      }
      const second = await owner.cancelUpload(id);
      await expectStatus(second, 200);
      assert.equal((await second.json() as { state: string }).state, "deleted");
    });

    await check("repeated cancellation of an already-deleted upload is safe and idempotent", async () => {
      const owner = await freshUser();
      const response = await owner.requestUpload(validFile, `repeat-cancel-${suffix}`);
      const { id } = await response.json() as { id: string };
      await expectStatus(await owner.cancelUpload(id), 200);
      const again = await owner.cancelUpload(id);
      await expectStatus(again, 200);
      assert.equal((await again.json() as { physicalDeletion: string }).physicalDeletion, "completed");
    });

    await check("a concurrent status refresh can never revive a cancelled upload back to ready", async () => {
      const owner = await freshUser();
      const response = await owner.requestUpload(validFile, `race-${suffix}`);
      const { id, tus } = await response.json() as { id: string; tus: { videoId: string } };
      videoStates.set(tus.videoId, { bunnyStatus: 4, length: 42, width: 1080, height: 1920 });
      await Promise.all([owner.cancelUpload(id), owner.getUpload(id)]);
      const [row] = await db.select().from(videoUploads).where(eq(videoUploads.id, id));
      assert.ok(["deletion_pending", "delete_failed", "deleted"].includes(row.state), `expected a cancel-related terminal state, got ${row.state}`);
      assert.notEqual(row.state, "ready");
    });

    await check("concurrency limit: a 4th simultaneous in-flight upload is rejected with 429", async () => {
      const owner = new Session(server.baseUrl);
      await owner.signup(`video-concurrency-${suffix}@example.com`, PASSWORD);
      for (let i = 0; i < 3; i += 1) {
        await expectStatus(await owner.requestUpload(validFile, `conc-${suffix}-${i}`), 201);
      }
      const fourth = await owner.requestUpload(validFile, `conc-${suffix}-3`);
      assert.equal(fourth.status, 429);
    });

    await check("rate limit: exceeding the rolling-window attempt count is rejected with 429", async () => {
      const owner = new Session(server.baseUrl);
      await owner.signup(`video-ratelimit-${suffix}@example.com`, PASSWORD);
      for (let i = 0; i < 20; i += 1) {
        const created = await owner.requestUpload(validFile, `rate-${suffix}-${i}`);
        await expectStatus(created, 201);
        const { id } = await created.json() as { id: string };
        await expectStatus(await owner.cancelUpload(id), 200);
      }
      const overLimit = await owner.requestUpload(validFile, `rate-${suffix}-over`);
      assert.equal(overLimit.status, 429);
    });

    await check("no credentials are ever exposed in server logs or any response body", async () => {
      assert.ok(!server.stdout.includes(TEST_API_KEY), "the Bunny API key must never appear in server logs");
      assert.equal(capturedAccessKeyHeader, TEST_API_KEY, "sanity check: the fake provider must have actually received the real key over the AccessKey header");
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
