// Taste in KIN Travel (feature flag taste_everywhere) against the REAL
// api-server and a REAL disposable database:
//  - the creator-place loader reads only the viewer's own saves and follows:
//    a saved place Edit and a followed creator's place Edit in the
//    destination come back (saved first), a stranger's Edit with thousands
//    of followers, likes and saves does not, nor a blocked creator's, nor
//    the viewer's own, nor an Edit in another city, nor a draft;
//  - the plan route answers 200 with the flag off and on (Google Places is
//    not configured here, so the plan itself reports unavailable either
//    way — the point is that the taste path never breaks the request).
//
// Usage:
//   DATABASE_URL=postgresql://<disposable> pnpm --filter scripts run verify:taste-everywhere
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { creatorFollows, creatorWorkspaces, db, editLikes, editSaves, featureFlags, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

// The loader under test lives in the api-server source tree. tsx resolves it
// at run time; the computed specifier keeps it out of this package's
// TypeScript project (which only covers scripts/src).
type CreatorPlace = { editId: string; creatorUsername: string; creatorDisplayName: string; placeName: string; locationLabel: string; mapsUrl: string | null; via: "saved" | "followed" };
const loaderModule = path.join(repoRoot, "artifacts/api-server/src/lib/kin-taste-places.ts");
const { creatorPlacesForViewer } = await import(loaderModule) as { creatorPlacesForViewer: (userId: string, destination: string) => Promise<CreatorPlace[]> };

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

type Server = { process: ChildProcess; baseUrl: string };
async function startServer(): Promise<Server> {
  const port = 24640 + Math.floor(Math.random() * 40);
  const child = spawn("node", [serverEntry], { env: { ...process.env, PORT: String(port), NODE_ENV: "production", SESSION_SECRET: process.env.SESSION_SECRET ?? "verify-taste-everywhere-not-a-real-secret" }, stdio: ["ignore", "pipe", "pipe"] });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseUrl}/api/healthz`)).ok) return { process: child, baseUrl }; } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error("api-server did not become ready");
}

class Session {
  cookie: string | null = null;
  userId = "";
  constructor(private baseUrl: string) {}
  async request(pathName: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    const response = await fetch(`${this.baseUrl}${pathName}`, { ...init, headers, redirect: "manual" });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    return response;
  }
  async json(pathName: string, method: string, body?: unknown) {
    return this.request(pathName, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async signup(email: string) {
    const response = await this.json("/api/auth/signup", "POST", { email, password: "taste-everywhere-pass-1", termsAccepted: true });
    assert.equal(response.status, 201, `signup ${email}`);
    this.userId = ((await response.json()) as { user: { id: string } }).user.id;
  }
  async profile() { return (await this.request("/api/creator-profile")).json() as Promise<Record<string, unknown>>; }
  async saveProfile(patch: Record<string, unknown>) {
    const current = await this.profile();
    const body = { displayName: current.displayName, username: current.username, bio: current.bio, city: current.city, country: current.country, interests: current.interests, dateOfBirth: current.dateOfBirth, showAge: current.showAge, avatarObjectPath: current.avatarObjectPath, coverImageObjectPath: current.coverImageObjectPath, ...patch };
    const response = await this.json("/api/creator-profile", "PUT", body);
    assert.equal(response.status, 200, `profile: ${await response.text()}`);
  }
  async workspace() { return (await this.request("/api/creator-workspace")).json() as Promise<{ revision: number; edits: unknown[]; collections: unknown[] }>; }
  async publish(edits: unknown[]) {
    const current = await this.workspace();
    const response = await this.json("/api/creator-workspace", "PUT", { edits, collections: current.collections, expectedRevision: current.revision });
    assert.equal(response.status, 200, `publish: ${await response.text()}`);
  }
}

const stamp = Date.now().toString(36);
const placeEdit = (id: string, placeName: string, locationLabel: string, status: "published" | "draft" = "published") => ({
  id: `${id}-${stamp}`, category: "Restaurants", title: placeName, titleAr: "", caption: `A table worth booking at ${placeName}.`, captionAr: "",
  image: "/tastekin-media/quiet-tailoring.webp", location: locationLabel, locationAr: "", altText: placeName,
  placeName, locationLabel, mapsUrl: null, tasteRating: 4, creatorReview: "",
  access: "public", status, collectionIds: [],
});

async function setFlag(key: "kin_search" | "taste_everywhere", enabled: boolean) {
  await db.insert(featureFlags).values({ key, description: "verify-taste-everywhere", enabled })
    .onConflictDoUpdate({ target: featureFlags.key, set: { enabled, updatedAt: new Date() } });
}

const results: Array<{ name: string; ok: boolean }> = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok — ${name}`); }
  catch (error) { results.push({ name, ok: false }); console.log(`  FAIL — ${name}\n    ${error instanceof Error ? error.message : error}`); }
}

