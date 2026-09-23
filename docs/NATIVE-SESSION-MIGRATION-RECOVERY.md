# Native-session production migration recovery

> **Complete this recovery before any further Replit republish.**
> Production's Drizzle ledger stops at 0016 while the 0017–0021 schema is
> already present. Migrations 0017–0020 contain non-idempotent DDL, so the
> deployment's boot-time migration runner (`RUN_MIGRATIONS_ON_BOOT=true`)
> would try to re-run 0017 on the next republish, fail on the existing
> `video_uploads` table, and leave the deployment unable to start. Run the
> apply step below first; only then republish.

This is an **exceptional, one-time ledger repair** for the reviewed drift:
production has the complete schema effects of migrations 0017–0021, but its
Drizzle ledger stops at 0016. Migration 0022 and `native_sessions` are absent.
Routine operation must not hand-edit the ledger. This tool is deliberately
limited to the exact reviewed journal timestamps and committed SQL hashes,
including production's historical 0000 hash difference; it never replaces
existing rows or reads from the workspace `DATABASE_URL`.

## Operator checklist

1. Review and merge the recovery PR. Do **not** add this command to CI,
   deployment, app startup, or an automated scheduler.
2. Arrange a production backup/snapshot and a maintenance window. Ensure no
   other migration process is running (no republish in progress). Confirm the
   intended `PROD_DB_URL` secret is present **without displaying it**. Do not
   paste URLs into a command, ticket, or log.
3. Run the default, read-only preflight:
   `pnpm --filter @workspace/scripts run recover:native-sessions`
4. Review its result. If it refuses, investigate drift instead of bypassing
   checks. No write occurs unless **both** explicit flags are supplied.
5. In the approved maintenance window, run:
   `pnpm --filter @workspace/scripts run recover:native-sessions --apply --confirm=APPLY-NATIVE-SESSIONS-RECOVERY`
   pnpm passes the flags straight through. The same command with a
   standalone `--` before the flags is also accepted (pnpm forwards that
   separator to the script, and the tool tolerates exactly one of them);
   both forms are covered by the disposable test.
6. Verify the ledger has one row per reviewed timestamp through 0022 and the
   `native_sessions` schema is correct. Verify API health and native bearer
   authentication through the deployed application separately.
7. Only now republish from the Replit Publishing panel.

The apply path takes a transaction-scoped advisory lock (the same key the
boot runner uses, so a concurrent republish migration is serialized against
it), rechecks the same preconditions *after* obtaining it, appends the five
missing historical hash/timestamp pairs, executes the unchanged committed
0022 SQL, verifies the resulting table/ledger, and commits once. Any
precondition, SQL, or verification failure rolls back the whole transaction.
The tool prints no connection details, user data, SQL driver errors, or
tokens. A second apply refuses because it is no longer in the pre-repair
state.

## Rollback

Before commit, a failure automatically rolls back all changes. **After a
successful commit, do not delete ledger rows or drop `native_sessions`**:
new native sessions may already contain production data. If a post-commit
problem occurs, preserve the database and logs, disable affected native
traffic using the existing operational controls, and arrange a reviewed
forward fix or restoration from the pre-operation production snapshot.
Do not rerun the tool to attempt a rollback.

## Disposable test

`DATABASE_URL=postgresql://... pnpm --filter @workspace/scripts run verify:native-session-recovery`
uses `DATABASE_URL` only to create an isolated, uniquely named temporary
database on that server, and drops it afterwards. **No production credential
is needed.** `PROD_DB_URL` is optional: when it happens to be present, it is
parsed (never connected to, never printed) purely to refuse a run whose test
target would coincide with production. The test first checks the CLI
argument contract, including both pnpm invocation forms, without any
database; the fixture then represents ledger 0–16 plus the 0017–0021 schema
but no later ledger rows or 0022 schema, and verifies dry run, rollback on a
post-check failure, apply, and repeat-apply refusal. Never point this test at
production.
