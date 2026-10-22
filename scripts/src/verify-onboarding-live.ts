// Sign-up → onboarding through the REAL web app and the REAL api-server, no
// mocks: starts the compiled server (which also serves the built web app)
// against a disposable database, then runs e2e/onboarding-live.spec.ts in
// Playwright against it. This is the check that catches a drift between the
// body the web app sends and what the API accepts — the mocked e2e suite
// cannot see that, and it once left every production sign-up stuck on
// "Invalid creator profile".
//
// Prerequisites (run once, from the repo root):
//   pnpm --filter @workspace/tastekin run build
//   pnpm --filter @workspace/api-server run build
// Usage:
//   DATABASE_URL=postgresql://<disposable> pnpm --filter scripts run verify:onboarding-live
//
// Creates real rows (accounts named live-<stamp>@example.test) in that
// database. Never point DATABASE_URL at production.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serverEntry = path.join(repoRoot, "artifacts/api-server/dist/index.mjs");
const webIndex = path.join(repoRoot, "artifacts/tastekin/dist/public/index.html");
const webDir = path.join(repoRoot, "artifacts/tastekin");
const port = Number(process.env.VERIFY_ONBOARDING_LIVE_PORT ?? 24490);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point this at a disposable test database, never production.");
  process.exit(1);
}
for (const [file, hint] of [[serverEntry, "pnpm --filter @workspace/api-server run build"], [webIndex, "pnpm --filter @workspace/tastekin run build"]] as const) {
  if (!existsSync(file)) {
    console.error(`Missing ${path.relative(repoRoot, file)} — run: ${hint}`);
    process.exit(1);
  }
}

async function startServer(): Promise<ChildProcess> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "production",
    SESSION_SECRET: process.env.SESSION_SECRET ?? "verify-onboarding-live-not-a-real-secret",
  };
  const child = spawn("node", [serverEntry], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
      if (response.ok) return child;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`api-server on port ${port} did not become ready in time`);
}

function runPlaywright(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "playwright", "test", "e2e/onboarding-live.spec.ts", "--reporter=line"], {
      cwd: webDir,
      env: { ...process.env, TASTEKIN_LIVE_API: "1", TASTEKIN_BASE_URL: `http://127.0.0.1:${port}` },
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function main() {
  console.log(`Starting api-server (serving the built web app) on http://127.0.0.1:${port} …`);
  const server = await startServer();
  try {
    const code = await runPlaywright();
    if (code === 0) console.log("verify:onboarding-live — sign-up and onboarding step 1 pass against the real API.");
    else console.error(`verify:onboarding-live — Playwright exited with code ${code}.`);
    process.exitCode = code;
  } finally {
    server.kill();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
