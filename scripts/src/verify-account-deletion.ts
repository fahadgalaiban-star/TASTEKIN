// Real-server verification of permanent account deletion
// (POST /api/me/delete-account) — the App Store / Google Play requirement
// added with the free v1.
//
// Proves, against a REAL disposable Postgres database and the compiled
// api-server over real HTTP, that:
//   - the endpoint refuses anonymous callers, missing confirmation,
//     administrator accounts and accounts holding feature-flag audit records,
//     changing nothing in each case;
//   - a successful deletion removes the users row and every row that refers
//     to the account (workspace, uploads, engagement, follows, views,
//     conversations, taste preferences, verification application, closet
//     items, KIN quota rows, Circle memberships, blocks/mutes), revokes every
//     web cookie session and native bearer token, nulls the feature-flag
//     reference, keeps moderation records with an opaque id, and leaves the
//     media ledgers in durable retry states when the storage/video providers
//     are unreachable (as they are here);
//   - the response never reveals anything about any other account, and the
//     other members' data is untouched.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:account-deletion
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.on("error", () => undefined);
let nextPort = 24700;

type Server = { port: number; process: ChildProcess; baseUrl: string };

async function startServer(): Promise<Server> {
  const port = nextPort;
  nextPort += 1;
  const env: Record<string, string | undefined> = { ...process.env, PORT: String(port), NODE_ENV: "production", ALLOWED_ORIGINS: "capacitor://localhost,https://localhost" };
  // The media providers must be unreachable here: the ledger rows must end
  // in their durable retry states, never silently "deleted".
  delete env.BUNNY_STREAM_API_KEY; delete env.BUNNY_STREAM_LIBRARY_ID;
  env.OBJECT_STORAGE_SIDECAR_ENDPOINT = "http://127.0.0.1:9"; env.PRIVATE_OBJECT_DIR = "/verify-bucket/private";
  const child = spawn("node", [serverEntry], { env, stdio: ["ignore", "pipe", "pipe"] });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
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

class Session {
  cookie: string | null = null;
  constructor(private baseUrl: string) {}
  async request(pathName: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set("cookie", this.cookie);
    const response = await fetch(`${this.baseUrl}${pathName}`, { ...init, headers, redirect: "manual" });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie && !/sid=;/.test(setCookie)) this.cookie = setCookie.split(";")[0];
    return response;
  }
  json(pathName: string, method: string, body?: unknown) {
    return this.request(pathName, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async signup(email: string, password: string) {
    const response = await this.json("/api/auth/signup", "POST", { email, password });
    const text = await response.text();
    assert.equal(response.status, 201, `signup for ${email}: ${text}`);
    return JSON.parse(text) as { user: { id: string; email: string } };
  }
  async me() {
    const response = await this.request("/api/me");
    assert.equal(response.status, 200);
    return (await response.json()) as { user: { id: string } | null; creator: { id: string; handle: string } | null };
  }
  async workspace() {
    const response = await this.request("/api/creator-workspace");
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return JSON.parse(text) as { creatorId: string; revision: number; edits: Array<Record<string, unknown>>; collections: Array<Record<string, unknown>> };
  }
}

function placeEdit(id: string, title: string) {
  return {
    id, category: "Restaurants", title, titleAr: title, caption: `${title} caption`, captionAr: `${title} caption`,
    location: "Kuwait City", locationAr: "مدينة الكويت", altText: "", access: "public", status: "published", collectionIds: [],
    placeName: `${title} place`, locationLabel: "Kuwait City", tasteRating: 4, creatorReview: null, mapsUrl: null,
  };
}

async function count(sqlText: string, params: unknown[] = []) {
  const { rows } = await pool.query(`select count(*)::int as n from ${sqlText}`, params);
  return Number(rows[0].n);
}

const suffix = Date.now();
const PASSWORD = "delete-verify-1234";
const results: Array<{ name: string; ok: boolean; error?: string }> = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok — ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) }); console.log(`  FAIL — ${name}\n    ${error instanceof Error ? error.message : error}`); }
}

