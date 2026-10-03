# Admin moderation — release gate and operator runbook

## Gate decision (2026-10-03): HOLD — keep PR #96 Draft

This review authorizes **no operational action**. Commands below are instructions
for a separately approved release, not commands executed during this review.

### Separately authorized isolated rehearsal completed

The owner subsequently authorized a production **pg_dump-only** export and a
new disposable, network-isolated restore/migration rehearsal. That rehearsal
passed and its dump/database were deleted. Neither production nor the existing
Development Database was modified, and no merge or publish was performed.
See [measured results and remaining blockers](admin-moderation-production-copy-rehearsal.md).
This closes only the isolated export/restore/0023 rehearsal gate; Draft / HOLD
and the separate production release approvals remain in effect. The planning
text below describes the earlier, unexecuted plan, not current permission to
repeat the export or perform release operations.

## Updated recovery rehearsal plan — planning only

PR #96 remains **Draft / HOLD**. No PITR, production reads/export, destination
creation, restore, migration, merge or publish is authorized by this plan.

### Confirmed evidence

- The owner reports production PITR ON for the last 7 days; scheduled daily
  backups OFF, no scheduled backups, and an available 7-day retention option.
- Replit Support confirmed to the owner that PITR restores production **in
  place** and cannot restore to a separate isolated database. Do not use PITR
  for this rehearsal. Enabled PITR is not evidence of a successful restore.
- Publishing history records successful release `0a353bcf` at
  `2026-09-30T23:23:56Z`. Its source commit and recovery capability are unverified.

### Proposed sequence — separate approvals before execution

1. **Approve the export and destination first.** The owner must separately
   authorize production preflight reads and `pg_dump`, creation of a disposable
   database, transfer/restore of production data, and isolated rehearsal writes.
   Agree on the operator, secured location, access, retention/deletion policy,
   compatible PostgreSQL tools/version, storage budget and acceptable recovery
   time/data-loss limits. No destination or backup is created during planning.
2. **Create and verify isolation after approval.** Use an operator-controlled
   disposable environment outside this review workspace, distinct from both
   production and the existing shared development database. Verify its target
   identity before any restore or test. Deny outbound access except the isolated
   database connection; disable workers, schedules, email, auth-provider, AI,
   media/storage and other external calls. Use mocks and new synthetic test
   identities, never copied customer credentials or sessions.
3. **Take a logical backup after approval.** Through the existing approved
   operator credential mechanism, use `pg_dump --format=custom` against the
   verified production source. Record source/schema/ledger metadata, UTC start
   and finish, tool version, archive size and checksum. Protect the dump and
   its transfer as sensitive production data; do not upload it here or print
   credentials/row contents. A dump is a consistent logical snapshot, not PITR,
   and does not include external media/provider resources or all cluster-level
   configuration. Confirm required extensions/permissions separately.
4. **Prove restoration.** Use `pg_restore` into the approved empty disposable
   database, with errors fatal, no `--clean`, no restore over production, and
   explicitly reviewed ownership/privilege handling. Verify schema, migration
   ledger, record counts and original-column data digests. Record restore time
   and storage use. An archive listing/checksum alone does not pass this gate.
5. **Rehearse 0023 only on that copy.** Pin the reviewed PR head and unchanged
   migration checksum; require the expected 0022 ledger/schema baseline. Test
   the reviewed 0023 transaction and ledger handling, success and intentional
   contention/timeout rollback, and old/new application compatibility. Measure
   total elapsed time, lock acquisition/hold time, rollback and disk/WAL growth.
   Initially retain the reviewed 3-second lock and 60-second statement limits;
   stop rather than silently increasing them. Check expected column/default,
   constraint, five valid indexes and ledger entry, plus unchanged original
   account, session, report and content records. Perform moderation mutations
   only on synthetic fixtures in the copy.
