# Admin moderation — review only

Migration: `lib/db/migrations/0023_moderation_actions.sql`.
The application requires this schema. Do not restart it against an unmigrated
existing development/shared database to preview the new feature.

Later safe order (each operational step requires separate approval):

1. Review the additive migration, journal and matching Drizzle schema.
2. Prepare and verify database backup/rollback procedures. Preserve the old
   application release. Application rollback does not require dropping the
   additive columns/table; retain moderation/audit/session history.
   A pre-moderation release does not enforce these new overlays/suspensions.
   Preserve maintenance/access restrictions during rollback; retaining schema
   alone does not preserve moderation enforcement.
3. Apply the migration in a controlled maintenance window, with lock/time budgets
   and a verified destination. No startup migrations or automatic schema pushes.
4. Deploy the application only after the migration succeeds.
5. Smoke-test admin/non-admin authorization, all six reversible actions,
   public visibility, web/native session expiration and protected-account rules.

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

## Read-path limitations requiring a separate review

- Replit's static artifact handler can serve packaged `/tastekin-media/*` files
  directly, before the API/Express middleware. The new direct-asset guard covers
  single-process Express serving only; it cannot revoke the platform's direct
  static URLs. API public-media endpoints and consumer JSON are moderated.
  Moving content images out of the publicly served artifact directory and behind
  the gated API requires a separately reviewed media-routing/package change.
- Previously issued third-party playback/media links, cached/offline responses
  and copied KIN text without a retained source identity cannot be recalled.
  New KIN references with retained identifiers are filtered/rejected.

Do not treat this draft as approval to release moderation with complete
direct-static/third-party asset revocation. No provider access or deployment
configuration change was made to work around that limitation.

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