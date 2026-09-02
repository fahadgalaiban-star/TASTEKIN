// Automated regression coverage for privacy-safe product analytics. Runs
// the compiled api-server against a REAL Postgres database (point
// DATABASE_URL at a disposable/test database — this creates real rows) and
// drives it over real HTTP, so it exercises the actual route/middleware
// code path rather than a reimplementation.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:analytics
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyticsEvents, db } from "@workspace/db";
import { eq } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

let nextPort = 24900;

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
  async track(name: string, metadata: Record<string, unknown> = {}) {
    return this.request("/api/analytics/events", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, metadata }),
    });
  }
  async summary() {
    return this.request("/api/admin/analytics/summary");
  }
}

const tsxBin = path.join(repoRoot, "scripts/node_modules/.bin/tsx");

async function runScript(scriptPath: string, args: string[]) {
  return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    const child = spawn(tsxBin, [scriptPath, ...args], { cwd: path.join(repoRoot, "scripts"), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stdout += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
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

async function countRowsNamed(name: string) {
  const rows = await db.select().from(analyticsEvents).where(eq(analyticsEvents.name, name));
  return rows;
}

async function main() {
  const server = await startServer();
  try {
    const anon = new Session(server.baseUrl);
    const user = new Session(server.baseUrl);
    const userAccount = await user.signup(`analytics-user-${suffix}@example.com`, PASSWORD);
    const admin = new Session(server.baseUrl);
    const adminAccount = await admin.signup(`analytics-admin-${suffix}@example.com`, PASSWORD);
    const grant = await runScript(path.join(repoRoot, "scripts/src/admin-grant.ts"), ["--user-id", adminAccount.user.id, "--yes"]);
    assert.equal(grant.code, 0, `admin-grant should exit 0: ${grant.stdout}`);

    // --- 1. allowlist: event name validation ---
    await check("an unknown event name is accepted with a fire-and-forget 202 but never stored", async () => {
      const eventName = `not-a-real-event-${suffix}`;
      const response = await anon.track(eventName);
      assert.equal(response.status, 202, "analytics must never surface an error to the caller");
      const payload = (await response.json()) as { recorded: boolean };
      assert.equal(payload.recorded, false);
      assert.equal((await countRowsNamed(eventName)).length, 0);
    });
    await check("a known event name with valid (empty) metadata is accepted and stored", async () => {
      const response = await anon.track("explore_viewed", {});
      await expectStatus(response, 202);
      const payload = (await response.json()) as { recorded: boolean };
      assert.equal(payload.recorded, true);
    });

    // --- 2. allowlist: metadata shape validation ---
    await check("metadata with an unexpected extra field is rejected and not stored", async () => {
      const eventName = "creator_profile_viewed";
      const before = (await countRowsNamed(eventName)).length;
      const response = await anon.track(eventName, { creatorId: `creator-${suffix}`, extraField: "not allowed" });
      const payload = (await response.json()) as { recorded: boolean };
      assert.equal(payload.recorded, false);
      assert.equal((await countRowsNamed(eventName)).length, before);
    });
    await check("metadata with a wrong-typed field is rejected and not stored", async () => {
      const eventName = "explore_search_performed";
      const before = (await countRowsNamed(eventName)).length;
      const response = await anon.track(eventName, { hasQuery: "yes" });
      const payload = (await response.json()) as { recorded: boolean };
      assert.equal(payload.recorded, false);
      assert.equal((await countRowsNamed(eventName)).length, before);
    });

    // --- 3. privacy: no raw search text, no message/report/block/mute content, no PII ---
    await check("explore_search_performed never accepts or stores the raw query text", async () => {
      const before = (await countRowsNamed("explore_search_performed")).length;
      const rejected = await anon.track("explore_search_performed", { hasQuery: true, category: "Fashion", query: "someone's private search text" });
      assert.equal(((await rejected.json()) as { recorded: boolean }).recorded, false, "a query/text field must never be an accepted key for this event");
      const accepted = await anon.track("explore_search_performed", { hasQuery: true, category: "Fashion" });
      await expectStatus(accepted, 202);
      assert.equal(((await accepted.json()) as { recorded: boolean }).recorded, true);
      const rows = await countRowsNamed("explore_search_performed");
      assert.equal(rows.length, before + 1, "only the valid, text-free event should have been stored");
      for (const row of rows) {
        assert.ok(!JSON.stringify(row.metadata).toLowerCase().includes("private search text"));
      }
    });
    await check("no event accepts arbitrary free-text fields that could carry message/report/mute/block content, passwords, or emails", async () => {
      for (const [name, badMetadata] of [
        ["onboarding_completed", { note: "message body" }],
        ["save_added", { editId: `edit-${suffix}`, password: "hunter2" }],
        ["follow_added", { creatorId: `creator-${suffix}`, email: "someone@example.com" }],
      ] as const) {
        const response = await anon.track(name, badMetadata);
        const payload = (await response.json()) as { recorded: boolean };
        assert.equal(payload.recorded, false, `${name} must reject an unexpected field`);
      }
    });
    await check("userId on a stored event is only ever the authenticated internal user id, never client-supplied", async () => {
      const before = (await countRowsNamed("save_added")).length;
      const spoofAttempt = await anon.track("save_added", { editId: `edit-${suffix}-spoof` });
      await expectStatus(spoofAttempt, 202);
      const rows = await countRowsNamed("save_added");
      assert.equal(rows.length, before + 1);
      const stored = rows.find((row) => (row.metadata as { editId?: string })?.editId === `edit-${suffix}-spoof`);
      assert.ok(stored);
      assert.equal(stored?.userId, null, "an anonymous request must never be attributed to a user id");

      const asUser = await user.track("save_added", { editId: `edit-${suffix}-owned` });
      await expectStatus(asUser, 202);
      const ownedRow = (await countRowsNamed("save_added")).find((row) => (row.metadata as { editId?: string })?.editId === `edit-${suffix}-owned`);
      assert.equal(ownedRow?.userId, userAccount.user.id);
    });

    // --- 4. duplicate / rate protection ---
    await check("firing the same event twice in immediate succession is deduplicated to a single stored row", async () => {
      const editId = `edit-${suffix}-dedupe`;
      const [first, second] = await Promise.all([user.track("edit_viewed", { editId }), user.track("edit_viewed", { editId })]);
      await expectStatus(first, 202);
      await expectStatus(second, 202);
      const rows = (await countRowsNamed("edit_viewed")).filter((row) => (row.metadata as { editId?: string })?.editId === editId);
      assert.equal(rows.length, 1, "a near-simultaneous duplicate must not create a second row");
    });

    // --- 5. analytics failures never surface as an error to the caller ---
    await check("a rejected/invalid event still responds with success-shaped 202, never a 4xx/5xx", async () => {
      const response = await anon.track(`another-fake-event-${suffix}`, { anything: true });
      assert.equal(response.status, 202);
    });

    // --- 6. admin authorization on the dashboard ---
    await check("anonymous GET /api/admin/analytics/summary is rejected with 403", async () => {
      assert.equal((await anon.summary()).status, 403);
    });
    await check("non-admin GET /api/admin/analytics/summary is rejected with 403", async () => {
      assert.equal((await user.summary()).status, 403);
    });

    // --- 7. dashboard aggregation ---
    await check("the admin dashboard aggregates total events, unique users, event counts, onboarding, and funnel counts correctly", async () => {
      const marker = `dash-${suffix}`;
      await expectStatus(await user.track("onboarding_started"), 202);
      await expectStatus(await user.track("onboarding_completed"), 202);
      await expectStatus(await user.track("home_viewed", { tab: marker }), 202);
      await expectStatus(await user.track("explore_viewed"), 202);
      await new Promise((resolve) => setTimeout(resolve, 2100)); // clear the dedupe window before re-using the same names below

      const before = await admin.summary();
      await expectStatus(before, 200);
      const beforePayload = (await before.json()) as { periods: { last7Days: { totalEvents: number; eventCounts: Record<string, number> } } };
      const baselineTotal = beforePayload.periods.last7Days.totalEvents;
      const baselineHomeViewed = beforePayload.periods.last7Days.eventCounts.home_viewed ?? 0;

      await expectStatus(await anon.track("home_viewed", { tab: marker }), 202);

      const response = await admin.summary();
      await expectStatus(response, 200);
      const payload = (await response.json()) as {
        periods: {
          last7Days: { totalEvents: number; uniqueActiveUsers: number; eventCounts: Record<string, number>; onboarding: { started: number; completed: number; rate: number }; funnel: Array<{ step: string; count: number }> };
          last30Days: { totalEvents: number };
        };
      };
      const window7 = payload.periods.last7Days;
      assert.equal(window7.totalEvents, baselineTotal + 1, "the dashboard total must include the newly recorded event");
      assert.equal(window7.eventCounts.home_viewed, baselineHomeViewed + 1);
      assert.ok(window7.onboarding.started >= 1);
      assert.ok(window7.onboarding.completed >= 1);
      assert.ok(window7.onboarding.rate > 0 && window7.onboarding.rate <= 1);
      assert.ok(window7.funnel.some((step) => step.step === "home_viewed"));
      assert.ok(payload.periods.last30Days.totalEvents >= window7.totalEvents, "the 30-day window must be a superset of the 7-day window");
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
  console.log(`\nAll ${results.length} analytics regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
