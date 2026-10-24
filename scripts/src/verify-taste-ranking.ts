// Taste-ranked Home (feature flag taste_ranking) against the REAL api-server
// and a REAL disposable database:
//  - creators pick taste tags on their profile (PUT /api/creator-profile),
//    unknown ids are dropped, the list is capped, GET returns them;
//  - flag OFF: /api/public-feed is newest-first and carries no scores;
//  - flag ON: a viewer with a complete taste profile gets taste order
//    (score desc, recency tiebreak, no creator twice in a row), each item
//    carries matchScore + sharedTastes; a viewer without a profile and a
//    signed-out visitor still get newest-first;
//  - "never by the numbers": thousands of likes, saves and followers on
//    the low-taste creator do not move the order by one place;
//  - Taste Match for a real creator with no picked tags is no longer
//    capped at 35% (tags inferred from their Edits' words).
//
// Usage:
//   DATABASE_URL=postgresql://<disposable> pnpm --filter scripts run verify:taste-ranking
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { creatorFollows, creatorWorkspaces, db, editLikes, editSaves, featureFlags, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

type Server = { process: ChildProcess; baseUrl: string };
async function startServer(): Promise<Server> {
  const port = 24520 + Math.floor(Math.random() * 40);
  const child = spawn("node", [serverEntry], { env: { ...process.env, PORT: String(port), NODE_ENV: "production", SESSION_SECRET: process.env.SESSION_SECRET ?? "verify-taste-ranking-not-a-real-secret" }, stdio: ["ignore", "pipe", "pipe"] });
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
    const response = await this.json("/api/auth/signup", "POST", { email, password: "taste-ranking-pass-1", termsAccepted: true });
    assert.equal(response.status, 201, `signup ${email}`);
    this.userId = ((await response.json()) as { user: { id: string } }).user.id;
  }
  async profile() { return (await this.request("/api/creator-profile")).json() as Promise<Record<string, unknown>>; }
  async saveProfile(patch: Record<string, unknown>) {
    const current = await this.profile();
    const body = { displayName: current.displayName, username: current.username, bio: current.bio, city: current.city, country: current.country, interests: current.interests, dateOfBirth: current.dateOfBirth, showAge: current.showAge, avatarObjectPath: current.avatarObjectPath, coverImageObjectPath: current.coverImageObjectPath, ...patch };
    return this.json("/api/creator-profile", "PUT", body);
  }
  async workspace() { return (await this.request("/api/creator-workspace")).json() as Promise<{ revision: number; edits: unknown[]; collections: unknown[] }>; }
  async publish(edits: unknown[]) {
    const current = await this.workspace();
    const response = await this.json("/api/creator-workspace", "PUT", { edits, collections: current.collections, expectedRevision: current.revision });
    assert.equal(response.status, 200, `publish: ${await response.text()}`);
  }
  async feed() { return (await this.request("/api/public-feed")).json() as Promise<{ ranking: string; items: Array<{ creatorUsername: string; matchScore?: number | null; sharedTastes?: Array<{ id: string }>; edit: { id: string } }> }>; }
}

const stamp = Date.now().toString(36);
const edit = (id: string, category: string, title: string, caption: string, titleAr = "", captionAr = "") => ({
  id: `${id}-${stamp}`, category, title, titleAr, caption, captionAr,
  image: "/tastekin-media/quiet-tailoring.webp", location: "Kuwait City, Kuwait", locationAr: "مدينة الكويت، الكويت", altText: title,
  access: "public", status: "published", collectionIds: [],
});

async function setFlag(enabled: boolean) {
  await db.insert(featureFlags).values({ key: "taste_ranking", description: "verify-taste-ranking", enabled })
    .onConflictDoUpdate({ target: featureFlags.key, set: { enabled, updatedAt: new Date() } });
}

