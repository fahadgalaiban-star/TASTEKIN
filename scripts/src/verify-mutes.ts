// Automated regression coverage for user muting. Runs the compiled
// api-server against a REAL Postgres database (point DATABASE_URL at a
// disposable/test database — this creates real rows) and drives it over
// real HTTP, so it exercises the actual route/middleware code path rather
// than a reimplementation.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:mutes
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { creatorWorkspaces, db, userMutes } from "@workspace/db";
import { and, eq } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

let nextPort = 24700;

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
    const profile = (await profileResponse.json()) as { username: string; displayName: string };
    return { creatorId: workspace.creatorId, username: profile.username, displayName: profile.displayName };
  }
  async mute(username: string) {
    return this.request("/api/mutes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }) });
  }
  async unmute(username: string) {
    return this.request(`/api/mutes/${encodeURIComponent(username)}`, { method: "DELETE" });
  }
  async muteStatus(username: string) {
    const response = await this.request(`/api/mutes/status/${encodeURIComponent(username)}`);
    await expectStatus(response, 200);
    return (await response.json()) as { muted: boolean };
  }
  async listMutes() {
    const response = await this.request("/api/mutes");
    await expectStatus(response, 200);
    return (await response.json()) as { mutes: Array<{ id: string; username: string | null }> };
  }
  async block(username: string) {
    return this.request("/api/blocks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }) });
  }
  async follow(targetUsername: string, active: boolean) {
    return this.request("/api/relationships", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "follow", targetId: targetUsername, active }),
    });
  }
  async report(body: Record<string, unknown>) {
    return this.request("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  async postComment(editId: string, body: string) {
    const response = await this.request(`/api/edits/${encodeURIComponent(editId)}/comments`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }),
    });
    await expectStatus(response, 201);
    return (await response.json()) as { id: string };
  }
  async listComments(editId: string) {
    const response = await this.request(`/api/edits/${encodeURIComponent(editId)}/comments`);
    await expectStatus(response, 200);
    return (await response.json()) as Array<{ id: string; body: string }>;
  }
  async engagement(editId: string) {
    const response = await this.request(`/api/edits/${encodeURIComponent(editId)}/engagement`);
    await expectStatus(response, 200);
    return (await response.json()) as { commentCount: number };
  }
  async publicFeedUsernames() {
    const response = await this.request("/api/public-feed");
    await expectStatus(response, 200);
    const payload = (await response.json()) as { items: Array<{ creatorUsername: string }> };
    return new Set(payload.items.map((item) => item.creatorUsername));
  }
  async exploreUsernames(query?: string) {
    const response = await this.request(`/api/explore${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    await expectStatus(response, 200);
    const payload = (await response.json()) as { creators: Array<{ username: string }> };
    return new Set(payload.creators.map((item) => item.username));
  }
}

async function addPublicEdit(creatorId: string, editId: string) {
  const [workspace] = await db.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, creatorId));
  const existing = (workspace?.edits as unknown[]) ?? [];
  const edit = {
    id: editId, status: "published", access: "public", category: "Fashion",
    title: "A public Edit", titleAr: "تعديل عام", caption: "", captionAr: "",
    location: "", locationAr: "", altText: "A public Edit", collectionIds: [],
  };
  await db.update(creatorWorkspaces).set({ edits: [...existing, edit], updatedAt: new Date() })
    .where(eq(creatorWorkspaces.creatorId, creatorId));
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
    const a = new Session(server.baseUrl); // the muter
    const aAccount = await a.signup(`muter-${suffix}@example.com`, PASSWORD);
    const aWorkspace = await a.ensureWorkspace();
    const aEditId = `edit-${suffix}-a`;
    await addPublicEdit(aWorkspace.creatorId, aEditId);

    const b = new Session(server.baseUrl); // the muted account
    const bAccount = await b.signup(`muted-${suffix}@example.com`, PASSWORD);
    const bWorkspace = await b.ensureWorkspace();
    const bEditId = `edit-${suffix}-b`;
    await addPublicEdit(bWorkspace.creatorId, bEditId);

    // A third, uninvolved creator whose Edit both A and B comment on, used to
    // prove third-party comment filtering is one-directional and doesn't
    // affect an unrelated viewer.
    const c = new Session(server.baseUrl);
    await c.signup(`bystander-${suffix}@example.com`, PASSWORD);
    const cWorkspace = await c.ensureWorkspace();
    const cEditId = `edit-${suffix}-c`;
    await addPublicEdit(cWorkspace.creatorId, cEditId);

    // A fully unrelated fourth viewer — never mutes or is muted by anyone.
    const d = new Session(server.baseUrl);
    await d.signup(`unrelated-${suffix}@example.com`, PASSWORD);

    const aCommentOnC = await a.postComment(cEditId, "A's comment on a third party's post");
    const bCommentOnC = await b.postComment(cEditId, "B's comment on a third party's post");

    // --- 1. authentication ---
    await check("unauthenticated POST /api/mutes is rejected with 401", async () => {
      const anon = new Session(server.baseUrl);
      assert.equal((await anon.mute(bWorkspace.username)).status, 401);
    });
    await check("unauthenticated GET /api/mutes is rejected with 401", async () => {
      const anon = new Session(server.baseUrl);
      assert.equal((await anon.request("/api/mutes")).status, 401);
    });

    // --- 2. self-mute prevention ---
    await check("a user cannot mute themselves", async () => {
      assert.equal((await a.mute(aWorkspace.username)).status, 400);
    });

    // --- 3. IDOR/BOLA ---
    await check("muting a nonexistent username returns a generic 404", async () => {
      assert.equal((await a.mute(`nobody-${suffix}`)).status, 404);
    });

    // --- 4. create the mute ---
    await check("a signed-in user can mute another user", async () => {
      const response = await a.mute(bWorkspace.username);
      await expectStatus(response, 201);
      const [row] = await db.select().from(userMutes).where(and(eq(userMutes.muterUserId, aAccount.user.id), eq(userMutes.mutedUserId, bAccount.user.id)));
      assert.ok(row, "a userMutes row should exist");
    });
    await check("mute status reflects the new mute for the muter", async () => {
      assert.equal((await a.muteStatus(bWorkspace.username)).muted, true);
    });

    // --- 5. duplicate / idempotency ---
    await check("muting the same user again is safe and creates no duplicate row", async () => {
      const response = await a.mute(bWorkspace.username);
      assert.ok(response.status === 200 || response.status === 201, `expected a safe 2xx, got ${response.status}`);
      const rows = await db.select().from(userMutes).where(and(eq(userMutes.muterUserId, aAccount.user.id), eq(userMutes.mutedUserId, bAccount.user.id)));
      assert.equal(rows.length, 1, "repeated mutes must not create duplicate rows");
    });

    // --- 6. one-directional visibility ---
    await check("the muter no longer sees the muted user's content in Home/For You", async () => {
      assert.ok(!(await a.publicFeedUsernames()).has(bWorkspace.username), "B's Edit must be filtered from A's public feed");
    });
    await check("the muted user still sees the muter's content normally (one-directional)", async () => {
      assert.ok((await b.publicFeedUsernames()).has(aWorkspace.username), "A's Edit must still appear in B's feed — B never muted A");
    });
    await check("the muter no longer sees the muted user in passive Explore recommendations", async () => {
      assert.ok(!(await a.exploreUsernames()).has(bWorkspace.username), "B must not appear in A's unfiltered Explore results");
    });
    await check("the muted user still appears in the muter's Explore when directly searched by name", async () => {
      assert.ok((await a.exploreUsernames(bWorkspace.displayName)).has(bWorkspace.username), "an intentional search for B must still find them even though A muted them");
    });
    await check("a bystander (never muted anyone) still sees the muted user normally in Explore", async () => {
      assert.ok((await d.exploreUsernames()).has(bWorkspace.username), "D must still see B — mute only affects the muter");
    });

    // --- 7. direct profile/content access remains available ---
    await check("the muter can still directly open the muted user's profile", async () => {
      assert.equal((await a.request(`/api/creators/${encodeURIComponent(bWorkspace.username)}/profile`)).status, 200);
    });
    await check("the muter can still directly open the muted user's workspace/content", async () => {
      assert.equal((await a.request(`/api/creators/${encodeURIComponent(bWorkspace.username)}/workspace`)).status, 200);
    });
    await check("the muter's direct single-creator lookup for the muted user still resolves", async () => {
      assert.equal((await a.request(`/api/creators/${encodeURIComponent(bWorkspace.username)}`)).status, 200);
    });
    await check("taste-match with the muted user is still reachable", async () => {
      assert.equal((await a.request(`/api/taste-match/${encodeURIComponent(bWorkspace.username)}`)).status, 200);
    });

    // --- 8. comments on third-party content: one-directional filtering ---
    await check("the muter no longer sees the muted user's comment on a third party's post", async () => {
      const comments = await a.listComments(cEditId);
      assert.ok(!comments.some((item) => item.id === bCommentOnC.id), "A must not see B's comment on C's Edit");
      assert.ok(comments.some((item) => item.id === aCommentOnC.id), "A must still see their own comment");
    });
    await check("the muted user still sees the muter's comment on a third party's post (one-directional)", async () => {
      const comments = await b.listComments(cEditId);
      assert.ok(comments.some((item) => item.id === aCommentOnC.id), "B must still see A's comment — B never muted A");
    });
    await check("an unrelated viewer still sees both comments on the third party's post", async () => {
      const [asOwner, asBystander] = await Promise.all([c.listComments(cEditId), d.listComments(cEditId)]);
      for (const comments of [asOwner, asBystander]) {
        assert.ok(comments.some((item) => item.id === aCommentOnC.id));
        assert.ok(comments.some((item) => item.id === bCommentOnC.id));
      }
    });
    await check("the comment count shown to the muter excludes the muted user's comment on that third-party post", async () => {
      const [asA, asUnrelated] = await Promise.all([a.engagement(cEditId), d.engagement(cEditId)]);
      assert.equal(asUnrelated.commentCount, 2, "an unrelated viewer sees the true count");
      assert.equal(asA.commentCount, 1, "A's own count must exclude B's filtered comment");
    });

    // --- 9. interactions remain fully allowed in both directions ---
    await check("the muted user can still like the muter's Edit", async () => {
      const response = await b.request(`/api/edits/${encodeURIComponent(aEditId)}/like`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: true }) });
      assert.equal(response.status, 200, await response.text().catch(() => ""));
    });
    await check("the muted user can still comment on the muter's Edit", async () => {
      const response = await b.request(`/api/edits/${encodeURIComponent(aEditId)}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "still allowed" }) });
      assert.equal(response.status, 201, await response.text().catch(() => ""));
    });
    await check("the muted user can still save the muter's Edit", async () => {
      const response = await b.request(`/api/edits/${encodeURIComponent(aEditId)}/save`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: true }) });
      assert.equal(response.status, 200, await response.text().catch(() => ""));
    });
    await check("the muter can still follow the muted user", async () => {
      const response = await a.follow(bWorkspace.username, true);
      assert.equal(response.status, 200, await response.text().catch(() => ""));
    });
    await check("messaging is not gated by mute (still governed only by the pre-existing verified-creator rule)", async () => {
      const response = await a.request("/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ creatorUsername: bWorkspace.username }) });
      // Neither test account is a verified creator, so this must fail for
      // that pre-existing reason (403) — never a mute-introduced 404, which
      // would mean mute had started gating an interaction it must not gate.
      assert.equal(response.status, 403);
      const body = await response.json() as { error: string };
      assert.match(body.error, /verified creator/i);
    });
    await check("reporting the muted user's profile is still allowed", async () => {
      const response = await a.report({ targetType: "profile", targetId: bWorkspace.username, reason: "spam" });
      assert.equal(response.status, 201, await response.text().catch(() => ""));
    });

    // --- 10. mute relationship privacy ---
    await check("GET /api/mutes never reveals who has muted the caller, only who the caller has muted", async () => {
      const bMutes = await b.listMutes();
      assert.equal(bMutes.mutes.length, 0, "B never muted anyone, so B's own mute list must be empty — even though A muted B");
      const aMutes = await a.listMutes();
      assert.ok(aMutes.mutes.some((row) => row.username === bWorkspace.username), "A's own mute list must include B");
    });
    await check("the muted user is never notified: no public/reported-facing response exposes mute state", async () => {
      // B's own view of their profile, and a bystander's view, must contain
      // no trace of being muted — there is no field for it in either
      // response shape, which is the actual guarantee; this just confirms
      // both requests succeed normally with no special-cased payload.
      const asB = await b.request("/api/creator-profile");
      await expectStatus(asB, 200);
      const asBystander = await d.request(`/api/creators/${encodeURIComponent(bWorkspace.username)}/profile`);
      await expectStatus(asBystander, 200);
      const bodyB = await asB.json() as Record<string, unknown>;
      const bodyBystander = await asBystander.json() as Record<string, unknown>;
      assert.ok(!("muted" in bodyB) && !("mutedBy" in bodyB));
      assert.ok(!("muted" in bodyBystander) && !("mutedBy" in bodyBystander));
    });

    // --- 11. unmute restores visibility ---
    await check("unmuting restores Home/For You and Explore visibility", async () => {
      const response = await a.unmute(bWorkspace.username);
      await expectStatus(response, 200);
      const [row] = await db.select().from(userMutes).where(and(eq(userMutes.muterUserId, aAccount.user.id), eq(userMutes.mutedUserId, bAccount.user.id)));
      assert.equal(row, undefined, "the userMutes row must be gone after unmuting");
      assert.equal((await a.muteStatus(bWorkspace.username)).muted, false);

      assert.ok((await a.publicFeedUsernames()).has(bWorkspace.username), "B's Edit must reappear in A's feed");
      assert.ok((await a.exploreUsernames()).has(bWorkspace.username), "B must reappear in A's Explore results");
    });
    await check("unmuting restores comment visibility on third-party content", async () => {
      const comments = await a.listComments(cEditId);
      assert.ok(comments.some((item) => item.id === bCommentOnC.id), "A must see B's comment again after unmuting");
      const engagement = await a.engagement(cEditId);
      assert.equal(engagement.commentCount, 2, "A's comment count must include B's comment again");
    });

    // --- 12. Block always takes precedence over Mute ---
    await check("when both a mute and a block exist, Block's stricter enforcement wins", async () => {
      const g = new Session(server.baseUrl);
      await g.signup(`precedence-muter-${suffix}@example.com`, PASSWORD);
      const gWorkspace = await g.ensureWorkspace();
      const gEditId = `edit-${suffix}-g`;
      await addPublicEdit(gWorkspace.creatorId, gEditId);

      const h = new Session(server.baseUrl);
      await h.signup(`precedence-target-${suffix}@example.com`, PASSWORD);
      const hWorkspace = await h.ensureWorkspace();

      await expectStatus(await g.mute(hWorkspace.username), 201);
      // Mute alone would still allow direct profile access and interactions —
      // confirm that, then add a block and confirm it overrides mute's
      // looser behavior rather than mute weakening it.
      assert.equal((await g.request(`/api/creators/${encodeURIComponent(hWorkspace.username)}/profile`)).status, 200);

      await expectStatus(await g.block(hWorkspace.username), 201);
      assert.equal((await g.request(`/api/creators/${encodeURIComponent(hWorkspace.username)}/profile`)).status, 404, "Block must still hide the profile even though a mute also exists");
      const likeResponse = await h.request(`/api/edits/${encodeURIComponent(gEditId)}/like`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: true }) });
      assert.equal(likeResponse.status, 403, "Block must still reject interaction even though a mute also exists (in the direction mute alone would have allowed)");
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
  console.log(`\nAll ${results.length} mute regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
