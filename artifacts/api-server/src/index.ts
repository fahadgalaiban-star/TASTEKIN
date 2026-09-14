#!/usr/bin/env node
import app from "./app";
import { logger } from "./lib/logger";
import { markReady } from "./lib/startup-state";

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

function main() {
  const server = app.listen(port);

  server.once("listening", () => {
    logger.info({ port }, "Server listening");
    markReady();
  });

  server.once("error", (err) => {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  });
}

main();
