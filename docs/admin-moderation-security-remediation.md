# PR #96 security remediation

Status: **open Draft / HOLD**. This is not approval to merge or publish.
Review date: 2026-10-03. Approved comparison base:
`59c73f43fc4e51861d5f1388ca1808ba7a637d01`.

No production database, provider, schema, migration, deployment or production
restart was accessed/performed. No existing database was migrated. Migration
0023 and its journal are unchanged by this follow-up. Testing used disposable
synthetic PostgreSQL over a Unix socket with an empty network listener and a
credential-free child environment. No audit force-fix, suppression, removed
security checks, unreviewed major upgrade or replacement library was used.

## Dependency evidence and classification

Before this follow-up the lockfile and workspace dependency configuration
matched the approved base exactly. Therefore **none of the 13 high findings was
introduced by PR #96**. All five affected packages are **transitive development
dependencies**, not direct application runtime dependencies. Frontend packages
being declared development dependencies alone is not proof of runtime absence:
the dependency/import paths below and the built API source map were checked.
The latter contains zero source files for these five packages. Tooling still
executes them; development-only is not the same as risk-free.

| Ref | Package before → now | Importer / dependency path | Runtime reachability | Upgrade / breaking risk |
| --- | --- | --- | --- | --- |
| A | brace-expansion 5.0.8 → 5.0.12 | TASTEKIN Capacitor CLI → rimraf → glob → minimatch; api-spec Orval → typedoc → minimatch | Native build/cleanup and documentation/codegen tooling; no consumer API import identified | Same-major patch; low compatibility risk, intentional limits on pathological patterns |
| B | braces 3.0.3 unchanged | mockup-sandbox fast-glob 3.3.3 → micromatch 4.0.8 | Design preview discovery uses fixed internal globs, not visitor-supplied patterns; no consumer runtime import | No published patch; latest npm version remains 3.0.3. Replacement/parent migration is separate |
| C | fast-uri 3.1.4 → 3.1.8 | api-spec Orval → Scalar OpenAPI/JSON parsing → ajv 8.20.0 → fast-uri | Parsing local OpenAPI/codegen inputs; no customer HTTP parsing with this package identified | Same-major patch; low compatibility risk, stricter hostile URI handling |
| D | js-yaml 4.3.0 → 4.3.2 | api-spec Orval 8.23.0 → js-yaml (exact 4.3.0 pin) | Local YAML/codegen tooling, not request-body parsing | Same-major patch; low compatibility risk; parent exact pin requires a narrow override |
| E | uuid 7.0.3 unchanged | TASTEKIN @capacitor/cli 8.5.2 → xcode 3.0.1 → uuid | Xcode project tooling calls `v4`; affected buffer APIs `v3`/`v5` are not used at that call site. Package remains vulnerable | First advised fix 11.1.1 is a major upgrade, outside xcode's `^7.0.3` range; native compatibility review required |

### Each of the 13 original high findings

Every row inherits its explicit dev/transitive/not-introduced classification,
reachability and breaking-risk assessment from the referenced path above.
“First fix” is the scanner-advised patched version, not necessarily the newest
safe version installed.

| Advisory | Ref | First fix | Disposition |
| --- | --- | --- | --- |
| GHSA-6j4f-fj2g-mc7p — parseCommaParts stack exhaustion | A | 5.0.10 | Fixed by 5.0.12 |
| GHSA-qhr7-859c-m2p7 — nested brace stack exhaustion | A | 5.0.11 | Fixed by 5.0.12 |
| GHSA-rgw5-rvv9-x895 — unbounded intermediate arrays | A | 5.0.9 | Fixed by 5.0.12 |
| GHSA-vfj7-8cjw-p6xm — nested braces stack exhaustion | B | None published | Remains HIGH; separate remediation |
| GHSA-5jgf-p345-68v8 — skipped IDN canonicalization | C | 3.1.6 | Fixed by 3.1.8 |
| GHSA-7p8r-x3mc-p8w7 — backslash authority confusion | C | 3.1.5 | Fixed by 3.1.8 |
| GHSA-f65p-4m7j-42xc — malformed IPv6 normalization | C | 3.1.6 | Fixed by 3.1.8 |
| GHSA-fph4-wmhf-6fwf — repeated hostname percent decoding | C | 3.1.6 | Fixed by 3.1.8 |
| GHSA-jqff-g426-hqxp — encoded scheme normalization | C | 3.1.6 | Fixed by 3.1.8 |
| GHSA-qw65-cvwx-89v3 — serialize port authority injection | C | 3.1.7 | Fixed by 3.1.8 |
| GHSA-2883-xcg3-v3hh — empty merge-source CPU amplification | D | 4.3.2 | Fixed by 4.3.2 |
| GHSA-5p4m-2wfm-xmqj — !!omap quadratic CPU use | D | 4.3.1 | Fixed by 4.3.2 |
| GHSA-w5hq-g745-h8pq — missing UUID buffer bounds | E | 11.1.1 | Remains HIGH; major update not applied |