6. **Prove application recovery and report results.** The previously observed
   production commit label resolves to
   `9d2876cae32c16acf45f23bfddc9540cc237a505`; use this as a source-pinned
   candidate, not an attested copy of the live binary or of release `0a353bcf`.
   Build from a clean checkout with the committed lockfile, pinned toolchain
   and recorded build/run settings. Retain artifact checksums and demonstrate
   recovery against the isolated post-0023 schema without startup DDL or schema
   down-migrations. Keep access restricted if moderation state has been used:
   the old application does not enforce it. Record failures, recovery times,
   cleanup disposition and owner sign-off before reassessing HOLD.

### Remaining release gates

- Export permissions, a safe disposable destination and a measured
  `pg_dump`/`pg_restore`/0023 rehearsal were subsequently verified under separate
  owner authorization; see the results linked above. No retained final-release
  backup or live recovery capability is established by the deleted copy.
- Representative storage/throughput and contention must be justified; an idle
  copy's timing is not a production downtime guarantee.
- A proven maintenance procedure must block all web/native/API/direct-static
  ingress, pause all writers/other deployments, let in-flight work finish, and
  confirm no remaining writes/long transactions through separately approved
  checks. No existing maintenance/drain control has been demonstrated.
- Confirm the supported production schema-application route before any release.
  The manual wrapper later in this document is not approval for direct DDL
  against Replit-managed production; its SQL may be evaluated on the isolated
  copy only after rehearsal approval.
- A rehearsal dump taken while live writes continue is not the final release
  recovery point. A final backup after approved maintenance/drain requires its
  own approval and verification. Do not enable scheduled backups or change PITR
  settings as part of this plan.

Reviewed implementation: `471b67c77f132eb28a4309bd074d799a498b0c70`.
Approved main baseline: `59c73f43fc4e51861d5f1388ca1808ba7a637d01`.

| Gate | Finding |
| --- | --- |
| Backward compatibility | Additive SQL is compatible with the reviewed main schema/old report-writing code. Exact currently deployed source revision is not exposed by the available deployment metadata, so compatibility with that exact binary is not attested. |
| Release order | Approved isolated backup/restore/0023 rehearsal → resolve supported production schema-application route and recovery controls → separately approved merge/maintenance/final backup/release → restricted smoke tests → reopen traffic. |
| Rollback | Atomic migration rollback before commit; retain additive schema/history on application rollback after commit. Old binaries do not enforce moderation and must remain access-restricted if moderation state has been used. |
| Lock duration | Restored-copy measurement: 83 ms DDL/ledger and 113 ms transaction/lock upper bound, with controlled timeout/rollback tests passed. No live-production timing or zero-downtime guarantee; an approved outage/I/O budget remains required. |
| Data retention | No DELETE, UPDATE, DROP or TRUNCATE in 0023; no session/report/content/media rewrite or provider operation. Physical no-rewrite default addition requires PostgreSQL 11+. |
| Merge versus publish | Replit documentation says publishing/republishing is manual. GitHub inventory showed one build-only workflow and zero repository webhooks; no publish/deploy step was found. Merge is not a Publish action. |

Read-only deployment metadata reported an existing Autoscale deployment with a
successful build. No production URL, database, application endpoint, logs or
provider resource was accessed to establish these findings. GitHub deployment
records were empty; that is **not** proof of the live application's source SHA.

**Before this gate can pass**, an operator must supply the non-secret deployed
build/source identity, confirm its compatibility against this change, provide a
retained final-release backup, and demonstrate the maintenance/drain and
previous-release rollback controls. The separately approved isolated
restore/migration rehearsal has passed; it does not satisfy those remaining
gates. No further production data access is authorized by this document to fill
these gaps. Do not mark Ready for Review yet.

## Compatibility and lock assessment

`users.is_suspended` is a NOT NULL boolean with constant DEFAULT false. Existing
and old-application-created users remain active. On PostgreSQL 11+, adding this
constant default uses missing-value metadata rather than rewriting every user
tuple. Older PostgreSQL can rewrite the table: stop if the operator's version
check fails. Nullable audit columns leave historical actions NULL, so the new
CHECK accepts old audit entries and old-style report-status inserts. No existing
column is renamed, removed or made more restrictive. Existing explicit-column
Drizzle reads/inserts remain compatible; applications relying on positional
`INSERT ... VALUES` without a column list require a separate compatibility check.

