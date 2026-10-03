# PR #96 — isolated production-copy rehearsal

Recorded UTC: **2026-10-03T12:37:22Z**. Decision: **Draft / HOLD**.

## Authorization and boundaries

The owner separately authorized one production `pg_dump`, a restricted temporary
custom-format archive, restoration into a new disposable PostgreSQL database,
0023-only rehearsal and cleanup. This superseded the earlier planning-only
prohibition **for this isolated rehearsal only**, not for production changes.

- Production access consisted only of one `pg_dump`, using the configured
  production secret through subprocess environment variables, never argv.
- The dump session used default read-only transactions, a 3-second lock-wait
  limit and a 60-second statement limit. No separate production SQL preflight,
  production database client, PITR, migration, restart or restore was used.
- No connection to the existing Development Database was made.
- The dump was outside the workspace in a newly created `0700` temporary
  directory; archive permissions were `0600`. Nothing was uploaded or committed.
- Restore and all tests ran in a new Linux network namespace and new
  Unix-socket-only PostgreSQL cluster. No external routes existed; an external
  network probe was blocked. Providers, uploads, email and webhooks had no
  credentials or network access. Workers/process entrypoints were not started;
  PostgreSQL shared preload libraries were disabled.
- Only synthetic identities/session credentials were used for authenticated
  tests. Copied production credentials/sessions were never used to authenticate.
- No merge, publish, deployment, existing service restart or production
  interruption was performed.

## Pinned inputs

| Input | Value |
| --- | --- |
| Reviewed new implementation | `471b67c77f132eb28a4309bd074d799a498b0c70` |
| Older source candidate | `9d2876cae32c16acf45f23bfddc9540cc237a505` |
| Verified current Draft PR head | `2bec90c3e1a8e2849e942474071ccbd58b545a36` |
| 0023 SHA-256 | `9d95a96f67c00d79c4bc767e9e31fa491d1dd321f7bc99cda88fbd5fa60ef9a1` |
| Shared committed lockfile SHA-256 | `1c78c90d2483c910d050be3d5b805104b2e26dbacf8ccc5898d81adca124f961` |
| Source PostgreSQL version, from archive metadata | 16.15 |
| Disposable PostgreSQL / dump tools | 16.10 |
| Node / esbuild | v24.13.0 / 0.27.3 |

GitHub read-only checks confirmed PR #96 is open, Draft and unmerged. Its
migration bytes match the reviewed checksum; API/database implementation files
are unchanged from the reviewed implementation. Both archived source lockfiles
match the workspace lockfile used for installed dependencies.

The older source remains a **candidate**, not an attested copy of the currently
deployed binary.

## Results

| Check | Result |
| --- | --- |
| Read-only custom-format export | PASS — 30.153 seconds |
| Temporary archive | 157,126 bytes; checksum and archive listing verified |
| Restore | PASS — 0.552 seconds, fatal errors enabled, one transaction, no ownership/privilege restoration, no overwrite/`--clean` |
| Archive/restore table set | PASS — 35 table-data entries and 35 restored user-schema tables |
| Restored baseline | PASS — matching 0022 ledger hash/timestamp; 0023 overlay absent |
| Original-record preservation | PASS — counts and original-column digests matched across all 35 restored tables before commit; copied originals also matched after application smoke checks, excluding only explicit synthetic fixture rows and the expected new ledger row |
| Successful 0023 DDL plus ledger insert | PASS — 83 ms |
| Transaction/lock-duration upper bound | 113 ms, including guards, integrity checks and commit |
| Observed relation lock modes | `AccessExclusiveLock` on altered tables and `ShareLock` for ordinary index builds; checked released after commit |
| Controlled contention | PASS — SQLSTATE `55P03` after 3.019 seconds; rollback restored baseline |
| Intentional abort after DDL and ledger insert | PASS — SQLSTATE `P0001`; migration/verification cycle 59 ms; ledger, columns, indexes, constraint and overlay rolled back |
| Whole-DO statement deadline | PASS — deliberately added `pg_sleep(61)` cancelled with SQLSTATE `57014` after 60.022 seconds; baseline schema/records restored |
| New objects | PASS — expected default `false`, NOT NULL suspension field, validated audit constraint and five valid indexes |
| Existing user/audit heaps | PASS — relation file identities unchanged; no heap rewrite |
| Successful-attempt database growth | 81,920 bytes / 80 KiB |
| Five new index files | 57,344 bytes / 56 KiB |
| Successful-attempt WAL generated | 53,656 bytes / approximately 52.4 KiB |