Only these three resolved package versions changed. Direct dependency versions,
minimum release age, other security restrictions and all other resolved packages
were retained. Overrides target the old exact versions, not unrelated majors.
The workspace reinstall skipped lifecycle scripts to avoid unrelated writes.
Actual Orval generation completed for both React Query and Zod, producing 84
files in disposable output directories; no live generated contracts were
rewritten for that compatibility check.

## Every static finding reviewed

All seven original findings predate this follow-up. No scanner suppression was
added. The six residual redirect findings remain visible for human review.

| Original location | Evidence / action | Current disposition |
| --- | --- | --- |
| auth.ts:148, Replit callback redirect | The old slash-prefix helper admitted slash-backslash URLs that browsers interpret as external authorities. Replaced by local URL parsing, explicit origin equality, rejection of backslashes/control characters and relative-only output | Real pre-existing validation flaw fixed; residual scanner taint warning does not recognize the helper |
| auth.ts:154, logout redirect | Same helper and caller; direct query input now passes the strict local-origin validator | Same fixed flaw; residual reviewed warning |
| auth.ts:323, Google callback redirect | Return cookie is revalidated at consumption, not trusted merely because it was set earlier | Same fixed flaw; residual reviewed warning |
| storage.ts:92, owner object redirect | Request path becomes a validated object key. Owner workspace membership is checked before the configured storage sidecar signs the download URL; request input is not the redirect authority | Reviewed taint false positive at the trusted signer boundary; route retained |
| storage.ts:104, profile photo redirect | Workspace object path is validated and signed by the same configured sidecar, not used as a user-selected URL authority | Reviewed taint false positive; route retained |
| storage.ts:111, profile cover redirect | Same signer flow as profile photo | Reviewed taint false positive; route retained |
| verify-video-upload-migration-replay.ts:30 | Example `user:pass` connection string was a documentation fixture, not a real credential. Replaced with a non-credential disposable-database placeholder; isolation guards unchanged | Removed; no longer reported |

Trust in the configured storage signer is a system boundary, not a guarantee
against a compromised signer. Existing signed provider URLs cannot be recalled.
Private object-storage/native image routes retain their prior ownership and
stream-versus-redirect behavior; regression checks were rerun.

## Every privacy finding fixed

| Original location | Action |
| --- | --- |
| admin-grant.ts:43 | Resolved-account output now contains administrator status only |
| admin-grant.ts:60 | Success output no longer emits an email or account identifier |
| admin-revoke.ts:38 | Resolved-account output now contains administrator status only |
| admin-revoke.ts:55 | Success output no longer emits an email or account identifier |

The update statements return only the status needed by those messages.
Target resolution, `--yes`, database selection and grant/revoke permissions were
not relaxed. Neither operator script was executed against a database.

## Local routing and origin verification

- Canonical media identity uses configured HTTP(S) app origins, platform-owned
  runtime domains and the current request origin. Custom native shell origins
  are clients only, never a `"null"` packaged-media identity.
- Explicit foreign/opaque Origin headers are rejected for packaged media and
  administrator report routes. Native shell clients must be explicitly
  configured. No wildcard or attacker-domain suffix matching was added.
- Anonymous public image GETs remain supported. Origin policy is not
  authentication or protection against non-browser clients spoofing/omitting
  Origin, and does not claim to prevent all embedding of public images.
- The actual API media middleware and report inspection routes were exercised
  with real synthetic session cookies: published bytes 200, hidden bytes 404,
  restoration 200, foreign/opaque origins 403, anonymous/non-admin/forged-cookie
  inspection 403 and authenticated admin hidden-original inspection 200.
- Actual Vite **dev and built preview** configurations were started inside the
  isolated fixture. Both proxy public/hidden/restored requests through the API,
  deny explicit foreign-origin requests, preserve authenticated admin inspection,
  and do not leak originals through `/public/...` or `/@fs/...`. Unrelated
  favicon delivery remains available.
- Encoded/query/range/HEAD/conditional requests, alternate frontend/backend
  hosts, comment links, suspension and database failure remain covered.
