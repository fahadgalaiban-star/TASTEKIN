// Real HTTP/API verification against a temporary database created from a
// non-production development connection. Never point this at production.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");
const productionUrl = process.env.PROD_DB_URL;
if (!productionUrl) throw new Error("PROD_DB_URL is required");
if (process.env.REPLIT_DEPLOYMENT || process.env.NODE_ENV === "production") throw new Error("Refusing to run in a production runtime");
function databaseIdentity(value: string) {
  const url = new URL(value);
  const protocol = url.protocol.toLowerCase();
  if (protocol !== "postgres:" && protocol !== "postgresql:") throw new Error("DATABASE_URL must be PostgreSQL");
  const hostname = decodeURIComponent(url.hostname).toLowerCase().replace(/\.$/, "");
  const port = url.port || "5432";
  const username = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!hostname || !username || !database) throw new Error("PostgreSQL URL must include host, user, and database");
  return { server: `${hostname}:${port}`, database, username };
}
const sourceIdentity = databaseIdentity(sourceUrl);
const productionIdentity = databaseIdentity(productionUrl);
if (sourceIdentity.server === productionIdentity.server || sourceIdentity.database.toLowerCase() === productionIdentity.database.toLowerCase()) {
  throw new Error("Development and production database identities must differ");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const databaseName = `verify_circle_${process.pid}_${Date.now()}`;
if (!/^verify_circle_[0-9]+_[0-9]+$/.test(databaseName)) throw new Error("Unsafe temporary database name");
const control = new pg.Pool({ connectionString: sourceUrl });
const tempUrl = new URL(sourceUrl);
tempUrl.pathname = `/${databaseName}`;
const scoped = new pg.Pool({ connectionString: tempUrl.toString() });
let child: ReturnType<typeof spawn> | undefined;
let output = "";
const port = 4317;

async function httpRequest(url: string, init: RequestInit = {}) {
  return fetch(`http://127.0.0.1:${port}${url}`, init);
}
async function waitForServer() {
  for (let i = 0; i < 150; i++) {
    try { if ((await httpRequest("/api/circle/feed")).status !== 503) return; } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API did not start: ${output}`);
}
async function signup(name: string) {
  const response = await httpRequest("/api/auth/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${name}@example.test`, password: "CircleVerifierPassword1!" }),
  });
  assert.equal(response.status, 201);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return { id: ((await response.json()) as { user: { id: string } }).user.id, cookie };
}
async function api(cookie: string, method: string, url: string, body?: unknown) {
  return httpRequest(url, {
    method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function scalar(sql: string, values: unknown[] = []) {
  return (await scoped.query(sql, values)).rows[0];
}
async function stopChild() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

try {
  const target = await control.query("SELECT current_database() AS database, current_user AS username");
  assert.equal(String(target.rows[0]?.database).toLowerCase(), sourceIdentity.database.toLowerCase());
  assert.equal(target.rows[0]?.username, sourceIdentity.username);
  await control.query(`CREATE DATABASE "${databaseName}"`);
  // 0010/0011 are intentionally incremental migrations for tables that were
  // originally introduced outside the tracked history. Recreate that legacy
  // baseline in the empty temporary database, then let the real migrations
  // perform the actual alterations during API boot.
  await scoped.query("CREATE TABLE closet_items (style text NOT NULL)");
  await scoped.query("CREATE TABLE closet_media_uploads (id uuid PRIMARY KEY DEFAULT gen_random_uuid())");
  await new Promise<void>((resolve, reject) => execFile("pnpm", ["--filter", "@workspace/api-server", "run", "build"], { cwd: root }, (error) => error ? reject(error) : resolve()));
  child = spawn("pnpm", ["--filter", "@workspace/api-server", "run", "start"], {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: tempUrl.toString(),
      PORT: String(port),
      RUN_MIGRATIONS_ON_BOOT: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  await waitForServer();
  // The original baseline migration predates the Drizzle-side UUID default;
  // production already has it, so reproduce that supported baseline detail.
  await scoped.query("ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid()");
  // This table predates tracked migration coverage in this repository. Keep
  // the verifier honest by creating it only inside the throwaway database.
  await scoped.query(`CREATE TABLE feature_flags (
    key text PRIMARY KEY, description text NOT NULL, enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now(), updated_by_user_id varchar REFERENCES users(id)
  )`);
  await scoped.query(`CREATE TABLE feature_flag_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), flag_key text NOT NULL,
    admin_user_id varchar NOT NULL REFERENCES users(id), from_enabled boolean NOT NULL,
    to_enabled boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  )`);

  const owner = await signup(`circle-owner-${process.pid}`);
  const other = await signup(`circle-other-${process.pid}`);
  const creator = await signup(`circle-creator-${process.pid}`);
  const unverified = await signup(`circle-unverified-${process.pid}`);
  const admin = await signup(`circle-admin-${process.pid}`);
  await scoped.query("UPDATE users SET is_admin = true WHERE id = $1", [admin.id]);
  const flagListing = await api(admin.cookie, "GET", "/api/admin/feature-flags");
  assert.equal(flagListing.status, 200);
  const flags = (await flagListing.json()) as { flags: Array<{ key: string; enabled: boolean }> };
  assert.equal(flags.flags.find((flag) => flag.key === "my_circle")?.enabled, false);
  assert.equal((await scalar("SELECT count(*)::int AS n FROM feature_flags WHERE key='my_circle'")).n, 0);
  const enabledFlag = await api(admin.cookie, "PUT", "/api/admin/feature-flags/my_circle", { enabled: true });
  assert.equal(enabledFlag.status, 200);
  assert.equal(((await enabledFlag.json()) as { enabled: boolean }).enabled, true);
  const enabledListing = await api(admin.cookie, "GET", "/api/admin/feature-flags");
  assert.equal(((await enabledListing.json()) as { flags: Array<{ key: string; enabled: boolean }> }).flags.find((flag) => flag.key === "my_circle")?.enabled, true);
  await scoped.query("UPDATE users SET is_verified = true WHERE id = $1", [creator.id]);
  const edit = {
    id: "circle-locked", status: "published", access: "locked",
    image: "/private/source.webp", previewImage: "/objects/uploads/preview.webp",
    title: "Private circle edit", category: "fashion", titleAr: "", caption: "",
    captionAr: "", location: "", locationAr: "", altText: "", collectionIds: [],
  };
  const publicEdit = { ...edit, id: "circle-public", access: "public", image: "/objects/uploads/public.webp", previewImage: undefined };
  for (const [id, username, userId, edits] of [
    ["owner", "circle-owner", owner.id, []],
    ["other", "circle-other", other.id, []],
    ["creator", "circlecreator", creator.id, [edit, publicEdit]],
    ["unverified", "circleunverified", unverified.id, []],
  ] as const) {
    await scoped.query(
      `INSERT INTO creator_workspaces (creator_id, owner_user_id, edits, collections, profile)
       VALUES ($1, $2, $3::jsonb, '[]'::jsonb, $4::jsonb)`,
      [id, userId, JSON.stringify(edits), JSON.stringify({ username, displayName: username, bio: "", city: "", country: "", interests: [], dateOfBirth: null, showAge: false, avatar: "/avatar.webp" })],
    );
  }
  assert.equal((await api(admin.cookie, "PUT", "/api/admin/feature-flags/my_circle", { enabled: false })).status, 200);
  for (const [method, url] of [
    ["GET", "/api/circle/members"], ["GET", "/api/circle/members/circlecreator"],
    ["PUT", "/api/circle/members/circlecreator"], ["DELETE", "/api/circle/members/circlecreator"],
    ["GET", "/api/circle/feed"],
  ] as const) {
    assert.equal((await httpRequest(url, { method })).status, 401);
    assert.equal((await api(owner.cookie, method, url)).status, 403);
  }
  assert.equal((await api(admin.cookie, "PUT", "/api/admin/feature-flags/my_circle", { enabled: true })).status, 200);
  assert.equal((await api(owner.cookie, "PUT", "/api/circle/members/circlecreator")).status, 200);
  assert.equal((await api(owner.cookie, "PUT", "/api/circle/members/circlecreator")).status, 200);
  assert.equal((await api(owner.cookie, "PUT", "/api/circle/members/circle-owner")).status, 403);
  assert.equal((await api(owner.cookie, "PUT", "/api/circle/members/circleunverified")).status, 403);

  const list = await api(owner.cookie, "GET", "/api/circle/members");
  assert.equal(list.status, 200);
  assert.equal(((await list.json()) as Array<{ username: string }>).map((x) => x.username).join(","), "circlecreator");
  assert.deepEqual(await (await api(other.cookie, "GET", "/api/circle/members")).json(), []);
  assert.equal((await api(other.cookie, "DELETE", "/api/circle/members/circlecreator")).status, 204);
  const ownerStatusAfterOtherDelete = await api(owner.cookie, "GET", "/api/circle/members/circlecreator");
  assert.equal(ownerStatusAfterOtherDelete.status, 200);
  assert.equal(((await ownerStatusAfterOtherDelete.json()) as { active: boolean }).active, true);
  assert.equal((await scalar("SELECT count(*)::int AS n FROM creator_follows WHERE follower_user_id=$1 AND creator_id='creator'", [owner.id])).n, 1);
  await assert.rejects(scoped.query("INSERT INTO my_circle_memberships (owner_user_id, creator_id) VALUES ($1,$2)", [owner.id, "creator"]));

  const feedResponse = await api(owner.cookie, "GET", "/api/circle/feed");
  const feed = await feedResponse.json() as Array<{ edit: Record<string, unknown> }>;
  const locked = feed.find((item) => item.edit.id === "circle-locked")?.edit;
  assert.ok(locked);
  assert.equal(locked.sourceImage, undefined);
  assert.equal(locked.previewImage, undefined);
  assert.equal(locked.image, "/api/public-media/circlecreator/circle-locked/preview");
  assert.ok((await api(owner.cookie, "GET", "/api/public-media/circlecreator/circle-locked")).status >= 400);

  assert.equal((await api(owner.cookie, "DELETE", "/api/circle/members/circlecreator")).status, 204);
  assert.equal((await scalar("SELECT count(*)::int AS n FROM my_circle_memberships WHERE owner_user_id=$1 AND creator_id='creator'", [owner.id])).n, 0);
  assert.equal((await scalar("SELECT count(*)::int AS n FROM creator_follows WHERE follower_user_id=$1 AND creator_id='creator'", [owner.id])).n, 1);
  assert.equal((await api(owner.cookie, "PUT", "/api/circle/members/circlecreator")).status, 200);
  await scoped.query("UPDATE users SET is_verified = false WHERE id = $1", [creator.id]);
  assert.deepEqual(await (await api(owner.cookie, "GET", "/api/circle/members")).json(), []);
  assert.equal(((await (await api(owner.cookie, "GET", "/api/circle/members/circlecreator")).json()) as { active: boolean }).active, false);
  assert.equal(((await (await api(owner.cookie, "GET", "/api/circle/feed")).json()) as unknown[]).length, 0);
  await scoped.query("UPDATE users SET is_verified = true WHERE id = $1", [creator.id]);
  await scoped.query("INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES ($1,$2)", [owner.id, creator.id]);
  assert.equal((await api(owner.cookie, "PUT", "/api/circle/members/circlecreator")).status, 404);

  await assert.rejects(scoped.query("INSERT INTO my_circle_memberships (owner_user_id, creator_id) VALUES ('missing','creator')"));
  await assert.rejects(scoped.query("INSERT INTO my_circle_memberships (owner_user_id, creator_id) VALUES ($1,'missing')", [owner.id]));
  await scoped.query("INSERT INTO my_circle_memberships (owner_user_id, creator_id) VALUES ($1,'creator')", [other.id]);
  await scoped.query("DELETE FROM users WHERE id = $1", [other.id]);
  assert.equal((await scalar("SELECT count(*)::int AS n FROM my_circle_memberships WHERE owner_user_id=$1", [other.id])).n, 0);
  await scoped.query(
    `INSERT INTO creator_workspaces (creator_id, edits, collections, profile)
     VALUES ('cascade-creator', '[]', '[]', '{"username":"cascade","displayName":"Cascade","bio":"","city":"","country":"","interests":[],"dateOfBirth":null,"showAge":false,"avatar":"/avatar.webp"}')`,
  );
  await scoped.query("INSERT INTO my_circle_memberships (owner_user_id, creator_id) VALUES ($1,'cascade-creator')", [owner.id]);
  await scoped.query("DELETE FROM creator_workspaces WHERE creator_id='cascade-creator'");
  assert.equal((await scalar("SELECT count(*)::int AS n FROM my_circle_memberships WHERE creator_id='cascade-creator'")).n, 0);
  console.log("Circle temporary-database real-server verification passed.");
} finally {
  await stopChild();
  await scoped.end();
  await control.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [databaseName],
  ).catch(() => undefined);
  await control.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  const remaining = await control.query("SELECT count(*)::int AS n FROM pg_database WHERE datname = $1", [databaseName]);
  assert.equal(remaining.rows[0]?.n, 0, "temporary Circle database must be dropped");
  await control.end();
}