// One-time, additive, operator-run backfill for the new-user onboarding
// feature: existing accounts (present before this feature shipped) must
// never be forced through onboarding. New signups already get this
// naturally — onboarding_completed_at defaults to NULL and the app's own
// server-side logic (lib/onboarding.ts) also auto-exempts any account with
// real pre-existing content (a profile actually saved, real edits/
// collections, or a saved taste selection) the first time it's evaluated,
// with no operator action required. This script closes the one remaining
// gap: an existing account that has NEVER touched its profile or taste
// preferences at all (indistinguishable from "brand new" by content alone)
// would otherwise see onboarding once. Run this once, right after deploying
// the new columns and before resuming real traffic, to mark every account
// that already existed at that point as onboarded.
//
// Only ever sets onboarding_completed_at / onboarding_step. Never touches
// any other column, never deletes or resets anything.
//
// Usage:
//   pnpm --filter scripts run backfill:onboarding -- --yes
//   pnpm --filter scripts run backfill:onboarding -- --prod --yes
//
// Omit --yes to dry-run: prints how many rows would change and changes nothing.
import { usersTable } from "@workspace/db/schema";
import { isNull, sql } from "drizzle-orm";

import { parseArgs } from "./lib/resolve-admin-target";
import { connectDatabase } from "./lib/resolve-database";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { db, pool } = connectDatabase(args);
  try {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(usersTable).where(isNull(usersTable.onboardingCompletedAt));

    if (count === 0) {
      console.log("No accounts have a null onboarding_completed_at. Nothing to do.");
      return;
    }

    console.log(`${count} account(s) currently have onboarding_completed_at = NULL and would be marked onboarded.`);

    if (!args.yes) {
      console.log("Dry run only — no changes made. Re-run with --yes to apply.");
      return;
    }

    const updated = await db.update(usersTable)
      .set({ onboardingStep: "done", onboardingCompletedAt: sql`COALESCE(${usersTable.onboardingCompletedAt}, ${usersTable.createdAt})`, updatedAt: new Date() })
      .where(isNull(usersTable.onboardingCompletedAt))
      .returning({ id: usersTable.id });

    console.log(`Backfilled onboarding_completed_at for ${updated.length} existing account(s).`);
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
