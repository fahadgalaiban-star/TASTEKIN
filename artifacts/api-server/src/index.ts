#!/usr/bin/env node
import path from "node:path";

import { runPendingMigrations } from "@workspace/db";

import app from "./app";
import { logger } from "./lib/logger";
import { markReady } from "./lib/startup-state";

// esbuild's banner (see build.mjs) sets this on globalThis from the bundle's
// own import.meta.url — same trick app.ts relies on to locate the sibling
// tastekin/dist/public directory.
declare const __dirname: string;

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function main() {
  // Bind the port FIRST, before anything that could block on the database —
  // Replit's Autoscale deployment watches for this port to open and SIGTERMs
  // the process if it doesn't within its own timeout. A slow or stuck
  // migration must never hold that up: the listener opens immediately, and
  // readinessMiddleware (mounted on "/api" in app.ts) answers GET /api and
  // GET /api/healthz with 200 { status: "starting" } — and 503 for every
  // other /api route — until markReady() below flips it. Health/port probes
  // hitting either of those two paths see the port open right away
  // regardless of how long migrations take.
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
      return;
    }
    logger.info({ port }, "Server listening");
  });

  // Explicit, off-by-default opt-in — only the real production deployment's
  // own run command sets this (see .replit). Local dev, preview workflows,
  // and every disposable-DB verify:* test suite keep booting exactly as
  // before, unaffected, since none of them set it: readiness is marked
  // immediately, with no migration step at all. This is what actually
  // applies Drizzle's tracked migrations (lib/db/migrations) to whatever
  // DATABASE_URL production has configured, before the app serves real
  // traffic — never manual SQL, never a hand-edited migration ledger.
  if (process.env.RUN_MIGRATIONS_ON_BOOT !== "true") {
    markReady();
    return;
  }

  // Overridable only for regression tests that need a controllable,
  // synthetic migration folder (e.g. one with a deliberate delay) to
  // observe the starting/ready transition over real HTTP — never set in
  // any real environment.
  const migrationsFolder = process.env.MIGRATIONS_FOLDER_OVERRIDE ?? path.resolve(__dirname, "../../../lib/db/migrations");
  logger.info({ migrationsFolder }, "Running pending database migrations…");
  try {
    await runPendingMigrations(migrationsFolder);
    logger.info("Database migrations up to date.");
    markReady();
  } catch (err) {
    logger.error({ err }, "Database migration failed — refusing to serve with a schema the app doesn't match");
    process.exit(1);
  }
}

main();
