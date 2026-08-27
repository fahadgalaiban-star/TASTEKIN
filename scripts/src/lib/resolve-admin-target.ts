import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type ParsedArgs = Record<string, string | boolean>;

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

type UserRow = typeof usersTable.$inferSelect;

async function byId(id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  return row ?? null;
}

async function byEmail(email: string): Promise<UserRow | null> {
  const normalized = email.trim().toLowerCase();
  const rows = await db.select().from(usersTable).where(eq(usersTable.email, normalized));
  if (rows.length > 1) {
    throw new Error(`More than one account matches email ${normalized} — this should not be possible since email is unique, but resolve by --user-id instead.`);
  }
  return rows[0] ?? null;
}

/**
 * Resolves exactly one target user row for the admin-grant/admin-revoke
 * scripts. Never used at request time — this is operator-invoked tooling
 * only. --user-id is the preferred, immutable identifier; --email is an
 * explicit human-provided fallback; --from-env (grant only) reads the
 * existing FOUNDER_AUTH_USER_ID/FOUNDER_EMAIL bootstrap criteria, but only
 * because an operator deliberately asked this one invocation to use them —
 * never automatically, and never at request time.
 */
export async function resolveAdminTarget(args: ParsedArgs, options: { allowFromEnv?: boolean } = {}): Promise<UserRow | null> {
  const userId = args["user-id"];
  const email = args.email;
  const fromEnv = args["from-env"];

  const modesRequested = [userId, email, fromEnv].filter((value) => value !== undefined).length;
  if (modesRequested !== 1) {
    throw new Error("Pass exactly one of: --user-id <id> (preferred), --email <email>" + (options.allowFromEnv ? ", or --from-env." : "."));
  }

  if (typeof userId === "string") return byId(userId);
  if (typeof email === "string") return byEmail(email);

  if (fromEnv) {
    if (!options.allowFromEnv) throw new Error("--from-env is not supported by this command.");
    const founderId = process.env.FOUNDER_AUTH_USER_ID?.trim();
    const founderEmail = process.env.FOUNDER_EMAIL?.trim();
    if (founderId) return byId(founderId);
    if (founderEmail) return byEmail(founderEmail);
    throw new Error("--from-env was passed but neither FOUNDER_AUTH_USER_ID nor FOUNDER_EMAIL is set in this environment.");
  }

  throw new Error("Pass exactly one of: --user-id <id> (preferred), --email <email>" + (options.allowFromEnv ? ", or --from-env." : "."));
}
