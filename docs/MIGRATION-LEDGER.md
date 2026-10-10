# Migration ledger vs. Publishing — why they drift, and how to see the state

This page records what was established on 2026-10-10 from the repository
alone. No real database was read for it. It authorizes no operational
action: running migrations, editing a ledger, approving Publishing or
republishing each need their own approval under `TASTEKIN_CLAUDE.md` §2–§4.

## Three mechanisms shape the schema; one writes the ledger

| Mechanism | What it reads | What it changes | Ledger (`drizzle.__drizzle_migrations`) |
| --- | --- | --- | --- |
| `drizzle-kit push` — `scripts/post-merge.sh` (Replit task-agent post-merge hook, Development) | `lib/db/src/schema` | Diffs the live database against the TypeScript schema and applies the difference | **never written** |
| Replit **Publishing** schema step ("Database migrations validated successfully") | Replit's own diff of the publish source against Production (the exact inputs are not visible in this repository; PR #25 showed it proposing DROPs from stale `lib/db/migrations/meta` snapshots) | Applies what it proposes when approved | **not written by anything in this repository** |
| Drizzle `migrate()` — `lib/db/src/run-migrations.ts` (`runPendingMigrations`) and the one-off recovery tools | `lib/db/migrations/*.sql` + `meta/_journal.json` | Runs every journal entry whose `when` is newer than the ledger's newest `created_at`, in one transaction | **written** (hash + `when`) |

Consequences that follow directly from the code:

- **Nothing in the deploy path runs `migrate()` any more.** Commit `19c2069`
  ("Remove migrations from API startup", 2026-09-15) deleted the boot-time
  runner from `artifacts/api-server/src/index.ts`. The `RUN_MIGRATIONS_ON_BOOT=true`
  in `.replit`'s run command is inert; `scripts/src/verify-migrations.ts`
  Phase 9 asserts that the compiled API ignores it. `TASTEKIN_CLAUDE.md` §4
  and `docs/NATIVE-SESSION-MIGRATION-RECOVERY.md` still describe the flag as
  live — that text is out of date.
- **`migrate()` matches on timestamps only.** Drizzle's migrator reads the
  single newest `created_at` and applies everything newer; hashes are stored
  but never compared, and object existence is never checked.
- **Every schema change applied by push or Publishing leaves the ledger
  behind.** The journal then has entries newer than the ledger, so a future
  `migrate()` tries to re-run them. Entries 0012, 0013, 0017–0023 contain
  statements without `IF NOT EXISTS`, so that run fails with
  `relation … already exists` and rolls back everything (ledger unchanged,
  schema unchanged). This is the "Publishing and the ledger are out of sync"
  symptom: the schema is current, the ledger says it is not, and the migrator
  cannot reconcile the two.
- **Snapshots stop at 0015.** `meta/` holds snapshots for 0003, 0009, 0014
  and 0015 only. Any snapshot-based diff (including `drizzle-kit generate`,
  which §4 forbids for this reason) believes the schema lacks `video_uploads`,
  `saved_lists`, `native_sessions`, `moderation_content_states` and
  `users.is_suspended`. If a Publishing preview ever proposes **DROP**
  statements for those, it is reading stale history, not the real database —
  do not approve it.
- **Known, documented production drift:** `docs/NATIVE-SESSION-MIGRATION-RECOVERY.md`
  records Production's ledger stopping at 0016 with the 0017–0021 schema
  present; `scripts/src/native-session-recovery.ts` is the reviewed one-time
  repair through 0022. `docs/admin-moderation-deployment.md` requires a ledger
  "complete through 0022 with matching checksum and 0023 absent" before 0023
  may be applied. The Development database already carried the 0023 objects
  via push before PR #96 (`docs/admin-moderation-premerge-gate.md`), i.e. it
  is in the schema-only state for 0023.
- **One naming divergence between history and schema:** 0006 creates the
  username-uniqueness index as `creator_workspaces_profile_username_unique`;
  the TypeScript schema (and 0009) name it `creator_workspaces_username_unique`.
  A database built by push only has the second; one that ran 0006 through
  `migrate()` has both. The report below shows this as 0006 "partial".

## Migration 0023 — destructive-change check

`lib/db/migrations/0023_moderation_actions.sql` (SHA-256
`9d95a96f67c00d79c4bc767e9e31fa491d1dd321f7bc99cda88fbd5fa60ef9a1`):

- Creates table `moderation_content_states`; adds `users.is_suspended`
  (`boolean NOT NULL DEFAULT false`, no table rewrite on PostgreSQL 11+); adds
  five nullable columns and one CHECK to `moderation_audit_log`; creates five
  indexes (ordinary, not CONCURRENTLY: a GIN index over
  `creator_workspaces.edits` and four B-tree/partial indexes).
- Contains **no** DROP, DELETE, TRUNCATE or UPDATE. It never rewrites a row:
  the disposable verification below proves pre-existing user, workspace,
  comment, report and audit rows are byte-identical before and after.
- It is **not idempotent**: none of its 13 objects is guarded with
  `IF NOT EXISTS`. On a database where push already created them (the
  Development database today) `migrate()` fails at the first statement and
  changes nothing. That is a loud failure, not data loss — but it means 0023
  cannot be "replayed" over a pushed schema; the ledger has to be reconciled
  first, by a reviewed operator step, not by this repository's code.
- Locks: `ALTER TABLE` on `users` and `moderation_audit_log` take ACCESS
  EXCLUSIVE; the index builds take SHARE on their tables and hold it until
  commit. Measured on an isolated copy: 83 ms DDL, 113 ms lock upper bound
  (`docs/admin-moderation-production-copy-rehearsal.md`).

## Seeing the state of any database: `report:migration-ledger`

```
DATABASE_URL=postgresql://... pnpm --filter scripts run report:migration-ledger [--json]
```

`scripts/src/migration-ledger-report.ts` is read-only: one `READ ONLY`
transaction, 3 s lock timeout, 15 s statement timeout, rolled back at the end.
It never prints the connection string. For every journal entry it reports:

| Status | Meaning |
| --- | --- |
| `applied` | ledger row present, every object the SQL creates exists |
| `pending` | no ledger row, none of its objects exist — `migrate()` would create them |
| `SCHEMA-ONLY` | objects exist but no ledger row — applied by push / Publishing |
| `LEDGER-ONLY` | ledger row present, objects absent — the 0012/0013 incident class |
| `PARTIAL` | some objects exist |
| `recorded` / `not recorded` (no probeable objects) | e.g. 0004 (an UPDATE) and 0010 (DROP NOT NULL) |

It also lists ledger rows with no journal entry, duplicate timestamps, hash
differences (informational — `migrate()` ignores hashes, but the PR #96 runbook
checks the 0022 hash), destructive or UPDATE statements per migration, and a
prediction of what `migrate()` would do next and the exact object it would
fail on. Exit code: `0` consistent and nothing pending; `2` consistent with
clean pending migrations; `1` drift or predicted failure.

Pointing it at Production is a production read and needs the same approval as
any other read under §4. It is the first thing to run before deciding whether
the ledger needs the native-session recovery, the 0023 release sequence, or a
new reconciliation review.

## Regression test

```
DATABASE_URL=postgresql://... pnpm --filter scripts run verify:migration-ledger-report
```

Creates and drops a uniquely named database on that server (never run it with
a production credential). It checks the journal statically, then drives one
disposable database through the four states above — 0022 baseline, applied
0023 (via the real `runPendingMigrations`), ledger-only, schema-only, no
ledger — asserting the report, exit codes, the runner's behaviour and that no
pre-existing row is ever changed.