- The registered API artifact declares `/tastekin-media` namespace ownership;
  the frontend build contains no static media copy. This is local configuration
  evidence, **not an attestation of published platform ingress or live origins**.

## Final checks and scan results

| Check | Result |
| --- | --- |
| Isolated moderation/migration/projection/HTTP suite | 25 passed |
| Private/native image, browser lifecycle and packaging/redirect/origin suite | 25 passed |
| Workspace TypeScript, including scripts/design preview | Passed |
| API and frontend builds | Passed; existing frontend chunk-size warning remains |
| Orval React Query + Zod with patched tooling, disposable output | Passed |
| Source → server media comparisons | All eight original files identical |
| Frontend public output excludes moderated media | Passed |
| Whitespace/conflict diff check | Passed |
| Legacy `scripts/verify-phase1.mjs` | FAILED at the old locked-collection assertion; also fails against the approved base at exactly that assertion. Not removed or changed |
| Dependency audit | 0 critical, **2 high**, 3 moderate, 2 low |
| Static analysis | Complete; **6 medium** reviewed redirect findings, not a zero-findings scan |
| Privacy/dataflow | **0 findings** |

0023 SHA-256 remains:
`9d95a96f67c00d79c4bc767e9e31fa491d1dd321f7bc99cda88fbd5fa60ef9a1`.

The managed preview shell was captured but is not a post-migration release
sign-off: its content photo was not rendered. Existing live development data
and schema were not inspected or changed to make that preview pass.

### Other residual dependency advisories

These pre-existing lower-severity issues were not silently folded into the
high-finding remediation. Include them in the separately reviewed work below.

| Package / advisory | Scope and reachability | Patch / risk |
| --- | --- | --- |
| esbuild 0.27.3, GHSA-g7r4-m6w7-qqqr (low) | Direct API build tool and transitive Vite/tsx tool; absent from API runtime bundle | 0.28.1 crosses a 0.x minor; toolchain compatibility review |
| markdown-it 14.3.0, GHSA-253c-mchw-3w2r (moderate) | Transitive Orval/typedoc documentation tooling, absent from API runtime bundle | 14.3.1 patch; separate low-risk tooling update |
| nanoid 3.3.16, GHSA-2v37-7h3g-55p8 (moderate) | Transitive PostCSS/Vite development tooling, absent from API runtime bundle | 3.3.18 patch; separate low-risk tooling update |
| qs 6.15.3, GHSA-4mjr-xmp4-gh2g (moderate), GHSA-x5fp-wj9c-mxmx (low) | **Production/transitive** Express 5.2.1 and body-parser 2.3.0; eight source files in API bundle. URL-encoded parsing is potentially request-reachable; not dismissed as dev-only | 6.16.0 same-major minor; verify parser/body/query limits and auth/request compatibility separately |

## Precisely proposed separate remediation PRs — not created or approved

1. **Remove vulnerable development globbing and migrate Xcode UUID tooling.**
   Scope: `artifacts/mockup-sandbox` fast-glob/micromatch/braces path and
   `artifacts/tastekin` Capacitor/Xcode/UUID path plus their lockfile entries.
   Prefer an upstream patched parent when published; otherwise use a separately
   reviewed discovery implementation rather than declaring vulnerable braces
   safe. For UUID, review the parent range and CJS/ESM/API/ID-generation behavior
   before any major override. Require mockup discovery/watch/ignore-pattern tests,
   bounded hostile-pattern tests, and real macOS/iOS Capacitor project generation,
   sync/build comparison. A Linux check is not native compatibility sign-off.
   Include independent esbuild/markdown-it/nanoid tooling updates and build/
   codegen regressions. Acceptance: no remaining high tooling advisories, no
   suppressed scanner findings, no changed application contracts.

2. **Patch the production Express query/body parser independently.**
   Scope: qs via Express/body-parser; resolve to >=6.16.0 without changing the
   Express major. Require query/body depth, parameter-count, duplicate-key and
   oversize-input tests plus auth/admin/API regressions. Rescan the built runtime
   dependency graph. No migration or provider operations are part of this PR.

The stale Phase 1 assertion also needs separate reconciliation with the approved
free-product behavior, not deletion to manufacture a passing result.

## Remaining HOLD gates

The two high dependency findings, visible static-review warnings, the baseline
Phase 1 failure and the unfinished release checks are not waived. Published
namespace/origin checks, exact binary/recovery identity, maintenance/drain,
approved schema-application route, retained backup and production budget remain
outside this local verification. Merge and publish each require separate
approval. No release or provider/cache purge was attempted.