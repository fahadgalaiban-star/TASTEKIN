// Integration coverage for a reported production bug: opening a creator
// profile (e.g. @noura.studio), then Report / Block / Mute all failing with
// HTTP 404 ("This content is not available to report" / "Account not
// found"). Root cause: the frontend's public-profile fetch
// (GET /api/creators/:username/profile) had a client-side fallback
// (`discoveryCreatorProfiles`) that rendered a fully interactive profile UI
// — Follow, Subscribe, Message, and a working-looking Report/Block/Mute
// menu — for usernames with NO backing `creator_workspaces` row at all. The
// backend's 404 was correct and honest the whole time: there was genuinely
// nothing to report/block/mute. The fix removes that phantom-profile
// fallback and stops rendering any interactive actions once a profile is
// confirmed missing, rather than hiding or converting the 404 itself.
//
// This suite locks in two things: (1) Report/Block/Mute for a genuinely
// real, seeded creator profile (an @noura.studio-equivalent fixture) work
// end-to-end, including duplicate-action and self-action handling, and (2)
// the exact reported symptom — a username with no backing account — still
// 404s honestly and identically across the profile fetch, Report, Block,
// and Mute, rather than silently succeeding or being papered over.
//
// Runs the compiled api-server against a REAL Postgres database (point
// DATABASE_URL at a disposable/test database — this creates real rows) and
// drives it over real HTTP.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:profile-safety-actions
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, userBlocks, userMutes, reports } from "@workspace/db";
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
    const profileResponse = await this.request("/api/creator-profile");
    await expectStatus(profileResponse, 200);
    const profile = (await profileResponse.json()) as { username: string; displayName: string };
    return { username: profile.username, displayName: profile.displayName };
  }
  async updateProfile(body: Record<string, unknown>) {
    return this.request("/api/creator-profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  async publicProfile(username: string) {
    return this.request(`/api/creators/${encodeURIComponent(username)}/profile`);
  }
  async report(body: Record<string, unknown>) {
    return this.request("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  async block(username: string) {
    return this.request("/api/blocks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }) });
  }
  async unblock(username: string) {
    return this.request(`/api/blocks/${encodeURIComponent(username)}`, { method: "DELETE" });
  }
  async mute(username: string) {
    return this.request("/api/mutes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }) });
  }
  async unmute(username: string) {
    return this.request(`/api/mutes/${encodeURIComponent(username)}`, { method: "DELETE" });
  }
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
    const reporter = new Session(server.baseUrl);
    const reporterAccount = await reporter.signup(`reporter-${suffix}@example.com`, PASSWORD);
    await reporter.ensureWorkspace();

    // A real, seeded creator fixture standing in for @noura.studio — a
    // genuine creator_workspaces row with a real ownerUserId, exactly the
    // shape Report/Block/Mute all require to resolve a profile target.
    const creator = new Session(server.baseUrl);
    const creatorAccount = await creator.signup(`noura-studio-${suffix}@example.com`, PASSWORD);
    const creatorWorkspace = await creator.ensureWorkspace();
    // Note: real usernames are constrained to [a-z0-9_] (no dots), so an
    // account literally named "noura.studio" could never exist — this
    // fixture uses the auto-assigned username and only sets the display
    // fields to match, which is enough to exercise the same lookup path.
    await expectStatus(await creator.updateProfile({
      displayName: "Noura Studio",
      username: creatorWorkspace.username,
      bio: "Small tables, beautiful ingredients, and places worth the detour.",
      city: "Jeddah", country: "Saudi Arabia", interests: ["Restaurants", "Places", "Travel", "Decor"],
      dateOfBirth: null, showAge: false, avatarObjectPath: null,
    }), 200);
    const creatorProfileResponse = await creator.request("/api/creator-profile");
    const creatorProfile = (await creatorProfileResponse.json()) as { username: string };
    const creatorUsername = creatorProfile.username;

    const missingUsername = `not-a-real-creator-${suffix}`;

    // --- 1. reproduce the exact reported bug: a username with no backing account ---
    await check("GET the public profile of a username with no backing account is a real 404", async () => {
      const response = await reporter.publicProfile(missingUsername);
      assert.equal(response.status, 404);
    });
    await check("reporting a profile with no backing account 404s honestly, not silently or with a generic 500", async () => {
      const response = await reporter.report({ targetType: "profile", targetId: missingUsername, reason: "spam" });
      assert.equal(response.status, 404);
      const body = await response.json() as { error: string };
      assert.equal(body.error, "This content is not available to report");
    });
    await check("blocking a profile with no backing account 404s honestly", async () => {
      const response = await reporter.block(missingUsername);
      assert.equal(response.status, 404);
      const body = await response.json() as { error: string };
      assert.equal(body.error, "Account not found");
    });
    await check("muting a profile with no backing account 404s honestly", async () => {
      const response = await reporter.mute(missingUsername);
      assert.equal(response.status, 404);
      const body = await response.json() as { error: string };
      assert.equal(body.error, "Account not found");
    });

    // --- 2. the actual fix: Report/Block/Mute all work for a real, seeded creator profile ---
    await check("GET the public profile of the real seeded creator (@noura.studio-equivalent) succeeds", async () => {
      const response = await reporter.publicProfile(creatorUsername);
      await expectStatus(response, 200);
      const body = await response.json() as { displayName: string };
      assert.equal(body.displayName, "Noura Studio");
    });
    await check("reporting the real creator's profile succeeds and is stored against the stable creatorId", async () => {
      const response = await reporter.report({ targetType: "profile", targetId: creatorUsername, reason: "spam" });
      await expectStatus(response, 201);
      const [row] = await db.select().from(reports).where(and(eq(reports.reporterUserId, reporterAccount.user.id), eq(reports.targetType, "profile")));
      assert.ok(row, "a reports row should exist");
      assert.notEqual(row.targetId, creatorUsername, "the stored targetId must be the stable creatorId, not the mutable username");
    });
    await check("a duplicate active report for the same profile is rejected, not silently duplicated", async () => {
      const response = await reporter.report({ targetType: "profile", targetId: creatorUsername, reason: "harassment" });
      assert.equal(response.status, 409);
      const rows = await db.select().from(reports).where(and(eq(reports.reporterUserId, reporterAccount.user.id), eq(reports.targetType, "profile")));
      assert.equal(rows.length, 1, "no duplicate report row should be created");
    });
    await check("reporting your own profile is rejected", async () => {
      const response = await creator.report({ targetType: "profile", targetId: creatorUsername, reason: "spam" });
      assert.equal(response.status, 400);
    });

    await check("blocking the real creator's profile succeeds", async () => {
      const response = await reporter.block(creatorUsername);
      await expectStatus(response, 201);
      const [row] = await db.select().from(userBlocks).where(and(eq(userBlocks.blockerUserId, reporterAccount.user.id), eq(userBlocks.blockedUserId, creatorAccount.user.id)));
      assert.ok(row, "a userBlocks row should exist");
    });
    await check("blocking the same profile again is idempotent, not a duplicate row", async () => {
      const response = await reporter.block(creatorUsername);
      assert.ok(response.status === 200 || response.status === 201, `expected a safe 2xx, got ${response.status}`);
      const rows = await db.select().from(userBlocks).where(and(eq(userBlocks.blockerUserId, reporterAccount.user.id), eq(userBlocks.blockedUserId, creatorAccount.user.id)));
      assert.equal(rows.length, 1, "repeated blocks must not create duplicate rows");
    });
    await check("blocking your own profile is rejected", async () => {
      const response = await creator.block(creatorUsername);
      assert.equal(response.status, 400);
    });
    await check("unblocking the real creator's profile succeeds and removes the row", async () => {
      const response = await reporter.unblock(creatorUsername);
      await expectStatus(response, 200);
      const [row] = await db.select().from(userBlocks).where(and(eq(userBlocks.blockerUserId, reporterAccount.user.id), eq(userBlocks.blockedUserId, creatorAccount.user.id)));
      assert.equal(row, undefined);
    });

    await check("muting the real creator's profile succeeds", async () => {
      const response = await reporter.mute(creatorUsername);
      await expectStatus(response, 201);
      const [row] = await db.select().from(userMutes).where(and(eq(userMutes.muterUserId, reporterAccount.user.id), eq(userMutes.mutedUserId, creatorAccount.user.id)));
      assert.ok(row, "a userMutes row should exist");
    });
    await check("muting the same profile again is idempotent, not a duplicate row", async () => {
      const response = await reporter.mute(creatorUsername);
      assert.ok(response.status === 200 || response.status === 201, `expected a safe 2xx, got ${response.status}`);
      const rows = await db.select().from(userMutes).where(and(eq(userMutes.muterUserId, reporterAccount.user.id), eq(userMutes.mutedUserId, creatorAccount.user.id)));
      assert.equal(rows.length, 1, "repeated mutes must not create duplicate rows");
    });
    await check("muting your own profile is rejected", async () => {
      const response = await creator.mute(creatorUsername);
      assert.equal(response.status, 400);
    });
    await check("unmuting the real creator's profile succeeds and removes the row", async () => {
      const response = await reporter.unmute(creatorUsername);
      await expectStatus(response, 200);
      const [row] = await db.select().from(userMutes).where(and(eq(userMutes.muterUserId, reporterAccount.user.id), eq(userMutes.mutedUserId, creatorAccount.user.id)));
      assert.equal(row, undefined);
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
  console.log(`\nAll ${results.length} profile-safety-action regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
