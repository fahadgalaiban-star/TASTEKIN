// Automated regression coverage for My Things (KIN PR-1): the private
// per-user closet backend/API foundation. Runs the compiled api-server
// against a REAL Postgres database (point DATABASE_URL at a disposable/
// test database — this creates real rows) and drives it over real HTTP.
//
// The real object-storage sidecar (Replit-platform-specific, normally at
// http://127.0.0.1:1106) does not exist in this environment — no existing
// verify-*.ts script in this repo exercises it either. This suite starts a
// small in-process fake sidecar bound to that same fixed address, so the
// real signing/PUT/GET/DELETE code paths in private-media-storage.ts run
// unmodified against a real (if fake) HTTP round trip, rather than being
// mocked out at the function level.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:my-things
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { closetItems, closetMediaUploads, db } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");
const reconcileScriptEntry = path.join(repoRoot, "scripts/src/reconcile-closet-media.ts");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

// The reconciliation script is spawned as its own subprocess (see
// runScript below) and inherits process.env — it needs PRIVATE_OBJECT_DIR
// set the same way startServer() sets it for the spawned api-server, so
// both talk to the same fake sidecar bucket/prefix.
process.env.PRIVATE_OBJECT_DIR = process.env.PRIVATE_OBJECT_DIR ?? "/closet-test-bucket/my-things";

// --- fake object-storage sidecar -------------------------------------------------