The new overlay table starts empty. Reports, creator JSON, comment bodies, web
sessions, native sessions and media/upload rows are not modified by this SQL.
Index creation does scan existing tables and generates index files/WAL; it is
not a logical content rewrite. Leave enough disk/WAL capacity for the GIN/B-tree
indexes and rollback work. Backups also consume I/O and disk.

**Locks are significant:**

- ALTER TABLE on users/audit takes ACCESS EXCLUSIVE. The audit CHECK validates
  existing history under that lock.
- Ordinary CREATE INDEX (not CONCURRENTLY) takes SHARE on the indexed table and
  blocks its writers. The GIN build scans all workspace Edit JSON; the comment
  index scans comments. Even empty partial user/audit indexes scan their source.
- In one transaction, these locks are retained through COMMIT. Users/audit can
  therefore be unavailable for the duration of the later GIN/comment builds,
  not merely for the fast ADD COLUMN statements.
- Large tables, contention, slow storage, WAL pressure or long transactions can
  make this take seconds, minutes or longer. Current sizes, contention and
  throughput were not directly queried on production. The separately approved
  restored-copy measurements are recorded in the rehearsal report; they do not
  assert live-production duration. Add operational headroom before scheduling.

The wrapper below enforces a **3-second lock-acquisition limit** and a
**60-second server-side limit on the entire migration DO statement**, not
60 seconds per index. These are conservative abort limits, not estimates or an
uptime guarantee. Guard/ledger/commit work and rollback also take time. If the
rehearsal cannot fit, stop and separately review a larger maintenance budget or
a concurrent-index migration design; do not edit 0023 or raise limits ad hoc.

## Operator prerequisites — STOP if any are missing

1. Separate approval for backup, maintenance, merge, migration and publishing.
2. Identify the deployed build and retain a reproducible, tested application
   recovery target with its source SHA, lockfile/toolchain, artifact checksum and
   run/build settings. Do not assume Publishing History supports rollback.
   Record the candidate merge SHA; historical release `0a353bcf` remains unverified.
3. Use an operator-controlled terminal with an **existing securely configured
   PostgreSQL service** for the approved production destination. Do not paste a
   database URL/password into commands, chat or logs; do not change credentials.
   `PGSERVICE`, `EXPECTED_DB`, `BACKUP_DIR` and `RESTORE_SERVICE` below must be
   supplied from the approved operator inventory, not guessed from this workspace.
   RESTORE_SERVICE must target a new, secured disposable restore database.
4. Confirm sufficient backup/index/WAL storage and a tested ingress-maintenance
   control that covers web, native/API and direct public routes. Drain **all**
   writers, including workers and other deployments, before migration. This PR
   supplies no maintenance flag or traffic-drain command; do not invent one.
   If the existing control cannot be demonstrated, do not proceed.
5. Confirm the migration ledger is complete through 0022 with matching checksum
   and that 0023 is absent. Missing/divergent ledger or schema requires a separate
   reconciliation review, not replay of historical migrations or schema push.
6. Provision approved synthetic release fixtures and test credentials through
   existing tools. Never use real customer users/content for moderation smoke
   mutations. Account deletion is checked on mocks/staging; on production, open
   the confirmation and cancel, without accepting destructive deletion.

## Exact release sequence — operator execution only

### A. Pin source and inspect the proposed release

Run in an operator release checkout, not this agent workspace. These Git commands
do not publish. Read-only checks can precede approval; merge cannot.

```bash
set -euo pipefail
set +x
git -c core.hooksPath=/dev/null fetch origin
git diff origin/main...origin/feature/admin-moderation-actions --check
git diff origin/main...origin/feature/admin-moderation-actions --name-only
gh pr view 96 --repo fahadgalaiban-star/TASTEKIN \
  --json state,isDraft,headRefOid,baseRefName
```

Verify the reviewed head, unchanged migration bytes, no memory/attachment changes,
and approval to proceed. Do not use this runbook while the gate remains HOLD.

### B. Destination/version/ledger checks and backup, before merge

