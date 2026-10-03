# Admin moderation draft — corrective review

PR: https://github.com/fahadgalaiban-star/TASTEKIN/pull/96
Branch: `feature/admin-moderation-actions`.
Base: `59c73f43fc4e51861d5f1388ca1808ba7a637d01`.
Corrective review starts from `bcf75251cf0863a9b90195debcf197fbc434c23b`.
Review only: retain Draft; no merge, publish, deployment or existing-database migration.

## Corrections

- Restored baseline memory content and removed only the newly introduced memory
  topic. No `.agents/memory/` changes remain in the net PR diff. Instruction
  attachments remain on disk but are excluded from the net PR diff.
- Six reversible moderation actions still change overlays/account status only.
  Creator JSON, comment bodies, audit history and expired/revoked session rows
  remain intact. State, session expiration and audit insertion are transactional.
- Suspension no longer locks users out of account safety. A suspension-expired
  cookie or moderation-revoked native token can prove identity only on the exact
  allowlist below, while its original lifetime remains valid. Native idle limits
  still apply; recovery reads do not update last-used time. This is not ordinary
  authentication, new session issuance, token renewal or session restoration.
  Logout closes recovery; unsuspension does not restore old credentials.
- Minimum suspended state omits creator/admin privileges and feature flags.
  English/Arabic account UI retains logout, deletion and legal/support links.
  Deletion retains the existing typed confirmation and authenticated identity.
- Replaced recursive response redaction with declared endpoint projections.
  Edit, comment, creator, Collection, Saved-list, provider-place, closet and trip
  identifiers are not treated as one namespace. Arbitrary nested metadata,
  Collection/list identity, upload IDs and external URL lookalikes survive.
  Known collection cover/Edit/order references and KIN citations/results are
  filtered. KIN snapshots with blocked retained provenance are withheld.
- Public home/detail/visitor views no longer substitute private originals when
  moderated public results are empty/missing. Private owner editing retains
  originals. Legacy default guest workspace/profile routes are projected;
  the private exception requires a server-resolved owned workspace.
- Protection is based on the target owner's database identity, `is_admin`,
  protected `owner`/`admin` role, or existing configured founder mapping.
  `FOUNDER_AUTH_USER_ID` takes precedence over `FOUNDER_EMAIL`; no hard-coded
  creator slug grants protection. Self-suspension and suspension of every
  protected owner/admin are prohibited. Client target/owner fields never select
  the account to moderate or delete.
  Ordinary workspace provisioning preserves protected owner/admin roles rather
  than silently replacing them with `creator`; this protection is regression-tested.

## Exact suspended-account allowlist

Only these methods and paths can use restricted identity proof:

| Method | API path |
| --- | --- |
| GET | `/api/me` |
| GET | `/api/auth/user` |
| GET | `/api/logout` |
| GET | `/api/privacy` |
| GET | `/api/terms` |
| GET | `/api/support` |
| POST | `/api/me/delete-account` |
| POST | `/api/auth/native/logout` |
| POST | `/api/auth/native/logout-all` |

The helper also accepts the same paths without `/api` because middleware mounts
use different prefixes. No suffix, wildcard, HEAD, PUT or other method is granted.
Legal/support entries are reserved exact safe paths, not new API handlers;
the existing public legal screens and configured support link remain accessible.
No legal/support authenticated application capability is added.
Session creation, content editing/publishing, uploads, comments, messaging,
follow/like/save and ordinary authenticated features have no recovery access.
Unauthenticated public browsing remains public; it is not authenticated recovery.

## Query evidence and migration indexes

Visibility reads only hidden moderation rows and suspended user IDs. Workspaces
are selected using `creator_id IN (...) OR owner_user_id IN (...)` for those
affected identities. Suspended-author comments use `WHERE user_id IN (...)`.
Individual admin targets use exact report/comment/creator keys; Edit resolution
uses `WHERE edits @> '[{"id":"..."}]'::jsonb LIMIT 2`. Duplicate legacy IDs are
rejected rather than choosing an arbitrary owner. Private-owner checks use the
existing unique owner index and `LIMIT 1`.
The shared engagement/comment/Saved Edit resolver also uses indexed JSONB
containment and `LIMIT 2`, rather than reading every workspace.

Migration `0023` adds five indexes justified by these real queries:

