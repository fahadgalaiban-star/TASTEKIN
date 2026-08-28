// Explicit, operator-run admin grant. This is the ONLY supported way to make
// an account an admin — request-time code never grants or restores this flag
// on its own. Safe to re-run: it always prints which database it's about to
// use and the exact row it resolved to before touching anything, and makes
// no change unless --yes is passed.
//
// Usage:
//   pnpm --filter scripts run admin:grant -- --user-id <id> --yes
//   pnpm --filter scripts run admin:grant -- --email <email> --yes
//   pnpm --filter scripts run admin:grant -- --from-env --yes
//
// --user-id is preferred (immutable). --email is an explicit fallback for
// when the id isn't already known. --from-env resolves the target using
// whichever of FOUNDER_AUTH_USER_ID / FOUNDER_EMAIL is already configured in
// this process's environment — a one-time bootstrap for the account that
// criteria already designates, run deliberately by a human, once.
//
// Database selection: reads DATABASE_URL by default. Pass --prod to use
// PROD_DB_URL instead (must already be set in this shell) — this is always
// an explicit, visible choice; there is no silent fallback between the two.
// The resolved database (host + name only, never credentials) is printed
// before anything else happens.
//
// Omit --yes to dry-run: it prints what would happen and changes nothing.
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

import { parseArgs, resolveAdminTarget } from "./lib/resolve-admin-target";
import { connectDatabase } from "./lib/resolve-database";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { db, pool } = connectDatabase(args);
  try {
    const target = await resolveAdminTarget(db, args, { allowFromEnv: true });

    if (!target) {
      console.error("No matching user found. Nothing changed.");
      process.exitCode = 1;
      return;
    }

    console.log(`Resolved target: id=${target.id} email=${target.email ?? "(none)"} isAdmin(current)=${target.isAdmin}`);

    if (target.isAdmin) {
      console.log("This account is already an admin. Nothing to do.");
      return;
    }

    if (!args.yes) {
      console.log("Dry run only — no changes made. Re-run with --yes to apply this exact grant.");
      return;
    }

    const [updated] = await db.update(usersTable)
      .set({ isAdmin: true, updatedAt: new Date() })
      .where(eq(usersTable.id, target.id))
      .returning({ id: usersTable.id, email: usersTable.email, isAdmin: usersTable.isAdmin });

    console.log(`Granted admin: id=${updated.id} email=${updated.email ?? "(none)"} isAdmin=${updated.isAdmin}`);
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
