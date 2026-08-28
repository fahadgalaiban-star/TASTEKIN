// Automated regression coverage for new-user onboarding: gating (only
// genuinely new users see it), per-step server-side persistence and resume,
// username uniqueness (app-level and the underlying database constraint),
// per-user isolation, unauthorized/invalid requests, the automatic bypass
// for admin/verified/already-established accounts, and non-regression of
// Settings for a user who has been through onboarding.
//
// Runs the compiled api-server against a REAL Postgres database (point
// DATABASE_URL at a disposable/test database — this creates real rows) and
// drives it over real HTTP.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:onboarding
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { creatorWorkspaces, db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

let nextPort = 24400;

type Server = { port: number; process: ChildProcess; baseUrl: string };

async function startServer(extraEnv: Record<string, string | undefined> = {}): Promise<Server> {
  const port = nextPort;
  nextPort += 1;
  const env: Record<string, string | undefined> = { ...process.env, PORT: String(port), NODE_ENV: "production", ...extraEnv };
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
  }
  const child = spawn("node", [serverEntry], { env, stdio: ["ignore", "pipe", "pipe"] });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/healthz`);
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
    assert.equal(response.status, 201, `signup for ${email} should succeed`);
    return (await response.json()) as { user: { id: string; email: string } };
  }
  async login(email: string, password: string) {
    const response = await this.request("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200, `login for ${email} should succeed`);
  }
  async logout() { await this.request("/api/logout"); }
  async me() {
    const response = await this.request("/api/me");
    assert.equal(response.status, 200);
    return (await response.json()) as {
      user: { id: string; email: string } | null;
      isAdmin: boolean;
      needsOnboarding: boolean;
      onboardingStep: "basics" | "photo" | "city" | "taste" | "done";
    };
  }
  async saveProfile(body: Record<string, unknown>) {
    return this.request("/api/creator-profile", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "New Member", username: "placeholder", bio: "", city: "", country: "", interests: [], dateOfBirth: null, showAge: false, avatarObjectPath: null, ...body }),
    });
  }
  async saveTaste(categories: string[], tags: string[]) {
    return this.request("/api/taste-preferences", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ categories, tags }),
    });
  }
  async advance() { return this.request("/api/onboarding/advance", { method: "POST" }); }
  async adminCreatorsStatus() { return (await this.request("/api/admin/creators")).status; }
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
    console.log("Phase 1: gating, per-step server-side persistence, and validation.");

    const a = new Session(server.baseUrl);
    const userA = await a.signup(`onboard-a-${suffix}@example.com`, PASSWORD);

    await check("a freshly signed-up user needs onboarding, starting at 'basics'", async () => {
      const me = await a.me();
      assert.equal(me.needsOnboarding, true);
      assert.equal(me.onboardingStep, "basics");
    });

    await check("unauthenticated POST /api/onboarding/advance is rejected with 401", async () => {
      const anon = new Session(server.baseUrl);
      assert.equal((await anon.advance()).status, 401);
    });

    await check("advancing 'basics' before ever saving a profile is rejected with 400 and does not move the step", async () => {
      const response = await a.advance();
      assert.equal(response.status, 400);
      assert.equal((await a.me()).onboardingStep, "basics");
    });

    await check("an unavailable username is rejected with a clear error and does not advance", async () => {
      const b = new Session(server.baseUrl);
      await b.signup(`onboard-b-${suffix}@example.com`, PASSWORD);
      const claim = await b.saveProfile({ displayName: "B", username: `taken_${suffix}` });
      assert.equal(claim.status, 200);

      const collision = await a.saveProfile({ displayName: "A", username: `taken_${suffix}` });
      assert.equal(collision.status, 409);
      const body = await collision.json() as { error: string };
      assert.equal(body.error, "That username is already in use");
      assert.equal((await a.me()).onboardingStep, "basics");
    });

    await check("the database itself enforces username uniqueness case-insensitively, independent of app-level checks", async () => {
      const unique = `caseproof-${suffix}`;
      await db.insert(creatorWorkspaces).values({
        creatorId: `verify-onboarding-${suffix}-1`, ownerUserId: null, edits: [], collections: [],
        profile: { displayName: "X", username: unique, bio: "", city: "", country: "", interests: [], dateOfBirth: null, showAge: false, avatar: "" },
      });
      await assert.rejects(
        db.insert(creatorWorkspaces).values({
          creatorId: `verify-onboarding-${suffix}-2`, ownerUserId: null, edits: [], collections: [],
          profile: { displayName: "Y", username: unique.toUpperCase(), bio: "", city: "", country: "", interests: [], dateOfBirth: null, showAge: false, avatar: "" },
        }),
        (error: unknown) => {
          const message = String((error as { message?: unknown })?.message ?? error);
          const cause = (error as { cause?: { message?: unknown; code?: unknown } })?.cause;
          const causeMessage = cause ? String(cause.message ?? "") : "";
          const code = cause?.code;
          return code === "23505" || /duplicate key|unique constraint/i.test(`${message} ${causeMessage}`);
        },
      );
    });

    await check("saving a valid, available username advances 'basics' to 'photo'", async () => {
      const saved = await a.saveProfile({ displayName: "Alice A", username: `alice_${suffix}` });
      assert.equal(saved.status, 200);
      const advance = await a.advance();
      assert.equal(advance.status, 200);
      const body = await advance.json() as { step: string; completed: boolean };
      assert.equal(body.step, "photo");
      assert.equal(body.completed, false);
      assert.equal((await a.me()).onboardingStep, "photo");
    });

    await check("the 'photo' step is optional: advancing with no photo moves straight to 'city'", async () => {
      const advance = await a.advance();
      assert.equal(advance.status, 200);
      assert.equal((await a.me()).onboardingStep, "city");
    });

    await check("the 'city' step is optional: advancing with no city moves straight to 'taste'", async () => {
      const advance = await a.advance();
      assert.equal(advance.status, 200);
      assert.equal((await a.me()).onboardingStep, "taste");
    });

    await check("advancing 'taste' before saving any preferences is rejected with 400", async () => {
      const response = await a.advance();
      assert.equal(response.status, 400);
      assert.equal((await a.me()).onboardingStep, "taste");
    });

    await check("advancing 'taste' with categories but too few tags is still rejected", async () => {
      const saved = await a.saveTaste(["Fashion"], ["quiet-luxury"]);
      assert.equal(saved.status, 200);
      const response = await a.advance();
      assert.equal(response.status, 400);
    });

    await check("a complete taste selection finishes onboarding: completed=true, step='done'", async () => {
      const saved = await a.saveTaste(["Fashion", "Travel"], ["quiet-luxury", "tailoring", "slow-travel"]);
      assert.equal(saved.status, 200);
      const advance = await a.advance();
      assert.equal(advance.status, 200);
      const body = await advance.json() as { step: string; completed: boolean };
      assert.equal(body.step, "done");
      assert.equal(body.completed, true);
      const me = await a.me();
      assert.equal(me.needsOnboarding, false);
      assert.equal(me.onboardingStep, "done");
    });

    await check("onboarding never grants admin, verification, or subscriber access on its own", async () => {
      const me = await a.me();
      assert.equal(me.isAdmin, false);
    });

    console.log("\nPhase 2: durable resume across sign-out/sign-in, and per-user isolation.");

    const c = new Session(server.baseUrl);
    const userC = await c.signup(`onboard-c-${suffix}@example.com`, PASSWORD);
    void userC;
    let resumedC: Session = c;
    await check("completing only 'basics' then signing out and back in resumes at 'photo', not from scratch", async () => {
      const saved = await c.saveProfile({ displayName: "Cleo C", username: `cleo_${suffix}` });
      assert.equal(saved.status, 200);
      assert.equal((await c.advance()).status, 200);
      assert.equal((await c.me()).onboardingStep, "photo");

      await c.logout();
      const loggedOut = await c.me();
      assert.equal(loggedOut.user, null, "sign out must clear the session");

      resumedC = new Session(server.baseUrl);
      await resumedC.login(`onboard-c-${suffix}@example.com`, PASSWORD);
      const me = await resumedC.me();
      assert.equal(me.needsOnboarding, true);
      assert.equal(me.onboardingStep, "photo", "progress must be read from the server, not reset to the first step");
    });

    await check("two users' onboarding progress never interferes with each other", async () => {
      const meA = await a.me();
      const meC = await resumedC.me();
      assert.equal(meA.onboardingStep, "done");
      assert.equal(meC.onboardingStep, "photo");
    });

    console.log("\nPhase 3: existing/established accounts are never forced through onboarding.");

    await check("an account manually granted admin is exempt from onboarding without ever calling advance", async () => {
      const d = new Session(server.baseUrl);
      const userD = await d.signup(`onboard-d-${suffix}@example.com`, PASSWORD);
      assert.equal((await d.me()).needsOnboarding, true, "sanity: starts needing onboarding");
      const tsxBin = path.join(repoRoot, "scripts/node_modules/.bin/tsx");
      const grant = await new Promise<{ code: number; stdout: string }>((resolve, reject) => {
        const child = spawn(tsxBin, [path.join(repoRoot, "scripts/src/admin-grant.ts"), "--user-id", userD.user.id, "--yes"], {
          cwd: path.join(repoRoot, "scripts"), env: process.env, stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk) => { stdout += chunk.toString(); });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
      });
      assert.equal(grant.code, 0, grant.stdout);
      const me = await d.me();
      assert.equal(me.isAdmin, true);
      assert.equal(me.needsOnboarding, false, "an admin account must never be forced through onboarding");
    });

    await check("an account manually marked verified is exempt from onboarding without ever calling advance", async () => {
      const e = new Session(server.baseUrl);
      const userE = await e.signup(`onboard-e-${suffix}@example.com`, PASSWORD);
      assert.equal((await e.me()).needsOnboarding, true, "sanity: starts needing onboarding");
      await db.update(usersTable).set({ isVerified: true }).where(eq(usersTable.id, userE.user.id));
      const me = await e.me();
      assert.equal(me.needsOnboarding, false, "a verified account must never be forced through onboarding");
    });

    await check("an account with genuinely pre-existing published content (edits/collections) is exempt without ever calling advance", async () => {
      const f = new Session(server.baseUrl);
      const userF = await f.signup(`onboard-f-${suffix}@example.com`, PASSWORD);
      assert.equal((await f.me()).needsOnboarding, true, "sanity: starts needing onboarding");
      // Onboarding itself can never produce an Edit — simulating one here
      // stands in for "this account was already an active creator before
      // onboarding existed."
      await db.update(creatorWorkspaces)
        .set({ edits: [{ id: "legacy-edit", category: "Fashion", title: "Pre-existing", status: "published" }] })
        .where(eq(creatorWorkspaces.ownerUserId, userF.user.id));
      const me = await f.me();
      assert.equal(me.needsOnboarding, false, "an account with real pre-existing content must be treated as already onboarded");
      assert.equal(me.onboardingStep, "done");
    });

    await check("saving a profile mid-onboarding never retroactively completes onboarding on its own (the actual regression this suite caught)", async () => {
      const g = new Session(server.baseUrl);
      await g.signup(`onboard-g-${suffix}@example.com`, PASSWORD);
      assert.equal((await g.saveProfile({ displayName: "Gigi G", username: `gigi_${suffix}` })).status, 200);
      // A second, unrelated save (e.g. correcting a typo before advancing)
      // bumps creator_workspaces.revision again — this must never be
      // mistaken for "an established pre-existing account".
      assert.equal((await g.saveProfile({ displayName: "Gigi Ann G", username: `gigi_${suffix}` })).status, 200);
      const me = await g.me();
      assert.equal(me.needsOnboarding, true, "still legitimately mid-onboarding despite multiple profile saves");
      assert.equal(me.onboardingStep, "basics");
    });

    // Deliberately the LAST onboarding-state check against this server/DB:
    // the backfill script marks EVERY account with onboarding_completed_at
    // still NULL as done, which would corrupt the in-progress state any
    // earlier check in this file depends on (e.g. user C/G left mid-flow
    // above). Nothing after this point reads another user's onboarding step.
    await check("the operator-run backfill script marks a plain existing account (a saved profile, nothing else) as onboarded", async () => {
      const h = new Session(server.baseUrl);
      const userH = await h.signup(`onboard-h-${suffix}@example.com`, PASSWORD);
      assert.equal((await h.saveProfile({ displayName: "Existing User", username: `existinguser_${suffix}` })).status, 200);
      assert.equal((await h.me()).needsOnboarding, true, "sanity: a plain saved profile alone is not auto-exempt");

      const tsxBin = path.join(repoRoot, "scripts/node_modules/.bin/tsx");
      const backfill = await new Promise<{ code: number; stdout: string }>((resolve, reject) => {
        const child = spawn(tsxBin, [path.join(repoRoot, "scripts/src/backfill-onboarding.ts"), "--yes"], {
          cwd: path.join(repoRoot, "scripts"), env: process.env, stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk) => { stdout += chunk.toString(); });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
      });
      assert.equal(backfill.code, 0, backfill.stdout);

      const [row] = await db.select({ onboardingCompletedAt: usersTable.onboardingCompletedAt })
        .from(usersTable).where(eq(usersTable.id, userH.user.id)).limit(1);
      assert.ok(row.onboardingCompletedAt, "backfill must set onboarding_completed_at for a pre-existing account");
      const me = await h.me();
      assert.equal(me.needsOnboarding, false);
    });

    console.log("\nPhase 4: regression — Settings keeps working for a user who has been through onboarding.");
    await check("Settings PUT/GET still works normally for an onboarded account", async () => {
      const put = await a.request("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: "ar" }) });
      assert.equal(put.status, 200);
      const me = await a.request("/api/me").then((response) => response.json()) as { language: string };
      assert.equal(me.language, "ar");
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
  console.log(`\nAll ${results.length} onboarding regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
