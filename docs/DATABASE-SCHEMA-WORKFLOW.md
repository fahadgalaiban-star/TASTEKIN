# Database schema workflow (production)

How a schema change reaches the production database, as confirmed by
Replit Support (2026-10-23) and by what the repository does today.

## The one rule

**Publishing applies the schema. Migration files document it.**

When you press Publish, Replit compares the **Development** database's
schema with the **Production** database's schema and applies the
difference to Production. It does not read `lib/db/migrations/`, it does
not run `drizzle-kit migrate`, and it does not write Drizzle's ledger table
(`drizzle.__drizzle_migrations`).

So the only way a change reaches Production is: it exists in Development
first, and you approve the diff.

## The workflow, step by step

1. **Write the change twice, in the same PR**:
   - the Drizzle schema in `lib/db/src/schema/` (the source Development is
     pushed from), and
   - a hand-authored, additive SQL file in `lib/db/migrations/` plus its
     `_journal.json` entry (the reviewed record; it also builds the
     disposable databases the verify scripts use). No `drizzle-kit generate`
     (snapshot gap, PR #25).
2. **Merge the PR**, then sync the Replit workspace to `origin/main`.
3. **Apply to Development.** `scripts/post-merge.sh` runs
   `drizzle-kit push` against the Development database; running
   `pnpm --filter @workspace/db run push` from the workspace does the same.
   Confirm it reports the statements you expect.
4. **Open the Publishing panel and read the schema diff.** It must contain
   only what the migration file says: `CREATE TABLE`, `ADD COLUMN`,
   `CREATE INDEX`, `ADD CONSTRAINT`. Two harmless items appear in every
   diff and are fine to approve: the 63-character truncation of a foreign
   key name on `my_circle_memberships`, and a `profile` column default.
5. **Approve and publish.** Production's schema changes here, together
   with the new code, so code that needs a new column is never live
   before the column exists.
6. **Verify on the live URL**, then (optionally) a read-only check in the
   Neon SQL console that the new objects exist.

Stop and investigate before approving if the diff proposes a `DROP`, a
column type change, a `NOT NULL` on an existing column without a default,
or anything you did not write.

## What not to do

- **Do not "fix" the ledger.** `drizzle.__drizzle_migrations` on
  Production stops at `0022_native_sessions` while the schema is current
  (0023 and 0024 exist as tables and columns). Under this workflow that
  mismatch is permanent and expected. Replit Support's advice, adopted
  here: do not delete, renumber or replay migration files to make the
  ledger match.
- **Do not run `drizzle-kit migrate`** (or `pnpm --filter @workspace/db run migrate`)
  against Production. The files are not idempotent; it would fail on
  "already exists" and, where it did not fail, apply a change twice.
- **Do not add a migration runner to the build or to boot.** Publishing
  already applies the change; a runner would race it. The
  `RUN_MIGRATIONS_ON_BOOT=true` argument in `.replit` is a leftover from
  the removed boot runner and does nothing; leave it, or remove it in a
  dedicated change, but never make it live again.
- **Do not change Production's schema by hand** in the SQL console. Put
  it in Development through the schema + migration file, and let Publish
  carry it.
- **Do not run `drizzle-kit push` against Production.** Push is for
  Development only.

## Why the ledger and the files still exist

- The SQL files are the human-reviewed statement of each change and the
  only place the exact DDL is written down; reviewers read them, the
  Publish diff is checked against them.
- The verify scripts (`verify:migrations`, `verify:onboarding`,
  `verify:account-deletion`, …) build throwaway databases from them.
- The journal keeps the files ordered. Nothing in production reads it.

## Migrations that cannot rebuild an empty database

The chain cannot recreate a database from zero (an early file fails and
`closet_items` was never created by a migration). That is irrelevant to
production, which is never rebuilt from the files, and the verify scripts
that need a full schema export it from Development or from the Drizzle
schema instead.

## Quick reference

| Want to… | Do |
| --- | --- |
| Add a column/table | schema change + additive migration file in one PR → merge → dev push → read Publish diff → approve |
| See what Production has | read-only query in the Neon SQL console (`information_schema.columns`); never change anything there |
| Explain a "pending" 0023/0024 in the ledger | expected; the objects exist, Publishing created them |
| `0025_edit_dismissals` (taste learning) | same workflow: after merge, dev push → Publish diff should show exactly `CREATE TABLE edit_dismissals` + one index; approve, then turn `taste_learning` on |
| Roll back a schema change | a new, forward-only migration file that reverses it, same workflow |