| Index | Purpose |
| --- | --- |
| `moderation_content_hidden_idx` | Partial `(creator_id,target_type,target_id) WHERE is_hidden=true` |
| `users_suspended_idx` | Partial `(id) WHERE is_suspended=true` |
| `moderation_audit_target_time_idx` | `(target_type,target_id,created_at DESC NULLS LAST) WHERE action IS NOT NULL` |
| `creator_workspaces_edits_gin_idx` | GIN `edits jsonb_path_ops` for JSONB containment |
| `edit_comments_user_idx` | B-tree `user_id` for suspended-author comments |

Admin inspection history now includes action history for the exact content target
and its owner account, in addition to report history. Existing primary/owner/report
indexes are reused; no redundant full-state boolean index is added.

Tests capture actual Drizzle SQL from visibility loading and individual Edit/comment
resolution, assert every workspace/comment read has a WHERE predicate, verify
containment with LIMIT 2 and suspended-author IN queries, and run EXPLAIN for all
five new indexes with sequential scans disabled. This proves index eligibility,
not production execution plans or performance. No production database was queried.
This instrumentation covers moderation enforcement and exact-target resolution,
not unrelated global catalog enumeration. Existing creator-directory aggregation
still enumerates the global catalog; this PR does not introduce pagination or
redesign that pre-existing discovery operation.
Migration and current schema are compared for columns/defaults/constraints/indexes,
including descending-index null ordering.

The migration is additive: no DROP, DELETE, TRUNCATE or content rewrite.
Application rollback can retain the additive schema, indexes and history.
Any later schema rollback needs its own backup/data-preservation review.

## Consumer endpoint/shape inventory

- `/feed`: flat Edit array.
- `/public-feed`: `{items:[{creatorUsername,edit,...}],...}`; `/circle/feed`:
  wrapped-item array. Only actual blocked creator/Edit entries are removed.
- `/creators`, `/circle/members`: creator arrays; `/creators/:username`,
  `/creators/:username/profile`: profile/detail objects and their Edit/Collection
  arrays; `/taste-match/:username`: creator wrapper.
- `/creators/:username/workspace`: public workspace Edit/CreatorCollection arrays;
  `/creators/:username/featured-collections`: Collection IDs remain Collection IDs.
  `/creator-workspace`, `/creator-profile`, `/creator-featured-collections`:
  legacy default public guest shapes, except authenticated private owners.
- `/explore`: creators/Edits/discovery Collection summaries. Product, place,
  taxonomy and arbitrary metadata identifiers are not reinterpreted.
- `/edits/:id`, `/edits/:id/engagement`, `/edits/:id/like`, `/edits/:id/save`:
  block hidden parent targets; engagement counters/flags remain intact.
- `/edits/:id/comments`, `/edits/:id/comments/:commentId`: comment namespace;
  hidden/suspended-author comment IDs removed, regardless of missing author fields.
- `/me/saved-edits`: string Edit IDs; `/me/saved-lists`, `/me/saved-lists/:id`,
  `/me/saved-lists/:id/edits/:editId`: declared Edit references only.
- `/circle/members/:username`, `/relationships`, `/relationships/follow/:username`,
  `/creators/:username/views`: exact creator relationship/view targets.
- `/kin/saved[/:id]`: saved `{items:[snapshot]}` or snapshot; `/kin/search`,
  `/kin/looks`, `/kin/looks/generate`, `/kin/travel/plan`,
  `/kin/travel/swap-place`, `/kin/travel/stays`: declared citation/result provenance.
  `/kin/trips[/:id[/items[/:itemId]]]`: provider/trip IDs and free text unchanged.
- `/public-media/:username/:editId...`, `/public-profile-media/:username...`:
  exact public media target guard.
- `/admin/reports/:id/inspection`, `/inspection/media`, `/actions`: independently
  server-authorized administration, never consumer redaction; hidden originals
  remain inspectable by administrators.

Focused tests cover real flat/wrapped arrays, creator details, discovery summaries,
CreatorCollection uploads/covers/order, Saved lists, KIN citation objects/snapshot
envelopes, media paths and unrelated-ID collisions. URI-encoded targets are checked.

## Validation

- 24 focused moderation/schema/projection tests passed in newly created
  disposable Unix-socket-only PostgreSQL databases. Child tests receive a clean
  environment without configured database URLs or provider secrets.
