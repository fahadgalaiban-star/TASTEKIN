# PR #96 final pre-merge gate

Review date: 2026-10-03. Reviewed application-code head:
`39919b83fc22167de702791be1d2e4cdc228392f`.
Approved comparison base: `59c73f43fc4e51861d5f1388ca1808ba7a637d01`.

**GitHub verdict: eligible for Ready for Review; no remaining PR code blocker identified.**
**Production release verdict: HOLD; no approval to publish or migrate.**

## Scope and database safety

- Used the **existing Replit Development database**, explicitly selected with
  `executeSql({ environment: "development" })`. No disposable/staging database
  substituted for this gate.
- Its moderation table, suspension field, action-audit fields and indexes were
  already present before this work. **No migration or schema push was needed or
  performed.** Migration 0023 retains SHA-256
  `9d95a96f67c00d79c4bc767e9e31fa491d1dd321f7bc99cda88fbd5fa60ef9a1`.
- Created unique synthetic consumer/moderator/owner/admin identities, one Edit,
  one comment, six reports, web cookies and hashed native bearer sessions.
  Owner protection was exercised through the server-owned `owner` role, not a
  hard-coded creator slug or modification of the real founder's identity.
- The synthetic PNG was placed temporarily in the Development API's ignored
  build directory. No real upload, original image, provider or storage object
  was used as the moderation target.
- Checked fingerprints and counts of the eight existing core tables before
  setup. Temporary credentials are local-only and must not be committed.
  Final fixture cleanup/preservation confirmation is recorded below.
- Restarted **only the Development API**, once, because its old running process
  had not loaded the reviewed Origin guard. No Production workflow, application,
  database, deployment logs or provider credentials were accessed.

## Existing-Development HTTP gate

`scripts/tests/premerge-development-http.mjs` passed **117 assertions** against
the actual API and synthetic records in that database. It uses only hard-coded
localhost Development HTTP; it cannot accept a remote API/database URL. Fixture
setup is intentionally agent-controlled through the explicitly Development SQL
callback, not an unguarded connection-string CLI.

| Requirement | Verified behavior |
| --- | --- |
| Hide / restore Edit | Admin action 200; inspection overlay true/false; original Edit data unchanged |
| Direct media | Public GET/HEAD/range 200/206 → hidden 404 with zero bytes → restored 200/206; no-store; foreign Origin 403 |
| Hidden-original inspection | Actual admin cookie receives original synthetic PNG; anonymous inspection 403 |
| Hide / restore comment | Public comment disappears/reappears; inspection retains original body |
| Suspend / unsuspend user | Account state changes through report-owned identity; media/content withheld/restored |
| Web/native credentials | Real cookie and hashed bearer resolve before suspension; restricted identity/safety state during suspension; ordinary writes denied; neither old credential is revived by unsuspension |
| Owner/admin/self protections | Synthetic owner role, `is_admin`, admin role and self suspension all 403; rejected operations add no audit |
| Audit records | All six actions have real history; actor/report, timestamp, reason and before/after state checked |
| Confirmation/access controls | Non-admin rejection and required confirmation verified |

Requests to a suspended author's Edit/comment endpoint can return 404 before
the authentication guard, because visibility withholds the parent Edit. This is
intentional fail-closed behavior, not evidence that a write was accepted.
Synthetic originals and denied-write absence are checked directly before cleanup.

## Browser and native-preview gate

The browser test uses the actual full web App, real administrator cookie and
real Development API, without fabricated API responses.

- Initial testing at the unconfigured raw-localhost frontend correctly produced
  `403 Request origin unavailable` on the browser action. The actual managed
  `.replit.dev` preview domain is recognized and its authenticated inspection
  returns 200. Testing continues through that actual preview URL **without
  overriding Origin or relaxing the allowlist**.
- Native-preview means a 402×874 browser context with **no cookie** and the real
  native bearer attached to the Development API. It is not a physical
  iOS/Android device or a store/submission sign-off.
- Actual shell-Origin probes confirmed `capacitor://localhost` and
  `https://localhost` receive the exact CORS allow-origin response and public
  synthetic media 200. Unconfigured `ionic://localhost` receives no CORS grant
  and media 403; no wildcard was added.
- External domains, private-object media and unrelated write endpoints are
  blocked by the browser test policy. The first raw-localhost navigation had a
  broader same-origin asset rule before it was tightened; that initial load
  cannot certify every local asset request. Subsequent preview verification
  uses the restrictive policy.

