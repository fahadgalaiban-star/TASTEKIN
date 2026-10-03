# Direct packaged-media moderation correction — PR #96

Decision: **Draft / HOLD**. Scope: application/package/routing code and synthetic
local verification only. No production access, merge, publish, deploy, provider
operation or production restart. Database schema, migration 0023 and its journal
are unchanged by this correction.

## Enforcement

The static web artifact previously bypassed Express moderation. Its build now
stages UI files without `tastekin-media`; the API build copies the eight packaged
demo images into its non-public `dist/media`. The API artifact explicitly owns
`/tastekin-media`, and Vite dev/preview proxy that same namespace to the API.
Vite filesystem serving denies alternate access to content-media sources.
No source/customer/private original is deleted, moved or rewritten.
Native packaged images use the already-configured native API origin instead of
the removed offline bundle path, remaining plain public image requests with no
bearer header. Web, private-object, local crop/blob and external URL behavior is
unchanged; native authentication/session plumbing is not modified.

GET/HEAD requests check readiness and fresh visibility before file serving.
Hidden Edit media, explicit local/same-origin packaged links in hidden comment
text and suspended-author media are withheld with empty 404 responses. Owners
and admins have no exception on this public URL. A database visibility failure
returns 503, never bytes or a SPA fallback. Restore/unsuspension restores access.
Absolute local-media identity uses the stable app-origin inventory in the
existing `ALLOWED_ORIGINS` configuration, plus the current request origin. All
serving aliases/historical app origins used in stored media links must be included
in that inventory before release; this change does not inspect or modify its
configured values. Media proxying preserves Host, while configured frontend
origins remain recognized even when a different alias/backend Host is used.
Unrelated images retain anonymous byte/MIME/HEAD/range behavior. New direct
responses are `private, no-store`, without ETag/Last-Modified validators.

Shared file references are conservative: any hidden/suspended referencing target
keeps the file denied. Text comments have no attachment column; only explicit
packaged links are recognized. Plain-text comment hiding never blocks the parent
Edit's image. Remote-origin lookalikes are not local packaged-media identities.

Existing admin inspection remains separately server-authorized and reads the
server package rather than the removed static copy. Private object inspection,
authentication, ownership, founder/admin protection, suspension identity rules
and transactional audit writing remain unchanged.

## Verification

- 25 moderation/schema/projection regression tests passed using a **new**
  disposable Unix-socket-only PostgreSQL cluster and synthetic fixtures. Child
  tests receive no configured database URLs/provider credentials. Cluster and
  fixture files are removed at exit. No existing Development database is used.
- Real HTTP tests cover public bytes, hide, known/encoded/query URLs, GET/HEAD,
  range and conditional denial, owner/admin public denial, restore, unrelated
  media, relative/same-origin hidden comment links, remote URL lookalikes,
  suspension/unsuspension and protected admin inspection. Missing/malformed/
  traversal URLs fail closed; synthetic visibility failure returns 503.
- Synthetic originals and file bytes remain intact. Existing regressions cover
  private-media authentication/ownership, account safety, protected accounts,
  complete transactional audits, failure rollback and session non-revival.
- 23 database-free tests passed: 19 private-image regressions plus four
  packaging/canonical-URL tests. Staging excludes media and removes stale copies,
  while preserving source files and unrelated UI assets.
  The real browser regression also checks native packaged images reach the
  public API origin without a bearer header, while web URLs stay relative.
- A requested independent security review found two bypass cases in the first
  revision: requesting-host-only absolute URL recognition and a comment extractor
  missing encoded extensions/sentence-final punctuation. Both were corrected.
  Regression tests now cover configured alternate/proxy origins, encoded
  extensions, punctuation and case-insensitive route-prefix aliases. No second
  reviewer pass or production test is claimed.
- Workspace TypeScript checks passed. API and frontend production builds passed;
  the existing frontend large-chunk warning remains. Final frontend public output
  contains no `tastekin-media`; all eight server media files match their sources.
- 0023 remains SHA-256
  `9d95a96f67c00d79c4bc767e9e31fa491d1dd321f7bc99cda88fbd5fa60ef9a1`.

## Prior correction scan findings — historical, not a clean bill of health

The subsequent finding-by-finding remediation and current scan/check results
are in [the security remediation review](admin-moderation-security-remediation.md).
The counts and unchanged-file statements below describe the earlier correction,
not the current security follow-up.

All three scanners completed. No scanner finding names the changed media code.
The unchanged lockfile/dependencies and unchanged files still produce:

| Scanner | Findings |
| --- | --- |
| Dependency audit | 0 critical, 13 high, 5 moderate, 2 low |
| Static analysis | 7 medium |
| Privacy/dataflow | 4 low |

High dependency findings concern brace-expansion/braces stack/memory exhaustion,
fast-uri host confusion/SSRF parsing, js-yaml CPU amplification and uuid buffer
bounds. They identify locked package versions, not demonstrated exploitability
of this media route. Dependency remediation remains separate release work.

Static findings flag redirects in existing auth/storage code and a fixture
PostgreSQL connection string in the migration-replay script. Privacy findings
flag email output in existing admin-grant/admin-revoke scripts. These are
scanner findings to triage, not confirmed new vulnerabilities; no authentication,
admin behavior, dependency or unrelated script refactor is included here.

## Limits and remaining HOLD gates

New requests beginning after a committed moderation change are checked against
that state. This does **not** revoke previously downloaded, cached, offline,
already admitted in-flight, or third-party-provider copies. No historical cache
purge or provider operation is performed.

Local tests do not attest live platform routing. Final release must verify API
namespace ownership and absence of media in the static output. Exact deployed
binary/recovery identity, maintenance/drain, production budget, supported
schema-application route, retained final backup, broader release checks and
separate merge/publish approvals remain outstanding.