- Real account-safety HTTP middleware/routes passed for cookie and native proofs,
  typed deletion confirmation, authenticated identity selection, logout,
  ordinary mutation rejection, session issuance rejection and no revival.
  Account deletion's destructive service was mocked: no account/provider deletion
  was performed, and all original fixture content/session/history rows remained.
- 19 existing database-free private-image regression tests passed.
- Shared-library, API and frontend TypeScript checks passed.
- Frontend production build passed; existing large-chunk warning remains.
- Mocked English/Arabic/mobile browser verification uses actual moderation and
  suspended-account components; all network fetches are refused unless mocked.
  Required reason, cancel/single confirmation, all action variants, retry,
  protected/non-admin states and safety callbacks passed at desktop and 390px.
  The tester noted inherited LTR computed direction in the isolated Arabic
  suspension fixture; explicit inline RTL direction now prevents that override.
- `git diff --check` passed. Exact net PR manifest is below.

## Remaining limitations and operational boundary

No complete revocation is claimed for previously issued provider URLs, cached or
offline copies, or unattributed copied KIN text. The later direct-media correction
removes content media from the static build and routes `/tastekin-media/*` through
the gated API; see [focused review](admin-moderation-direct-media-review.md).
This is locally verified source/package enforcement, not a production rollout or
historical cache purge. No storage-provider redesign is included.

No configured/existing database migration or provider resource operation was
performed. No raw credentials/secrets were inspected or changed. GitHub updates
use the existing managed connection. Nothing was merged, deployed, published,
or applied to production; the development API was not started against new schema.
See `docs/admin-moderation-deployment.md` for the separately approved release order.

## Prior corrective-review manifest (45; before the direct-media correction)

This historical list predates the focused package/routing correction. See
`docs/admin-moderation-direct-media-review.md` and the PR's current Files changed
tab for that correction; database/schema/contracts are unchanged by it.

- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/lib/active-account.ts`
- `artifacts/api-server/src/lib/auth.ts`
- `artifacts/api-server/src/lib/creator-account.ts`
- `artifacts/api-server/src/lib/moderation-policy.ts`
- `artifacts/api-server/src/lib/moderation-repository.ts`
- `artifacts/api-server/src/lib/moderation-visibility.ts`
- `artifacts/api-server/src/lib/native-auth.ts`
- `artifacts/api-server/src/lib/suspended-account-access.ts`
- `artifacts/api-server/src/middlewares/auth-middleware.ts`
- `artifacts/api-server/src/middlewares/moderation-middleware.ts`
- `artifacts/api-server/src/routes/engagement.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/routes/moderation-actions.ts`
- `artifacts/tastekin/src/App.tsx`
- `artifacts/tastekin/src/components/AdminModerationActions.tsx`
- `artifacts/tastekin/src/components/SuspendedAccountPanel.tsx`
- `artifacts/tastekin/src/native.ts`
- `docs/admin-moderation-deployment.md`
- `docs/admin-moderation-review.md`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/moderationActionInput.ts`
- `lib/api-zod/src/generated/types/moderationActionInputAction.ts`
- `lib/api-zod/src/generated/types/moderationActionResult.ts`
- `lib/api-zod/src/generated/types/moderationAuditEntry.ts`
- `lib/api-zod/src/generated/types/moderationAuditEntryNewState.ts`
- `lib/api-zod/src/generated/types/moderationAuditEntryPreviousState.ts`
- `lib/api-zod/src/generated/types/moderationInspection.ts`
- `lib/api-zod/src/generated/types/moderationTarget.ts`
- `lib/api-zod/src/generated/types/moderationTargetData.ts`
- `lib/api-zod/src/generated/types/moderationTargetTargetType.ts`
- `lib/db/migrations/0023_moderation_actions.sql`
- `lib/db/migrations/meta/_journal.json`
- `lib/db/src/schema/auth.ts`
- `lib/db/src/schema/creator-workspaces.ts`
- `lib/db/src/schema/engagement.ts`
- `lib/db/src/schema/moderation.ts`
- `scripts/tests/build-moderation-preview.mjs`
- `scripts/tests/moderation-projections.test.mjs`
- `scripts/tests/moderation.test.mjs`
- `scripts/tests/run-moderation-review.sh`