**Browser gate: passed** on the managed Development preview, with its real Origin.
Reason/confirmation, all six UI actions, the protected-account notice/disabled
buttons and four negative 403 requests, audit before/after details, web and
no-cookie mobile suspended screens, restoration and old-credential invalidation
were verified. The four safety/legal controls were observed, not followed into
external pages or destructive deletion. Ordinary-write denial is covered by
the actual HTTP gate, not inferred from the browser's blocked unrelated reads.

Screenshots retained by the browser test:

- `1oluy6`: desktop restore audit, hidden true → false.
- `ci8z9y`: 402×874 no-cookie native-preview suspended-account screen.
- `57jxaq`: successful Edit hide; exact public image 404 and admin original 200.
- `scqyxk`: successful author unsuspension and final moderation controls.

After the browser pass, actual `capacitor://localhost` and `https://localhost`
media requests were also checked across hide **404** → restore **200**, with
their exact CORS grant preserved. No Origin override or allowlist change.
The real configured-founder matcher additionally passed seven assertions with
explicit synthetic ID/email mappings in a credential-free isolated context:
ID priority, normalized email fallback, empty/missing rejection and no
creator-slug authorization. The real mapping/secret was never read or changed.

## Merge cannot execute a release or production schema operation

Verified the live GitHub repository configuration, not merely local YAML:

- Repository Actions inventory has one workflow, **Mobile build validation**.
  The repository webhook inventory is empty.
- Its `push: main` and pull-request jobs install dependencies, typecheck, build
  the web bundle, run Capacitor sync, build unsigned Android/iOS outputs and
  upload **GitHub build artifacts**. Artifact upload is not app publication.
  No deployment, store upload/signing, database credential, migration, schema
  push or Production restart command is present.
- Root install/build scripts have no schema/deployment lifecycle hook. The
  artifact production build/run commands only build/start the API; they do not
  invoke 0023 or `drizzle-kit`.
- Current source and compiled API entrypoint do not call the exported
  `runPendingMigrations` helper or read `RUN_MIGRATIONS_ON_BOOT`.
  The legacy `.replit` run string still mentions that flag, but the current
  entrypoint ignores it and the artifact-owned run command does not set it.
  This legacy configuration is not an automatic migration execution path.
- `.replit`'s `postMerge` points to the existing Development schema setup script.
  A **Replit task merge** hook is distinct from a **GitHub pull-request merge**;
  the GitHub workflow does not invoke it. It must not be run in a Production
  environment. This review did not execute it.
- Replit's managed **Publish** flow can diff/apply Development schema to
  Production after a separate user publishing action. GitHub merge is not that
  action; no publishing action was requested or performed.

This establishes no merge-triggered release/schema path in the verified
repository/platform flow. It is not a universal guarantee against an unknown
external operator or future automation changes. Recheck if workflows/webhooks,
startup/build scripts or publishing integration settings change.

Main is currently unprotected according to GitHub's branch-protection endpoint.
Therefore human discipline still matters: Ready for Review does not approve
merge or release, and no merge operation or auto-merge enablement is authorized.

## Remaining security findings: introduction and exploit reachability

Both remaining HIGH packages were locked at the same versions in the approved
base. No application dependency/import path to either is introduced by this PR.
Both are absent from the compiled API source map.

| Finding | Production reachability / disposition |
| --- | --- |
| `braces` 3.0.3, GHSA-vfj7-8cjw-p6xm | Development design-preview fast-glob → micromatch; discovery uses fixed internal `src/components/mockups/**/*.tsx` and fixed ignore patterns, not visitor patterns. No customer API/frontend import identified. Still vulnerable tooling; remove/replace through the separate tooling PR when an upstream patch is available or replacement is reviewed. |
| `uuid` 7.0.3, GHSA-w5hq-g745-h8pq | Capacitor → Xcode build tooling, not packaged app execution. Xcode's call is `v4()` without a caller-supplied output buffer; the advisory affects v3/v5/v6 buffer APIs. Still a vulnerable installed package; separately review the parent/API/major update and native sync/build compatibility. |

All six redirect sinks existed in the approved base. Storage route source is
unchanged; the auth helper is hardened by this PR, not weakened.

