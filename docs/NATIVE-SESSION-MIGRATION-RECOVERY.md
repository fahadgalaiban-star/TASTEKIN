# Native-session production migration recovery

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
   other migration process is running. Confirm the intended `PROD_DB_URL`
   secret is present **without displaying it**. Do not paste URLs into a
   command, ticket, or log.
3. Run the default, read-only preflight:
   `pnpm --filter @workspace/scripts run recover:native-sessions`
4. Review its result. If it refuses, investigate drift instead of bypassing
   checks. No write occurs unless **both** explicit flags are supplied.
5. In the approved maintenance window, run:
   `pnpm --filter @workspace/scripts run recover:native-sessions -- --apply --confirm=APPLY-NATIVE-SESSIONS-RECOVERY`
6. Verify the ledger has one row per reviewed timestamp through 0022 and the
   `native_sessions` schema is correct. Verify API health and native bearer
   authentication through the deployed application separately.

The apply path takes a transaction-scoped advisory lock, rechecks the same
preconditions *after* obtaining it, appends the five missing historical
hash/timestamp pairs, executes the unchanged committed 0022 SQL, verifies
the resulting table/ledger, and commits once. Any precondition, SQL, or
verification failure rolls back the whole transaction. The tool prints no
connection details, user data, SQL driver errors, or tokens. A second apply
refuses because it is no longer in the pre-repair state.

## Rollback

Before commit, a failure automatically rolls back all changes. **After a
successful commit, do not delete ledger rows or drop `native_sessions`**:
new native sessions may already contain production data. If a post-commit
problem occurs, preserve the database and logs, disable affected native
traffic using the existing operational controls, and arrange a reviewed
forward fix or restoration from the pre-operation production snapshot.
Do not rerun the tool to attempt a rollback.

## Disposable test

`pnpm --filter @workspace/scripts run verify:native-session-recovery` uses
`DATABASE_URL` only to create an isolated temporary database on the
development server. It refuses to use the production server when
`PROD_DB_URL` is configured. The fixture represents ledger 0–16 plus the
0017–0021 schema but no later ledger rows or 0022 schema; it verifies dry
run, apply, and repeat-apply behavior. Never point this test at production.