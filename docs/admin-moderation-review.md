# Admin moderation draft review

Base: `59c73f43fc4e51861d5f1388ca1808ba7a637d01`.
Branch: `feature/admin-moderation-actions`.
Review only: no merge, deployment, existing-database migration or provider access.

## Verification

- New disposable, local Unix-socket-only PostgreSQL cluster; TCP disabled.
  The destination was verified before migration execution. No configured database
  URL was used. A second new database compared migrated schema with current
  Drizzle exports. The test server was stopped on exit.
- 11 focused tests passed: additive migration, old/new user defaults, legacy
  audit validity, schema/journal/constraint/index parity, authorization and
  protected accounts, reversibility, real HTTP admin inspection, forged owner
  rejection, session expiration/rejection, concurrency and audit-failure rollback,
  consumer projection and original-row preservation.
- 19 existing database-free native/private-image regressions passed.
- Shared-library, API and frontend TypeScript passed.
- Frontend production build passed. Existing large-chunk warning remains.
- Browser test of the actual moderation component with mocked requests passed:
  required reason, cancel/confirm, single sends, all action variants, retry,
  queue refresh, non-admin absence, protected account and Arabic/mobile layout.
  A non-blocking fixture resource 404 was observed.
- `git diff --check` passed.

## Limitations and release order

API feeds, profiles/collections, discovery/search, Circle, comments/engagement,
Saved, retained KIN references and API public-media paths use the server projection.
Admin inspection is separately authorized; private creator editing keeps originals.
Home/Explore no longer repopulate an empty public feed from private originals.

Direct packaged `/tastekin-media/*` assets can bypass the API through the
platform's static handler. Previously issued provider links, offline/cached
copies and KIN text without retained source identities cannot be revoked here.
These are not claimed as safely covered. No provider access or artifact/deployment
configuration change was made to bypass the review boundary.

See `docs/admin-moderation-deployment.md` for:
**migration review → backup/rollback preparation → controlled migration →
application deployment → smoke tests**. Every operational step requires separate
approval. The existing development API was not started against unapplied schema.

## Exact changed files

- `.agents/memory/MEMORY.md`
- `.agents/memory/tastekin-openapi-url-fields.md`
- `.agents/memory/tastekin-static-media-boundaries.md`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/src/lib/active-account.ts`
- `artifacts/api-server/src/lib/auth.ts`
- `artifacts/api-server/src/lib/moderation-policy.ts`
- `artifacts/api-server/src/lib/moderation-repository.ts`
- `artifacts/api-server/src/lib/moderation-visibility.ts`
- `artifacts/api-server/src/lib/native-auth.ts`
- `artifacts/api-server/src/middlewares/moderation-middleware.ts`
- `artifacts/api-server/src/routes/engagement.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/routes/moderation-actions.ts`
- `artifacts/tastekin/src/App.tsx`
- `artifacts/tastekin/src/components/AdminModerationActions.tsx`
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
- `lib/db/src/schema/moderation.ts`
- `scripts/tests/build-moderation-preview.mjs`
- `scripts/tests/moderation.test.mjs`
- `scripts/tests/run-moderation-review.sh`