import { pool } from "@workspace/db";
import { runAccountMediaCleanup } from "../lib/account-media-cleanup";
import { logger } from "../lib/logger";

// Explicit one-shot runner. No startup hook, timer or schedule is installed.
async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--yes")) throw new Error("Usage: reconcile:account-media [--yes]");
    console.log(JSON.stringify(await runAccountMediaCleanup({ apply: args.includes("--yes") }), null, 2));
  } finally { await pool.end(); }
}
main().catch(error => { logger.error({ err: error }, "Account media cleanup failed"); process.exitCode = 1; });
