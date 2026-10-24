// Taste learning (feature flag taste_learning, on top of taste_ranking)
// against the REAL api-server and a REAL disposable database:
//  - flag OFF: /api/public-feed carries learning:false and the
//    "Not interested" route is 404 even for a signed-in member;
//  - flag ON: the viewer's OWN saves, likes and follows move the order of
//    the viewer's Home only; another member's Home is untouched;
//  - "Not interested" hides that Edit from the viewer's Home and lowers
//    Edits sharing its tags; it is idempotent; an owner cannot dismiss
//    their own Edit; it is never visible to the creator;
//  - edit_dwell analytics events are accepted with a valid shape and
//    refused (recorded:false) with the wrong one; dwell feeds learning;
//  - never by the numbers: thousands of likes, saves and followers from
//    OTHER members on the low-taste creator do not move the viewer's order;
//  - account deletion removes the member's dismissals.
//
// Usage:
//   DATABASE_URL=postgresql://<disposable> pnpm --filter scripts run verify:taste-learning
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyticsEvents, creatorFollows, creatorWorkspaces, db, editDismissals, editLikes, editSaves, featureFlags, usersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

type Server = { process: ChildProcess; baseUrl: string };
async function startServer(): Promise<Server> {
  const port = 24580 + Math.floor(Math.random() * 40);
  const child = spawn("node", [serverEntry], { env: { ...process.env, PORT: String(port), NODE_ENV: "production", SESSION_SECRET: process.env.SESSION_SECRET ?? "verify-taste-learning-not-a-real-secret" }, stdio: ["ignore", "pipe", "pipe"] });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseUrl}/api/healthz`)).ok) return { process: child, baseUrl }; } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error("api-server did not become ready");
}

type FeedItem = { creatorUsername: string; matchScore?: number | null; sharedTastes?: Array<{ id: string }>; edit: { id: string } };
type Feed = { ranking: string; learning?: boolean; items: FeedItem[] };

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
    const response = await this.json("/api/auth/signup", "POST", { email, password: "taste-learning-pass-1", termsAccepted: true });
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
  async feed(): Promise<Feed> { return (await this.request("/api/public-feed")).json() as Promise<Feed>; }
  async ours(): Promise<FeedItem[]> { return (await this.feed()).items.filter((item) => item.creatorUsername.endsWith(stamp)); }
  async track(name: string, metadata: Record<string, unknown>) {
    const response = await this.json("/api/analytics/events", "POST", { name, metadata });
    assert.equal(response.status, 202);
    return (await response.json()) as { recorded: boolean };
  }
}

const stamp = Date.now().toString(36);
const edit = (id: string, category: string, title: string, caption: string) => ({
  id: `${id}-${stamp}`, category, title, titleAr: "", caption, captionAr: "",
  image: "/tastekin-media/quiet-tailoring.webp", location: "Kuwait City, Kuwait", locationAr: "مدينة الكويت، الكويت", altText: title,
  access: "public", status: "published", collectionIds: [],
});

async function setFlag(key: "taste_ranking" | "taste_learning", enabled: boolean) {
  await db.insert(featureFlags).values({ key, description: "verify-taste-learning", enabled })
    .onConflictDoUpdate({ target: featureFlags.key, set: { enabled, updatedAt: new Date() } });
}

const results: Array<{ name: string; ok: boolean }> = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok — ${name}`); }
  catch (error) { results.push({ name, ok: false }); console.log(`  FAIL — ${name}\n    ${error instanceof Error ? error.message : error}`); }
}

const creatorOf = (items: FeedItem[], id: string) => items.findIndex((item) => item.edit.id === `${id}-${stamp}`);