async function main() {
  await setFlag("kin_search", true);
  await setFlag("taste_everywhere", false);
  const server = await startServer();
  try {
    const saved = new Session(server.baseUrl); await saved.signup(`te-saved-${stamp}@example.test`);
    const followed = new Session(server.baseUrl); await followed.signup(`te-followed-${stamp}@example.test`);
    const stranger = new Session(server.baseUrl); await stranger.signup(`te-stranger-${stamp}@example.test`);
    const blocked = new Session(server.baseUrl); await blocked.signup(`te-blocked-${stamp}@example.test`);
    const viewer = new Session(server.baseUrl); await viewer.signup(`te-viewer-${stamp}@example.test`);
    await saved.saveProfile({ displayName: "Saved Creator", username: `saved_${stamp}`, interests: ["Restaurants"] });
    await followed.saveProfile({ displayName: "Followed Creator", username: `followed_${stamp}`, interests: ["Restaurants"] });
    await stranger.saveProfile({ displayName: "Stranger", username: `stranger_${stamp}`, interests: ["Restaurants"] });
    await blocked.saveProfile({ displayName: "Blocked Creator", username: `blocked_${stamp}`, interests: ["Restaurants"] });
    await viewer.saveProfile({ displayName: "Viewer", username: `viewer_${stamp}`, interests: ["Restaurants"] });
    await saved.publish([placeEdit("saved-paris", "Septime", "Paris, France"), placeEdit("saved-rome", "Roscioli", "Rome, Italy")]);
    await followed.publish([placeEdit("followed-paris", "Clown Bar", "Paris, France"), placeEdit("followed-draft", "Le Servan", "Paris, France", "draft"), placeEdit("followed-old", "Frenchie", "Paris, France")]);
    await stranger.publish([placeEdit("stranger-paris", "Chez Janou", "Paris, France")]);
    await blocked.publish([placeEdit("blocked-paris", "Le Baratin", "Paris, France")]);
    await viewer.publish([placeEdit("viewer-paris", "My own place", "Paris, France")]);

    // The viewer saves ONE of the saved creator's Edits, follows the followed creator and blocks the blocked one.
    assert.equal((await viewer.json(`/api/edits/saved-paris-${stamp}/save`, "PUT", { active: true })).status, 200);
    assert.equal((await viewer.json("/api/relationships", "POST", { type: "follow", targetId: `followed_${stamp}`, active: true })).status, 200);
    const block = await viewer.json("/api/blocks", "POST", { username: `blocked_${stamp}` });
    assert.ok(block.status === 200 || block.status === 201, `block: ${block.status} ${await block.text()}`);

    // The stranger is wildly popular: thousands of followers, likes and saves.
    const strangerWorkspaceId = (await db.select({ id: creatorWorkspaces.creatorId }).from(creatorWorkspaces).where(eq(creatorWorkspaces.ownerUserId, stranger.userId)))[0].id;
    const fans = Array.from({ length: 200 }, (_, i) => ({ id: `tefan-${stamp}-${i}`, email: `tefan-${stamp}-${i}@example.test` }));
    await db.insert(usersTable).values(fans.map((fan) => ({ id: fan.id, email: fan.email, authProvider: "password" })));
    await db.insert(creatorFollows).values(fans.map((fan) => ({ followerUserId: fan.id, creatorId: strangerWorkspaceId })));
    await db.insert(editLikes).values(fans.map((fan) => ({ editId: `stranger-paris-${stamp}`, userId: fan.id })));
    await db.insert(editSaves).values(fans.map((fan) => ({ editId: `stranger-paris-${stamp}`, userId: fan.id })));

    await check("creator places for Paris: the saved Edit first, then the followed creator's published Paris Edits; nothing from strangers, blocked creators, drafts, other cities or the viewer", async () => {
      const places = await creatorPlacesForViewer(viewer.userId, "Paris");
      const ids = places.map((place) => place.editId);
      assert.equal(ids[0], `saved-paris-${stamp}`, `saved first, got ${ids.join(", ")}`);
      assert.ok(ids.includes(`followed-paris-${stamp}`) && ids.includes(`followed-old-${stamp}`), "followed creator's Paris Edits are in");
      assert.ok(!ids.includes(`followed-draft-${stamp}`), "drafts never");
      assert.ok(!ids.includes(`saved-rome-${stamp}`), "another city never");
      assert.ok(!ids.includes(`stranger-paris-${stamp}`), "thousands of followers/likes/saves do not make a stranger a source");
      assert.ok(!ids.includes(`blocked-paris-${stamp}`), "blocked creators never");
      assert.ok(!ids.includes(`viewer-paris-${stamp}`), "the viewer's own Edits never");
      assert.deepEqual(places.map((place) => place.via).slice(0, 1), ["saved"]);
      assert.equal(places[0].creatorUsername, `saved_${stamp}`);
      for (const place of places) assert.ok(!("followerCount" in place) && !("likeCount" in place) && !("saveCount" in place));
    });

    await check("the destination filter understands qualifiers and Arabic: 'Paris, Texas' yields nothing; an unknown city yields nothing", async () => {
      assert.deepEqual(await creatorPlacesForViewer(viewer.userId, "Paris, Texas"), []);
      assert.deepEqual(await creatorPlacesForViewer(viewer.userId, "Tokyo"), []);
      assert.equal((await creatorPlacesForViewer(viewer.userId, "paris, france")).length, 3);
    });

    await check("another member with no saves or follows gets no creator places, whatever the destination", async () => {
      assert.deepEqual(await creatorPlacesForViewer(stranger.userId, "Paris"), []);
    });

    await check("flag OFF and ON: POST /api/kin/travel/plan still answers 200 for the viewer (Google Places is not configured here, so the plan reports unavailable both ways)", async () => {
      const body = { query: "Plan a trip to Paris including: Dinner", destination: "Paris", locale: "en", interests: ["dinner"] };
      const off = await viewer.json("/api/kin/travel/plan", "POST", body);
      const offText = await off.text();
      assert.equal(off.status, 200, offText);
      assert.equal((JSON.parse(offText) as { status: string }).status, "unavailable");
      await setFlag("taste_everywhere", true);
      const on = await viewer.json("/api/kin/travel/plan", "POST", body);
      const onText = await on.text();
      assert.equal(on.status, 200, onText);
      assert.equal((JSON.parse(onText) as { status: string }).status, "unavailable");
    });
  } finally {
    await setFlag("taste_everywhere", false);
    await setFlag("kin_search", false);
    server.process.kill();
    await db.execute(sql`select 1`).catch(() => undefined);
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length) { console.error(`\n${failed.length} of ${results.length} taste-everywhere checks failed.`); process.exitCode = 1; }
  else console.log(`\nAll ${results.length} taste-everywhere checks passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => process.exit());