| Static warning | Runtime sink? | Unresolved exploitable issue? |
| --- | --- | --- |
| Replit callback auth.ts:149 | Yes | No identified path: destination passes strict `safeLocalRedirect` validation; original pre-existing slash/backslash flaw fixed |
| Web logout auth.ts:155 | Yes | Same local-origin validation, with normalization/control/backslash/authority regressions |
| Google callback auth.ts:324 | Yes | Return cookie is validated again at consumption, not trusted because it was set earlier |
| Owner object redirect storage.ts:92 | Yes | Reviewed trusted-signer boundary: validated owned object key is signed by the configured sidecar; caller does not supply redirect authority |
| Profile photo storage.ts:104 | Yes | Stored object path passes the configured private-object signer; no client-selected URL authority reaches Location |
| Profile cover storage.ts:111 | Yes | Same signer boundary; storage source unchanged from base |

The scanner still reports **six medium warnings**. These are human-reviewed
validation/trust-boundary findings, not suppressions or a zero-findings scan.
Compromise of the trusted signer is outside the caller-taint finding and remains
a system trust assumption. No provider/signing requests were made to validate
this boundary.

### Lower-severity production package follow-up

`qs` 6.15.3 is installed in production and its parser is request-reachable.
That fact must not be mislabeled as development-only. However, the two reported
advisories require additional call/option conditions:

- GHSA-4mjr-xmp4-gh2g requires hostile objects reaching `qs.stringify` after
  parsing. The application has no direct `qs` import or parse→stringify path.
  Express/body-parser use the npm package's **parse**, not stringify.
- GHSA-x5fp-wj9c-mxmx requires `comma: true`; body-parser does not set that option,
  and Express's query parser remains `simple`. Default comma parsing is false.
- The Anthropic SDK also contains a distinct vendored qs-like serializer with
  the constructor/isBuffer pattern. Its three current message-call sites pass
  structured request bodies and timeout/retry options, not attacker-supplied
  URL-query objects. No such serialization path was identified in the current
  request call graph. Future query-option use requires renewed review.

These are residual dependency/SDK risks, not a blanket claim that parsing is
risk-free. Keep the separately scoped parser patch and bounded
depth/parameter/size/constructor/comma regressions. Any newly identified
request-reachable unresolved vulnerability is a blocker, regardless of whether
it predates this PR.

## CI, preservation and separate verdicts

- All 66 current PR file blobs match the local reviewed files exactly.
- GitHub checks on application-code head `39919b8`: Web bundle, Android debug/
  unsigned release and iOS unsigned simulator/device builds all **success**.
- Existing TypeScript/build/isolated compatibility results remain applicable:
  this gate changes no application source, lockfile, schema or migration.
- Legacy Phase 1 locked-collection assertion remains a reproduced baseline
  failure, not removed or suppressed to produce a passing gate.

**Cleanup/preservation: passed.** Before cleanup, all six audit action types
were present (49 synthetic records in total), with reasons, timestamps and
non-null before/after state; the Edit had exactly one comment with its original
body; all five fixture accounts were unsuspended.

An atomic exact-ID Development transaction removed only the synthetic users,
their five workspaces, six reports, comment, overlays, sessions and dependent
fixture rows. The temporary local PNG and credential file were removed.
Post-cleanup counts **and full-row aggregate fingerprints match the pre-setup
snapshot for all eight core tables**: users, workspaces, comments, reports,
audit, web sessions, native sessions and moderation state. All 313 existing
users, 324 existing web sessions, 11 workspaces and the existing report were
preserved; there were no pre-existing comments, native sessions or moderation
audit/overlay rows. Synthetic audit evidence was verified before removal and
is retained in this report/screenshots, not left as production-like test data.

### GitHub merge/review readiness

**Ready for human review; not a merge instruction.** Existing-Development
HTTP/browser/native-preview/preservation gates passed. No remaining exploitable
PR security issue was identified in the reviewed call paths. The two vulnerable
tooling packages and six visible static findings remain documented, not
suppressed or declared universally safe. No auto-merge enablement is authorized.

### Production release readiness

**NOT READY — HOLD.** Even a Ready for Review PR is not release approval.
Production was not accessed, so this gate cannot attest live binary/recovery
identity, published namespace/origin/cache behavior, backups and restore,
maintenance/drain, schema-application approval or migration budget.
Device/store release sign-off and the separately reviewed residual dependency
remediation are separate work. No staging deployment, merge, publication,
Production migration, schema push or Production restart was performed.