// TASTEKIN has no paid or locked content, no subscriptions, no viewing fees
// and no blurred "preview" photos. This suite is the regression guard for
// the last of those: it seeds a creator workspace row directly in the
// database with every legacy shape the old paywall left behind — an Edit
// whose only image is a blurred `*-preview.webp` static asset (the original
// demo seeds), a locked Edit whose only image is its blurred `previewImage`
// object, a locked Edit with a clear crop AND a blurred previewImage, an
// Edit whose image is the never-shipped demo source, and a collection whose
// cover is a blurred asset — then proves that every read path (owner
// workspace, visitor workspace, public feed, public media route, save
// round-trip) serves clear photos only, never a blurred rendition, and that
// the blurred static assets no longer exist in the web bundle at all.
//
// Runs the compiled api-server against a real Postgres database — never a
// migration, never production.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:free-media
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { creatorWorkspaces, db } from "@workspace/db";
import { eq } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");
const webMediaDir = path.join(repoRoot, "artifacts/tastekin/public/tastekin-media");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

let nextPort = 25800;
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
  async workspace() { return this.request("/api/creator-workspace"); }
  async profile() { return this.request("/api/creator-profile"); }
  async saveWorkspace(edits: unknown[], collections: unknown[], expectedRevision: number) {
    return this.request("/api/creator-workspace", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ edits, collections, expectedRevision }) });
  }
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

type EditView = Record<string, unknown> & { id: string; image?: string; previewImage?: string; access?: string };
type CollectionView = Record<string, unknown> & { id: string; coverImage?: string; access?: string };
type WorkspaceView = { edits: EditView[]; collections: CollectionView[]; revision: number };

const BLURRED_STATIC = "/tastekin-media/private-hotel-preview.webp";
const BLURRED_STATIC_2 = "/tastekin-media/training-week-preview.webp";
const MISSING_SOURCE = "/tastekin-media/private-hotel-source.webp";
const CLEAR_STATIC = "/tastekin-media/quiet-tailoring.webp";
const CLEAR_OBJECT = `/objects/uploads/${randomUUID()}`;
const CLEAR_SOURCE = `/objects/uploads/${randomUUID()}`;
const BLURRED_OBJECT = `/objects/uploads/${randomUUID()}`;
const BLURRED_OBJECT_2 = `/objects/uploads/${randomUUID()}`;

const baseEdit = {
  category: "Travel", title: "t", titleAr: "t", caption: "c", captionAr: "c",
  location: "Kuwait City, Kuwait", locationAr: "مدينة الكويت، الكويت", altText: "a", status: "published", collectionIds: [] as string[],
};
/** Every legacy paywall shape at once. `image`/`previewImage` are exactly what old stored rows look like. */
const LEGACY_EDITS = [
  { ...baseEdit, id: "demo-blurred-static", access: "locked", image: BLURRED_STATIC, altText: "A blurred private hotel preview." },
  { ...baseEdit, id: "demo-blurred-static-public", access: "public", image: BLURRED_STATIC_2 },
  { ...baseEdit, id: "demo-missing-source", access: "locked", image: MISSING_SOURCE, previewImage: BLURRED_STATIC },
  { ...baseEdit, id: "locked-preview-only", access: "locked", image: "", sourceImage: CLEAR_SOURCE, previewImage: BLURRED_OBJECT },
  { ...baseEdit, id: "locked-image-is-preview", access: "locked", image: BLURRED_OBJECT_2, sourceImage: CLEAR_SOURCE, previewImage: BLURRED_OBJECT_2 },
  { ...baseEdit, id: "locked-clear-crop", access: "locked", image: CLEAR_OBJECT, sourceImage: CLEAR_SOURCE, previewImage: BLURRED_OBJECT },
  { ...baseEdit, id: "public-clear-static", access: "public", image: CLEAR_STATIC },
  { ...baseEdit, id: "draft-blurred", access: "locked", image: BLURRED_STATIC, status: "draft" },
];
const LEGACY_COLLECTIONS = [
  { id: "coastal-edit", title: "The Coastal Edit", titleAr: "اختيارات الساحل", description: "", descriptionAr: "", access: "locked", coverEditId: "demo-blurred-static", editIds: ["demo-blurred-static", "locked-clear-crop"], coverImage: BLURRED_STATIC },
  { id: "clear-cover", title: "Clear", titleAr: "Clear", description: "", descriptionAr: "", access: "public", coverEditId: "", editIds: [], coverImage: CLEAR_STATIC, uploads: [{ id: "u1", type: "photo", image: CLEAR_STATIC }], itemOrder: ["u1"] },
];

