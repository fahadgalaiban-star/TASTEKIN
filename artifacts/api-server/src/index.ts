#!/usr/bin/env node
import path from "node:path";

import { runPendingMigrations } from "@workspace/db";

import app from "./app";
import { logger } from "./lib/logger";

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
  // Explicit, off-by-default opt-in — only the real production deployment's
  // own run command sets this (see .replit). Local dev, preview workflows,
  // and every disposable-DB verify:* test suite keep booting exactly as
  // before, unaffected, since none of them set it. This is what actually
  // applies Drizzle's tracked migrations (lib/db/migrations) to whatever
  // DATABASE_URL production has configured, before the app accepts any
  // traffic — never manual SQL, never a hand-edited migration ledger.
  if (process.env.RUN_MIGRATIONS_ON_BOOT === "true") {
    const migrationsFolder = path.resolve(__dirname, "../../../lib/db/migrations");
    logger.info({ migrationsFolder }, "Running pending database migrations before startup…");
    try {
      await runPendingMigrations(migrationsFolder);
      logger.info("Database migrations up to date.");
    } catch (err) {
      logger.error({ err }, "Database migration failed — refusing to start with a schema the app doesn't match");
      process.exit(1);
      return;
    }
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

main();
