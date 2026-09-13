// Dev workflow fix — regression coverage for the two real gaps behind
// "the API only works when started by hand": (1) no Replit workflow ever
// started the API server automatically (see .replit's new
// [[workflows.workflow]] block), and (2) the Vite dev server had no proxy
// for /api/*, so a browser talking to the Vite dev server's own origin
// could never reach the API server running on its own separate port —
// worse, a *direct* cross-origin fetch from the Vite origin to the API's
// origin would additionally be blocked by the API's own CORS policy
// (app.ts's ALLOWED_ORIGINS/selfOrigin check), since the two dev processes
// never share an origin. The fix (artifacts/tastekin/vite.config.ts's
// `server.proxy['/api']`) sidesteps that entirely: the browser only ever
// talks to the Vite dev server's own origin, and Vite's own Node-side
// proxy client makes the real (server-to-server, not browser, not
// CORS-checked) call to the API server.
//
// This starts BOTH real dev processes exactly as the fixed Replit
// workflow does — `pnpm --filter @workspace/api-server run dev` and
// `pnpm --filter @workspace/tastekin run dev` — against a disposable
// Postgres database, and proves the proxy actually forwards a request.
// Never touches Bunny, never runs a migration, never deploys.
//
// Usage:
//   DATABASE_URL=postgresql://... pnpm --filter scripts run verify:dev-proxy
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable dev database, never production.");
  process.exit(1);
}

const API_PORT = 25990;
const VITE_PORT = 25991;

async function waitForOk(url: string, deadlineMs: number): Promise<Response> {
  const deadline = Date.now() + deadlineMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${url} never became ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function spawnDev(label: string, args: string[], env: Record<string, string | undefined>): ChildProcess {
  const child = spawn("pnpm", args, { cwd: repoRoot, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  // Only surfaced on failure (see the catch block in main) — kept quiet
  // otherwise so a passing run stays as terse as every other verify:* script.
  const chunks: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => chunks.push(chunk));
  (child as ChildProcess & { __output: () => string }).__output = () => Buffer.concat(chunks).toString("utf-8").slice(-4000);
  void label;
  return child;
}

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
  const apiProcess = spawnDev("api-server", ["--filter", "@workspace/api-server", "run", "dev"], {
    PORT: String(API_PORT),
    SESSION_SECRET: "dev-proxy-verify-secret-never-used-in-prod",
  });
  const viteProcess = spawnDev("tastekin", ["--filter", "@workspace/tastekin", "run", "dev"], {
    PORT: String(VITE_PORT),
    BASE_PATH: "/",
    API_DEV_PORT: String(API_PORT),
  });

  try {
    await check("the API server (run exactly like the fixed Replit workflow's first task) becomes ready on its own port", async () => {
      const response = await waitForOk(`http://127.0.0.1:${API_PORT}/api/healthz`, 60_000);
      const body = await response.json() as { status: string };
      assert.equal(body.status, "ok");
    });

    await check("the Vite dev server (the fixed workflow's second task) becomes ready on its own, separate port", async () => {
      await waitForOk(`http://127.0.0.1:${VITE_PORT}/`, 60_000);
    });

    await check("a request to the Vite dev server's own origin at /api/healthz is proxied through to the real API server, not 404'd or served as the SPA fallback", async () => {
      const response = await fetch(`http://127.0.0.1:${VITE_PORT}/api/healthz`);
      assert.equal(response.status, 200, "the Vite dev server must forward this, not answer it itself");
      const body = await response.json() as { status: string };
      assert.equal(body.status, "ok");
    });

    await check("the proxied response is byte-for-byte the API server's own — proving it's a real forward, not a coincidental 200 from something else", async () => {
      const [direct, proxied] = await Promise.all([
        fetch(`http://127.0.0.1:${API_PORT}/api/version`),
        fetch(`http://127.0.0.1:${VITE_PORT}/api/version`),
      ]);
      const [directBody, proxiedBody] = await Promise.all([direct.json(), proxied.json()]);
      assert.deepEqual(proxiedBody, directBody, "the proxied /api/version must match the API server's own response exactly");
    });
  } finally {
    apiProcess.kill();
    viteProcess.kill();
  }

  // check() itself catches every failure to keep the suite running to
  // completion (same convention as every other verify:*.ts script) — the
  // process output is only useful once we know something actually failed.
  if (results.some((result) => !result.ok)) {
    console.log("--- api-server output (tail) ---");
    console.log((apiProcess as ChildProcess & { __output: () => string }).__output());
    console.log("--- tastekin (vite) output (tail) ---");
    console.log((viteProcess as ChildProcess & { __output: () => string }).__output());
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const result of failed) console.log(`  - ${result.name}: ${result.error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