async function main() {
  await setFlag("taste_ranking", true);
  await setFlag("taste_learning", false);
  const server = await startServer();
  try {
    // Three creators. The viewer's EXPLICIT taste is Decor only, so decor
    // Edits lead at first; the viewer then behaves like a café person and
    // café Edits must rise, while gym Edits stay where they are.
    const cafe = new Session(server.baseUrl); await cafe.signup(`learn-cafe-${stamp}@example.test`);
    const gym = new Session(server.baseUrl); await gym.signup(`learn-gym-${stamp}@example.test`);
    const decor = new Session(server.baseUrl); await decor.signup(`learn-decor-${stamp}@example.test`);
    const viewer = new Session(server.baseUrl); await viewer.signup(`learn-viewer-${stamp}@example.test`);
    const other = new Session(server.baseUrl); await other.signup(`learn-other-${stamp}@example.test`);
    await cafe.saveProfile({ displayName: "Cafe Notes", username: `cafe_${stamp}`, interests: ["Restaurants"], tasteTags: ["coffee-stops", "long-lunches"] });
    await gym.saveProfile({ displayName: "Gym Log", username: `gym_${stamp}`, interests: ["HealthFitness"], tasteTags: ["strength-training", "recovery"] });
    await decor.saveProfile({ displayName: "Calm Rooms", username: `decor_${stamp}`, interests: ["Decor"], tasteTags: ["calm-interiors", "natural-light"] });
    await cafe.publish([
      edit("cafe-1", "Restaurants", "Flat white at the roaster", "The best espresso in town, then a long lunch by the harbour."),
      edit("cafe-2", "Restaurants", "Sunday brunch", "A slow brunch with friends and good coffee."),
      edit("cafe-3", "Restaurants", "Table for eight", "Linen, candles and a long table set for friends."),
    ]);
    await gym.publish([
      edit("gym-1", "HealthFitness", "Leg day", "Squats, deadlifts, five sets each."),
      edit("gym-2", "HealthFitness", "Rest day", "Mobility work and a sauna."),
    ]);
    await decor.publish([
      edit("decor-1", "Decor", "Morning light", "A calm living room in soft natural light."),
      edit("decor-2", "Decor", "Linen and oak", "Quiet textures for a bedroom."),
    ]);
    const gymWorkspaceId = (await db.select({ id: creatorWorkspaces.creatorId }).from(creatorWorkspaces).where(eq(creatorWorkspaces.ownerUserId, gym.userId)))[0].id;

    const viewerTaste = { categories: ["Decor"], tags: ["calm-interiors", "natural-light"] };
    assert.equal((await viewer.json("/api/taste-preferences", "PUT", viewerTaste)).status, 200);
    assert.equal((await other.json("/api/taste-preferences", "PUT", viewerTaste)).status, 200);

    await check("flag OFF: Home is taste-ranked but not learning, and the Not interested route is 404", async () => {
      const feed = await viewer.feed();
      assert.equal(feed.ranking, "taste");
      assert.equal(feed.learning, false);
      const ours = feed.items.filter((item) => item.creatorUsername.endsWith(stamp));
      assert.equal(ours[0].creatorUsername, `decor_${stamp}`, "explicit taste puts decor first");
      assert.equal((await viewer.json(`/api/edits/cafe-3-${stamp}/not-interested`, "POST")).status, 404);
      assert.equal(await db.$count(editDismissals, eq(editDismissals.userId, viewer.userId)), 0);
    });

    await check("flag OFF: an edit_dwell event is still only accepted with a valid shape (editId, seconds 1–60, optional surface)", async () => {
      assert.equal((await viewer.track("edit_dwell", { editId: `cafe-1-${stamp}`, seconds: 12, surface: "home" })).recorded, true);
      assert.equal((await viewer.track("edit_dwell", { editId: `cafe-1-${stamp}`, seconds: 0 })).recorded, false, "zero seconds");
      assert.equal((await viewer.track("edit_dwell", { editId: `cafe-1-${stamp}`, seconds: 61 })).recorded, false, "over the cap");
      assert.equal((await viewer.track("edit_dwell", { editId: `cafe-1-${stamp}`, seconds: 5, surface: "elsewhere" })).recorded, false, "unknown surface");
      assert.equal((await viewer.track("edit_dwell", { editId: `cafe-1-${stamp}`, seconds: 5, likeCount: 3 })).recorded, false, "no extra keys");
      assert.equal((await viewer.track("edit_dwell", { seconds: 5 })).recorded, false, "editId required");
      const anon = await fetch(`${server.baseUrl}/api/analytics/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "edit_dwell", metadata: { editId: `cafe-1-${stamp}`, seconds: 5 } }) });
      assert.equal(anon.status, 202);
      const stored = await db.select({ userId: analyticsEvents.userId, metadata: analyticsEvents.metadata }).from(analyticsEvents).where(eq(analyticsEvents.name, "edit_dwell"));
      const mine = stored.filter((row) => row.userId === viewer.userId);
      assert.equal(mine.length, 1, "exactly the one valid event was stored for the viewer");
      assert.deepEqual(mine[0].metadata, { editId: `cafe-1-${stamp}`, seconds: 12, surface: "home" });
    });

    await setFlag("taste_learning", true);

    const baselineViewer = await viewer.ours();
    const baselineOther = await other.ours();

    await check("flag ON: the feed says learning:true and, with no behaviour yet, the order equals the explicit-taste order", async () => {
      const feed = await viewer.feed();
      assert.equal(feed.learning, true);
      // One 12s dwell on cafe-1 is below the implicit threshold (needs ≥1 category and ≥2 tags with weight ≥ 1).
      assert.deepEqual(feed.items.filter((item) => item.creatorUsername.endsWith(stamp)).map((item) => item.edit.id), baselineViewer.map((item) => item.edit.id));
    });

    await check("the viewer's own save, like and follow lift café Edits above gym (decor, the explicit taste, still leads); the other member's Home is unchanged", async () => {
      assert.equal((await viewer.json(`/api/edits/cafe-1-${stamp}/save`, "PUT", { active: true })).status, 200);
      assert.equal((await viewer.json(`/api/edits/cafe-2-${stamp}/like`, "PUT", { active: true })).status, 200);
      assert.equal((await viewer.json("/api/relationships", "POST", { type: "follow", targetId: `cafe_${stamp}`, active: true })).status, 200);
      const ours = await viewer.ours();
      const cafeTop = ours.findIndex((item) => item.creatorUsername === `cafe_${stamp}`);
      const gymTop = ours.findIndex((item) => item.creatorUsername === `gym_${stamp}`);
      assert.equal(ours[0].creatorUsername, `decor_${stamp}`, "the explicit taste (decor) still leads: 60% explicit");
      assert.ok(cafeTop < gymTop, `café Edits now rank above gym (café ${cafeTop}, gym ${gymTop})`);
      const scoreOf = (id: string) => ours[creatorOf(ours, id)].matchScore ?? 0;
      assert.equal(baselineViewer[creatorOf(baselineViewer, "cafe-1")].matchScore ?? 0, 0, "before any behaviour the café Edit scored 0");
      assert.ok(scoreOf("cafe-1") > 0, `the saved café Edit now scores above 0 (${scoreOf("cafe-1")})`);
      assert.ok(ours.filter((item) => item.creatorUsername === `gym_${stamp}`).every((item) => (item.matchScore ?? 0) === 0), "gym still 0");
      assert.ok(ours[creatorOf(ours, "cafe-1")].sharedTastes!.some((taste) => taste.id === "coffee-stops"), "the learned shared taste is named");
      assert.deepEqual((await other.ours()).map((item) => item.edit.id), baselineOther.map((item) => item.edit.id), "another member's Home does not move");
    });

    await check("Not interested hides the Edit from the viewer's Home, is idempotent, and lowers Edits sharing its tags", async () => {
      const before = await viewer.ours();
      const decor1Before = before[creatorOf(before, "decor-1")].matchScore ?? 0;
      assert.ok(creatorOf(before, "decor-2") >= 0, "decor-2 is visible before");
      const first = await viewer.json(`/api/edits/decor-2-${stamp}/not-interested`, "POST");
      assert.equal(first.status, 200, await first.text());
      assert.equal((await viewer.json(`/api/edits/decor-2-${stamp}/not-interested`, "POST")).status, 200, "idempotent");
      assert.equal(await db.$count(editDismissals, and(eq(editDismissals.userId, viewer.userId), eq(editDismissals.editId, `decor-2-${stamp}`))), 1);
      const after = await viewer.ours();
      assert.equal(creatorOf(after, "decor-2"), -1, "decor-2 is gone from the viewer's Home");
      assert.ok(creatorOf(await other.ours(), "decor-2") >= 0, "still visible to another member");
      // decor-2 carried the creator's tags (calm interiors, natural light), which
      // decor-1 shares: those tags are now rejected for this viewer and decor-1 loses points.
      const decor1After = after[creatorOf(after, "decor-1")].matchScore ?? 0;
      assert.ok(decor1After < decor1Before, `decor-1 dropped from ${decor1Before} to ${decor1After}`);
      assert.ok(decor1After >= 0);
      // A second dismissal hides that Edit too.
      assert.equal((await viewer.json(`/api/edits/cafe-3-${stamp}/not-interested`, "POST")).status, 200);
      assert.equal(creatorOf(await viewer.ours(), "cafe-3"), -1);
      // The dismissed Edit's category/tags only count against the viewer.
      assert.deepEqual((await other.ours()).map((item) => item.edit.id), baselineOther.map((item) => item.edit.id));
    });

    await check("an owner cannot mark their own Edit as Not interested (400) and a stranger cannot hide an unknown Edit (404)", async () => {
      const own = await cafe.json(`/api/edits/cafe-1-${stamp}/not-interested`, "POST");
      assert.equal(own.status, 400, await own.text());
      assert.equal((await viewer.json(`/api/edits/no-such-edit-${stamp}/not-interested`, "POST")).status, 404);
      const anon = await fetch(`${server.baseUrl}/api/edits/cafe-1-${stamp}/not-interested`, { method: "POST" });
      assert.equal(anon.status, 401);
    });

    await check("the creator never sees who dismissed: nothing in their profile, insights or workspace mentions dismissals", async () => {
      for (const pathName of ["/api/creator-profile", "/api/creator-workspace", `/api/creators/decor_${stamp}`, "/api/creator-insights"]) {
        const response = await decor.request(pathName);
        const text = await response.text();
        assert.ok(!/dismiss|not.?interested/i.test(text), `${pathName} mentions dismissals`);
      }
    });

    await check("never by the numbers: thousands of likes, saves and followers from OTHER members on the gym creator do not move the viewer's order", async () => {
      const before = (await viewer.ours()).map((item) => item.edit.id);
      const fans = Array.from({ length: 300 }, (_, i) => ({ id: `lfan-${stamp}-${i}`, email: `lfan-${stamp}-${i}@example.test` }));
      await db.insert(usersTable).values(fans.map((fan) => ({ id: fan.id, email: fan.email, authProvider: "password" })));
      await db.insert(creatorFollows).values(fans.map((fan) => ({ followerUserId: fan.id, creatorId: gymWorkspaceId })));
      await db.insert(editLikes).values(fans.flatMap((fan) => [`gym-1-${stamp}`, `gym-2-${stamp}`].map((editId) => ({ editId, userId: fan.id }))));
      await db.insert(editSaves).values(fans.flatMap((fan) => [`gym-1-${stamp}`, `gym-2-${stamp}`].map((editId) => ({ editId, userId: fan.id }))));
      const after = (await viewer.ours()).map((item) => item.edit.id);
      assert.deepEqual(after, before);
      const feed = await viewer.feed();
      assert.ok(feed.items.every((item) => !("likeCount" in item) && !("followerCount" in item) && !("saveCount" in item)), "the feed payload carries no counts");
    });

    await check("account deletion removes the member's dismissals", async () => {
      assert.equal(await db.$count(editDismissals, eq(editDismissals.userId, viewer.userId)), 2);
      const response = await viewer.json("/api/me/delete-account", "POST", { confirm: "DELETE" });
      assert.equal(response.status, 200, await response.text());
      assert.equal(await db.$count(editDismissals, eq(editDismissals.userId, viewer.userId)), 0);
    });
  } finally {
    await setFlag("taste_learning", false);
    await setFlag("taste_ranking", false);
    server.process.kill();
    await db.execute(sql`select 1`).catch(() => undefined);
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length) { console.error(`\n${failed.length} of ${results.length} taste-learning checks failed.`); process.exitCode = 1; }
  else console.log(`\nAll ${results.length} taste-learning checks passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => process.exit());