const results: Array<{ name: string; ok: boolean }> = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok — ${name}`); }
  catch (error) { results.push({ name, ok: false }); console.log(`  FAIL — ${name}\n    ${error instanceof Error ? error.message : error}`); }
}

async function main() {
  await setFlag(false);
  const server = await startServer();
  try {
    // Two creators. "cafe" publishes café/lunch Edits and picks no tags at
    // all; "gym" publishes training Edits. The viewer loves cafés.
    const cafe = new Session(server.baseUrl); await cafe.signup(`taste-cafe-${stamp}@example.test`);
    const gym = new Session(server.baseUrl); await gym.signup(`taste-gym-${stamp}@example.test`);
    const viewer = new Session(server.baseUrl); await viewer.signup(`taste-viewer-${stamp}@example.test`);
    const blank = new Session(server.baseUrl); await blank.signup(`taste-blank-${stamp}@example.test`);
    await cafe.saveProfile({ displayName: "Cafe Notes", username: `cafe_${stamp}`, interests: ["Restaurants"] });
    await gym.saveProfile({ displayName: "Gym Log", username: `gym_${stamp}`, interests: ["HealthFitness"] });
    // gym publishes LAST so newest-first puts gym on top.
    await cafe.publish([
      edit("cafe-1", "Restaurants", "Flat white at the roaster", "The best espresso in town, then a long lunch by the harbour.", "", "قهوة في المحمصة ثم غداء طويل"),
      edit("cafe-2", "Restaurants", "Sunday brunch", "A slow brunch with friends and good coffee."),
    ]);
    await gym.publish([
      edit("gym-1", "HealthFitness", "Leg day", "Squats, deadlifts, five sets each."),
      edit("gym-2", "HealthFitness", "Rest day", "Mobility work and a sauna."),
    ]);
    const cafeWorkspaceId = (await db.select({ id: creatorWorkspaces.creatorId }).from(creatorWorkspaces).where(eq(creatorWorkspaces.ownerUserId, cafe.userId)))[0].id;
    const gymWorkspaceId = (await db.select({ id: creatorWorkspaces.creatorId }).from(creatorWorkspaces).where(eq(creatorWorkspaces.ownerUserId, gym.userId)))[0].id;
    void cafeWorkspaceId;

    await check("creators can pick taste tags on their profile; unknown ids are dropped and the list is capped at 8", async () => {
      const saved = await gym.saveProfile({ tasteTags: ["strength-training", "recovery", "not-a-tag", "wellbeing", "strength-training"] });
      assert.equal(saved.status, 200, await saved.text());
      assert.deepEqual((await gym.profile()).tasteTags, ["wellbeing", "strength-training", "recovery"]);
      const tooMany = await gym.saveProfile({ tasteTags: ["quiet-luxury", "tailoring", "neutral-layers", "everyday-uniforms", "slow-travel", "coastal-escapes", "packing-notes", "city-guides", "hidden-gems", "architecture"] });
      assert.equal(tooMany.status, 400, "more than 8 is refused by the schema");
      await gym.saveProfile({ tasteTags: ["strength-training", "recovery"] });
    });

    await check("a profile save without tasteTags (older client) keeps the previous tags", async () => {
      const current = await gym.profile();
      const { tasteTags: _omit, ...withoutTags } = { displayName: current.displayName, username: current.username, bio: current.bio, city: current.city, country: current.country, interests: current.interests, dateOfBirth: current.dateOfBirth, showAge: current.showAge, avatarObjectPath: current.avatarObjectPath, coverImageObjectPath: current.coverImageObjectPath, tasteTags: null };
      void _omit;
      assert.equal((await gym.json("/api/creator-profile", "PUT", withoutTags)).status, 200);
      assert.deepEqual((await gym.profile()).tasteTags, ["strength-training", "recovery"]);
    });

    const viewerTaste = { categories: ["Restaurants"], tags: ["coffee-stops", "long-lunches"] };
    assert.equal((await viewer.json("/api/taste-preferences", "PUT", viewerTaste)).status, 200);

    await check("flag OFF: Home is newest-first with no scores, even for a viewer with a complete taste profile", async () => {
      const feed = await viewer.feed();
      assert.equal(feed.ranking, "recency");
      const ours = feed.items.filter((item) => item.creatorUsername.endsWith(stamp));
      assert.deepEqual(ours.map((item) => item.creatorUsername), [`gym_${stamp}`, `gym_${stamp}`, `cafe_${stamp}`, `cafe_${stamp}`]);
      assert.ok(ours.every((item) => item.matchScore === undefined && item.sharedTastes === undefined));
    });

    await setFlag(true);

    await check("flag ON: the viewer's Home is ordered by taste with a creator-diversity pass, and items carry matchScore + sharedTastes", async () => {
      const feed = await viewer.feed();
      assert.equal(feed.ranking, "taste");
      const ours = feed.items.filter((item) => item.creatorUsername.endsWith(stamp));
      assert.equal(ours[0].creatorUsername, `cafe_${stamp}`, "a café Edit comes first");
      assert.ok((ours[0].matchScore ?? 0) > 50, `top café Edit scores above 50, got ${ours[0].matchScore}`);
      assert.ok(ours[0].sharedTastes!.some((taste) => taste.id === "coffee-stops"), "shared taste names coffee stops");
      const gymItems = ours.filter((item) => item.creatorUsername === `gym_${stamp}`);
      assert.ok(gymItems.every((item) => (item.matchScore ?? 0) === 0), "gym Edits score 0 for this viewer");
      // Diversity: with two creators the sequence alternates while both have items left.
      for (let i = 1; i < ours.length; i += 1) {
        if (ours[i].creatorUsername === ours[i - 1].creatorUsername) {
          const remaining = ours.slice(i).some((item) => item.creatorUsername !== ours[i - 1].creatorUsername);
          assert.equal(remaining, false, `same creator twice in a row at ${i} while another creator still had Edits`);
        }
      }
    });

    await check("flag ON: a viewer without a complete taste profile and a signed-out visitor still get newest-first", async () => {
      const blankFeed = await blank.feed();
      assert.equal(blankFeed.ranking, "recency");
      const anon = await (await fetch(`${server.baseUrl}/api/public-feed`)).json() as { ranking: string };
      assert.equal(anon.ranking, "recency");
    });

    await check("never by the numbers: thousands of likes, saves and followers on the gym creator do not move the order", async () => {
      const before = (await viewer.feed()).items.filter((item) => item.creatorUsername.endsWith(stamp)).map((item) => item.edit.id);
      const fans = Array.from({ length: 300 }, (_, i) => ({ id: `fan-${stamp}-${i}`, email: `fan-${stamp}-${i}@example.test` }));
      await db.insert(usersTable).values(fans.map((fan) => ({ id: fan.id, email: fan.email, authProvider: "password" })));
      await db.insert(creatorFollows).values(fans.map((fan) => ({ followerUserId: fan.id, creatorId: gymWorkspaceId })));
      await db.insert(editLikes).values(fans.flatMap((fan) => [`gym-1-${stamp}`, `gym-2-${stamp}`].map((editId) => ({ editId, userId: fan.id }))));
      await db.insert(editSaves).values(fans.flatMap((fan) => [`gym-1-${stamp}`, `gym-2-${stamp}`].map((editId) => ({ editId, userId: fan.id }))));
      const after = (await viewer.feed()).items.filter((item) => item.creatorUsername.endsWith(stamp)).map((item) => item.edit.id);
      assert.deepEqual(after, before);
      const feed = await viewer.feed();
      assert.ok(feed.items.every((item) => !("likeCount" in item) && !("followerCount" in item) && !("saveCount" in item)), "the feed payload carries no counts");
    });

    await check("Taste Match for a creator with no picked tags rises above 35% from the words in their Edits", async () => {
      const explore = await (await viewer.request("/api/explore")).json() as { creators: Array<{ username: string; matchScore: number | null; sharedTastes: Array<{ id: string }> }> };
      const cafeCreator = explore.creators.find((creator) => creator.username === `cafe_${stamp}`);
      assert.ok(cafeCreator, "café creator is in Explore");
      assert.ok((cafeCreator!.matchScore ?? 0) > 35, `expected > 35, got ${cafeCreator!.matchScore}`);
      assert.ok(cafeCreator!.sharedTastes.some((taste) => taste.id === "coffee-stops"));
      const gymCreator = explore.creators.find((creator) => creator.username === `gym_${stamp}`);
      assert.equal(gymCreator?.matchScore, 0);
    });
  } finally {
    await setFlag(false);
    server.process.kill();
    await db.execute(sql`select 1`).catch(() => undefined);
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length) { console.error(`\n${failed.length} of ${results.length} taste-ranking checks failed.`); process.exitCode = 1; }
  else console.log(`\nAll ${results.length} taste-ranking checks passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => process.exit());