const store = new Map<string, Buffer>();
let failNextPut = false;
let failNextDelete = false;

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
          if (req.method === "PUT") {
            if (failNextPut) { failNextPut = false; res.writeHead(500); res.end(); return; }
            store.set(key, body);
            res.writeHead(200); res.end();
            return;
          }
          if (req.method === "GET") {
            const stored = store.get(key);
            if (!stored) { res.writeHead(404); res.end(); return; }
            res.writeHead(200); res.end(stored);
            return;
          }
          if (req.method === "DELETE") {
            if (failNextDelete) { failNextDelete = false; res.writeHead(500); res.end(); return; }
            const existed = store.delete(key);
            res.writeHead(existed ? 200 : 404); res.end();
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

// --- server harness (same pattern as every other verify-*.ts script) -------------

let nextPort = 25100;
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
  async listItems() { return this.request("/api/closet-items"); }
  async getItem(id: string) { return this.request(`/api/closet-items/${id}`); }
  async updateItem(id: string, fields: Record<string, unknown>) {
    return this.request(`/api/closet-items/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(fields) });
  }
  async deleteItem(id: string) { return this.request(`/api/closet-items/${id}`, { method: "DELETE" }); }
  async getItemImage(id: string) { return this.request(`/api/closet-items/${id}/image`); }
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

// --- fixtures ----------------------------------------------------------------

async function validJpeg(width = 40, height = 40): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 180, g: 60, b: 60 } } }).jpeg().toBuffer();
}
async function validPng(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 60, g: 180, b: 60 } } }).png().toBuffer();
}
async function jpegWithGpsExif(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 60, g: 60, b: 180 } } })
    .withExifMerge({ IFD0: { Make: "TestCam", GPSLatitude: "37/1,46/1,0/1", GPSLongitude: "122/1,25/1,0/1" } })
    .jpeg()
    .toBuffer();
}
async function oversizedDimensionJpeg(): Promise<Buffer> {
  // ~25 megapixels declared, but a solid color compresses to a few KB — well under the 10MB request limit.
  return sharp({ create: { width: 6100, height: 4100, channels: 3, background: { r: 10, g: 10, b: 10 } } }).jpeg().toBuffer();
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

async function resetFlagsAndData() {
  await db.delete(closetItems);
  await db.delete(closetMediaUploads);
}

async function main() {
  await resetFlagsAndData();
  const sidecar = await startFakeSidecar();
  const server = await startServer();
  try {
    const admin = new Session(server.baseUrl);
    const adminAccount = await admin.signup(`my-things-admin-${suffix}@example.com`, PASSWORD);
    const grant = await runScript(path.join(repoRoot, "scripts/src/admin-grant.ts"), ["--user-id", adminAccount.user.id, "--yes"]);
    assert.equal(grant.code, 0, `admin-grant should exit 0: ${grant.stdout}`);

    const userA = new Session(server.baseUrl);
    const userAAccount = await userA.signup(`my-things-a-${suffix}@example.com`, PASSWORD);
    const userB = new Session(server.baseUrl);
    await userB.signup(`my-things-b-${suffix}@example.com`, PASSWORD);

    // --- 1. flag OFF blocks everything, including for the resource owner ---
    await check("my_things OFF: media upload is rejected with 403", async () => {
      assert.equal((await userA.uploadMedia(await validJpeg())).status, 403);
    });
    await check("my_things OFF: list/read/update/delete/image routes are all rejected with 403", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      assert.equal((await userA.listItems()).status, 403);
      assert.equal((await userA.getItem(fakeId)).status, 403);
      assert.equal((await userA.updateItem(fakeId, { itemType: "shirt", primaryColor: "black", style: "casual" })).status, 403);
      assert.equal((await userA.deleteItem(fakeId)).status, 403);
      assert.equal((await userA.getItemImage(fakeId)).status, 403);
    });

    await expectStatus(await admin.setFlag("my_things", true), 200);

    // --- 2. upload validation ---
    await check("a valid JPEG upload succeeds and returns an opaque uploadId (never a storage key)", async () => {
      const response = await userA.uploadMedia(await validJpeg());
      await expectStatus(response, 201);
      const payload = await response.json() as Record<string, unknown>;
      assert.ok(typeof payload.uploadId === "string" && payload.uploadId.length > 0);
      assert.ok(!("imageObjectKey" in payload) && !("objectPath" in payload), "the storage key must never be returned to the client");
    });
    await check("a valid PNG upload is also accepted (format allowlist covers PNG)", async () => {
      await expectStatus(await userA.uploadMedia(await validPng(), "image/png"), 201);
    });
    await check("a non-image buffer claiming Content-Type: image/jpeg is rejected — client MIME claim is never trusted", async () => {
      const response = await userA.uploadMedia(Buffer.from("not an image, just text pretending to be one"), "image/jpeg");
      assert.equal(response.status, 422);
    });
    await check("an oversized request body (>10MB) is rejected with 413 before any decoding is attempted", async () => {
      const oversized = Buffer.alloc(11 * 1024 * 1024, 1);
      const response = await userA.uploadMedia(oversized);
      assert.equal(response.status, 413);
    });
    await check("an image exceeding the 24-megapixel limit is rejected — real decode/dimension check, not just a byte-size check", async () => {
      const response = await userA.uploadMedia(await oversizedDimensionJpeg());
      assert.equal(response.status, 422);
    });
    await check("a rejected upload's reservation is durably marked 'rejected' in the ledger, not left dangling", async () => {
      const response = await userA.uploadMedia(Buffer.from("garbage"), "image/jpeg");
      assert.equal(response.status, 422);
      const rejectedRows = await db.select().from(closetMediaUploads).where(eq(closetMediaUploads.state, "rejected"));
      assert.ok(rejectedRows.length > 0, "at least one rejected row must exist");
    });
    await check("storage PUT failure: 502 response, no item created, ledger reaches upload_failed with the key retained and a sanitized bounded error, and reconciliation (--yes) resolves it to deleted", async () => {
      const itemsBefore = (await db.select().from(closetItems).where(eq(closetItems.ownerUserId, userAAccount.user.id))).length;

      failNextPut = true;
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      assert.equal(uploadResponse.status, 502, "the endpoint must surface the intended failure response");
      const uploadPayload = await uploadResponse.json() as Record<string, unknown>;
      assert.ok(!("uploadId" in uploadPayload), "a failed upload must never return an uploadId to attach against");

      const itemsAfter = (await db.select().from(closetItems).where(eq(closetItems.ownerUserId, userAAccount.user.id))).length;
      assert.equal(itemsAfter, itemsBefore, "a failed storage PUT must never result in a closet_items row");

      const [failedRow] = await db.select().from(closetMediaUploads)
        .where(and(eq(closetMediaUploads.ownerUserId, userAAccount.user.id), eq(closetMediaUploads.state, "upload_failed")))
        .orderBy(desc(closetMediaUploads.createdAt))
        .limit(1);
      assert.ok(failedRow, "the ledger must durably record the failed attempt");
      assert.equal(failedRow.retryCount, 1, "retry_count must be incremented on a PUT failure");
      assert.ok(failedRow.imageObjectKey, "the already-allocated private object key must be retained, not cleared, so the object (if partially written) stays trackable");
      assert.ok(failedRow.lastError && failedRow.lastError.length <= 200, "last_error must be present and bounded");
      assert.ok(
        !failedRow.lastError!.includes("127.0.0.1") && !failedRow.lastError!.toLowerCase().includes("http://"),
        "last_error must never contain a URL",
      );

      // Durably discoverable: the reconciliation eligibility query admits
      // any 'upload_failed' row unconditionally (see reconcile-closet-media.ts's
      // ELIGIBILITY clause), so this row can never become a silently
      // untracked orphan — it stays 'upload_failed' until reconciliation
      // (or a future run of it) resolves it.

      // Exercise reconciliation for real, with --yes (explicit execution
      // enabled) — the object was never actually written to the fake
      // sidecar (the PUT failed before any bytes landed), so the
      // reconciliation's delete call hits a 404 there, which is treated
      // idempotently as success, exactly as it would be for a genuinely
      // partial/missing object in real storage.
      const reconcileRun = await runScript(reconcileScriptEntry, ["--yes"]);
      assert.equal(reconcileRun.code, 0, `reconcile-closet-media --yes should exit 0: ${reconcileRun.stdout}`);

      const [resolvedRow] = await db.select().from(closetMediaUploads).where(eq(closetMediaUploads.id, failedRow.id));
      assert.equal(resolvedRow.state, "deleted", "reconciliation must resolve the failed upload's ledger row to deleted, idempotently, even though the object was never actually present");
      assert.equal(resolvedRow.cleanupLeaseUntil, null);
      assert.equal(resolvedRow.cleanupClaimToken, null);
    });

    // --- 3. EXIF/GPS stripping, output normalized to WebP ---
    await check("EXIF/GPS metadata is stripped end-to-end; stored output is WebP", async () => {
      const uploadResponse = await userA.uploadMedia(await jpegWithGpsExif());
      await expectStatus(uploadResponse, 201);
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const createResponse = await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "blue", style: "casual" });
      await expectStatus(createResponse, 201);
      const item = await createResponse.json() as { id: string };
      const imageResponse = await userA.getItemImage(item.id);
      assert.equal(imageResponse.status, 302);
      const location = imageResponse.headers.get("location");
      assert.ok(location);
      const stored = await fetch(location!);
      await expectStatus(stored, 200);
      const bytes = Buffer.from(await stored.arrayBuffer());
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.format, "webp");
      assert.ok(!metadata.exif, "EXIF (including GPS) must not survive re-encoding");
    });

    // --- 4. two-step attach: transaction, idempotency, ownership ---
    let itemAId = "";
    let consumedUploadId = "";
    await check("attaching a valid uploadId creates the item and returns fields, never the storage key", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      consumedUploadId = uploadId;
      const response = await userA.createItem(uploadId, { itemType: "jeans", primaryColor: "navy", style: "casual", occasion: "everyday", season: "all_season", brand: "  Acme  " });
      await expectStatus(response, 201);
      const item = await response.json() as Record<string, unknown>;
      itemAId = item.id as string;
      assert.equal(item.brand, "Acme", "brand must be trimmed");
      assert.ok(!("imageObjectKey" in item));
    });
    await check("reusing an already-consumed uploadId is rejected with 409, not a second item", async () => {
      const before = (await (await userA.listItems()).json() as { items: unknown[] }).items.length;
      const response = await userA.createItem(consumedUploadId, { itemType: "jeans", primaryColor: "navy", style: "casual" });
      assert.equal(response.status, 409);
      const after = (await (await userA.listItems()).json() as { items: unknown[] }).items.length;
      assert.equal(after, before, "a rejected re-attach must never create a second item");
    });
    await check("attaching an unknown/never-existed uploadId is rejected with 404", async () => {
      const response = await userA.createItem("00000000-0000-0000-0000-000000000000", { itemType: "jeans", primaryColor: "navy", style: "casual" });
      assert.equal(response.status, 404);
    });
    await check("an invalid item field (unknown itemType) is rejected with 400", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const response = await userA.createItem(uploadId, { itemType: "spaceship", primaryColor: "navy", style: "casual" });
      assert.equal(response.status, 400);
    });
    await check("brand normalizes empty/whitespace to null, never the literal string 'unknown'", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const response = await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "black", style: "casual", brand: "   " });
      const item = await response.json() as { brand: unknown };
      assert.equal(item.brand, null);
    });

    // --- PR-3: style is optional — itemType and primaryColor remain
    // required. A missing or explicit-null style must succeed and
    // serialize as null; an invalid non-null style must still 400; a
    // fake fallback (e.g. "casual", "unknown", "unspecified") must never
    // be silently inserted in its place. ---
    await check("create succeeds with style entirely absent from the body, and serializes as style: null", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const response = await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "black" });
      await expectStatus(response, 201);
      const item = await response.json() as { style: unknown };
      assert.equal(item.style, null, "style must be null, never a fallback token, when omitted");
    });
    await check("create succeeds with style explicitly null, and serializes as style: null", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const response = await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "black", style: null });
      await expectStatus(response, 201);
      const item = await response.json() as { style: unknown };
      assert.equal(item.style, null);
    });
    await check("create still succeeds with a valid non-null style, unchanged from before PR-3", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const response = await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "black", style: "formal" });
      await expectStatus(response, 201);
      const item = await response.json() as { style: unknown };
      assert.equal(item.style, "formal");
    });
    await check("create still rejects an invalid non-null style with 400", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const response = await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "black", style: "spaceship" });
      assert.equal(response.status, 400);
    });
    await check("itemType and primaryColor remain required: omitting itemType is still rejected with 400 even though style is optional", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const response = await userA.createItem(uploadId, { primaryColor: "black" });
      assert.equal(response.status, 400);
    });
    await check("PUT can null out an existing style by omitting it (full-replace semantics, same as occasion/season)", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const created = await (await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "black", style: "formal" })).json() as { id: string; style: unknown };
      assert.equal(created.style, "formal");
      const updateResponse = await userA.updateItem(created.id, { itemType: "shirt", primaryColor: "black" });
      await expectStatus(updateResponse, 200);
      const updated = await updateResponse.json() as { style: unknown };
      assert.equal(updated.style, null, "omitting style on a full-replace PUT must null it out, not preserve the old value");
    });
    await check("PUT still rejects an invalid non-null style with 400", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const created = await (await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "black", style: "formal" })).json() as { id: string };
      const response = await userA.updateItem(created.id, { itemType: "shirt", primaryColor: "black", style: "spaceship" });
      assert.equal(response.status, 400);
    });

    // --- 5. CRUD, list, read ---
    await check("GET /closet-items lists only the caller's own items", async () => {
      const response = await userA.listItems();
      await expectStatus(response, 200);
      const payload = await response.json() as { items: Array<{ id: string }> };
      assert.ok(payload.items.some((item) => item.id === itemAId));
    });
    await check("PUT /closet-items/:id updates the organized fields for the owner", async () => {
      const response = await userA.updateItem(itemAId, { itemType: "jeans", primaryColor: "black", style: "smart_casual", confirmationStatus: "confirmed" });
      await expectStatus(response, 200);
      const updated = await response.json() as { primaryColor: string; confirmationStatus: string };
      assert.equal(updated.primaryColor, "black");
      assert.equal(updated.confirmationStatus, "confirmed");
    });

    // --- 6. cross-user denial (every case) ---
    await check("cross-user: B cannot list A's items", async () => {
      const payload = await (await userB.listItems()).json() as { items: Array<{ id: string }> };
      assert.ok(!payload.items.some((item) => item.id === itemAId));
    });
    await check("cross-user: B reading A's item returns 404", async () => {
      assert.equal((await userB.getItem(itemAId)).status, 404);
    });
    await check("cross-user: B updating A's item returns 404, A's row unchanged", async () => {
      const response = await userB.updateItem(itemAId, { itemType: "dress", primaryColor: "pink", style: "evening" });
      assert.equal(response.status, 404);
      const stillA = await (await userA.getItem(itemAId)).json() as { itemType: string };
      assert.equal(stillA.itemType, "jeans");
    });
    await check("cross-user: B deleting A's item returns 404, item still exists for A", async () => {
      const response = await userB.deleteItem(itemAId);
      assert.equal(response.status, 404);
      assert.equal((await userA.getItem(itemAId)).status, 200);
    });
    await check("cross-user: B accessing A's item image returns 404, never a redirect", async () => {
      const response = await userB.getItemImage(itemAId);
      assert.equal(response.status, 404);
    });
    await check("cross-user: B cannot attach A's already-consumed or any of A's uploadIds", async () => {
      const response = await userB.createItem(consumedUploadId, { itemType: "shirt", primaryColor: "black", style: "casual" });
      assert.equal(response.status, 404);
    });
    await check("cross-user: B attaching A's *unconsumed* uploadId also fails with 404, and A can still consume it afterward", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const bResponse = await userB.createItem(uploadId, { itemType: "shirt", primaryColor: "black", style: "casual" });
      assert.equal(bResponse.status, 404);
      const aResponse = await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "black", style: "casual" });
      assert.equal(aResponse.status, 201, "B's failed attempt must not have consumed the upload");
    });

    // --- 7. rate limiting: durable, counts every attempt state, race-safe reservation ---
    await check("upload rate limit: 30 attempts/hour allowed, the 31st is rejected with 429 (counts rejected+successful alike)", async () => {
      const limitUser = new Session(server.baseUrl);
      await limitUser.signup(`my-things-ratelimit-${suffix}@example.com`, PASSWORD);
      const statuses: number[] = [];
      for (let i = 0; i < 15; i += 1) statuses.push((await limitUser.uploadMedia(await validJpeg(8, 8))).status);
      for (let i = 0; i < 15; i += 1) statuses.push((await limitUser.uploadMedia(Buffer.from("bad"), "image/jpeg")).status);
      assert.ok(statuses.every((s) => s === 201 || s === 422), "all 30 attempts should be accepted-or-rejected, not rate-limited yet");
      const thirtyFirst = await limitUser.uploadMedia(await validJpeg(8, 8));
      assert.equal(thirtyFirst.status, 429);
    });
    await check("upload rate limit under real concurrency: 35 simultaneous attempts admit exactly 30 and reject exactly 5 with 429, via the real Postgres advisory-lock path", async () => {
      const concurrentUser = new Session(server.baseUrl);
      const concurrentAccount = await concurrentUser.signup(`my-things-concurrent-${suffix}@example.com`, PASSWORD);
      const buffers = await Promise.all(Array.from({ length: 35 }, () => validJpeg(8, 8)));
      const statuses = await Promise.all(buffers.map((buffer) => concurrentUser.uploadMedia(buffer).then((response) => response.status)));

      const admitted = statuses.filter((status) => status !== 429);
      const rateLimited = statuses.filter((status) => status === 429);
      assert.equal(admitted.length, 30, `expected exactly 30 admitted reservations, got ${admitted.length} (statuses: ${statuses.join(",")})`);
      assert.equal(rateLimited.length, 5, `expected exactly 5 requests rejected with 429, got ${rateLimited.length}`);
      assert.ok(admitted.every((status) => status === 201), "every admitted concurrent upload should have fully succeeded (all fixtures are valid, none should fail decode/storage)");

      const ledgerRows = await db.select().from(closetMediaUploads).where(eq(closetMediaUploads.ownerUserId, concurrentAccount.user.id));
      assert.equal(ledgerRows.length, 30, "the ledger must record exactly 30 attempts for this user's rolling-hour window — no more, no fewer, regardless of request concurrency");
    });

    // --- 8. delete: option (b) privacy-first behavior ---
    await check("delete: physical deletion succeeds synchronously — 200, physicalDeletion 'completed', ledger row 'deleted'", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const item = await (await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "black", style: "casual" })).json() as { id: string };
      const [ledgerBefore] = await db.select().from(closetMediaUploads).where(eq(closetMediaUploads.closetItemId, item.id));
      const response = await userA.deleteItem(item.id);
      await expectStatus(response, 200);
      const payload = await response.json() as { physicalDeletion: string };
      assert.equal(payload.physicalDeletion, "completed");
      assert.equal((await userA.getItem(item.id)).status, 404, "item must be gone immediately");
      const [ledgerAfter] = await db.select().from(closetMediaUploads).where(eq(closetMediaUploads.id, ledgerBefore.id));
      assert.equal(ledgerAfter.state, "deleted");
      assert.equal(ledgerAfter.closetItemId, null, "onDelete: set null must have cleared this once the item row was deleted");
    });
    await check("delete: item disappears immediately and no new image route/signed URL is obtainable after delete is requested", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const item = await (await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "black", style: "casual" })).json() as { id: string };
      await expectStatus(await userA.deleteItem(item.id), 200);
      assert.equal((await userA.getItemImage(item.id)).status, 404);
      assert.equal((await userA.listItems()).status, 200);
      const payload = await (await userA.listItems()).json() as { items: Array<{ id: string }> };
      assert.ok(!payload.items.some((row) => row.id === item.id));
    });
    await check("delete: simulated physical storage failure — 202, physicalDeletion 'pending', ledger 'delete_failed' with sanitized bounded error", async () => {
      const uploadResponse = await userA.uploadMedia(await validJpeg());
      const { uploadId } = await uploadResponse.json() as { uploadId: string };
      const item = await (await userA.createItem(uploadId, { itemType: "shirt", primaryColor: "black", style: "casual" })).json() as { id: string };
      const [ledgerBefore] = await db.select().from(closetMediaUploads).where(eq(closetMediaUploads.closetItemId, item.id));
      failNextDelete = true;
      const response = await userA.deleteItem(item.id);
      await expectStatus(response, 202);
      const payload = await response.json() as { physicalDeletion: string };
      assert.equal(payload.physicalDeletion, "pending");
      assert.equal((await userA.getItem(item.id)).status, 404, "item must still disappear immediately even though physical deletion failed");
      const [ledgerRow] = await db.select().from(closetMediaUploads).where(eq(closetMediaUploads.id, ledgerBefore.id));
      assert.equal(ledgerRow.state, "delete_failed");
      assert.equal(ledgerRow.retryCount, 1);
      assert.ok(ledgerRow.lastError && ledgerRow.lastError.length <= 200);
      assert.ok(!ledgerRow.lastError!.includes("127.0.0.1") && !ledgerRow.lastError!.toLowerCase().includes("http://"), "last_error must never contain a URL");
    });

    // --- 9. admin authorization on the flag itself (named explicitly for my_things) ---
    await check("non-admin cannot toggle the my_things flag", async () => {
      assert.equal((await userA.setFlag("my_things", false)).status, 403);
    });
    await check("re-disabling my_things blocks the owner's own routes again", async () => {
      await expectStatus(await admin.setFlag("my_things", false), 200);
      assert.equal((await userA.listItems()).status, 403);
      await expectStatus(await admin.setFlag("my_things", true), 200);
    });
  } finally {
    stopServer(server);
    await new Promise<void>((resolve) => sidecar.close(() => resolve()));
    await resetFlagsAndData();
  }

  console.log("\nResults:");
  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`  ${result.ok ? "PASS" : "FAIL"} — ${result.name}`);
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} checks failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} My Things regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
