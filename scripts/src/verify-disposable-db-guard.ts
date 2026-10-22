/**
 * Proves that the disposable-database guard rejects every non-local or
 * production-like DATABASE_URL and accepts only local disposable servers.
 * Pure: opens no connection, needs no DATABASE_URL.
 *
 * Usage: pnpm --filter scripts run verify:disposable-db-guard
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DisposableDatabaseRefusal, assertDisposableDatabaseUrl } from "./disposable-db-guard";

const rejected: Array<[string, string | undefined, RegExp, string | undefined]> = [
  // [url, PROD_DB_URL, expected reason, label]
  ["", undefined, /DATABASE_URL is not set/, "empty"],
  ["   ", undefined, /DATABASE_URL is not set/, "blank"],
  ["not a url", undefined, /not a parseable URL/, "garbage"],
  ["mysql://root@127.0.0.1:3306/test", undefined, /not a postgres:\/\/ URL/, "wrong scheme"],
  ["postgresql://user:pw@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require", undefined, /managed\/remote database provider/, "Neon production shape"],
  ["postgresql://user:pw@db.example.com:5432/postgres", undefined, /host is not local/, "remote host"],
  ["postgresql://user:pw@10.0.0.5:5432/postgres", undefined, /host is not local/, "LAN address"],
  ["postgresql://user:pw@localhost.example.com/postgres", undefined, /host is not local/, "localhost lookalike"],
  ["postgresql://user:pw@127.0.0.2:5432/postgres", undefined, /host is not local/, "loopback range but not 127.0.0.1"],
  ["postgresql://user@helium.replit.dev/postgres", undefined, /managed\/remote database provider/, "Replit host"],
  ["postgresql://user:pw@mydb.abc123.eu-west-1.rds.amazonaws.com/postgres", undefined, /managed\/remote database provider/, "RDS host"],
  ["postgresql://postgres@127.0.0.1:5433/postgres?sslmode=require", undefined, /sslmode=require/, "local but TLS-required"],
  ["postgresql://postgres@127.0.0.1:5433/postgres?sslmode=verify-full", undefined, /sslmode=verify-full/, "local but verify-full"],
  ["postgresql://postgres@127.0.0.1:5433/postgres?channel_binding=require", undefined, /channel_binding=require/, "channel binding"],
  ["postgresql://postgres@127.0.0.1:5433/", undefined, /no admin database name/, "no database"],
  ["postgresql://postgres@127.0.0.1:5433", undefined, /no admin database name/, "no path at all"],
  ["postgresql://postgres@127.0.0.1:5433/production", undefined, /production-like/, "production db name"],
  ["postgresql://postgres@127.0.0.1:5433/tastekin_prod", undefined, /production-like/, "prod suffix"],
  ["postgresql://postgres@127.0.0.1:5433/tastekin", undefined, /production-like/, "app database name"],
  ["postgresql://postgres@127.0.0.1:5433/neondb", undefined, /production-like/, "neondb name"],
  ["postgresql://postgres@localhost:5432/postgres", "postgresql://postgres@localhost:5432/app", /shares host and port with PROD_DB_URL/, "same server as PROD_DB_URL"],
  ["postgresql://postgres@127.0.0.1/postgres", "postgresql://postgres@127.0.0.1:5432/app", /shares host and port with PROD_DB_URL/, "implicit 5432 equals PROD_DB_URL port"],
  ["postgresql://postgres@127.0.0.1:5433/postgres", "nonsense", /PROD_DB_URL is set but not a parseable/, "unparseable PROD_DB_URL"],
];

const accepted: Array<[string, string | undefined, string]> = [
  ["postgresql://postgres@127.0.0.1:5433/postgres", undefined, "loopback with explicit port"],
  ["postgres://postgres:postgres@localhost:5432/postgres", undefined, "localhost, postgres:// scheme, password"],
  ["postgresql://postgres@[::1]:5433/postgres", undefined, "IPv6 loopback"],
  ["postgresql://postgres@127.0.0.1:5433/postgres?sslmode=disable", undefined, "explicit sslmode=disable"],
  ["postgresql://postgres@127.0.0.1:5433/postgres", "postgresql://user:pw@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require", "PROD_DB_URL set but remote"],
  ["postgresql://postgres@127.0.0.1:5433/postgres", "postgresql://postgres@127.0.0.1:5432/app", "PROD_DB_URL on a different local port"],
];

let checks = 0;
for (const [url, prod, reason, label] of rejected) {
  assert.throws(
    () => assertDisposableDatabaseUrl(url, { PROD_DB_URL: prod }),
    (error: unknown) => {
      assert.ok(error instanceof DisposableDatabaseRefusal, `${label}: must throw DisposableDatabaseRefusal`);
      assert.match(error.message, reason, `${label}: wrong reason`);
      // The message must never echo the URL, its credentials or its host.
      for (const secret of ["pw", "neon.tech", "example.com", "10.0.0.5", "amazonaws", "replit.dev"]) {
        if (url.includes(secret)) assert.ok(!error.message.includes(secret), `${label}: message leaks "${secret}"`);
      }
      return true;
    },
    `${label}: must be rejected`,
  );
  checks += 1;
}
for (const [url, prod, label] of accepted) {
  const parsed = assertDisposableDatabaseUrl(url, { PROD_DB_URL: prod });
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname), `${label}: accepted host must be local`);
  checks += 1;
}

// End to end: the real verifier must refuse before any connection attempt.
// A remote hostname that cannot resolve would otherwise surface as a DNS or
// connection error — its absence proves the guard ran first.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
for (const [url, label] of [
  ["postgresql://user:pw@db.example.com:5432/postgres", "remote host"],
  ["postgresql://user:pw@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require", "managed provider"],
  ["postgresql://postgres@127.0.0.1:5433/production", "production-like name"],
] as const) {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url };
  delete env.PROD_DB_URL;
  const result = spawnSync("pnpm", ["--filter", "@workspace/scripts", "run", "verify:migration-ledger-report"], { cwd: repoRoot, env, encoding: "utf8", timeout: 120_000 });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0, `${label}: verifier must not succeed`);
  assert.match(output, /DisposableDatabaseRefusal|Refusing to run against this DATABASE_URL/, `${label}: verifier must refuse via the guard`);
  assert.doesNotMatch(output, /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|CREATE DATABASE|Scenario 0/, `${label}: verifier must refuse before connecting`);
  assert.ok(!output.includes("pw@"), `${label}: output must not echo credentials`);
  checks += 1;
}

console.log(`disposable-db guard: ${rejected.length} rejections, ${accepted.length} acceptances and 3 end-to-end refusals verified (${checks} checks)`);
