// Automated regression coverage for Video Foundation Phase 3A's server-side
// publish validation on PUT /api/creator-workspace: the checks that stop a
// client from bypassing the composer UI and attaching a video that isn't
// really theirs, isn't really ready, or doesn't really match what Bunny
// issued. Runs the compiled api-server against a REAL Postgres database
// (point DATABASE_URL at a disposable/test database — this creates real
// rows) and drives it over real HTTP. Never calls the real Bunny API — a
// fake in-process HTTP server stands in for it, exactly like
// verify-video-upload-lifecycle.ts.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:creator-workspace-video
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

// --- fake Bunny Stream provider (create + status only — this suite never
// needs cancel/delete) ------------------------------------------------------

type VideoState = { bunnyStatus: number; length?: number | null; width?: number | null; height?: number | null };
let videoCounter = 0;
const videoStates = new Map<string, VideoState>();

function startFakeBunny(): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const url = req.url ?? "";
        const createMatch = url.match(/^\/library\/([^/]+)\/videos$/);
        const itemMatch = url.match(/^\/library\/([^/]+)\/videos\/([^/]+)$/);

        if (req.method === "POST" && createMatch) {
          videoCounter += 1;
          const guid = `fake-video-${videoCounter}`;
          videoStates.set(guid, { bunnyStatus: 0 });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ guid }));
          return;
        }

        if (req.method === "GET" && itemMatch) {
          const videoId = itemMatch[2];
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
          videoStates.delete(itemMatch[2]);
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

let nextPort = 25400;
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

type Edit = Record<string, unknown>;

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
  async requestUpload(body: Record<string, unknown>, idempotencyKey: string) {
    return this.request("/api/video-uploads/request-upload", {
      method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body),
    });
  }
  async getUpload(id: string) { return this.request(`/api/video-uploads/${encodeURIComponent(id)}`); }
  async workspace() { return this.request("/api/creator-workspace"); }
  async saveWorkspace(edits: Edit[], expectedRevision: number, collections: unknown[] = []) {
    return this.request("/api/creator-workspace", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ edits, collections, expectedRevision }),
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

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

const validFile = { fileName: "trip-clip.mp4", sizeBytes: 12_345_678, mimeType: "video/mp4" };

function baseEdit(id: string, overrides: Edit = {}): Edit {
  return {
    id, category: "Fashion", title: "", titleAr: "", caption: "", captionAr: "",
    location: "", locationAr: "", altText: "", access: "public", status: "draft", collectionIds: [],
    ...overrides,
  };
}

