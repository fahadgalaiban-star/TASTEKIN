// "Set a password" for a Replit/Google-provider account, against the REAL
// api-server and a REAL disposable database:
//  - a Replit-created admin (no password) cannot sign in with email/password
//    and gets the pointer to Settings → Account;
//  - POST /api/auth/set-password needs a signed-in session (401 otherwise),
//    refuses a short password, and succeeds once for the signed-in account;
//  - afterwards email + password signs in to the SAME user id with admin
//    rights intact, auth_provider still "replit", /api/me passwordSet true,
//    exactly one users row for that email (no duplicate), the email
//    unchanged; the native (bearer) login works too; a second set is 409;
//  - the Replit upsert that runs on every Replit sign-in leaves the hash.
//
// Usage:
//   DATABASE_URL=postgresql://<disposable> pnpm --filter scripts run verify:set-password
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, sessionsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required — a disposable database, never production."); process.exit(1); }

async function startServer(): Promise<{ process: ChildProcess; baseUrl: string }> {
  const port = 24580 + Math.floor(Math.random() * 40);
  const child = spawn("node", [serverEntry], { env: { ...process.env, PORT: String(port), NODE_ENV: "production", SESSION_SECRET: process.env.SESSION_SECRET ?? "verify-set-password-not-a-real-secret" }, stdio: ["ignore", "pipe", "pipe"] });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseUrl}/api/healthz`)).ok) return { process: child, baseUrl }; } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill(); throw new Error("api-server did not become ready");
}

async function post(baseUrl: string, pathName: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${pathName}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), redirect: "manual" });
}
async function me(baseUrl: string, headers: Record<string, string>) {
  return (await fetch(`${baseUrl}/api/me`, { headers })).json() as Promise<{ user: { id: string; email: string } | null; isAdmin: boolean; authProvider: string | null; passwordSet: boolean }>;
}

const results: Array<{ name: string; ok: boolean }> = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ok — ${name}`); }
  catch (error) { results.push({ name, ok: false }); console.log(`  FAIL — ${name}\n    ${error instanceof Error ? error.message : error}`); }
}