These are future operator database reads/export/restore, **not operations
performed by this review**. Follow the updated recovery rehearsal plan above:
export, data transfer and destination creation each need separate approval.
This is a logical `pg_dump`/`pg_restore` rehearsal, not an in-place PITR restore.

```bash
: "${PGSERVICE:?Existing approved production service required}"
: "${EXPECTED_DB:?Approved non-secret database name required}"
: "${BACKUP_DIR:?Approved secured backup directory required}"
: "${RESTORE_SERVICE:?New approved disposable restore destination required}"
test -d "$BACKUP_DIR"
umask 077
export PGAPPNAME=tastekin-moderation-release
psql -X -v ON_ERROR_STOP=1 -v expected_db="$EXPECTED_DB" <<'SQL'
SELECT current_database(), current_user, current_setting('server_version'),
  inet_server_addr(), inet_server_port();
SELECT 1 / CASE WHEN current_database() = :'expected_db'
  AND current_setting('server_version_num')::int >= 110000 THEN 1 ELSE 0 END
  AS required_destination_and_version;
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) AS total_size
  FROM pg_class WHERE oid IN ('public.users'::regclass,
    'public.moderation_audit_log'::regclass,
    'public.creator_workspaces'::regclass,'public.edit_comments'::regclass);
SQL
BACKUP_FILE="$BACKUP_DIR/tastekin-before-0023-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --file="$BACKUP_FILE"
pg_restore --list "$BACKUP_FILE" > "$BACKUP_FILE.list"
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
sha256sum --check "$BACKUP_FILE.sha256"
# Existing RESTORE_SERVICE MUST point to an empty, new, secured database.
# Never use --clean or restore over production.
PGSERVICE="$RESTORE_SERVICE" pg_restore --exit-on-error --single-transaction \
  --no-owner --no-privileges --dbname="service=$RESTORE_SERVICE" "$BACKUP_FILE"
```

An archive listing/checksum is not a restore test. Validate the restored schema,
ledger, record counts and original data; rehearse the reviewed old binary, 0023
wrapper and new binary only against that separately authorized secured copy.
Do not import a production backup into this Replit review environment. Verify
provider/backing file recovery separately without modifying Backblaze resources.

If live writes continue after this backup, it is not the final pre-migration
recovery point. After maintenance/drain, take and verify another backup using
the same commands, with a new timestamp; retain the original archive as well.

### C. Merge only after backup/rehearsal and gate approval

The PR must first have separately passed review and been marked ready. Do not
override Draft or use --admin/auto-merge.

```bash
: "${REVIEWED_HEAD:?Final approved PR head required}"
gh pr merge 96 --repo fahadgalaiban-star/TASTEKIN --merge \
  --match-head-commit "$REVIEWED_HEAD"
git -c core.hooksPath=/dev/null fetch origin main
RELEASE_SHA="$(git rev-parse origin/main)"
git -c core.hooksPath=/dev/null checkout --detach "$RELEASE_SHA"
git status --porcelain
```

Set REVIEWED_HEAD to the final approved PR head (documentation pushes change it).
Record RELEASE_SHA; verify clean checkout and the expected merged migration.
No push/rebase/force-push to main, task-agent merge, publishing or migration is
part of these Git commands.

**Automation caveat:** `.replit` configures `scripts/post-merge.sh`, which contains
`pnpm --filter db push`. That is Replit's task-agent post-merge setup, not a GitHub
publishing workflow. Do not run it, use a task-agent merge, or invoke `db push` as
a release step. Git commands above disable local Git hooks for those invocations.
`.replit` also contains a legacy `RUN_MIGRATIONS_ON_BOOT=true` run argument;
the reviewed API entrypoint does not call runPendingMigrations. Managed artifact
production runs use the direct Node entrypoint. Verify the actual publishing
run command and source; do not rely on an unused flag to establish safety.
Abort if another release/startup hook performs schema mutation.

### D. Drain traffic, take final backup, then apply only 0023

Activate the demonstrated maintenance control, stop/drain all writers, confirm no
long transactions and take the final verified backup. The old binary can coexist
with the additive schema after commit, but should not serve normal traffic while
these locks are held. Do not deploy the new binary before commit.