const BLURRED_VALUES = [BLURRED_STATIC, BLURRED_STATIC_2, MISSING_SOURCE, BLURRED_OBJECT, BLURRED_OBJECT_2];
function assertNoBlur(payload: unknown, where: string) {
  const text = JSON.stringify(payload);
  for (const value of BLURRED_VALUES) assert.ok(!text.includes(value), `${where} must never carry the blurred/missing rendition ${value}`);
  assert.ok(!/-preview\.webp/i.test(text), `${where} must never reference a *-preview.webp asset`);
  assert.ok(!text.includes('"previewImage"'), `${where} must never carry a previewImage field`);
  assert.ok(!text.includes('"locked"'), `${where} must never carry a locked access value`);
}
function assertEditsClear(edits: EditView[], where: string, publicMediaPrefix: string | null) {
  const byId = new Map(edits.map((edit) => [edit.id, edit]));
  for (const edit of edits) assert.equal(edit.access, "public", `${where}: ${edit.id} is public`);
  for (const id of ["demo-blurred-static", "demo-blurred-static-public", "demo-missing-source", "locked-preview-only", "locked-image-is-preview"]) {
    const edit = byId.get(id);
    assert.ok(edit, `${where}: ${id} is still listed (it is a published Edit, just without a photo)`);
    assert.equal(edit.image, undefined, `${where}: ${id} has no photo rather than a blurred one`);
  }
  assert.equal(byId.get("public-clear-static")?.image, CLEAR_STATIC, `${where}: a clear static photo is untouched`);
  const clearCrop = byId.get("locked-clear-crop");
  assert.ok(clearCrop, `${where}: the legacy locked Edit with a real crop is listed`);
  assert.equal(clearCrop.image, publicMediaPrefix ? `${publicMediaPrefix}/locked-clear-crop` : CLEAR_OBJECT, `${where}: its clear crop is the photo served`);
}

