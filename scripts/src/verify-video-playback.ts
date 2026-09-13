// Video Foundation, Phase 3B — regression coverage for server-side PLAYBACK
// resolution: the checks that decide whether a viewer-facing response is
// allowed to include a working playbackUrl/posterUrl for a video Edit.
// Runs the compiled api-server against a real Postgres database and a fake
// in-process Bunny Stream server, exactly like verify-creator-workspace
// -video.ts (never calls real Bunny, never a migration).
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:video-playback
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { creatorWorkspaces, db, featureFlags, videoUploads } from "@workspace/db";
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
const FAKE_CDN_HOSTNAME = "fake-cdn.example-bunny-cdn.test";

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

let nextPort = 25600;
type Server = { port: number; process: ChildProcess; baseUrl: string };
async function startServer(env: Record<string, string | undefined> = {}): Promise<Server> {
  const port = nextPort;
  nextPort += 1;
  const fullEnv: Record<string, string | undefined> = { ...process.env, ...env, PORT: String(port), NODE_ENV: "production" };
  const child = spawn("node", [serverEntry], { env: fullEnv, stdio: ["ignore", "pipe", "pipe"] });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`${baseUrl}/api/version`); if (response.ok) return { port, process: child, baseUrl }; } catch { /* not up yet */ }
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
type VideoField = { uploadId: string; bunnyVideoId: string; bunnyLibraryId: string; playbackUrl?: string | null; posterUrl?: string | null; durationSeconds?: number | null; width?: number | null; height?: number | null };

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
    const response = await this.request("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    await expectStatus(response, 201);
    return (await response.json()) as { user: { id: string; email: string } };
  }
  async setFlag(key: string, enabled: boolean) {
    return this.request(`/api/admin/feature-flags/${encodeURIComponent(key)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
  }
  async requestUpload(body: Record<string, unknown>, idempotencyKey: string) {
    return this.request("/api/video-uploads/request-upload", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
  }
  async getUpload(id: string) { return this.request(`/api/video-uploads/${encodeURIComponent(id)}`); }
  async workspace() { return this.request("/api/creator-workspace"); }
  async publicWorkspace(username: string) { return this.request(`/api/creators/${encodeURIComponent(username)}/workspace`); }
  async publicFeed() { return this.request("/api/public-feed"); }
  async saveWorkspace(edits: Edit[], expectedRevision: number, collections: unknown[] = []) {
    return this.request("/api/creator-workspace", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ edits, collections, expectedRevision }) });
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
  return { id, category: "Fashion", title: "", titleAr: "", caption: "", captionAr: "", location: "", locationAr: "", altText: "", access: "public", status: "draft", collectionIds: [], ...overrides };
}
async function createReadyVideo(owner: Session, key: string, metadata: { length?: number; width?: number; height?: number } = {}) {
  const response = await owner.requestUpload(validFile, key);
  await expectStatus(response, 201);
  const { id, tus } = await response.json() as { id: string; tus: { videoId: string; libraryId: string } };
  videoStates.set(tus.videoId, { bunnyStatus: 3, length: metadata.length ?? 42, width: metadata.width ?? 1080, height: metadata.height ?? 1920 });
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
    BUNNY_STREAM_CDN_HOSTNAME: FAKE_CDN_HOSTNAME,
  });

  // A second server, identical except with NO CDN hostname configured — used
  // by the "unconfigured deployment" scenario. Shares the same database and
  // fake Bunny, so fixtures created against `server` are equally visible here.
  const serverNoCdn = await startServer({
    BUNNY_STREAM_API_KEY: TEST_API_KEY,
    BUNNY_STREAM_LIBRARY_ID: TEST_LIBRARY_ID,
    BUNNY_STREAM_BASE_URL: fakeBunny.baseUrl,
    BUNNY_STREAM_TIMEOUT_MS_OVERRIDE: "300",
    VIDEO_UPLOAD_RECONCILE_MIN_INTERVAL_MS_OVERRIDE: "50",
  });

  try {
    const admin = new Session(server.baseUrl);
    const adminAccount = await admin.signup(`playback-admin-${suffix}@example.com`, PASSWORD);
    const grant = await runScript(path.join(repoRoot, "scripts/src/admin-grant.ts"), ["--user-id", adminAccount.user.id, "--yes"]);
    assert.equal(grant.code, 0, `admin-grant should exit 0: ${grant.stdout}`);
    await expectStatus(await admin.setFlag("video_upload", true), 200);

    let freshCounter = 0;
    async function freshOwner(): Promise<{ session: Session; revision: number; username: string; ownerUserId: string }> {
      freshCounter += 1;
      const session = new Session(server.baseUrl);
      const account = await session.signup(`playback-${suffix}-${freshCounter}@example.com`, PASSWORD);
      const workspace = await (await session.workspace()).json() as { revision: number };
      // Read the username directly off the row rather than GET
      // /creator-profile: this app's own GET /api/creator-profile now
      // correctly returns 200 for a fresh account's empty avatar (see
      // verify-creator-workspace-schema.ts), but reading straight from the
      // DB here keeps this suite's fixtures independent of that endpoint.
      const [row] = await db.select({ profile: creatorWorkspaces.profile }).from(creatorWorkspaces).where(eq(creatorWorkspaces.ownerUserId, account.user.id));
      const username = (row?.profile as { username?: string } | undefined)?.username;
      assert.ok(username, "a freshly created creator workspace must always have a username");
      return { session, revision: workspace.revision, username: username!, ownerUserId: account.user.id };
    }
    /** Reuses the same signed-in session against the CDN-less server (same cookie is meaningless cross-process, so re-derive via the shared DB instead: just re-signup isn't possible for the same email — instead this helper is only ever used read-side, unauthenticated, against public endpoints that don't need a session on serverNoCdn.) */
    const publicSession = new Session(serverNoCdn.baseUrl);

    await check("a ready, published, public, correctly-attached video Edit gets playbackUrl/posterUrl in the owner's own GET /creator-workspace", async () => {
      const owner = await freshOwner();
      const video = await createReadyVideo(owner.session, `owner-view-${suffix}`);
      const edit = baseEdit("owner-view-edit", { status: "published", video: { uploadId: video.id, bunnyVideoId: video.bunnyVideoId, bunnyLibraryId: video.bunnyLibraryId } });
      await expectStatus(await owner.session.saveWorkspace([edit], owner.revision), 200);
      const ws = await (await owner.session.workspace()).json() as { edits: Array<{ id: string; video?: VideoField }> };
      const saved = ws.edits.find((item) => item.id === "owner-view-edit");
      assert.ok(saved?.video?.playbackUrl?.includes(FAKE_CDN_HOSTNAME), "playbackUrl must be present and point at the configured CDN hostname");
      assert.ok(saved?.video?.playbackUrl?.includes(video.bunnyVideoId), "playbackUrl must be derived from the row's own bunnyVideoId");
      assert.ok(saved?.video?.posterUrl?.includes(video.bunnyVideoId), "posterUrl must be derived from the row's own bunnyVideoId");
      assert.equal(saved?.video?.durationSeconds, 42);
      assert.equal(saved?.video?.width, 1080);
      assert.equal(saved?.video?.height, 1920);
    });

    await check("the same Edit's playback fields are also present via the public GET /creators/:username/workspace (unauthenticated)", async () => {
      const owner = await freshOwner();
      const video = await createReadyVideo(owner.session, `public-workspace-${suffix}`);
      const edit = baseEdit("public-workspace-edit", { status: "published", video: { uploadId: video.id, bunnyVideoId: video.bunnyVideoId, bunnyLibraryId: video.bunnyLibraryId } });
      await expectStatus(await owner.session.saveWorkspace([edit], owner.revision), 200);
      const visitor = new Session(server.baseUrl);
      const ws = await (await visitor.publicWorkspace(owner.username)).json() as { edits: Array<{ id: string; video?: VideoField }> };
      const seen = ws.edits.find((item) => item.id === "public-workspace-edit");
      assert.ok(seen?.video?.playbackUrl, "an anonymous visitor must see the resolved playbackUrl for a public published video Edit");
    });

    await check("the same Edit's playback fields are also present in GET /public-feed", async () => {
      const owner = await freshOwner();
      const video = await createReadyVideo(owner.session, `feed-${suffix}`);
      const edit = baseEdit("feed-edit", { status: "published", video: { uploadId: video.id, bunnyVideoId: video.bunnyVideoId, bunnyLibraryId: video.bunnyLibraryId } });
      await expectStatus(await owner.session.saveWorkspace([edit], owner.revision), 200);
      const visitor = new Session(server.baseUrl);
      const feed = await (await visitor.publicFeed()).json() as { items: Array<{ edit: { id: string; video?: VideoField } }> };
      const item = feed.items.find((entry) => entry.edit.id === "feed-edit");
      assert.ok(item?.edit.video?.playbackUrl, "the public feed must resolve playback for a ready, published, public video Edit");
    });

    await check("GET /public-feed correctly attributes playback to the right creator when multiple creators each have a ready video (single batched resolution, no cross-attribution)", async () => {
      const ownerA = await freshOwner();
      const ownerB = await freshOwner();
      const videoA = await createReadyVideo(ownerA.session, `multi-a-${suffix}`, { length: 10 });
      const videoB = await createReadyVideo(ownerB.session, `multi-b-${suffix}`, { length: 20 });
      const editA = baseEdit("multi-edit-a", { status: "published", video: { uploadId: videoA.id, bunnyVideoId: videoA.bunnyVideoId, bunnyLibraryId: videoA.bunnyLibraryId } });
      const editB = baseEdit("multi-edit-b", { status: "published", video: { uploadId: videoB.id, bunnyVideoId: videoB.bunnyVideoId, bunnyLibraryId: videoB.bunnyLibraryId } });
      await expectStatus(await ownerA.session.saveWorkspace([editA], ownerA.revision), 200);
      await expectStatus(await ownerB.session.saveWorkspace([editB], ownerB.revision), 200);
      const visitor = new Session(server.baseUrl);
      const feed = await (await visitor.publicFeed()).json() as { items: Array<{ creatorUsername: string; edit: { id: string; video?: VideoField } }> };
      const itemA = feed.items.find((entry) => entry.edit.id === "multi-edit-a");
      const itemB = feed.items.find((entry) => entry.edit.id === "multi-edit-b");
      assert.ok(itemA?.edit.video?.playbackUrl?.includes(videoA.bunnyVideoId), "creator A's edit must resolve to creator A's own video");
      assert.ok(itemB?.edit.video?.playbackUrl?.includes(videoB.bunnyVideoId), "creator B's edit must resolve to creator B's own video");
      assert.equal(itemA?.edit.video?.durationSeconds, 10);
      assert.equal(itemB?.edit.video?.durationSeconds, 20);
      assert.equal(itemA?.creatorUsername, ownerA.username);
      assert.equal(itemB?.creatorUsername, ownerB.username);
    });

    await check("a draft (unpublished) video Edit gets playback resolved in the owner's own view but never appears in any public endpoint at all", async () => {
      const owner = await freshOwner();
      const video = await createReadyVideo(owner.session, `draft-${suffix}`);
      const edit = baseEdit("draft-playback-edit", { status: "draft", video: { uploadId: video.id, bunnyVideoId: video.bunnyVideoId, bunnyLibraryId: video.bunnyLibraryId } });
      await expectStatus(await owner.session.saveWorkspace([edit], owner.revision), 200);
      const ownerView = await (await owner.session.workspace()).json() as { edits: Array<{ id: string; video?: VideoField }> };
      assert.ok(ownerView.edits.find((item) => item.id === "draft-playback-edit")?.video?.playbackUrl, "the owner's own composer/preview must still see playback for a ready draft video");
      const visitor = new Session(server.baseUrl);
      const publicView = await (await visitor.publicWorkspace(owner.username)).json() as { edits: Array<{ id: string }> };
      assert.ok(!publicView.edits.some((item) => item.id === "draft-playback-edit"), "a draft Edit must never appear in the public workspace view at all, video or not");
      const feed = await (await visitor.publicFeed()).json() as { items: Array<{ edit: { id: string } }> };
      assert.ok(!feed.items.some((entry) => entry.edit.id === "draft-playback-edit"), "a draft Edit must never appear in the public feed at all, video or not");
    });

    await check("with the video_upload flag disabled, no response includes a playbackUrl anywhere — the edit's video field is returned exactly as before this feature", async () => {
      const owner = await freshOwner();
      const video = await createReadyVideo(owner.session, `flag-off-${suffix}`);
      const edit = baseEdit("flag-off-edit", { status: "published", video: { uploadId: video.id, bunnyVideoId: video.bunnyVideoId, bunnyLibraryId: video.bunnyLibraryId } });
      await expectStatus(await owner.session.saveWorkspace([edit], owner.revision), 200);
      await expectStatus(await admin.setFlag("video_upload", false), 200);
      try {
        const ownerView = await (await owner.session.workspace()).json() as { edits: Array<{ id: string; video?: VideoField }> };
        const ownerEdit = ownerView.edits.find((item) => item.id === "flag-off-edit");
        assert.equal(ownerEdit?.video?.playbackUrl, undefined, "owner view must not resolve playback while the flag is disabled");
        assert.equal(ownerEdit?.video?.bunnyVideoId, video.bunnyVideoId, "the underlying video field must otherwise be unchanged");
        const visitor = new Session(server.baseUrl);
        const publicView = await (await visitor.publicWorkspace(owner.username)).json() as { edits: Array<{ id: string; video?: VideoField }> };
        assert.equal(publicView.edits.find((item) => item.id === "flag-off-edit")?.video?.playbackUrl, undefined);
        const feed = await (await visitor.publicFeed()).json() as { items: Array<{ edit: { id: string; video?: VideoField } }> };
        assert.equal(feed.items.find((entry) => entry.edit.id === "flag-off-edit")?.edit.video?.playbackUrl, undefined);
      } finally {
        await expectStatus(await admin.setFlag("video_upload", true), 200);
      }
    });

    await check("with no CDN hostname configured on this deployment, playback is never resolved even though the flag is on and the video is ready+attached (safe placeholder, not a crash)", async () => {
      const owner = await freshOwner();
      const video = await createReadyVideo(owner.session, `no-cdn-${suffix}`);
      const edit = baseEdit("no-cdn-edit", { status: "published", video: { uploadId: video.id, bunnyVideoId: video.bunnyVideoId, bunnyLibraryId: video.bunnyLibraryId } });
      await expectStatus(await owner.session.saveWorkspace([edit], owner.revision), 200);
      const feedNoCdn = await (await publicSession.publicFeed()).json() as { items: Array<{ edit: { id: string; video?: VideoField } }> };
      const item = feedNoCdn.items.find((entry) => entry.edit.id === "no-cdn-edit");
      assert.ok(item, "the edit must still be present in the feed (never dropped) even without a configured CDN hostname");
      assert.equal(item?.edit.video?.playbackUrl, undefined, "playbackUrl must be absent, never a broken/guessed URL, when no CDN hostname is configured");
      assert.equal(item?.edit.video?.posterUrl, undefined);
    });

    await check("a video row whose attached_edit_id points at a DIFFERENT Edit never resolves playback for the Edit that merely references its uploadId", async () => {
      const owner = await freshOwner();
      const video = await createReadyVideo(owner.session, `mismatch-attach-${suffix}`);
      const edit = baseEdit("mismatch-attach-edit", { status: "published", video: { uploadId: video.id, bunnyVideoId: video.bunnyVideoId, bunnyLibraryId: video.bunnyLibraryId } });
      await expectStatus(await owner.session.saveWorkspace([edit], owner.revision), 200);
      // Simulate a stale/tampered attachment directly at the data layer —
      // this state can never be reached through the API itself (the
      // duplicate-uploadId fix and attach/detach logic prevent it), but the
      // playback resolver must independently refuse to trust it if it ever
      // occurred, exactly like the ownership/identity checks it sits beside.
      await db.update(videoUploads).set({ attachedEditId: "some-other-edit-entirely" }).where(eq(videoUploads.id, video.id));
      const ownerView = await (await owner.session.workspace()).json() as { edits: Array<{ id: string; video?: VideoField }> };
      const seen = ownerView.edits.find((item) => item.id === "mismatch-attach-edit");
      assert.equal(seen?.video?.playbackUrl, undefined, "playback must never be resolved for an Edit the video row isn't actually attached to");
    });

    await check("attachResolvedPlayback returns bunnyVideoId/bunnyLibraryId from the persisted video_uploads row, never a stale or tampered value sitting in the workspace's own stored edit.video JSON", async () => {
      const owner = await freshOwner();
      const video = await createReadyVideo(owner.session, `identity-source-${suffix}`);
      const edit = baseEdit("identity-source-edit", { status: "published", video: { uploadId: video.id, bunnyVideoId: video.bunnyVideoId, bunnyLibraryId: video.bunnyLibraryId } });
      await expectStatus(await owner.session.saveWorkspace([edit], owner.revision), 200);
      // Directly corrupt the bunnyVideoId/bunnyLibraryId sitting in the
      // workspace's own stored edit.video JSON — this state can never be
      // reached through the API itself (the PUT handler cross-checks these
      // against the row at save time and rejects a mismatch with 409), but
      // attachResolvedPlayback must independently refuse to echo it back if
      // it were ever present, exactly like it refuses to build a URL from
      // client-submitted identity.
      const [workspaceRow] = await db.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.ownerUserId, owner.ownerUserId));
      assert.ok(workspaceRow, "the fixture workspace must exist");
      const tamperedEdits = (workspaceRow.edits as Array<Record<string, unknown>>).map((item) =>
        item.id === "identity-source-edit"
          ? { ...item, video: { ...(item.video as Record<string, unknown>), bunnyVideoId: "tampered-video-id", bunnyLibraryId: "tampered-library-id" } }
          : item);
      await db.update(creatorWorkspaces).set({ edits: tamperedEdits }).where(eq(creatorWorkspaces.ownerUserId, owner.ownerUserId));
      const ownerView = await (await owner.session.workspace()).json() as { edits: Array<{ id: string; video?: VideoField }> };
      const seen = ownerView.edits.find((item) => item.id === "identity-source-edit");
      assert.equal(seen?.video?.bunnyVideoId, video.bunnyVideoId, "bunnyVideoId in the response must come from the row, never the tampered stored JSON");
      assert.equal(seen?.video?.bunnyLibraryId, video.bunnyLibraryId, "bunnyLibraryId in the response must come from the row, never the tampered stored JSON");
      assert.ok(seen?.video?.playbackUrl?.includes(video.bunnyVideoId), "playbackUrl must still be derived from the row's own bunnyVideoId, not the tampered one");
    });
  } finally {
    stopServer(server);
    stopServer(serverNoCdn);
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
