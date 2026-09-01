// Automated regression coverage for user blocking. Runs the compiled
// api-server against a REAL Postgres database (point DATABASE_URL at a
// disposable/test database — this creates real rows) and drives it over
// real HTTP, so it exercises the actual route/middleware code path rather
// than a reimplementation.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:blocks
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { creatorFollows, creatorWorkspaces, db, userBlocks } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

let nextPort = 24500;

type Server = { port: number; process: ChildProcess; baseUrl: string };

async function startServer(): Promise<Server> {
  const port = nextPort;
  nextPort += 1;
  const env: Record<string, string | undefined> = { ...process.env, PORT: String(port), NODE_ENV: "production" };
  const child = spawn("node", [serverEntry], { env, stdio: ["ignore", "pipe", "pipe"] });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/version`);
      if (response.ok) return { port, process: child, baseUrl };
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`Server on port ${port} did not become ready in time`);
}

function stopServer(server: Server) {
  server.process.kill();
}

async function expectStatus(response: Response, expected: number) {
  if (response.status !== expected) {
    const text = await response.text().catch(() => "");
    throw new Error(`expected status ${expected}, got ${response.status}: ${text}`);
  }
}

// --- tiny per-user cookie jar over fetch, since Node's fetch has none ---
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
  async ensureWorkspace() {
    const workspaceResponse = await this.request("/api/creator-workspace");
    await expectStatus(workspaceResponse, 200);
    const workspace = (await workspaceResponse.json()) as { creatorId: string };
    const profileResponse = await this.request("/api/creator-profile");
    await expectStatus(profileResponse, 200);
    const profile = (await profileResponse.json()) as { username: string };
    return { creatorId: workspace.creatorId, username: profile.username };
  }
  async follow(targetUsername: string, active: boolean) {
    return this.request("/api/relationships", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "follow", targetId: targetUsername, active }),
    });
  }
  async block(username: string) {
    return this.request("/api/blocks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }) });
  }
  async unblock(username: string) {
    return this.request(`/api/blocks/${encodeURIComponent(username)}`, { method: "DELETE" });
  }
  async listBlocks() {
    return this.request("/api/blocks");
  }
  async report(body: Record<string, unknown>) {
    return this.request("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
}

async function addPublicEdit(creatorId: string, editId: string) {
  const [workspace] = await db.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, creatorId));
  const existing = (workspace?.edits as unknown[]) ?? [];
  await db.update(creatorWorkspaces).set({ edits: [...existing, { id: editId, status: "published", access: "public", title: "A public Edit" }], updatedAt: new Date() })
    .where(eq(creatorWorkspaces.creatorId, creatorId));
}

async function followRowExists(followerUserId: string, creatorId: string) {
  const [row] = await db.select({ followerUserId: creatorFollows.followerUserId }).from(creatorFollows)
    .where(and(eq(creatorFollows.followerUserId, followerUserId), eq(creatorFollows.creatorId, creatorId))).limit(1);
  return Boolean(row);
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
  const server = await startServer();
  try {
    const a = new Session(server.baseUrl);
    const aAccount = await a.signup(`blocker-${suffix}@example.com`, PASSWORD);
    const aWorkspace = await a.ensureWorkspace();
    const aEditId = `edit-${suffix}-a`;
    await addPublicEdit(aWorkspace.creatorId, aEditId);

    const b = new Session(server.baseUrl);
    const bAccount = await b.signup(`blocked-${suffix}@example.com`, PASSWORD);
    const bWorkspace = await b.ensureWorkspace();
    const bEditId = `edit-${suffix}-b`;
    await addPublicEdit(bWorkspace.creatorId, bEditId);

    // A third, uninvolved user — used to prove blocking A<->B never affects
    // C's own ability to see either of them, and that the Report system
    // still works normally for an unrelated pair.
    const c = new Session(server.baseUrl);
    await c.signup(`bystander-${suffix}@example.com`, PASSWORD);

    // --- 0. baseline: mutual follows exist before any block ---
    await expectStatus(await a.follow(bWorkspace.username, true), 200);
    await expectStatus(await b.follow(aWorkspace.username, true), 200);
    await check("baseline: both follow relationships exist before blocking", async () => {
      assert.ok(await followRowExists(aAccount.user.id, bWorkspace.creatorId), "A should follow B");
      assert.ok(await followRowExists(bAccount.user.id, aWorkspace.creatorId), "B should follow A");
    });

    // --- 1. authentication ---
    await check("unauthenticated POST /api/blocks is rejected with 401", async () => {
      const anon = new Session(server.baseUrl);
      assert.equal((await anon.block(bWorkspace.username)).status, 401);
    });
    await check("unauthenticated GET /api/blocks is rejected with 401", async () => {
      const anon = new Session(server.baseUrl);
      assert.equal((await anon.listBlocks()).status, 401);
    });

    // --- 2. self-block prevention ---
    await check("a user cannot block themselves", async () => {
      const response = await a.block(aWorkspace.username);
      assert.equal(response.status, 400);
    });

    // --- 3. IDOR/BOLA: blocking a nonexistent account ---
    await check("blocking a nonexistent username returns a generic 404", async () => {
      const response = await a.block(`nobody-${suffix}`);
      assert.equal(response.status, 404);
    });

    // --- 4. create the block ---
    await check("a signed-in user can block another user", async () => {
      const response = await a.block(bWorkspace.username);
      await expectStatus(response, 201);
      const [row] = await db.select().from(userBlocks).where(and(eq(userBlocks.blockerUserId, aAccount.user.id), eq(userBlocks.blockedUserId, bAccount.user.id)));
      assert.ok(row, "a userBlocks row should exist");
    });

    // --- 5. duplicate / idempotency ---
    await check("blocking the same user again is safe and creates no duplicate row", async () => {
      const response = await a.block(bWorkspace.username);
      assert.ok(response.status === 200 || response.status === 201, `expected a safe 2xx, got ${response.status}`);
      const rows = await db.select().from(userBlocks).where(and(eq(userBlocks.blockerUserId, aAccount.user.id), eq(userBlocks.blockedUserId, bAccount.user.id)));
      assert.equal(rows.length, 1, "repeated blocks must not create duplicate rows");
    });

    // --- 6. existing follows removed in both directions ---
    await check("blocking removes the existing follow relationship in both directions", async () => {
      assert.equal(await followRowExists(aAccount.user.id, bWorkspace.creatorId), false, "A's follow of B must be removed");
      assert.equal(await followRowExists(bAccount.user.id, aWorkspace.creatorId), false, "B's follow of A must be removed");
    });

    // --- 7. profile, workspace, and featured-collections disappear (both directions) ---
    await check("the blocked user's profile is not visible to the blocker (404)", async () => {
      assert.equal((await a.request(`/api/creators/${encodeURIComponent(bWorkspace.username)}/profile`)).status, 404);
    });
    await check("the blocker's profile is not visible to the blocked user either (mutual)", async () => {
      assert.equal((await b.request(`/api/creators/${encodeURIComponent(aWorkspace.username)}/profile`)).status, 404);
    });
    await check("the blocked user's workspace/content listing is not visible to the blocker (404)", async () => {
      assert.equal((await a.request(`/api/creators/${encodeURIComponent(bWorkspace.username)}/workspace`)).status, 404);
    });
    await check("the blocked user's featured collections are not visible to the blocker (404)", async () => {
      assert.equal((await a.request(`/api/creators/${encodeURIComponent(bWorkspace.username)}/featured-collections`)).status, 404);
    });
    await check("a bystander (uninvolved third user) can still see both A and B normally", async () => {
      assert.equal((await c.request(`/api/creators/${encodeURIComponent(aWorkspace.username)}/profile`)).status, 200);
      assert.equal((await c.request(`/api/creators/${encodeURIComponent(bWorkspace.username)}/profile`)).status, 200);
    });

    // --- 8. feed, search, explore, taste-match ---
    await check("a blocked user's content disappears from the blocker's public feed", async () => {
      const response = await a.request("/api/public-feed");
      await expectStatus(response, 200);
      const payload = await response.json() as { items: Array<{ creatorUsername: string }> };
      assert.ok(!payload.items.some((item) => item.creatorUsername === bWorkspace.username), "B's edits must not appear in A's feed");
    });
    await check("a blocked user disappears from the blocker's creator search results", async () => {
      const response = await a.request("/api/creators");
      await expectStatus(response, 200);
      const payload = await response.json() as Array<{ username: string }>;
      assert.ok(!payload.some((item) => item.username === bWorkspace.username), "B must not appear in A's /api/creators search");
    });
    await check("direct single-creator lookup for a blocked user returns 404", async () => {
      assert.equal((await a.request(`/api/creators/${encodeURIComponent(bWorkspace.username)}`)).status, 404);
    });
    await check("a blocked user disappears from the blocker's Explore results", async () => {
      const response = await a.request("/api/explore");
      await expectStatus(response, 200);
      const payload = await response.json() as { creators: Array<{ username: string }> };
      assert.ok(!payload.creators.some((item) => item.username === bWorkspace.username), "B must not appear in A's Explore results");
    });
    await check("taste-match with a blocked user returns 404", async () => {
      assert.equal((await a.request(`/api/taste-match/${encodeURIComponent(bWorkspace.username)}`)).status, 404);
    });

    // --- 9. interactions rejected in both directions ---
    // These Edits genuinely exist (unlike the profile/feed/search cases
    // above, which collapse missing-vs-blocked into one 404), so they follow
    // the engagement routes' own established convention: 403 "not available
    // to this account" — the exact same response already used for
    // subscriber-locked content, so a block is indistinguishable from that.
    await check("the blocked user cannot like the blocker's Edit (403, same shape as locked content)", async () => {
      const response = await b.request(`/api/edits/${encodeURIComponent(aEditId)}/like`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: true }) });
      assert.equal(response.status, 403);
    });
    await check("the blocker cannot like the blocked user's Edit (403, same shape as locked content)", async () => {
      const response = await a.request(`/api/edits/${encodeURIComponent(bEditId)}/like`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: true }) });
      assert.equal(response.status, 403);
    });
    await check("the blocked user cannot comment on the blocker's Edit (403)", async () => {
      const response = await b.request(`/api/edits/${encodeURIComponent(aEditId)}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "hi" }) });
      assert.equal(response.status, 403);
    });
    await check("the blocked user cannot save the blocker's Edit (403)", async () => {
      const response = await b.request(`/api/edits/${encodeURIComponent(aEditId)}/save`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: true }) });
      assert.equal(response.status, 403);
    });
    await check("the blocked user cannot read the blocker's Edit engagement (403)", async () => {
      const response = await b.request(`/api/edits/${encodeURIComponent(aEditId)}/engagement`);
      assert.equal(response.status, 403);
    });
    await check("the blocked user cannot follow the blocker (and the reverse)", async () => {
      assert.equal((await b.follow(aWorkspace.username, true)).status, 404);
      assert.equal((await a.follow(bWorkspace.username, true)).status, 404);
    });
    await check("recording a profile view against a blocked account returns 404", async () => {
      const response = await b.request(`/api/creators/${encodeURIComponent(aWorkspace.username)}/views`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ editId: null }) });
      assert.equal(response.status, 404);
    });
    await check("starting a conversation with a blocked account returns 404", async () => {
      const response = await a.request("/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorUsername: bWorkspace.username }) });
      assert.equal(response.status, 404);
    });

    // --- 10. blocking never touches subscriptions/payments (nothing to assert
    // against here since none exist yet in this codebase — documented as a
    // no-op guarantee: block only ever deletes from creatorFollows). ---
    await check("blocking only ever removed rows from creatorFollows, never from creatorWorkspaces", async () => {
      const [aRow] = await db.select({ creatorId: creatorWorkspaces.creatorId }).from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, aWorkspace.creatorId));
      const [bRow] = await db.select({ creatorId: creatorWorkspaces.creatorId }).from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, bWorkspace.creatorId));
      assert.ok(aRow && bRow, "both creator workspaces must still exist untouched");
    });

    // --- 11. reporter privacy / Report system unaffected ---
    await check("the merged Report system still works normally for an unrelated (unblocked) pair", async () => {
      const response = await c.report({ targetType: "edit", targetId: aEditId, reason: "spam" });
      assert.equal(response.status, 201, await response.text().catch(() => ""));
    });
    await check("reporting a blocked user's profile is not possible once blocked (collapses to the same generic 404)", async () => {
      const response = await a.report({ targetType: "profile", targetId: bWorkspace.username, reason: "spam" });
      assert.equal(response.status, 404);
    });
    await check("GET /api/blocks never reveals who has blocked the caller, only who the caller has blocked", async () => {
      const bListResponse = await b.listBlocks();
      await expectStatus(bListResponse, 200);
      const bPayload = await bListResponse.json() as { blocks: Array<{ username: string | null }> };
      assert.equal(bPayload.blocks.length, 0, "B never blocked anyone, so B's own block list must be empty — even though A blocked B");

      const aListResponse = await a.listBlocks();
      await expectStatus(aListResponse, 200);
      const aPayload = await aListResponse.json() as { blocks: Array<{ username: string | null }> };
      assert.ok(aPayload.blocks.some((row) => row.username === bWorkspace.username), "A's own block list must include B");
    });

    // --- 12. unblock ---
    await check("unblocking a user that was never blocked is safe (idempotent)", async () => {
      const response = await c.unblock(bWorkspace.username);
      assert.ok(response.status === 200 || response.status === 204, `expected a safe 2xx, got ${response.status}`);
    });
    await check("unblocking restores profile visibility and interaction", async () => {
      const response = await a.unblock(bWorkspace.username);
      await expectStatus(response, 200);
      const [row] = await db.select().from(userBlocks).where(and(eq(userBlocks.blockerUserId, aAccount.user.id), eq(userBlocks.blockedUserId, bAccount.user.id)));
      assert.equal(row, undefined, "the userBlocks row must be gone after unblocking");

      assert.equal((await a.request(`/api/creators/${encodeURIComponent(bWorkspace.username)}/profile`)).status, 200, "A should see B's profile again");
      assert.equal((await b.request(`/api/creators/${encodeURIComponent(aWorkspace.username)}/profile`)).status, 200, "B should see A's profile again (mutual)");

      const likeResponse = await b.request(`/api/edits/${encodeURIComponent(aEditId)}/like`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: true }) });
      assert.equal(likeResponse.status, 200, "B should be able to like A's Edit again after unblocking");
    });
    await check("unblocking does not restore the previous follow relationship", async () => {
      assert.equal(await followRowExists(aAccount.user.id, bWorkspace.creatorId), false, "A's old follow of B must stay gone");
      assert.equal(await followRowExists(bAccount.user.id, aWorkspace.creatorId), false, "B's old follow of A must stay gone");
    });
    await check("a fresh follow works normally again after unblocking", async () => {
      const response = await a.follow(bWorkspace.username, true);
      await expectStatus(response, 200);
      assert.ok(await followRowExists(aAccount.user.id, bWorkspace.creatorId));
    });
  } finally {
    stopServer(server);
  }

  console.log("\nResults:");
  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`  ${result.ok ? "PASS" : "FAIL"} — ${result.name}`);
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} checks failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} block regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