async function main() {
  const stamp = Date.now().toString(36);
  // A Replit-created admin: id is the Replit subject, email as the provider
  // sent it (mixed case on purpose), no password, is_admin true.
  const userId = `replit-sub-${stamp}`;
  const email = `Dark.Admin.${stamp}@Example.test`;
  await db.insert(usersTable).values({ id: userId, email, firstName: "Dark", lastName: "Admin", authProvider: "replit", isAdmin: true });
  // The cookie session a Replit sign-in would have created (same shape as createSession()).
  const sid = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({ sid, sess: { user: { id: userId, email, firstName: "Dark", lastName: "Admin", profileImageUrl: null }, accessToken: "", expiresAt: Date.now() + 86_400_000 }, expire: new Date(Date.now() + 86_400_000) });
  const cookie = { cookie: `sid=${sid}` };
  const password = "set-from-settings-1234";

  const server = await startServer();
  try {
    await check("before: email/password sign-in is refused with a pointer to Settings → Account", async () => {
      const response = await post(server.baseUrl, "/api/auth/login", { email: email.toLowerCase(), password });
      assert.equal(response.status, 401);
      const body = await response.json() as { error: string };
      assert.match(body.error, /signed up with Replit sign-in/);
      assert.match(body.error, /Settings → Account/);
    });

    await check("/api/me for the Replit session says authProvider 'replit', passwordSet false, isAdmin true", async () => {
      const session = await me(server.baseUrl, cookie);
      assert.equal(session.user?.id, userId);
      assert.equal(session.authProvider, "replit");
      assert.equal(session.passwordSet, false);
      assert.equal(session.isAdmin, true);
    });

    await check("set-password without a session is 401 — nothing about it is reachable signed out", async () => {
      const response = await post(server.baseUrl, "/api/auth/set-password", { password });
      assert.equal(response.status, 401);
    });

    await check("a short password is refused with 400 and nothing is stored", async () => {
      assert.equal((await post(server.baseUrl, "/api/auth/set-password", { password: "short" }, cookie)).status, 400);
      const [row] = await db.select({ passwordHash: usersTable.passwordHash }).from(usersTable).where(eq(usersTable.id, userId));
      assert.equal(row.passwordHash, null);
    });

    await check("the signed-in account sets a password: 200, provider unchanged", async () => {
      const response = await post(server.baseUrl, "/api/auth/set-password", { password }, cookie);
      const text = await response.text();
      assert.equal(response.status, 200, text);
      assert.deepEqual(JSON.parse(text), { ok: true, authProvider: "replit", passwordSet: true });
    });

    let webCookie = "";
    await check("after: email + password signs in to the SAME user id with admin rights intact", async () => {
      const response = await post(server.baseUrl, "/api/auth/login", { email: email.toLowerCase(), password });
      assert.equal(response.status, 200, `login after set-password: ${response.status}`);
      webCookie = response.headers.get("set-cookie")!.split(";")[0];
      const session = await me(server.baseUrl, { cookie: webCookie });
      assert.equal(session.user?.id, userId, "same user id");
      assert.equal(session.user?.email, email, "email unchanged, including its case");
      assert.equal(session.isAdmin, true, "admin flag preserved");
      assert.equal(session.authProvider, "replit", "provider unchanged: Replit sign-in keeps working");
      assert.equal(session.passwordSet, true);
    });

    await check("the mixed-case email signs in whatever the typed case", async () => {
      assert.equal((await post(server.baseUrl, "/api/auth/login", { email: email.toUpperCase(), password })).status, 200);
    });

    await check("no duplicate user: exactly one users row for that email, same id as before", async () => {
      const rows = await db.select({ id: usersTable.id, authProvider: usersTable.authProvider, isAdmin: usersTable.isAdmin }).from(usersTable).where(sql`lower(${usersTable.email}) = ${email.toLowerCase()}`);
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], { id: userId, authProvider: "replit", isAdmin: true });
    });

    await check("the native (bearer) login works with the new password for the same account", async () => {
      const response = await post(server.baseUrl, "/api/auth/native/login", { email: email.toLowerCase(), password, platform: "ios", appVersion: "1.0.0" });
      const text = await response.text();
      assert.equal(response.status, 200, text);
      const body = JSON.parse(text) as { token: string; user: { id: string } };
      assert.equal(body.user.id, userId);
      const session = await me(server.baseUrl, { authorization: `Bearer ${body.token}` });
      assert.equal(session.user?.id, userId);
      assert.equal(session.isAdmin, true);
    });

    await check("setting a password a second time is refused with 409 (no silent overwrite)", async () => {
      const response = await post(server.baseUrl, "/api/auth/set-password", { password: "another-password-1234" }, cookie);
      assert.equal(response.status, 409);
      assert.equal((await post(server.baseUrl, "/api/auth/login", { email: email.toLowerCase(), password })).status, 200, "the original password still works");
    });

    await check("the Replit sign-in upsert (same statement shape) keeps the password hash and the admin flag", async () => {
      // Mirrors upsertUser(): insert … on conflict (id) do update set email/first/last/image/updated_at.
      await db.insert(usersTable).values({ id: userId, email, firstName: "Dark", lastName: "Admin", profileImageUrl: null, authProvider: "replit" })
        .onConflictDoUpdate({ target: usersTable.id, set: { email, firstName: "Dark", lastName: "Admin", profileImageUrl: null, updatedAt: new Date() } });
      const [row] = await db.select({ passwordHash: usersTable.passwordHash, isAdmin: usersTable.isAdmin, authProvider: usersTable.authProvider }).from(usersTable).where(eq(usersTable.id, userId));
      assert.ok(row.passwordHash, "hash survives the provider upsert");
      assert.equal(row.isAdmin, true);
      assert.equal(row.authProvider, "replit");
    });

    await check("a plain email/password account cannot use set-password (already has one): 409", async () => {
      const signup = await post(server.baseUrl, "/api/auth/signup", { email: `plain-${stamp}@example.test`, password, termsAccepted: true });
      assert.equal(signup.status, 201);
      const plainCookie = signup.headers.get("set-cookie")!.split(";")[0];
      assert.equal((await post(server.baseUrl, "/api/auth/set-password", { password: "whatever-1234" }, { cookie: plainCookie })).status, 409);
    });
  } finally {
    server.process.kill();
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length) { console.error(`\n${failed.length} of ${results.length} set-password checks failed.`); process.exitCode = 1; }
  else console.log(`\nAll ${results.length} set-password checks passed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => process.exit());