No original account, role, session, report, audit, workspace, comment or media
record was rewritten by the migration. New-column values/defaults were checked
separately rather than treating additive columns as original-record changes.

The 83 ms measurement includes the migration DO and ledger insert, not export,
restore or fixture tests. The 113 ms measurement is a conservative **upper
bound**, not a sampled per-relation exact lock interval. Storage/WAL figures
cover the successful attempt after rollback trials; they are not measurements
of physical WAL retention, whole-cluster disk allocation or earlier rollback
WAL. PostgreSQL sequences can retain harmless gaps after aborted ledger inserts;
rollback checks compare actual ledger rows, not transactional sequence rewind.

## Application compatibility scope

Both clean, source-pinned application harnesses used their own schema source,
with only the database connector injected and logging disabled. Each returned:

- HTTP 200 for anonymous `/api/me`;
- HTTP 200 for `/api/me` using a new synthetic session, with the expected
  synthetic user identity;
- HTTP 200 for `/api/public-feed`;
- unchanged schema metadata across application initialization/smoke requests.

Legacy-compatible explicit-column user, workspace and session fixture inserts
also succeeded on the additive schema. Original copied rows remained unchanged
after these checks.

| Harness | SHA-256 of generated code |
| --- | --- |
| Old | `963d3fd543b1ceb4e5791d84955ef0136d553faf085b0faa5c214d3bf1122ed2` |
| New | `c24cb9149b25dc3db62f23810f48eb34ab93270d61ca5adc93355cfee1926625` |

These are **API compatibility smoke tests**, not the exact production build,
full browser/native regression tests, new moderation-action/report-write
coverage, provider recovery tests, OAuth tests or a deployable recovery artifact.
Application readiness was marked only for the isolated harness after the
database checks; production process entrypoints/startup hooks were not run.
Restore intentionally omitted ownership/grants and used the disposable cluster
owner. Production runtime roles, ACL/RLS behavior, cluster-level configuration
and external media/provider resource recovery are not attested by this test.

## Cleanup

PASS — the disposable postmaster stopped, the temporary dump and all copied
database files/logs were deleted, and no rehearsal temporary directory remains.
Only non-sensitive results were retained. The deleted dump is **not** a retained
release backup or recovery point.

## Remaining blockers — HOLD

1. Attest the exact deployed build/source identity and provide a reproducible,
   tested operational application-recovery artifact. Candidate-source smoke
   compatibility does not prove Publishing rollback or compatibility with the
   exact live binary.
2. Demonstrate maintenance/drain controls covering web, native, API and direct
   static ingress, all writers and other deployments. No live maintenance,
   drain or long-transaction inspection was authorized or performed.
3. Approve a production outage/I/O/WAL/storage budget. An idle local restored
   copy, on different storage and a different PostgreSQL minor version, is not
   a production downtime or contention guarantee.
4. Confirm the supported managed-production schema-application route and obtain
   separate release/merge/maintenance/final-backup/publish approvals. This
   rehearsal authorizes no production DDL or startup migration hook.
5. Obtain and verify a retained final backup after separately approved
   maintenance/drain. Live writes can continue after this rehearsal snapshot.
6. The follow-up source/package correction closes direct-static media ingress
   in local tests; see [direct-media review](admin-moderation-direct-media-review.md).
   Verify final release routing/package ownership under separate approval and
   retain third-party/cached-media limitations. This historical database
   rehearsal did not test that later correction.
7. Complete the required release-level frontend/native/moderation/report-write
   and recovery checks; the API smoke scope above is intentionally narrower.
   An old application ignores moderation state and must remain externally
   restricted if used for recovery after moderation has occurred.

Do not wire the ignored local rehearsal helpers into CI, startup, deployment or
automatic hooks. Any further production export requires separate authorization.