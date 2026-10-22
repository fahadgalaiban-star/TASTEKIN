---
name: TASTEKIN migration baseline
description: Safely generating additive database migrations in a project whose older migrations lack Drizzle snapshots.
---

When adding a new table, inspect any generated migration before applying it. If Drizzle has no prior snapshots, it can treat the current database as empty and emit duplicate `CREATE TABLE` statements for the entire existing schema.

**Why:** Applying that output after the existing migration history would fail on tables that already exist, even though the intended change is only additive.

**How to apply:** Keep the migration limited to the new schema delta and add it to the Drizzle journal in sequence (the file is the reviewed record and builds the disposable verify databases). Production is changed only by Replit Publishing, which applies the Development→Production schema diff and never runs the files or writes the ledger — so push the schema to Development, read the Publish diff, approve. Never run `drizzle-kit migrate` against production and never "fix" the production ledger (see `docs/DATABASE-SCHEMA-WORKFLOW.md`).