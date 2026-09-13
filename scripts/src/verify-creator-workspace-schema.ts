// Phase 3B follow-up — regression coverage for a schema-drift bug found in
// PR review: regenerating lib/api-zod's Zod validators from openapi.yaml
// (needed to add the new video playback fields) silently reverted two
// unrelated, actively-used fields to a stale/incomplete spec:
//   - CreatorCollection lost coverImage/coverImageObjectPath/uploads/
//     itemOrder entirely, and its (required) coverEditId gained an
//     incompatible minLength: 1 — breaking any collection that has no
//     linked Edit (an uploads-only collection, or a freshly created one).
//   - CreatorProfileSettings.avatar gained an incompatible minLength: 1 —
//     breaking GET /api/creator-profile for any account with no photo yet
//     (initialProfile() legitimately sets avatar: "").
// This suite proves both are fixed: collection fields survive a PUT/GET
// round-trip through the real Zod-validated routes, and a fresh account's
// empty avatar returns 200, not 500. Runs the compiled api-server against a
// real Postgres database — never a migration, never real Bunny (this suite
// doesn't touch video at all).
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:creator-workspace-schema
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

let nextPort = 25700;
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

type Collection = {
  id: string; title: string; titleAr: string; description: string; descriptionAr: string;
  access: string; coverEditId: string; editIds: string[];
  coverImage?: string; coverImageObjectPath?: string | null;
  uploads?: Array<{ id: string; type: string; image: string; imageObjectPath?: string | null }>;
  itemOrder?: string[];
};

async function main() {
  const server = await startServer({});
  let counter = 0;
  try {
    async function freshOwner(): Promise<{ session: Session; revision: number }> {
      counter += 1;
      const session = new Session(server.baseUrl);
      await session.signup(`schema-${suffix}-${counter}@example.com`, PASSWORD);
      const workspace = await (await session.workspace()).json() as { revision: number };
      return { session, revision: workspace.revision };
    }

    await check("a collection with coverImage, coverImageObjectPath, uploads, and itemOrder — and no linked Edit at all — survives a PUT then GET round-trip unchanged", async () => {
      const owner = await freshOwner();
      const collection: Collection = {
        id: `uploads-only-${suffix}`,
        title: "Uploads only", titleAr: "تحميلات فقط",
        description: "", descriptionAr: "",
        access: "public",
        // No linked Edit: this is exactly the shape blankCollection() /
        // an uploads-only collection sends — coverEditId must be allowed
        // to stay empty.
        coverEditId: "",
        editIds: [],
        coverImage: "/tastekin-media/quiet-tailoring.webp",
        coverImageObjectPath: null,
        uploads: [
          { id: "upload-1", type: "photo", image: "/tastekin-media/quiet-tailoring.webp", imageObjectPath: null },
        ],
        itemOrder: ["upload-1"],
      };
      const saveResponse = await owner.session.saveWorkspace([], [collection], owner.revision);
      await expectStatus(saveResponse, 200);
      const saved = await saveResponse.json() as { collections: Collection[] };
      const savedCollection = saved.collections.find((item) => item.id === collection.id);
      assert.equal(savedCollection?.coverEditId, "", "an empty coverEditId must be accepted, not rejected as too short");
      assert.equal(savedCollection?.coverImage, collection.coverImage, "coverImage must survive the save response");
      assert.equal(savedCollection?.uploads?.length, 1, "uploads must survive the save response");
      assert.deepEqual(savedCollection?.itemOrder, ["upload-1"], "itemOrder must survive the save response");

      const ws = await (await owner.session.workspace()).json() as { collections: Collection[] };
      const seen = ws.collections.find((item) => item.id === collection.id);
      assert.equal(seen?.coverEditId, "", "an empty coverEditId must still read back as empty, not stripped/defaulted");
      assert.equal(seen?.coverImage, collection.coverImage, "coverImage must survive a subsequent GET, not be silently dropped by response validation");
      assert.equal(seen?.coverImageObjectPath, null, "coverImageObjectPath must survive as null");
      assert.equal(seen?.uploads?.length, 1, "uploads must survive a subsequent GET");
      assert.equal(seen?.uploads?.[0]?.id, "upload-1");
      assert.equal(seen?.uploads?.[0]?.image, collection.uploads![0].image);
      assert.deepEqual(seen?.itemOrder, ["upload-1"], "itemOrder must survive a subsequent GET");
    });

    await check("a freshly created (non-founder) account's empty avatar does not cause GET /api/creator-profile to 500", async () => {
      const owner = await freshOwner();
      const response = await owner.session.profile();
      await expectStatus(response, 200);
      const profile = await response.json() as { avatar: string };
      assert.equal(profile.avatar, "", "a fresh account with no uploaded photo must report an empty avatar, not fail response validation");
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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