async function createReadyVideo(owner: Session, key: string) {
  const response = await owner.requestUpload(validFile, key);
  await expectStatus(response, 201);
  const { id, tus } = await response.json() as { id: string; tus: { videoId: string; libraryId: string } };
  videoStates.set(tus.videoId, { bunnyStatus: 3, length: 42, width: 1080, height: 1920 });
  await sleep(80);
  const status = await (await owner.getUpload(id)).json() as { state: string };
  assert.equal(status.state, "ready", "fixture video must reach ready before the scenario that needs it runs");
  return { id, bunnyVideoId: tus.videoId, bunnyLibraryId: tus.libraryId };
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

async function main() {
  await db.delete(videoUploads);
  await db.delete(featureFlags).where(eq(featureFlags.key, "video_upload"));
  const fakeBunny = await startFakeBunny();

  const server = await startServer({
    BUNNY_STREAM_API_KEY: TEST_API_KEY,
    BUNNY_STREAM_LIBRARY_ID: TEST_LIBRARY_ID,
    BUNNY_STREAM_BASE_URL: fakeBunny.baseUrl,
    BUNNY_STREAM_TIMEOUT_MS_OVERRIDE: "300",
    VIDEO_UPLOAD_RECONCILE_MIN_INTERVAL_MS_OVERRIDE: "50",
  });

  try {
    const admin = new Session(server.baseUrl);
    const adminAccount = await admin.signup(`workspace-video-admin-${suffix}@example.com`, PASSWORD);
    const grant = await runScript(path.join(repoRoot, "scripts/src/admin-grant.ts"), ["--user-id", adminAccount.user.id, "--yes"]);
    assert.equal(grant.code, 0, `admin-grant should exit 0: ${grant.stdout}`);
    await expectStatus(await admin.setFlag("video_upload", true), 200);

    let freshCounter = 0;
    async function freshOwner(): Promise<{ session: Session; revision: number }> {
      freshCounter += 1;
      const session = new Session(server.baseUrl);
      await session.signup(`workspace-video-${suffix}-${freshCounter}@example.com`, PASSWORD);
      const workspace = await (await session.workspace()).json() as { revision: number };
      return { session, revision: workspace.revision };
    }

    await check("a draft Edit can attach a video that is still processing (readiness is only required to publish)", async () => {
      const owner = await freshOwner();
      const uploadResponse = await owner.session.requestUpload(validFile, `draft-${suffix}`);
      await expectStatus(uploadResponse, 201);
      const { id, tus } = await uploadResponse.json() as { id: string; tus: { videoId: string; libraryId: string } };
      const edit = baseEdit("draft-video-edit", { status: "draft", video: { uploadId: id, bunnyVideoId: tus.videoId, bunnyLibraryId: tus.libraryId } });
      const saved = await owner.session.saveWorkspace([edit], owner.revision);
      await expectStatus(saved, 200);
    });

    await check("publishing an Edit whose video has not reached ready is rejected with 409 and a clear reason", async () => {
      const owner = await freshOwner();
      const uploadResponse = await owner.session.requestUpload(validFile, `notready-${suffix}`);
      const { id, tus } = await uploadResponse.json() as { id: string; tus: { videoId: string; libraryId: string } };
      const edit = baseEdit("not-ready-edit", { status: "published", video: { uploadId: id, bunnyVideoId: tus.videoId, bunnyLibraryId: tus.libraryId } });
      const response = await owner.session.saveWorkspace([edit], owner.revision);
      await expectStatus(response, 409);
      const body = await response.json() as { error: string };
      assert.match(body.error, /finish processing/);
    });

    await check("publishing an Edit whose video has reached ready succeeds", async () => {
      const owner = await freshOwner();
      const video = await createReadyVideo(owner.session, `ready-${suffix}`);
      const edit = baseEdit("ready-edit", { status: "published", video: { uploadId: video.id, bunnyVideoId: video.bunnyVideoId, bunnyLibraryId: video.bunnyLibraryId } });
      const response = await owner.session.saveWorkspace([edit], owner.revision);
      await expectStatus(response, 200);
      const body = await response.json() as { edits: Array<{ id: string; video?: unknown }> };
      assert.ok(body.edits.find((item) => item.id === "ready-edit")?.video, "the saved Edit must retain its video reference");
    });

    await check("attaching a video that belongs to a different owner's account is rejected with 409, not leaked as a validation detail", async () => {
      const ownerA = await freshOwner();
      const video = await createReadyVideo(ownerA.session, `crossuser-${suffix}`);
      const ownerB = await freshOwner();
      const edit = baseEdit("cross-user-edit", { status: "draft", video: { uploadId: video.id, bunnyVideoId: video.bunnyVideoId, bunnyLibraryId: video.bunnyLibraryId } });
      const response = await ownerB.session.saveWorkspace([edit], ownerB.revision);
      await expectStatus(response, 409);
      const body = await response.json() as { error: string };
      assert.match(body.error, /no longer available or doesn't belong/);
    });

    await check("a bunnyVideoId that does not match the persisted row is rejected with 409 (never trusts a resubmitted id pair)", async () => {
      const owner = await freshOwner();
      const video = await createReadyVideo(owner.session, `mismatch-video-${suffix}`);
      const edit = baseEdit("mismatch-video-edit", { status: "draft", video: { uploadId: video.id, bunnyVideoId: "some-other-bunny-video-id", bunnyLibraryId: video.bunnyLibraryId } });
      const response = await owner.session.saveWorkspace([edit], owner.revision);
      await expectStatus(response, 409);
    });

    await check("a bunnyLibraryId that does not match the persisted row is rejected with 409", async () => {
      const owner = await freshOwner();
      const video = await createReadyVideo(owner.session, `mismatch-library-${suffix}`);
      const edit = baseEdit("mismatch-library-edit", { status: "draft", video: { uploadId: video.id, bunnyVideoId: video.bunnyVideoId, bunnyLibraryId: "some-other-library" } });
      const response = await owner.session.saveWorkspace([edit], owner.revision);
      await expectStatus(response, 409);
    });

    await check("a malformed (non-UUID) uploadId is rejected with 409 rather than crashing the request", async () => {
      const owner = await freshOwner();
      const edit = baseEdit("malformed-id-edit", { status: "draft", video: { uploadId: "not-a-uuid", bunnyVideoId: "x", bunnyLibraryId: "y" } });
      const response = await owner.session.saveWorkspace([edit], owner.revision);
      await expectStatus(response, 409);
    });

    await check("photo and video are mutually exclusive on one Edit: both present is rejected with 400 before any DB work", async () => {
      const owner = await freshOwner();
      const video = await createReadyVideo(owner.session, `mutex-${suffix}`);
      const edit = baseEdit("mutex-edit", {
        status: "draft",
        image: "/objects/uploads/11111111-1111-1111-1111-111111111111",
        video: { uploadId: video.id, bunnyVideoId: video.bunnyVideoId, bunnyLibraryId: video.bunnyLibraryId },
      });
      const response = await owner.session.saveWorkspace([edit], owner.revision);
      await expectStatus(response, 400);
      const body = await response.json() as { error: string };
      assert.match(body.error, /cannot have both a photo and a video/);
    });

    await check("an Edit with neither photo nor video still behaves exactly as before (no video-specific regression)", async () => {
      const owner = await freshOwner();
      const edit = baseEdit("no-media-edit", { status: "draft" });
      const response = await owner.session.saveWorkspace([edit], owner.revision);
      await expectStatus(response, 200);
    });

    await check("a draft can still reference a video the owner has since cancelled (ownership/identity checks never require readiness)", async () => {
      const owner = await freshOwner();
      const uploadResponse = await owner.session.requestUpload(validFile, `cancelled-${suffix}`);
      const { id, tus } = await uploadResponse.json() as { id: string; tus: { videoId: string; libraryId: string } };
      await owner.session.request(`/api/video-uploads/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      const edit = baseEdit("cancelled-edit", { status: "draft", video: { uploadId: id, bunnyVideoId: tus.videoId, bunnyLibraryId: tus.libraryId } });
      const response = await owner.session.saveWorkspace([edit], owner.revision);
      await expectStatus(response, 200);
    });

    await check("publishing an Edit whose video was cancelled is rejected with 409 (a cancelled video is never ready)", async () => {
      const owner = await freshOwner();
      const uploadResponse = await owner.session.requestUpload(validFile, `cancel-publish-${suffix}`);
      const { id, tus } = await uploadResponse.json() as { id: string; tus: { videoId: string; libraryId: string } };
      await owner.session.request(`/api/video-uploads/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      const edit = baseEdit("cancel-publish-edit", { status: "published", video: { uploadId: id, bunnyVideoId: tus.videoId, bunnyLibraryId: tus.libraryId } });
      const response = await owner.session.saveWorkspace([edit], owner.revision);
      await expectStatus(response, 409);
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
