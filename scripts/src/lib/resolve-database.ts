import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";

import type { ParsedArgs } from "./resolve-admin-target";

const { Pool } = pg;

export type AdminDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Deliberately does NOT import "@workspace/db" itself: that module's top
 * level constructs a Pool from process.env.DATABASE_URL the instant it's
 * imported, before this script's own argument parsing ever runs (static ES
 * imports are hoisted and evaluated ahead of the importing module's code,
 * regardless of where the import line sits textually) — so it could never
 * honor --prod. Importing only the schema (a plain object, no side effects)
 * and building the Pool/drizzle instance here, after --prod is resolved,
 * is what makes an explicit, deliberate choice possible.
 */
function resolveConnectionString(args: ParsedArgs): { url: string; source: "PROD_DB_URL" | "DATABASE_URL" } {
  if (args.prod) {
    const url = process.env.PROD_DB_URL?.trim();
    if (!url) throw new Error("--prod was passed but PROD_DB_URL is not set in this environment.");
    return { url, source: "PROD_DB_URL" };
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not set. Pass --prod to use PROD_DB_URL instead, or set DATABASE_URL explicitly.");
  return { url, source: "DATABASE_URL" };
}

/** Host + database name only — never the credentials embedded in the URL. */
function describeConnection(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(could not parse connection string)";
  }
}

export function connectDatabase(args: ParsedArgs): { db: AdminDb; pool: InstanceType<typeof Pool> } {
  const { url, source } = resolveConnectionString(args);
  console.log(`Connecting via ${source} → ${describeConnection(url)}${args.prod ? " (PRODUCTION)" : ""}`);
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  return { db, pool };
}
