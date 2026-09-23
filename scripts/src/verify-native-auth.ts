// Real-server verification of the native (iOS/Android) session model added in
// mobile PR-2: opaque bearer tokens, SHA-256 hashes at rest, 30-day idle /
// 180-day absolute expiry, immediate revocation, password reset revoking
// native AND web sessions, the shared password-login throttle on the web and
// native routes, and the CORS behaviour the shell origins need. Also proves
// the web cookie path is unchanged.
//
// Runs the compiled api-server against a REAL Postgres database (point
// DATABASE_URL at a disposable/test database with the current schema — this
// creates and mutates real rows) and drives it over real HTTP.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:native-auth
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
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
let nextPort = 24600;

type Server = { port: number; process: ChildProcess; baseUrl: string };

async function startServer(extraEnv: Record<string, string | undefined> = {}): Promise<Server> {
  const port = nextPort;
  nextPort += 1;
  const env: Record<string, string | undefined> = { ...process.env, PORT: String(port), NODE_ENV: "production", ...extraEnv };
  for (const [key, value] of Object.entries(extraEnv)) if (value === undefined) delete env[key];
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

async function postJson(baseUrl: string, route: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${route}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
async function me(baseUrl: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}/api/me`, { headers });
  assert.equal(response.status, 200, `GET /api/me → ${response.status}`);
  return response.json() as Promise<{ user: { id: string; email: string } | null; nativeAuth: "valid" | "invalid" | "error" | null }>;
}
function sha256(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function cookieOf(response: Response) { return response.headers.get("set-cookie") ?? ""; }
function sidFrom(response: Response) { return /sid=([^;]+)/.exec(cookieOf(response))?.[1] ?? null; }

const suffix = Date.now();
const PASSWORD = "native-verify-1234";
const results: Array<{ name: string; ok: boolean; error?: string }> = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok — ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) }); console.log(`  FAIL — ${name}\n    ${error instanceof Error ? error.message : error}`); }
}

type Issued = { token: string; expiresAt: string; user: { id: string; email: string } };

async function main() {
  const server = await startServer({ ALLOWED_ORIGINS: "capacitor://localhost,https://localhost" });
  try {
    const email = `native-${suffix}@example.com`;
    let issued: Issued | null = null;

    // ------------------------------------------------------------------ issue
    await check("native signup (ios) returns a bearer token, no cookie, user echo", async () => {
      const response = await postJson(server.baseUrl, "/api/auth/native/signup", { email, password: PASSWORD, platform: "ios", appVersion: "1.0.0 (1)" });
      const text = await response.text();
      assert.equal(response.status, 201, text);
      assert.equal(response.headers.get("set-cookie"), null, "native routes must never set a cookie");
      assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
      issued = JSON.parse(text) as Issued;
      assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(issued.user.email, email);
      assert.ok(new Date(issued.expiresAt).getTime() > Date.now() + 179 * 864e5);
    });
    await check("only sha256(token) is stored; platform and app version recorded", async () => {
      const { rows } = await pool.query("select token_hash, platform, app_version, revoked_at from native_sessions where user_id = $1", [issued!.user.id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].token_hash, sha256(issued!.token));
      assert.equal(rows[0].platform, "ios");
      assert.equal(rows[0].app_version, "1.0.0 (1)");
      assert.equal(rows[0].revoked_at, null);
      const { rows: leak } = await pool.query("select 1 from native_sessions where token_hash = $1", [issued!.token]);
      assert.equal(leak.length, 0, "plaintext token must never be stored");
    });
    await check("bearer /api/me resolves the user with nativeAuth 'valid'", async () => {
      const payload = await me(server.baseUrl, { authorization: `Bearer ${issued!.token}` });
      assert.equal(payload.user?.email, email);
      assert.equal(payload.nativeAuth, "valid");
    });
    await check("no bearer → signed out, nativeAuth null; unknown or malformed bearer → signed out, nativeAuth 'invalid'", async () => {
      assert.deepEqual([(await me(server.baseUrl)).user, (await me(server.baseUrl)).nativeAuth], [null, null]);
      const unknown = await me(server.baseUrl, { authorization: `Bearer ${crypto.randomBytes(32).toString("base64url")}` });
      assert.equal(unknown.user, null); assert.equal(unknown.nativeAuth, "invalid");
      const malformed = await me(server.baseUrl, { authorization: "Bearer not-a-real-token" });
      assert.equal(malformed.user, null); assert.equal(malformed.nativeAuth, "invalid");
    });
    await check("native login (android) issues a second, independent token", async () => {
      const response = await postJson(server.baseUrl, "/api/auth/native/login", { email, password: PASSWORD, platform: "android" });
      const text = await response.text();
      assert.equal(response.status, 200, text);
      assert.equal(response.headers.get("set-cookie"), null);
      const second = JSON.parse(text) as Issued;
      assert.notEqual(second.token, issued!.token);
      const { rows } = await pool.query("select platform from native_sessions where user_id = $1 order by created_at", [issued!.user.id]);
      assert.deepEqual(rows.map((r) => r.platform), ["ios", "android"]);
    });
    await check("native routes reject a missing/unknown platform and wrong credentials with the web's wording", async () => {
      const noPlatform = await postJson(server.baseUrl, "/api/auth/native/login", { email, password: PASSWORD });
      assert.equal(noPlatform.status, 400);
      const badPlatform = await postJson(server.baseUrl, "/api/auth/native/login", { email, password: PASSWORD, platform: "web" });
      assert.equal(badPlatform.status, 400);
      const wrong = await postJson(server.baseUrl, "/api/auth/native/login", { email, password: "wrong-password-1", platform: "ios" });
      assert.equal(wrong.status, 401);
      assert.deepEqual(await wrong.json(), { error: "Incorrect email or password." });
      const dup = await postJson(server.baseUrl, "/api/auth/native/signup", { email, password: PASSWORD, platform: "ios" });
      assert.equal(dup.status, 409);
    });

    // ------------------------------------------------------------- lifetimes
    await check("last_used_at is refreshed when older than the touch interval", async () => {
      await pool.query("update native_sessions set last_used_at = now() - interval '20 minutes' where token_hash = $1", [sha256(issued!.token)]);
      assert.equal((await me(server.baseUrl, { authorization: `Bearer ${issued!.token}` })).nativeAuth, "valid");
      const { rows } = await pool.query("select extract(epoch from now() - last_used_at) as age from native_sessions where token_hash = $1", [sha256(issued!.token)]);
      assert.ok(Number(rows[0].age) < 60, `last_used_at should be ~now, age ${rows[0].age}s`);
    });
    await check("idle expiry: 30 days unused → invalid (row untouched, not deleted)", async () => {
      await pool.query("update native_sessions set last_used_at = now() - interval '30 days 1 minute' where token_hash = $1", [sha256(issued!.token)]);
      const payload = await me(server.baseUrl, { authorization: `Bearer ${issued!.token}` });
      assert.equal(payload.user, null); assert.equal(payload.nativeAuth, "invalid");
      await pool.query("update native_sessions set last_used_at = now() where token_hash = $1", [sha256(issued!.token)]);
      assert.equal((await me(server.baseUrl, { authorization: `Bearer ${issued!.token}` })).nativeAuth, "valid");
    });
    await check("absolute expiry: expires_at in the past → invalid even when recently used", async () => {
      await pool.query("update native_sessions set expires_at = now() - interval '1 second' where token_hash = $1", [sha256(issued!.token)]);
      assert.equal((await me(server.baseUrl, { authorization: `Bearer ${issued!.token}` })).nativeAuth, "invalid");
      await pool.query("update native_sessions set expires_at = now() + interval '180 days' where token_hash = $1", [sha256(issued!.token)]);
      assert.equal((await me(server.baseUrl, { authorization: `Bearer ${issued!.token}` })).nativeAuth, "valid");
    });

    // ------------------------------------------------------------ revocation
    await check("logout revokes exactly the presented token, immediately, and is idempotent", async () => {
      const response = await fetch(`${server.baseUrl}/api/auth/native/logout`, { method: "POST", headers: { authorization: `Bearer ${issued!.token}` } });
      assert.equal(response.status, 204);
      assert.equal((await me(server.baseUrl, { authorization: `Bearer ${issued!.token}` })).nativeAuth, "invalid");
      const { rows } = await pool.query("select revoked_reason from native_sessions where token_hash = $1", [sha256(issued!.token)]);
      assert.equal(rows[0].revoked_reason, "logout");
      const again = await fetch(`${server.baseUrl}/api/auth/native/logout`, { method: "POST", headers: { authorization: `Bearer ${issued!.token}` } });
      assert.equal(again.status, 204);
      const anonymous = await fetch(`${server.baseUrl}/api/auth/native/logout`, { method: "POST" });
      assert.equal(anonymous.status, 204);
      const { rows: others } = await pool.query("select count(*)::int as n from native_sessions where user_id = $1 and revoked_at is null", [issued!.user.id]);
      assert.equal(others[0].n, 1, "the android token must still be live");
    });
    await check("logout-all needs a valid bearer and revokes every native token AND every web cookie session", async () => {
      const denied = await fetch(`${server.baseUrl}/api/auth/native/logout-all`, { method: "POST" });
      assert.equal(denied.status, 401);
      const a = await (await postJson(server.baseUrl, "/api/auth/native/login", { email, password: PASSWORD, platform: "ios" })).json() as Issued;
      const b = await (await postJson(server.baseUrl, "/api/auth/native/login", { email, password: PASSWORD, platform: "android" })).json() as Issued;
      const web = await postJson(server.baseUrl, "/api/auth/login", { email, password: PASSWORD });
      const sid = sidFrom(web);
      assert.ok(sid, "web login must still set the sid cookie");
      assert.equal((await me(server.baseUrl, { cookie: `sid=${sid}` })).user?.email, email);
      const response = await fetch(`${server.baseUrl}/api/auth/native/logout-all`, { method: "POST", headers: { authorization: `Bearer ${a.token}` } });
      assert.equal(response.status, 204);
      assert.equal((await me(server.baseUrl, { authorization: `Bearer ${a.token}` })).nativeAuth, "invalid");
      assert.equal((await me(server.baseUrl, { authorization: `Bearer ${b.token}` })).nativeAuth, "invalid");
      assert.equal((await me(server.baseUrl, { cookie: `sid=${sid}` })).user, null, "web session must be gone too");
      const { rows } = await pool.query("select count(*)::int as n from native_sessions where user_id = $1 and revoked_at is null", [issued!.user.id]);
      assert.equal(rows[0].n, 0);
    });
    await check("password reset revokes native and web sessions; only the new password signs in", async () => {
      const native = await (await postJson(server.baseUrl, "/api/auth/native/login", { email, password: PASSWORD, platform: "ios" })).json() as Issued;
      const sid = sidFrom(await postJson(server.baseUrl, "/api/auth/login", { email, password: PASSWORD }));
      const resetToken = crypto.randomBytes(32).toString("hex");
      await pool.query("insert into password_reset_tokens (token, user_id, expires_at) values ($1, $2, now() + interval '1 hour')", [resetToken, issued!.user.id]);
      const response = await postJson(server.baseUrl, "/api/auth/reset-password", { token: resetToken, password: `${PASSWORD}-new` });
      assert.equal(response.status, 200, `reset-password → ${response.status}`);
      assert.equal((await me(server.baseUrl, { authorization: `Bearer ${native.token}` })).nativeAuth, "invalid");
      assert.equal((await me(server.baseUrl, { cookie: `sid=${sid}` })).user, null);
      const { rows } = await pool.query("select revoked_reason from native_sessions where token_hash = $1", [sha256(native.token)]);
      assert.equal(rows[0].revoked_reason, "password_reset");
      const old = await postJson(server.baseUrl, "/api/auth/native/login", { email, password: PASSWORD, platform: "ios" });
      assert.equal(old.status, 401);
      const fresh = await postJson(server.baseUrl, "/api/auth/native/login", { email, password: `${PASSWORD}-new`, platform: "ios" });
      assert.equal(fresh.status, 200);
    });

    // ------------------------------------------------------- web unchanged
    await check("web signup/login are unchanged: cookie session, no token in the body, nativeAuth null", async () => {
      const webEmail = `web-${suffix}@example.com`;
      const signup = await postJson(server.baseUrl, "/api/auth/signup", { email: webEmail, password: PASSWORD });
      assert.equal(signup.status, 201);
      assert.ok(sidFrom(signup));
      assert.equal("token" in (await signup.json() as object), false);
      const login = await postJson(server.baseUrl, "/api/auth/login", { email: webEmail, password: PASSWORD });
      assert.equal(login.status, 200);
      const sid = sidFrom(login);
      assert.match(cookieOf(login), /HttpOnly/i);
      assert.match(cookieOf(login), /SameSite=Lax/i);
      const payload = await me(server.baseUrl, { cookie: `sid=${sid}` });
      assert.equal(payload.user?.email, webEmail);
      assert.equal(payload.nativeAuth, null);
      const { rows } = await pool.query("select count(*)::int as n from native_sessions ns join users u on u.id = ns.user_id where u.email = $1", [webEmail]);
      assert.equal(rows[0].n, 0, "web login must not create native sessions");
    });
    await check("a bearer header takes precedence over a cookie for the same request; a cookie never authenticates a native route", async () => {
      const webEmail = `web-${suffix}@example.com`;
      const sid = sidFrom(await postJson(server.baseUrl, "/api/auth/login", { email: webEmail, password: PASSWORD }));
      const payload = await me(server.baseUrl, { cookie: `sid=${sid}`, authorization: "Bearer not-a-real-token" });
      assert.equal(payload.user, null); assert.equal(payload.nativeAuth, "invalid");
      const response = await fetch(`${server.baseUrl}/api/auth/native/logout-all`, { method: "POST", headers: { cookie: `sid=${sid}` } });
      assert.equal(response.status, 401, "logout-all is bearer-only");
    });

    // --------------------------------------------------------- rate limiting
    await check("the shared login throttle covers web AND native for the same email, with a generic 429", async () => {
      const victim = `victim-${suffix}@example.com`;
      await postJson(server.baseUrl, "/api/auth/signup", { email: victim, password: PASSWORD });
      for (let i = 0; i < 5; i += 1) assert.equal((await postJson(server.baseUrl, "/api/auth/login", { email: victim, password: "wrong-1" })).status, 401);
      for (let i = 0; i < 5; i += 1) assert.equal((await postJson(server.baseUrl, "/api/auth/native/login", { email: victim, password: "wrong-1", platform: "ios" })).status, 401);
      const web = await postJson(server.baseUrl, "/api/auth/login", { email: victim, password: PASSWORD });
      assert.equal(web.status, 429, "10 failures across both routes must throttle the web route");
      assert.deepEqual(await web.json(), { error: "Too many sign-in attempts. Please try again later." });
      assert.ok(web.headers.get("retry-after"));
      const native = await postJson(server.baseUrl, "/api/auth/native/login", { email: victim, password: PASSWORD, platform: "ios" });
      assert.equal(native.status, 429, "…and the native route");
      // The same 429 for a non-existent account: no enumeration signal.
      const ghost = `ghost-${suffix}@example.com`;
      for (let i = 0; i < 10; i += 1) await postJson(server.baseUrl, "/api/auth/login", { email: ghost, password: "wrong-1" });
      const ghostThrottled = await postJson(server.baseUrl, "/api/auth/login", { email: ghost, password: "wrong-1" });
      assert.equal(ghostThrottled.status, 429);
      assert.deepEqual(await ghostThrottled.json(), { error: "Too many sign-in attempts. Please try again later." });
      // A different email from the same client is still under the per-IP budget.
      const other = await postJson(server.baseUrl, "/api/auth/native/login", { email, password: `${PASSWORD}-new`, platform: "ios" });
      assert.equal(other.status, 200);
    });

    // ------------------------------------------------------------------ CORS
    await check("preflight from capacitor://localhost with an Authorization header is allowed when ALLOWED_ORIGINS lists it", async () => {
      for (const origin of ["capacitor://localhost", "https://localhost"]) {
        const response = await fetch(`${server.baseUrl}/api/me`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
        assert.equal(response.headers.get("access-control-allow-origin"), origin, `${origin} should be reflected`);
        assert.match(response.headers.get("access-control-allow-headers") ?? "", /authorization/i);
      }
    });
  } finally {
    stopServer(server);
  }

  const bare = await startServer({ ALLOWED_ORIGINS: undefined });
  try {
    await check("without the shell origins in ALLOWED_ORIGINS the preflight gets no CORS headers (documented deployment prerequisite)", async () => {
      const response = await fetch(`${bare.baseUrl}/api/me`, { method: "OPTIONS", headers: { Origin: "capacitor://localhost", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    });
  } finally {
    stopServer(bare);
  }

  console.log("\nResults:");
  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`  ${result.ok ? "PASS" : "FAIL"} — ${result.name}`);
  await pool.end();
  if (failed.length) { console.error(`\n${failed.length} of ${results.length} checks failed.`); process.exit(1); }
  console.log(`\nAll ${results.length} native-auth checks passed.`);
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
