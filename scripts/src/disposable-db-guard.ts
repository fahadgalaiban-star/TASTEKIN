/**
 * Fail-closed guard for verifiers that CREATE and DROP databases: they may
 * only ever run against a dedicated local disposable PostgreSQL server.
 *
 * Accepts a DATABASE_URL only when every one of these holds:
 *   - it parses as a postgres:// or postgresql:// URL;
 *   - the host is exactly localhost, 127.0.0.1 or ::1 (no remote host, no
 *     managed provider, no LAN address);
 *   - it carries no managed-provider marker (neon.tech, replit, amazonaws,
 *     supabase, azure, googleapis, …) anywhere in the string;
 *   - it does not demand TLS (sslmode=require/verify-*, channel_binding=
 *     require) — a local disposable server does not, managed ones do;
 *   - it names an admin database (the one CREATE DATABASE is issued from)
 *     whose name is not production-like (prod, production, live, neondb,
 *     tastekin);
 *   - when PROD_DB_URL is also set, it does not point at the same
 *     host:port (PROD_DB_URL is parsed only, never connected to or printed).
 *
 * Error messages never include the URL, credentials or the remote hostname.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const MANAGED_MARKERS = ["neon.tech", "replit", "amazonaws", "rds.", "supabase", "azure", "googleapis", "cloudsql", "digitalocean", "render.com", "railway", "heroku", "timescale", "crunchy", "aiven"];
const PRODUCTION_LIKE_DB = /(^|[^a-z])(prod|production|live|neondb|tastekin)([^a-z]|$)/i;

export class DisposableDatabaseRefusal extends Error {
  constructor(reason: string) {
    super(`Refusing to run against this DATABASE_URL: ${reason}. This verifier creates and drops databases and only accepts a dedicated local disposable PostgreSQL server (localhost / 127.0.0.1 / ::1).`);
    this.name = "DisposableDatabaseRefusal";
  }
}

function parse(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DisposableDatabaseRefusal(`${label} is not a parseable URL`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DisposableDatabaseRefusal(`${label} is not a postgres:// URL`);
  }
  return url;
}

/**
 * Throws DisposableDatabaseRefusal unless `databaseUrl` is a local
 * disposable server. Returns the parsed URL on success. Pure: no I/O.
 */
export function assertDisposableDatabaseUrl(databaseUrl: string | undefined, env: { PROD_DB_URL?: string } = {}): URL {
  if (!databaseUrl || !databaseUrl.trim()) throw new DisposableDatabaseRefusal("DATABASE_URL is not set");
  const lowered = databaseUrl.toLowerCase();
  for (const marker of MANAGED_MARKERS) {
    if (lowered.includes(marker)) throw new DisposableDatabaseRefusal("the URL references a managed/remote database provider");
  }
  const url = parse(databaseUrl, "DATABASE_URL");
  if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new DisposableDatabaseRefusal("the host is not local (only localhost, 127.0.0.1 or ::1 are accepted)");
  }
  const sslmode = url.searchParams.get("sslmode")?.toLowerCase();
  if (sslmode && sslmode !== "disable" && sslmode !== "allow" && sslmode !== "prefer") {
    throw new DisposableDatabaseRefusal(`sslmode=${sslmode} indicates a managed server, not a local disposable one`);
  }
  if (url.searchParams.get("channel_binding")?.toLowerCase() === "require") {
    throw new DisposableDatabaseRefusal("channel_binding=require indicates a managed server, not a local disposable one");
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!databaseName) throw new DisposableDatabaseRefusal("no admin database name is given (e.g. /postgres)");
  if (PRODUCTION_LIKE_DB.test(databaseName)) {
    throw new DisposableDatabaseRefusal("the admin database name looks production-like");
  }
  if (env.PROD_DB_URL) {
    let production: URL;
    try {
      production = parse(env.PROD_DB_URL, "PROD_DB_URL");
    } catch {
      throw new DisposableDatabaseRefusal("PROD_DB_URL is set but not a parseable postgres URL, so the target cannot be proven distinct from production");
    }
    if (production.hostname.toLowerCase() === url.hostname.toLowerCase() && (production.port || "5432") === (url.port || "5432")) {
      throw new DisposableDatabaseRefusal("the target shares host and port with PROD_DB_URL");
    }
  }
  return url;
}