async function main() {
  const server = await startServer();
  try {
    // ------------------------------------------------------------ fixtures
    const alice = new Session(server.baseUrl);
    const aliceAccount = await alice.signup(`delete-alice-${suffix}@example.com`, PASSWORD);
    const aliceId = aliceAccount.user.id;
    const bob = new Session(server.baseUrl);
    const bobAccount = await bob.signup(`delete-bob-${suffix}@example.com`, PASSWORD);
    const bobId = bobAccount.user.id;
    await pool.query("update users set is_verified = true where id = any($1)", [[aliceId, bobId]]);

    const aliceMe = await alice.me();
    const bobMe = await bob.me();
    assert.ok(aliceMe.creator && bobMe.creator);
    const aliceHandle = aliceMe.creator.handle;
    const bobHandle = bobMe.creator.handle;
    const aliceWorkspace = await alice.workspace();
    const bobWorkspace = await bob.workspace();
    const aliceEditId = `alice-edit-${suffix}`;
    const bobEditId = `bob-edit-${suffix}`;
    assert.equal((await alice.json("/api/creator-workspace", "PUT", { expectedRevision: aliceWorkspace.revision, edits: [placeEdit(aliceEditId, "Alice lunch"), { ...placeEdit(`alice-draft-${suffix}`, "Alice draft"), status: "draft" }], collections: [{ id: `alice-col-${suffix}`, title: "Alice picks", titleAr: "", description: "", descriptionAr: "", access: "public", coverEditId: aliceEditId, editIds: [aliceEditId] }] })).status, 200);
    assert.equal((await bob.json("/api/creator-workspace", "PUT", { expectedRevision: bobWorkspace.revision, edits: [placeEdit(bobEditId, "Bob dinner")], collections: [] })).status, 200);

    // Bob interacts with Alice's content; Alice interacts with Bob's.
    for (const [session, editId] of [[bob, aliceEditId], [alice, bobEditId]] as const) {
      assert.equal((await session.json(`/api/edits/${editId}/like`, "PUT", { active: true })).status, 200);
      assert.equal((await session.json(`/api/edits/${editId}/save`, "PUT", { active: true })).status, 200);
      assert.equal((await session.json(`/api/edits/${editId}/comments`, "POST", { body: "lovely" })).status, 201);
    }
    assert.equal((await bob.json("/api/relationships", "POST", { type: "follow", targetId: aliceHandle, active: true })).status, 200);
    assert.equal((await alice.json("/api/relationships", "POST", { type: "follow", targetId: bobHandle, active: true })).status, 200);
    const listResponse = await alice.json("/api/me/saved-lists", "POST", { name: "Alice list" });
    assert.equal(listResponse.status, 201);
    const aliceList = (await listResponse.json()) as { id: string };
    assert.equal((await alice.json(`/api/me/saved-lists/${aliceList.id}/edits/${bobEditId}`, "PUT", { active: true })).status, 200);
    const bobListResponse = await bob.json("/api/me/saved-lists", "POST", { name: "Bob list" });
    const bobList = (await bobListResponse.json()) as { id: string };
    assert.equal((await bob.json(`/api/me/saved-lists/${bobList.id}/edits/${aliceEditId}`, "PUT", { active: true })).status, 200);
    assert.equal((await alice.json("/api/taste-preferences", "PUT", { categories: ["Fashion", "Travel", "Places"], tags: ["tailoring", "slow-travel", "city-guides"] })).status, 200);
    assert.equal((await alice.json(`/api/creators/${bobHandle}/views`, "POST", { editId: null })).status, 201);
    assert.equal((await bob.json(`/api/creators/${aliceHandle}/views`, "POST", { editId: aliceEditId })).status, 201);
    const conversation = await bob.json("/api/conversations", "POST", { creatorUsername: aliceHandle });
    const conversationText = await conversation.text();
    assert.equal(conversation.status, 201, conversationText);
    const conversationId = (JSON.parse(conversationText) as { id: string }).id;
    assert.equal((await bob.json(`/api/conversations/${conversationId}/messages`, "POST", { body: "hi alice" })).status, 201);
    assert.equal((await alice.json(`/api/conversations/${conversationId}/messages`, "POST", { body: "hi bob" })).status, 201);
    assert.equal((await alice.json("/api/mutes", "POST", { username: bobHandle })).status, 201);
    assert.equal((await alice.json("/api/reports", "POST", { targetType: "edit", targetId: bobEditId, reason: "spam" })).status, 201);
    assert.equal((await alice.json("/api/analytics/events", "POST", { name: "home_viewed", metadata: {} })).status, 202);
    // Alice is already verified above (needed for messaging), so her application row is seeded directly.
    await pool.query("insert into verification_applications (user_id, statement, status) values ($1, $2, 'approved')", [aliceId, "I am Alice"]);
    // A native (app) session for Alice.
    const nativeLogin = await fetch(`${server.baseUrl}/api/auth/native/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: aliceAccount.user.email, password: PASSWORD, platform: "ios" }) });
    assert.equal(nativeLogin.status, 200);
    const aliceToken = ((await nativeLogin.json()) as { token: string }).token;
    // Rows the HTTP surface cannot create in this environment (no storage
    // sidecar, no Bunny): inserted directly, shaped exactly like production.
    await pool.query("insert into creator_media_uploads (object_path, creator_id, owner_user_id, state) values ($1, $2, $3, 'committed')", [`/objects/uploads/${crypto.randomUUID()}`, aliceWorkspace.creatorId, aliceId]);
    const closetKey = `/objects/closet/${crypto.randomUUID()}`;
    const { rows: [closetRow] } = await pool.query("insert into closet_media_uploads (owner_user_id, image_object_key, state) values ($1, $2, 'uploaded') returning id", [aliceId, closetKey]);
    const { rows: [closetItem] } = await pool.query("insert into closet_items (owner_user_id, image_object_key, item_type, primary_color) values ($1, $2, 'shirt', 'black') returning id", [aliceId, closetKey]);
    await pool.query("update closet_media_uploads set state = 'attached', closet_item_id = $2 where id = $1", [closetRow.id, closetItem.id]);
    const { rows: [videoRow] } = await pool.query("insert into video_uploads (creator_id, owner_user_id, bunny_library_id, bunny_video_id, state, declared_file_name, attached_edit_id) values ($1, $2, 'lib-1', $3, 'ready', 'alice.mp4', $4) returning id", [aliceWorkspace.creatorId, aliceId, `bunny-${suffix}`, aliceEditId]);
    await pool.query("insert into kin_search_usage (owner_user_id) values ($1)", [aliceId]);
    await pool.query("insert into my_circle_memberships (owner_user_id, creator_id) values ($1, $2), ($3, $4)", [aliceId, bobWorkspace.creatorId, bobId, aliceWorkspace.creatorId]);
    await pool.query("insert into feature_flags (key, description, enabled, updated_by_user_id) values ($1, 'verify', true, $2) on conflict (key) do update set updated_by_user_id = excluded.updated_by_user_id", [`verify_flag_${suffix}`, aliceId]);

    // ------------------------------------------------------------ refusals
    await check("anonymous callers get 401 and nothing changes", async () => {
      const response = await fetch(`${server.baseUrl}/api/me/delete-account`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }) });
      assert.equal(response.status, 401);
      assert.equal(await count("users where id = $1", [aliceId]), 1);
    });
    await check("a request without the exact typed confirmation is rejected with 400 and nothing changes", async () => {
      for (const body of [{}, { confirm: true }, { confirm: "delete" }, { confirm: "yes" }]) {
        const response = await alice.json("/api/me/delete-account", "POST", body);
        assert.equal(response.status, 400, JSON.stringify(body));
      }
      assert.equal(await count("users where id = $1", [aliceId]), 1);
      assert.equal((await alice.me()).user?.id, aliceId, "the session survives a rejected attempt");
    });
    await check("an administrator account is refused (409 admin_account) and left intact", async () => {
      await pool.query("update users set is_admin = true where id = $1", [aliceId]);
      try {
        const response = await alice.json("/api/me/delete-account", "POST", { confirm: "DELETE" });
        assert.equal(response.status, 409);
        assert.equal(((await response.json()) as { code: string }).code, "admin_account");
        assert.equal(await count("users where id = $1", [aliceId]), 1);
        assert.equal(await count("creator_workspaces where owner_user_id = $1", [aliceId]), 1);
      } finally {
        await pool.query("update users set is_admin = false where id = $1", [aliceId]);
      }
    });
    await check("an account holding feature-flag audit records is refused (409 audit_trail) and left intact", async () => {
      const { rows: [audit] } = await pool.query("insert into feature_flag_audit_log (flag_key, admin_user_id, from_enabled, to_enabled) values ($1, $2, true, false) returning id", [`verify_flag_${suffix}`, aliceId]);
      try {
        const response = await alice.json("/api/me/delete-account", "POST", { confirm: "DELETE" });
        assert.equal(response.status, 409);
        assert.equal(((await response.json()) as { code: string }).code, "audit_trail");
        assert.equal(await count("users where id = $1", [aliceId]), 1);
        assert.equal(await count("native_sessions where user_id = $1 and revoked_at is null", [aliceId]), 1, "no session was revoked by a refused attempt");
      } finally {
        await pool.query("delete from feature_flag_audit_log where id = $1", [audit.id]);
      }
    });

    // ------------------------------------------------------------ deletion
    let cookieCleared = false;
    let mediaCleanup = "";
    await check("the owner deletes their account with the typed confirmation: 200, cookie cleared, media cleanup reported honestly", async () => {
      const response = await alice.json("/api/me/delete-account", "POST", { confirm: "DELETE" });
      const text = await response.text();
      assert.equal(response.status, 200, text);
      const body = JSON.parse(text) as { deleted: boolean; mediaCleanup: string };
      assert.equal(body.deleted, true);
      mediaCleanup = body.mediaCleanup;
      // Storage sidecar and Bunny are unreachable in this run, so the honest
      // answer is "pending" (never "completed").
      assert.equal(body.mediaCleanup, "pending");
      cookieCleared = /sid=;/.test(response.headers.get("set-cookie") ?? "");
      assert.equal(cookieCleared, true, "the web cookie must be cleared");
      assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    });
    await check("the account row and every credential are gone: cookie session signed out, native token invalid, deleted cookie gets 401", async () => {
      assert.equal(await count("users where id = $1", [aliceId]), 0);
      assert.equal(await count("sessions where sess->'user'->>'id' = $1", [aliceId]), 0);
      assert.equal(await count("native_sessions where user_id = $1", [aliceId]), 0);
      assert.equal((await alice.me()).user, null);
      const nativeMe = await fetch(`${server.baseUrl}/api/me`, { headers: { authorization: `Bearer ${aliceToken}` } });
      assert.equal(((await nativeMe.json()) as { user: unknown; nativeAuth: string }).nativeAuth, "invalid");
      assert.equal((await alice.json("/api/me/delete-account", "POST", { confirm: "DELETE" })).status, 401);
    });
    await check("the creator workspace, its Edits' engagement, featured collections, followers and view events are gone", async () => {
      assert.equal(await count("creator_workspaces where owner_user_id = $1 or creator_id = $2", [aliceId, aliceWorkspace.creatorId]), 0);
      assert.equal(await count("edit_likes where edit_id = $1 or user_id = $2", [aliceEditId, aliceId]), 0);
      assert.equal(await count("edit_saves where edit_id = $1 or user_id = $2", [aliceEditId, aliceId]), 0);
      assert.equal(await count("edit_comments where edit_id = $1 or user_id = $2", [aliceEditId, aliceId]), 0);
      assert.equal(await count("saved_list_items where edit_id = $1", [aliceEditId]), 0, "Bob's list no longer references Alice's Edit");
      assert.equal(await count("saved_lists where user_id = $1", [aliceId]), 0);
      assert.equal(await count("creator_follows where follower_user_id = $1 or creator_id = $2", [aliceId, aliceWorkspace.creatorId]), 0);
      assert.equal(await count("creator_view_events where creator_id = $1", [aliceWorkspace.creatorId]), 0);
      assert.equal(await count("creator_view_events where viewer_user_id = $1", [aliceId]), 0, "Alice's own views of Bob are anonymized");
      assert.equal(await count("creator_view_events where creator_id = $1 and viewer_user_id is null", [bobWorkspace.creatorId]), 1, "Bob's aggregate view count is kept");
      assert.equal(await count("my_circle_memberships where owner_user_id = $1 or creator_id = $2", [aliceId, aliceWorkspace.creatorId]), 0);
      const profile = await fetch(`${server.baseUrl}/api/creators/${encodeURIComponent(aliceHandle)}/profile`);
      assert.equal(profile.status, 404);
      const feed = (await (await bob.request("/api/public-feed")).json()) as { items: Array<{ edit: { id: string } }> };
      assert.equal(feed.items.some((item) => item.edit.id === aliceEditId), false);
    });
    await check("conversations, personal data, safety settings, closet items and KIN rows are gone", async () => {
      assert.equal(await count("conversations where id = $1", [conversationId]), 0);
      assert.equal(await count("conversation_messages where conversation_id = $1", [conversationId]), 0);
      assert.equal(await count("user_taste_preferences where user_id = $1", [aliceId]), 0);
      assert.equal(await count("verification_applications where user_id = $1", [aliceId]), 0);
      assert.equal(await count("user_mutes where muter_user_id = $1 or muted_user_id = $1", [aliceId]), 0);
      assert.equal(await count("closet_items where owner_user_id = $1", [aliceId]), 0);
      assert.equal(await count("kin_search_usage where owner_user_id = $1", [aliceId]), 0);
      assert.equal(await count("password_reset_tokens where user_id = $1", [aliceId]), 0);
      assert.equal(await count("analytics_events where user_id = $1", [aliceId]), 0);
      const { rows: [flag] } = await pool.query("select updated_by_user_id from feature_flags where key = $1", [`verify_flag_${suffix}`]);
      assert.equal(flag.updated_by_user_id, null);
    });
    await check("media ledgers keep durable retry states instead of pretending the files are gone", async () => {
      const { rows: [closet] } = await pool.query("select owner_user_id, state, closet_item_id, image_object_key from closet_media_uploads where id = $1", [closetRow.id]);
      assert.equal(closet.owner_user_id, null);
      assert.equal(closet.closet_item_id, null);
      assert.equal(closet.state, "delete_failed", "sidecar unreachable → delete_failed for the reconcile sweep");
      assert.equal(closet.image_object_key, closetKey);
      const { rows: [video] } = await pool.query("select state, attached_edit_id, declared_file_name from video_uploads where id = $1", [videoRow.id]);
      assert.equal(video.state, "delete_failed", "Bunny not configured → delete_failed for the recovery sweep");
      assert.equal(video.attached_edit_id, null);
      assert.equal(video.declared_file_name, null);
      const { rows: [upload] } = await pool.query("select state from creator_media_uploads where owner_user_id = $1", [aliceId]);
      assert.equal(upload.state, "delete_failed");
      assert.equal(mediaCleanup, "pending");
    });
    await check("moderation records are retained with an opaque id that no longer resolves to anyone", async () => {
      assert.equal(await count("reports where reporter_user_id = $1", [aliceId]), 1);
      assert.equal(await count("users where id = $1", [aliceId]), 0);
    });
    await check("the other member is untouched and still signed in", async () => {
      assert.equal((await bob.me()).user?.id, bobId);
      assert.equal(await count("creator_workspaces where owner_user_id = $1", [bobId]), 1);
      assert.equal(await count("saved_lists where user_id = $1", [bobId]), 1);
      assert.equal(await count("user_taste_preferences where user_id = $1", [bobId]), 0);
      const bobWorkspaceAfter = await bob.workspace();
      assert.equal(bobWorkspaceAfter.edits.some((edit) => edit.id === bobEditId), true);
    });
  } finally {
    stopServer(server);
    await pool.end();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
