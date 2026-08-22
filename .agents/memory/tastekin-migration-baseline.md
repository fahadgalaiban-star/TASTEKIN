---
name: TASTEKIN migration baseline
description: Safely generating additive database migrations in a project whose older migrations lack Drizzle snapshots.
---

When adding a new table, inspect any generated migration before applying it. If Drizzle has no prior snapshots, it can treat the current database as empty and emit duplicate `CREATE TABLE` statements for the entire existing schema.

**Why:** Applying that output after the existing migration history would fail on tables that already exist, even though the intended change is only additive.

**How to apply:** Keep the migration limited to the new schema delta, add every hand-authored migration to the Drizzle journal in sequence (otherwise `drizzle-kit migrate` ignores it), then use the normal development schema push and the publish-time schema flow.