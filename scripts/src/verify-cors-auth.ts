// Regression coverage for a live-site authentication outage: "Continue with
// Replit" failing, email/password signup returning a bare "Internal server
// error", and login failing when the app is opened on a domain other than
// whatever ALLOWED_ORIGINS happened to list (a temporary Replit preview
// domain, or a published domain the secret was never updated for).
//
// Root cause: the CORS origin check rejected any Origin not in the static
// ALLOWED_ORIGINS allowlist by calling the `cors` package's callback with an
// Error, which the package re-throws — skipping every other middleware
// (including each route's own try/catch) and landing on app.ts's generic
// error handler, producing exactly {"error":"Internal server error"} for
// signup/login/anything else, regardless of what the route itself would
// have said. This suite locks in the fix: a request whose Origin exactly
// matches the host it actually arrived on (never truly cross-origin, since
// this one process serves both the frontend and /api) is always allowed
// without needing ALLOWED_ORIGINS to list every ephemeral preview domain,
// while a genuinely different origin is still denied — via omitted CORS
// headers (a normal browser-enforced block), never a thrown 500.
//
// Runs the compiled api-server against a REAL Postgres database (point
// DATABASE_URL at a disposable/test database — this creates real rows) and
// drives it over real HTTP.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:cors-auth
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

async function postJson(baseUrl: string, path: string, body: unknown, headers: Record<string, string>) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
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

async function main() {
  // ALLOWED_ORIGINS deliberately unset — the exact preview-deployment
  // condition (or a workspace where the secret was never configured at
  // all): only the built-in localhost dev defaults are recognized
  // explicitly, so a preview/production domain is only reachable through
  // the self-origin trust path this suite verifies.
  const server = await startServer({ ALLOWED_ORIGINS: undefined });
  try {
    // Node's fetch (like a browser's) refuses to let a caller override the
    // Host header — it always reflects the actual request URL. So the most
    // realistic way to simulate "a browser on some domain ALLOWED_ORIGINS
    // doesn't list" is to send Origin equal to the URL actually being hit:
    // that is precisely what a real browser sends when the page itself is
    // served from that domain, which is exactly the preview/production
    // scenario this fix targets (self-origin, not an explicit allowlist
    // entry — ALLOWED_ORIGINS is deliberately unset for this server).
    const selfOrigin = server.baseUrl;
    const evilOrigin = "https://evil.example.com";

    // --- 1. the actual reported bug: signup from an unlisted "self" origin ---
    await check("signup from an origin matching the request's own Host succeeds (not a 500)", async () => {
      const response = await postJson(server.baseUrl, "/api/auth/signup", { email: `preview-${suffix}@example.com`, password: PASSWORD }, { Origin: selfOrigin });
      const body = await response.json() as { user?: { email: string }; error?: string };
      assert.equal(response.status, 201, `expected 201, got ${response.status}: ${JSON.stringify(body)}`);
      assert.equal(response.headers.get("access-control-allow-origin"), selfOrigin, "the browser needs this header to read the response");
      assert.equal(body.user?.email, `preview-${suffix}@example.com`);
    });
    await check("login from that same self-origin succeeds (not a 500)", async () => {
      const response = await postJson(server.baseUrl, "/api/auth/login", { email: `preview-${suffix}@example.com`, password: PASSWORD }, { Origin: selfOrigin });
      assert.equal(response.status, 200, `expected 200, got ${response.status}: ${await response.text()}`);
      assert.equal(response.headers.get("access-control-allow-origin"), selfOrigin);
    });
    await check("GET /api/me from that self-origin succeeds and is never the generic 500", async () => {
      const response = await fetch(`${server.baseUrl}/api/me`, { headers: { Origin: selfOrigin } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), selfOrigin);
    });

    // --- 2. a real login/signup failure must still be its own honest error, never the CORS 500 ---
    await check("a wrong password from the self-origin is a real 401, not a generic 500", async () => {
      const response = await postJson(server.baseUrl, "/api/auth/login", { email: `preview-${suffix}@example.com`, password: "wrong-password" }, { Origin: selfOrigin });
      assert.equal(response.status, 401);
      const body = await response.json() as { error: string };
      assert.notEqual(body.error, "Internal server error");
    });

    // --- 3. an origin that is genuinely cross-site must still be denied ---
    await check("a request from a completely different origin gets no CORS header (the browser blocks it), but the server never 500s", async () => {
      const response = await postJson(server.baseUrl, "/api/auth/signup", { email: `evil-${suffix}@example.com`, password: PASSWORD }, { Origin: evilOrigin });
      assert.notEqual(response.status, 500, "a disallowed origin must never surface as an opaque server error");
      assert.equal(response.headers.get("access-control-allow-origin"), null, "no ACAO header means the browser will refuse to expose this response to that origin's JS");
    });
    await check("the previous check did not silently disable the CORS boundary: an explicitly allowed dev origin still gets its own ACAO header, not a wildcard", async () => {
      const response = await fetch(`${server.baseUrl}/api/me`, { headers: { Origin: "http://localhost:5173" } });
      assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
    });

    // --- 4. no Origin header at all (native apps, curl, server-to-server) is unaffected ---
    await check("a request with no Origin header at all still works normally", async () => {
      const response = await fetch(`${server.baseUrl}/api/me`);
      assert.equal(response.status, 200);
    });
  } finally {
    stopServer(server);
  }

  // A second server instance with ALLOWED_ORIGINS explicitly configured for
  // a real cross-origin case (e.g. a separate marketing site) — confirms
  // the explicit allowlist path still works exactly as before this change,
  // independent of the new self-origin trust.
  const configuredServer = await startServer({ ALLOWED_ORIGINS: "https://marketing.example.com" });
  try {
    await check("an explicitly configured ALLOWED_ORIGINS entry is still honored", async () => {
      const response = await fetch(`${configuredServer.baseUrl}/api/me`, { headers: { Origin: "https://marketing.example.com" } });
      assert.equal(response.headers.get("access-control-allow-origin"), "https://marketing.example.com");
    });
    await check("self-origin trust still applies alongside an explicit ALLOWED_ORIGINS list", async () => {
      const response = await fetch(`${configuredServer.baseUrl}/api/me`, { headers: { Origin: configuredServer.baseUrl } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), configuredServer.baseUrl);
    });
  } finally {
    stopServer(configuredServer);
  }

  console.log("\nResults:");
  const failed = results.filter((result) => !result.ok);
  for (const result of results) console.log(`  ${result.ok ? "PASS" : "FAIL"} — ${result.name}`);
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} checks failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} CORS/auth regression checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