The wrapper intentionally does **not** run `pnpm ... migrate`, startup migrations,
`db push` or all historical SQL. It applies 0023 and advances its Drizzle ledger
entry atomically, only from the exact 0022 ledger head.

```bash
set -euo pipefail
set +x
: "${PGSERVICE:?Approved production service required}"
: "${EXPECTED_DB:?Approved database name required}"
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
test -z "$(git status --porcelain)"
HASH_0022="$(sha256sum lib/db/migrations/0022_native_sessions.sql | cut -d' ' -f1)"
HASH_0023="$(sha256sum lib/db/migrations/0023_moderation_actions.sql | cut -d' ' -f1)"
SQL_FILE="$(mktemp)"
trap 'rm -f "$SQL_FILE"' EXIT
{
cat <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '10s';
SELECT pg_advisory_xact_lock(727273001001);
LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE;
SELECT 1 / CASE WHEN current_database() = :'expected_db'
  AND current_setting('server_version_num')::int >= 110000
  AND (SELECT max(created_at) FROM drizzle.__drizzle_migrations) = 1790200000000
  AND (SELECT count(*) FROM drizzle.__drizzle_migrations
       WHERE created_at = 1790200000000 AND hash = :'hash_0022') = 1
  AND to_regclass('public.moderation_content_states') IS NULL
  THEN 1 ELSE 0 END AS required_clean_0022_baseline;
DO $migration_0023$
BEGIN
SQL
cat lib/db/migrations/0023_moderation_actions.sql
cat <<'SQL'
END;
$migration_0023$;
INSERT INTO drizzle.__drizzle_migrations(hash, created_at)
  VALUES (:'hash_0023', 1790983213528);
COMMIT;
SQL
} > "$SQL_FILE"
psql -X -v ON_ERROR_STOP=1 -v expected_db="$EXPECTED_DB" \
  -v hash_0022="$HASH_0022" -v hash_0023="$HASH_0023" -f "$SQL_FILE"
rm -f "$SQL_FILE"
trap - EXIT
```

Migration statements and the ledger insert are in one transaction. The single
DO statement bounds all 0023 work together. Do not bypass an error or retry
blindly: a lost connection during COMMIT can leave the outcome unknown.

After success, verify ledger timestamp/hash, column/default, audit constraint and
all five valid indexes before publishing:

```bash
psql -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT hash, created_at FROM drizzle.__drizzle_migrations
  WHERE created_at = 1790983213528;
SELECT column_name, column_default, is_nullable FROM information_schema.columns
  WHERE table_schema='public' AND table_name='users' AND column_name='is_suspended';
SELECT conname, convalidated FROM pg_constraint
  WHERE conrelid='public.moderation_audit_log'::regclass
    AND conname='moderation_action_complete_check';
SELECT c.relname, i.indisvalid, pg_get_indexdef(i.indexrelid)
  FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
  WHERE c.relname IN ('moderation_content_hidden_idx','users_suspended_idx',
    'moderation_audit_target_time_idx','creator_workspaces_edits_gin_idx',
    'edit_comments_user_idx');
SQL
```

Require exactly one matching ledger row, expected column/constraint and five valid
indexes. Compare original-record checks against the drained backup/rehearsal.
Missing/incorrect state means STOP, not publish.

### E. Publish manually, then smoke test while ingress is restricted

In Replit **Publishing**, verify RELEASE_SHA/source and the unchanged approved
production destination, run/build settings and migration-free startup. Use the
manual Publish/Republish action. Do not change database/provider credentials,
enable schema synchronization, upload the review fixture or run a startup schema
push. If the publishing flow proposes database changes, cancel and review them;
0023 has already been applied explicitly. Do not accept another schema operation.

There is no invented CLI command here: this repository's supported release
action is the Publishing UI. A local `pnpm build` is not publishing.

```bash
: "${PRODUCTION_ORIGIN:?Verified Publishing URL required}"
curl --fail-with-body --silent --show-error "$PRODUCTION_ORIGIN/api/healthz"
curl --fail-with-body --silent --show-error "$PRODUCTION_ORIGIN/api/creators"
curl --fail-with-body --silent --show-error "$PRODUCTION_ORIGIN/api/feed"
```

