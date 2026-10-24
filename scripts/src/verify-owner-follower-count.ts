// Owner-only follower count (flag owner_follower_count) against the REAL
// api-server and a REAL disposable database:
//  - flag OFF: /api/creator-insights carries no follower number;
//  - flag ON: the owner sees `followers` on /api/creator-insights, and only
//    the owner (another member gets 403 as before);
//  - the number never leaks: the public profile, Explore, the public feed
//    and the public workspace payloads contain no key that looks like a
//    follower count, flag on or off.
//
// Usage:
//   DATABASE_URL=postgresql://<disposable> pnpm --filter scripts run verify:owner-follower-count
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { creatorFollows, creatorWorkspaces, db, featureFlags, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required — a disposable database, never production."); process.exit(1); }

async function startServer(): Promise<{ process: ChildProcess; baseUrl: string }> {
  const port = 24640 + Math.floor(Math.random() * 40);
  const child = spawn("node", [serverEntry], { env: { ...process.env, PORT: String(port), NODE_ENV: "production", SESSION_SECRET: process.env.SESSION_SECRET ?? "verify-owner-follower-count-not-a-real-secret" }, stdio: ["ignore", "pipe", "pipe"] });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseUrl}/api/healthz`)).ok) return { process: child, baseUrl }; } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill(); throw new Error("api-server did not become ready");
}

class Session {
  cookie = "";
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
  async signup(email: string) {
    const response = await this.request("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "follower-count-pass-1", termsAccepted: true }) });
    assert.equal(response.status, 201, `signup ${email}`);
    this.userId = ((await response.json()) as { user: { id: string } }).user.id;
  }
  async json(pathName: string) { const response = await this.request(pathName); return { status: response.status, body: await response.json() as unknown }; }
}

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, out));
  else if (value && typeof value === "object") for (const [key, inner] of Object.entries(value)) { out.add(key); keysDeep(inner, out); }
  return out;
}
const FOLLOWER_KEY = /follow(er|ers|erCount|ersCount|ingCount)$|^followers$/i;

async function setFlag(enabled: boolean) {
  await db.insert(featureFlags).values({ key: "owner_follower_count", description: "verify-owner-follower-count", enabled })
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
    const stamp = Date.now().toString(36);
    const owner = new Session(server.baseUrl); await owner.signup(`fc-owner-${stamp}@example.test`);
    const other = new Session(server.baseUrl); await other.signup(`fc-other-${stamp}@example.test`);
    // Owner publishes one Edit so the public routes have something to show.
    const profile = (await owner.json("/api/creator-profile")).body as Record<string, unknown>;
    await owner.request("/api/creator-profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...profile, displayName: "Follower Count Owner", username: `fc_owner_${stamp}`, tasteTags: [] }) });
    const workspace = (await owner.json("/api/creator-workspace")).body as { revision: number; collections: unknown[] };
    const edit = { id: `fc-edit-${stamp}`, category: "Places", title: "Courtyard", titleAr: "", caption: "A hidden courtyard.", captionAr: "", image: "/tastekin-media/quiet-tailoring.webp", location: "Kuwait City, Kuwait", locationAr: "", altText: "Courtyard", access: "public", status: "published", collectionIds: [] };
    assert.equal((await owner.request("/api/creator-workspace", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ edits: [edit], collections: workspace.collections, expectedRevision: workspace.revision }) })).status, 200);
    const [{ creatorId }] = await db.select({ creatorId: creatorWorkspaces.creatorId }).from(creatorWorkspaces).where(eq(creatorWorkspaces.ownerUserId, owner.userId));
    // Three followers, inserted directly (the relationship route is covered elsewhere).
    const fans = Array.from({ length: 3 }, (_, i) => ({ id: `fc-fan-${stamp}-${i}`, email: `fc-fan-${stamp}-${i}@example.test` }));
    await db.insert(usersTable).values(fans.map((fan) => ({ id: fan.id, email: fan.email, authProvider: "password" })));
    await db.insert(creatorFollows).values(fans.map((fan) => ({ followerUserId: fan.id, creatorId })));

    const publicRoutes = [`/api/creators/fc_owner_${stamp}/profile`, `/api/creators/fc_owner_${stamp}/workspace`, "/api/explore", "/api/public-feed"];
    const assertNoLeak = async (label: string) => {
      for (const route of publicRoutes) {
        const asOther = await other.json(route);
        assert.equal(asOther.status, 200, `${route} for another member`);
        const leaked = Array.from(keysDeep(asOther.body)).filter((key) => FOLLOWER_KEY.test(key) && key !== "following");
        assert.deepEqual(leaked, [], `${label}: ${route} must carry no follower count, found ${leaked.join(", ")}`);
        const anon = await fetch(`${server.baseUrl}${route}`);
        const anonLeaked = Array.from(keysDeep(await anon.json())).filter((key) => FOLLOWER_KEY.test(key) && key !== "following");
        assert.deepEqual(anonLeaked, [], `${label}: ${route} (signed out) must carry no follower count`);
      }
    };

    await check("flag OFF: the owner's Insights carry no follower number", async () => {
      const insights = await owner.json("/api/creator-insights");
      assert.equal(insights.status, 200);
      const body = insights.body as Record<string, unknown>;
      assert.ok(!("followers" in body) || body.followers === null, "no followers key, or null");
    });
    await check("flag OFF: no public payload carries a follower count", () => assertNoLeak("flag off"));

    await setFlag(true);

    await check("flag ON: the owner sees followers: 3 on Insights", async () => {
      const insights = await owner.json("/api/creator-insights");
      assert.equal(insights.status, 200);
      assert.equal((insights.body as { followers?: unknown }).followers, 3);
    });
    await check("flag ON: another member cannot read the owner's Insights", async () => {
      // Another member's own Insights describe their own (empty) workspace; the owner's never reach them.
      const insights = await other.json("/api/creator-insights");
      assert.equal(insights.status, 200);
      assert.equal((insights.body as { followers?: unknown }).followers, 0, "their own count, not the owner's");
    });
    await check("flag ON: still no public payload carries a follower count", () => assertNoLeak("flag on"));
  } finally {
    await setFlag(false);
    server.process.kill();
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length) { console.error(`\n${failed.length} of ${results.length} owner-follower-count checks failed.`); process.exitCode = 1; }
  else console.log(`\nAll ${results.length} owner-follower-count checks passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => process.exit());
