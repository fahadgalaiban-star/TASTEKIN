// Explicit, operator-run admin revoke. Sets users.is_admin = false for one
// exact account. Nothing in the app will ever set it back to true on its
// own afterward — request-time authorization only ever reads this column,
// it never restores it from email or environment variables. The only way
// this account becomes an admin again is another deliberate admin-grant run.
//
// Usage:
//   pnpm --filter scripts run admin:revoke -- --user-id <id> --yes
//   pnpm --filter scripts run admin:revoke -- --email <email> --yes
//
// --user-id is preferred (immutable). --email is an explicit fallback.
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
    const target = await resolveAdminTarget(db, args, { allowFromEnv: false });

    if (!target) {
      console.error("No matching user found. Nothing changed.");
      process.exitCode = 1;
      return;
    }

    console.log(`Resolved target: id=${target.id} email=${target.email ?? "(none)"} isAdmin(current)=${target.isAdmin}`);

    if (!target.isAdmin) {
      console.log("This account is already not an admin. Nothing to do.");
      return;
    }

    if (!args.yes) {
      console.log("Dry run only — no changes made. Re-run with --yes to apply this exact revoke.");
      return;
    }

    const [updated] = await db.update(usersTable)
      .set({ isAdmin: false, updatedAt: new Date() })
      .where(eq(usersTable.id, target.id))
      .returning({ id: usersTable.id, email: usersTable.email, isAdmin: usersTable.isAdmin });

    console.log(`Revoked admin: id=${updated.id} email=${updated.email ?? "(none)"} isAdmin=${updated.isAdmin}`);
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
