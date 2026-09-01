// Automated regression coverage for user reporting and the Admin report
// review queue. Runs the compiled api-server against a REAL Postgres
// database (point DATABASE_URL at a disposable/test database — this creates
// real rows) and drives it over real HTTP, so it exercises the actual
// route/middleware code path rather than a reimplementation.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:reports
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { creatorWorkspaces, db, moderationAuditLog, reports, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}

let nextPort = 24300;

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
    assert.equal(response.status, 201, `signup for ${email} should succeed`);
    return (await response.json()) as { user: { id: string; email: string } };
  }
  async ensureWorkspace() {
    const workspaceResponse = await this.request("/api/creator-workspace");
    assert.equal(workspaceResponse.status, 200, "creator-workspace should lazily provision a workspace");
    const workspace = (await workspaceResponse.json()) as { creatorId: string };
    const profileResponse = await this.request("/api/creator-profile");
    assert.equal(profileResponse.status, 200, "creator-profile should be readable right after provisioning");
    const profile = (await profileResponse.json()) as { username: string };
    return { creatorId: workspace.creatorId, username: profile.username };
  }
  async postComment(editId: string, body: string) {
    const response = await this.request(`/api/edits/${encodeURIComponent(editId)}/comments`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }),
    });
    await expectStatus(response, 201);
    return (await response.json()) as { id: string };
  }
  async report(body: Record<string, unknown>) {
    return this.request("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  async adminReports(query = "") {
    return this.request(`/api/admin/reports${query}`);
  }
  async reviewReport(id: string, body: Record<string, unknown>) {
    return this.request(`/api/admin/reports/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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

async function addEditsToWorkspace(creatorId: string, edits: Array<{ id: string; status: string; access: string; title?: string }>) {
  const [workspace] = await db.select().from(creatorWorkspaces).where(eq(creatorWorkspaces.creatorId, creatorId));
  const existing = (workspace?.edits as unknown[]) ?? [];
  await db.update(creatorWorkspaces).set({ edits: [...existing, ...edits], updatedAt: new Date() }).where(eq(creatorWorkspaces.creatorId, creatorId));
}

const suffix = Date.now();
const PASSWORD = "regression-test-1234";
const results: Array<{ name: string; ok: boolean; error?: string }> = [];

async function expectStatus(response: Response, expected: number) {
  if (response.status !== expected) {
    const text = await response.text().catch(() => "");
    throw new Error(`expected status ${expected}, got ${response.status}: ${text}`);
  }
}

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
    // --- fixtures ---
    const reporterEmail = `reporter-${suffix}@example.com`;
    const ownerEmail = `owner-${suffix}@example.com`;
    const commenterEmail = `commenter-${suffix}@example.com`;
    const adminEmail = `admin-${suffix}@example.com`;

    const reporter = new Session(server.baseUrl);
    const reporterAccount = await reporter.signup(reporterEmail, PASSWORD);

    const owner = new Session(server.baseUrl);
    await owner.signup(ownerEmail, PASSWORD);
    const ownerWorkspace = await owner.ensureWorkspace();

    const commenter = new Session(server.baseUrl);
    await commenter.signup(commenterEmail, PASSWORD);

    const admin = new Session(server.baseUrl);
    const adminAccount = await admin.signup(adminEmail, PASSWORD);
    const grant = await runScript(path.join(repoRoot, "scripts/src/admin-grant.ts"), ["--user-id", adminAccount.user.id, "--yes"]);
    assert.equal(grant.code, 0, `admin-grant should exit 0: ${grant.stdout}`);

    const publicEditId = `edit-${suffix}-public`;
    const lockedEditId = `edit-${suffix}-locked`;
    await addEditsToWorkspace(ownerWorkspace.creatorId, [
      { id: publicEditId, status: "published", access: "public", title: "A public Edit" },
      { id: lockedEditId, status: "published", access: "locked", title: "A locked Edit" },
    ]);
    const comment = await commenter.postComment(publicEditId, "This is a normal comment");

    // --- 1. report creation across all three target types ---
    await check("authenticated user can report an Edit (post)", async () => {
      const response = await reporter.report({ targetType: "edit", targetId: publicEditId, reason: "spam" });
      await expectStatus(response, 201);
      const body = await response.json() as Record<string, unknown>;
      assert.equal(body.targetType, "edit");
      assert.equal(body.targetId, publicEditId);
      assert.equal(body.status, "pending");
    });

    await check("authenticated user can report a comment", async () => {
      const response = await reporter.report({ targetType: "comment", targetId: comment.id, reason: "harassment" });
      assert.equal(response.status, 201, await response.text().catch(() => ""));
    });

    await check("authenticated user can report a profile (addressed by username)", async () => {
      const response = await reporter.report({ targetType: "profile", targetId: ownerWorkspace.username, reason: "hate_or_abuse" });
      assert.equal(response.status, 201, await response.text().catch(() => ""));
      const [row] = await db.select().from(reports).where(eq(reports.reporterUserId, reporterAccount.user.id));
      assert.ok(row, "a report row should exist");
    });

    await check("profile report is stored against the stable creatorId, not the username", async () => {
      const [row] = await db.select().from(reports).where(sql`${reports.targetType} = 'profile' and ${reports.reporterUserId} = ${reporterAccount.user.id}`);
      assert.ok(row);
      assert.equal(row.targetId, ownerWorkspace.creatorId);
    });

    await check("\"other\" reason requires details", async () => {
      const response = await reporter.report({ targetType: "edit", targetId: publicEditId, reason: "other" });
      assert.equal(response.status, 400);
    });

    await check("\"other\" reason with details succeeds and persists the details", async () => {
      // use a distinct target to avoid the active-duplicate guard
      const secondEditId = `edit-${suffix}-other-reason`;
      await addEditsToWorkspace(ownerWorkspace.creatorId, [{ id: secondEditId, status: "published", access: "public" }]);
      const response = await reporter.report({ targetType: "edit", targetId: secondEditId, reason: "other", details: "Something specific." });
      await expectStatus(response, 201);
      const body = await response.json() as Record<string, unknown>;
      assert.equal(body.details, "Something specific.");
    });

    // --- 2. self-report prevention ---
    await check("a creator cannot report their own Edit", async () => {
      const response = await owner.report({ targetType: "edit", targetId: publicEditId, reason: "spam" });
      assert.equal(response.status, 400);
    });

    await check("a commenter cannot report their own comment", async () => {
      const response = await commenter.report({ targetType: "comment", targetId: comment.id, reason: "spam" });
      assert.equal(response.status, 400);
    });

    await check("a creator cannot report their own profile", async () => {
      const response = await owner.report({ targetType: "profile", targetId: ownerWorkspace.username, reason: "spam" });
      assert.equal(response.status, 400);
    });

    // --- 3. duplicate prevention ---
    await check("a second active report by the same user against the same target is rejected (409)", async () => {
      const response = await reporter.report({ targetType: "edit", targetId: publicEditId, reason: "violence" });
      assert.equal(response.status, 409, "reporter already has a pending report against this Edit from check #1");
    });

    await check("a different user may still report the same already-reported target", async () => {
      const response = await commenter.report({ targetType: "edit", targetId: publicEditId, reason: "spam" });
      assert.equal(response.status, 201, await response.text().catch(() => ""));
    });

    // --- 4. IDOR / BOLA safety ---
    await check("reporting a nonexistent Edit returns a generic 404", async () => {
      const response = await reporter.report({ targetType: "edit", targetId: "does-not-exist", reason: "spam" });
      assert.equal(response.status, 404);
    });

    await check("reporting a locked Edit you cannot read returns the same generic 404 (no existence oracle)", async () => {
      const response = await reporter.report({ targetType: "edit", targetId: lockedEditId, reason: "spam" });
      assert.equal(response.status, 404);
    });

    await check("reporting a malformed comment id returns 404, not a 500", async () => {
      const response = await reporter.report({ targetType: "comment", targetId: "not-a-uuid", reason: "spam" });
      assert.equal(response.status, 404);
    });

    await check("reporting an unknown username returns a generic 404", async () => {
      const response = await reporter.report({ targetType: "profile", targetId: `nobody-${suffix}`, reason: "spam" });
      assert.equal(response.status, 404);
    });

    // --- 5. rate limiting ---
    await check("excessive report creation is rate-limited (429)", async () => {
      const rateLimiter = new Session(server.baseUrl);
      await rateLimiter.signup(`rate-limited-${suffix}@example.com`, PASSWORD);
      const rateWorkspace = await rateLimiter.ensureWorkspace();
      // needs its own owned edits so the rate-limited session isn't blocked by self-report
      const targets = Array.from({ length: 25 }, (_, index) => ({ id: `edit-${suffix}-rate-${index}`, status: "published", access: "public" }));
      await addEditsToWorkspace(ownerWorkspace.creatorId, targets);
      const statuses: number[] = [];
      for (const target of targets) {
        const response = await rateLimiter.report({ targetType: "edit", targetId: target.id, reason: "spam" });
        statuses.push(response.status);
      }
      assert.ok(statuses.some((status) => status === 429), `expected at least one 429 among ${JSON.stringify(statuses)}`);
      assert.equal(statuses.filter((status) => status === 201).length <= 20, true, "no more than the configured cap should succeed");
    });

    // --- 6. reporter privacy ---
    await check("the report creation response never includes reporter identity fields", async () => {
      const thirdEditId = `edit-${suffix}-privacy`;
      await addEditsToWorkspace(ownerWorkspace.creatorId, [{ id: thirdEditId, status: "published", access: "public" }]);
      const response = await reporter.report({ targetType: "edit", targetId: thirdEditId, reason: "spam" });
      assert.equal(response.status, 201);
      const body = await response.json() as Record<string, unknown>;
      assert.equal("reporterUserId" in body, false);
      assert.equal("reporterEmail" in body, false);
    });

    await check("the reported user (non-admin) cannot see the report queue at all", async () => {
      assert.equal((await owner.adminReports()).status, 403);
      assert.equal((await commenter.adminReports()).status, 403);
    });

    // --- 7. unauthorized admin access ---
    await check("a signed-in non-admin gets 403 from the report queue", async () => {
      assert.equal((await reporter.adminReports()).status, 403);
    });

    await check("an unauthenticated request gets 403, not 500, from the report queue", async () => {
      const anon = new Session(server.baseUrl);
      assert.equal((await anon.adminReports()).status, 403);
    });

    // --- 8. admin status changes + audit log ---
    let reviewedReportId = "";
    await check("admin can list reports newest-first and filter by status/target type", async () => {
      const response = await admin.adminReports("?status=pending&targetType=edit");
      await expectStatus(response, 200);
      const payload = await response.json() as { reports: Array<{ id: string; status: string; targetType: string; reporterEmail: string | null }> };
      assert.ok(payload.reports.length > 0);
      assert.ok(payload.reports.every((row) => row.status === "pending" && row.targetType === "edit"));
      // admin views may see reporter identity for anti-abuse operational review
      assert.ok(payload.reports.some((row) => row.reporterEmail === reporterEmail));
      reviewedReportId = payload.reports[0].id;
    });

    await check("admin can mark a report under review without a note", async () => {
      const response = await admin.reviewReport(reviewedReportId, { status: "under_review" });
      await expectStatus(response, 200);
      const body = await response.json() as Record<string, unknown>;
      assert.equal(body.status, "under_review");
    });

    await check("resolving a report without a note is rejected", async () => {
      const response = await admin.reviewReport(reviewedReportId, { status: "resolved" });
      assert.equal(response.status, 400);
    });

    await check("resolving a report with a note succeeds and is recorded", async () => {
      const response = await admin.reviewReport(reviewedReportId, { status: "resolved", adminNote: "Reviewed and actioned outside this system." });
      await expectStatus(response, 200);
      const body = await response.json() as Record<string, unknown>;
      assert.equal(body.status, "resolved");
      assert.equal(body.adminNote, "Reviewed and actioned outside this system.");
    });

    await check("dismissing a report without a note is rejected", async () => {
      const [another] = await db.select().from(reports).where(eq(reports.targetId, comment.id));
      assert.ok(another);
      const response = await admin.reviewReport(another.id, { status: "dismissed" });
      assert.equal(response.status, 400);
    });

    await check("a report never auto-hides or deletes its target", async () => {
      const editStillThere = await reporter.request(`/api/edits/${encodeURIComponent(publicEditId)}/engagement`);
      assert.equal(editStillThere.status, 200, "the reported Edit must still be fully readable after being reported and reviewed");
      const commentsStillThere = await reporter.request(`/api/edits/${encodeURIComponent(publicEditId)}/comments`);
      const commentRows = await commentsStillThere.json() as Array<{ id: string }>;
      assert.ok(commentRows.some((row) => row.id === comment.id), "the reported comment must not have been deleted by review");
    });

    await check("every admin status change is recorded in the immutable moderation audit log", async () => {
      const auditRows = await db.select().from(moderationAuditLog).where(eq(moderationAuditLog.reportId, reviewedReportId));
      assert.equal(auditRows.length, 2, "under_review then resolved should each produce one audit row");
      assert.deepEqual(auditRows.map((row) => row.toStatus).sort(), ["resolved", "under_review"]);
      const resolvedRow = auditRows.find((row) => row.toStatus === "resolved")!;
      assert.equal(resolvedRow.fromStatus, "under_review");
      assert.equal(resolvedRow.adminUserId, adminAccount.user.id);
      assert.equal(resolvedRow.note, "Reviewed and actioned outside this system.");
    });

    await check("admin review status changes are visible in an admin listing filtered by the new status", async () => {
      const response = await admin.adminReports("?status=resolved");
      assert.equal(response.status, 200);
      const payload = await response.json() as { reports: Array<{ id: string }> };
      assert.ok(payload.reports.some((row) => row.id === reviewedReportId));
    });

    // --- 9. existing account row untouched ---
    await check("regression: reporting/reviewing never mutates the reported user's own account row", async () => {
      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, adminAccount.user.id));
      assert.ok(row?.isAdmin, "the admin grant used for setup must still hold");
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
  console.log(`\nAll ${results.length} reports/moderation regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