Use the approved maintenance allowlist/authenticated operator channel for those
requests. Confirm actual readiness and no schema/startup errors; an HTTP 200
health response alone does not certify migration or enforcement.

With approved synthetic fixtures only:

- Check admin inspection/hidden-original media access and non-admin rejection.
- Hide/restore fixture Edit and comment; verify public feed, profile, collections,
  discovery, Circle, Saved/KIN retained references and API media behavior.
- Suspend/unsuspend only the fixture account. Verify web/native ordinary mutation
  rejection, new-session rejection, restricted minimum state/logout/legal access,
  and that expired/revoked fixture credentials do not revive.
- Check self/protected-owner/admin rejection; one confirmation plus required
  reason; failed action/retry; one complete transactional audit per success.
- Open account deletion confirmation and cancel. Never accept production account
  deletion as a smoke test. Destructive deletion is tested only with mocks/staging.
- Check English, Arabic/RTL and mobile. Restore the fixture overlay/account flags
  via normal audited actions; do not delete reports/audits/session rows as cleanup.

Do not release normal traffic until these checks pass and the operator signs off.
These explicitly approved fixture actions mutate fixture moderation/session state;
they are not migration side effects or permission to rewrite customer records.

## Failure and rollback procedure

| Failure | Exact response |
| --- | --- |
| Backup/restore/preflight | Stop before merge/migration/publish; leave current release intact. |
| Migration error/timeout before commit | ON_ERROR_STOP closes the connection and PostgreSQL rolls back the transaction, including ledger/indexes/DDL. Wait for rollback/lock release; verify 0023 ledger and objects are absent, then reopen the unchanged old release if safe. No schema-down SQL. |
| Unknown COMMIT outcome | Keep maintenance. Reconnect through the approved operator channel and inspect the 0023 hash/ledger and complete schema. Never rerun based solely on a client error. |
| Publish/build/startup failure after commit | Keep 0023 and its ledger. Do not drop columns/table/indexes or restore the pre-migration dump over live data. Preserve the previous healthy deployment if still serving; otherwise use only the separately approved, rehearsed application recovery procedure. If none is available, remain in maintenance and stop. Do not assume Publishing History rollback. |
| Smoke failure | Re-enable/retain maintenance immediately. Record build/failed check/audit IDs; stop fixture actions. Use only the separately approved, rehearsed application recovery target, retaining all moderation/audit/session history. Diagnose/fix forward; retest before reopening. Do not assume Publishing History rollback. |

An old pre-moderation application ignores hidden/suspended state. **Application
rollback is not enforcement rollback:** if moderation has occurred, reopening that
binary exposes content/accounts previously restricted. Keep broad maintenance or
a proven external restriction in place until a moderation-capable build passes
checks. Do not zero flags, delete overlays/audits, extend sessions or un-revoke
native tokens merely to make rollback appear successful.

Backup restoration is disaster recovery, not the normal additive-migration
rollback. It can lose every write after the backup, including audits, reports,
sessions and new content. It requires a separate incident plan, explicit data-loss
approval and preservation/reconciliation of newer writes. Restore first to a new
secured database; no DROP, TRUNCATE, --clean or overwrite-live command is approved
by this document. Storage/provider rollback is outside this release.

That separate-destination recovery proposal uses an approved logical dump,
**not PITR**. Support confirmed PITR changes production in place; any future PITR
operation requires its own incident authorization and data-loss assessment and
cannot serve as an isolated rehearsal.

Sources for manual publishing/rollback:
https://docs.replit.com/features/publishing/overview and
https://docs.replit.com/build/troubleshooting.

## Existing implementation and media boundaries

Migration: `lib/db/migrations/0023_moderation_actions.sql`.
The application requires this schema. Do not restart it against an unmigrated
existing development/shared database to preview the new feature.

The runbook above is the authoritative sequence. Every operational phase still
requires separate approval. Application rollback retains additive schema and
history, but cannot by itself preserve moderation enforcement in an old binary.

Account and target advisory locks serialize session issuance and moderation.
Overlay changes and audit insertion are transactional. Session rows are expired
or soft-revoked, not deleted. Unsuspension never restores old credentials.