async function main() {
  const server = await startServer({});
  try {
    const owner = new Session(server.baseUrl);
    const account = await owner.signup(`free-media-${suffix}@example.com`, PASSWORD);
    const profile = await (await owner.profile()).json() as { username: string };
    const username = profile.username;
    const initial = await (await owner.workspace()).json() as WorkspaceView;
    // Seed the legacy rows straight into the database — the save route
    // would (correctly) normalize them, and the point is to prove the READ
    // paths never trust stored data.
    await db.update(creatorWorkspaces)
      .set({ edits: LEGACY_EDITS, collections: LEGACY_COLLECTIONS, revision: initial.revision + 1, updatedAt: new Date() })
      .where(eq(creatorWorkspaces.ownerUserId, account.user.id));
    const visitor = new Session(server.baseUrl);
    const publicMedia = `/api/public-media/${encodeURIComponent(username)}`;

    await check("the blurred demo preview assets no longer exist in the web bundle", async () => {
      assert.ok(existsSync(webMediaDir), `media dir exists at ${webMediaDir}`);
      const blurred = readdirSync(webMediaDir).filter((name) => /-preview\.webp$/i.test(name) || /private-hotel-source/i.test(name));
      assert.deepEqual(blurred, [], "no *-preview.webp or demo source file may ship");
    });

    await check("owner workspace: every legacy locked/blurred Edit reads as public with a clear photo or none; no previewImage, no blurred asset anywhere", async () => {
      const response = await owner.workspace();
      await expectStatus(response, 200);
      const workspace = await response.json() as WorkspaceView;
      assertNoBlur(workspace, "owner workspace");
      assertEditsClear(workspace.edits, "owner workspace", null);
      assert.ok(workspace.edits.some((edit) => edit.id === "draft-blurred" && edit.image === undefined), "the owner's draft keeps its record but not the blurred photo");
      const coastal = workspace.collections.find((collection) => collection.id === "coastal-edit");
      assert.equal(coastal?.access, "public");
      assert.equal(coastal?.coverImage, undefined, "a blurred collection cover is dropped, not served");
      assert.equal(workspace.collections.find((collection) => collection.id === "clear-cover")?.coverImage, CLEAR_STATIC, "a clear cover is untouched");
    });

    await check("visitor workspace (/api/creators/:username/workspace): same guarantees, clear crops served via the public media route", async () => {
      const response = await visitor.request(`/api/creators/${encodeURIComponent(username)}/workspace`);
      await expectStatus(response, 200);
      const workspace = await response.json() as WorkspaceView;
      assertNoBlur(workspace, "visitor workspace");
      assertEditsClear(workspace.edits, "visitor workspace", publicMedia);
      assert.ok(!workspace.edits.some((edit) => edit.id === "draft-blurred"), "drafts are not public");
      assert.equal(workspace.collections.find((collection) => collection.id === "coastal-edit")?.coverImage, undefined);
    });

    await check("public feed: same guarantees for every creator card", async () => {
      const response = await visitor.request("/api/public-feed");
      await expectStatus(response, 200);
      const feed = await response.json() as { items: Array<{ creatorUsername: string; edit: EditView }> };
      const mine = feed.items.filter((item) => item.creatorUsername === username);
      assert.ok(mine.length >= 7, `the seeded creator's published Edits are in the feed (${mine.length})`);
      assertNoBlur(mine, "public feed");
      assertEditsClear(mine.map((item) => item.edit), "public feed", publicMedia);
    });

    await check("public media route: an Edit whose only photo was a blurred rendition is 404, never redirected to the blur; the legacy /preview route never serves a blur either", async () => {
      for (const id of ["locked-preview-only", "locked-image-is-preview", "demo-blurred-static", "demo-missing-source"]) {
        await expectStatus(await visitor.request(`${publicMedia}/${id}`), 404);
        await expectStatus(await visitor.request(`${publicMedia}/${id}/preview`), 404);
      }
    });

    await check("owner private media route: a legacy blurred previewImage object is 404 even for the signed-in owner, so no route anywhere can hand out a blurred rendition", async () => {
      for (const blurred of [BLURRED_OBJECT, BLURRED_OBJECT_2]) {
        const response = await owner.request(`/api/storage${blurred}`);
        assert.equal(response.status, 404, `${blurred} must not be served to the owner`);
      }
      // Anonymous callers never reach private media at all.
      assert.equal((await visitor.request(`/api/storage${CLEAR_OBJECT}`)).status, 404);
    });

    await check("save round-trip: an old client submitting locked access and a previewImage gets public access back and no previewImage", async () => {
      const current = await (await owner.workspace()).json() as WorkspaceView;
      const submitted = [{ ...baseEdit, id: `old-client-edit-${suffix}`, access: "locked", image: CLEAR_OBJECT, sourceImage: CLEAR_SOURCE, previewImage: BLURRED_OBJECT }];
      const response = await owner.saveWorkspace(submitted, [], current.revision);
      await expectStatus(response, 200);
      const saved = await response.json() as WorkspaceView;
      assertNoBlur(saved, "save response");
      assert.equal(saved.edits.find((edit) => edit.id === `old-client-edit-${suffix}`)?.image, CLEAR_OBJECT);
      const after = await (await owner.workspace()).json() as WorkspaceView;
      assertNoBlur(after, "workspace after save");
    });
  } finally {
    stopServer(server);
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const result of failed) console.log(`  - ${result.name}: ${result.error}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