Suspension-expired credentials can prove identity only for exact account-safety
methods/routes while their original lifetimes remain valid. This is not session
restoration. Logout closes this proof; new session issuance stays blocked.
Minimum suspension state, typed account deletion, logout and public legal/support
information remain accessible. See the exact allowlist in the corrective review.

Migration 0023 adds partial hidden-state/suspended-user indexes, a partial
target/time action-history index, JSONB containment GIN for workspace Edit lookup,
and a comment-author B-tree. They match bounded predicates rather than loading
all workspaces/comments. Review schema/index parity before migration; retain
additive schema/history on application rollback, rather than deleting audit data.

Consumer routes project a fresh server-side moderation view, including static
catalog routes, saved identifiers and KIN citation snapshots. Private creator
workspace editing retains its original JSON; only separately authorized admin
inspection bypasses public projection for moderation.

Previously delivered files, third-party cached copies and unattributed free text
cannot be recalled by this application. Provider resources are not modified.

## Direct packaged-media enforcement — Draft / HOLD

- The API artifact now owns `/tastekin-media` as well as `/api`. The frontend
  stages only unrelated UI assets into its static public directory; content
  media is copied into the API's non-public build directory. Source demo files
  and private/customer storage objects are not deleted, moved or rewritten.
- Direct GET/HEAD requests check fresh moderation state before file serving.
  Hidden Edit media, explicit packaged-media links in hidden text comments and
  suspended-author media return empty 404 responses, including known URLs,
  encoded filenames, query strings, range and conditional requests. A visibility
  failure returns 503, never a static or SPA fallback. Restore/unsuspension
  restores access without touching media bytes.
- Ordinary public access remains unauthenticated, including unrelated media
  viewed by a suspended account. The direct public route has no owner/admin
  exception. Existing separately authorized admin inspection reads originals
  from the server package and retains its existing authorization/audit behavior.
- All newly served direct responses use `private, no-store`; ETag/Last-Modified
  validators are disabled so a new hidden request cannot return 304. Normal
  image content types, HEAD and visible-media range support are retained.
- A file referenced by multiple targets is denied while **any** referencing
  target is hidden/suspended. Restoration of one target cannot override another
  target's restriction. Comments have no attachment column: only explicit local
  or same-origin packaged-media links in their text are media references; hiding
  a plain-text comment does not hide its parent Edit's image.
- This closes the source/package routing bypass, not a live-production
  attestation. Release checks must verify `/tastekin-media` reaches the gated API,
  the final static package has no media files, and provider/cache boundaries are
  understood. Draft / HOLD and all remaining release approvals still apply.
- Absolute media links use the existing configured `ALLOWED_ORIGINS` app-origin
  inventory rather than the current request Host alone. Confirm every serving
  alias/historical app origin used in stored media links is listed before
  release. No configured origin value was accessed or changed for this review.

## Remaining read-path limitations
- Previously issued third-party playback/media links, cached/offline responses
  and copied KIN text without a retained source identity cannot be recalled.
  New KIN references with retained identifiers are filtered/rejected.

Previously delivered/cached/offline copies and already admitted in-flight
downloads cannot be revoked. There is no provider purge or historical CDN-cache
purge in this change. No production access, deployment or provider operation was
performed to implement or verify this correction.

## Local review verification

`bash scripts/tests/run-moderation-review.sh` creates a brand-new Unix-socket-only
PostgreSQL cluster, exports the approved main schema without connecting to any
database, and verifies its isolated destination before testing. It never accepts
an existing database URL; its server is stopped on exit. Migration/schema
comparison also uses a second new database in that same isolated cluster.
Child test environment contains no configured database URLs/provider secrets.
Deletion-service/provider operations are mocked; deletion tests verify real
authenticated confirmation/dispatch without performing destructive deletion.

`node scripts/tests/build-moderation-preview.mjs`, after the frontend build,
creates an ignored isolated browser fixture using the actual component, with all
fetches mocked. It is not shipped as application functionality or registered as
a separate artifact. Keep it out of published builds.