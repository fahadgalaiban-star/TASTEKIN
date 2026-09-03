# TASTEKIN — Session State

This document is a from-scratch audit of the actual codebase (not a running
log of past sessions). It reflects what is really implemented as of this
writing. Treat this as the source of truth over any prior state doc.

## Next session focus

**My Things (KIN) frontend UI shipped — PR-2 (#20), merged and live.** The
closet UI (My Things list/grid + Add Item screens under You, gated by the
`my_things` flag) is merged into `main`, and the published app has been
redeployed and confirmed Live. The PR-1 schema (`closet_items`,
`closet_media_uploads`) is already applied to the production database. See
"My Things (KIN) — PR-2" below for exactly what shipped.

**Not done: `is_admin` for `dark.gcc.kw@gmail.com` could not be
(re-)confirmed in production this session.** The Replit agent's connection
to the production database is read-only, so it cannot run
`admin:grant --prod`. The Replit SQL editor can write to production
directly, but doing so from the mobile UI proved impractical. This blocks
enabling the `my_things` flag (flag toggles require `is_admin`). Note this
sits alongside the "Confirmed live in production" / "Re-confirmed, fully
resolved" notes under Admin authorization below, which recorded this as
already done in an earlier session — treat that as unconfirmed until it is
actually re-checked; this session could not verify either way.

**Next session topic — do this on a desktop, not mobile:**
1. Set `is_admin = true` for `dark.gcc.kw@gmail.com` in production (Replit
   SQL editor, or `admin:grant --prod --email dark.gcc.kw@gmail.com --yes`
   once a writable production `DATABASE_URL`/`PROD_DB_URL` is available
   from that machine).
2. Enable the `my_things` feature flag from the Admin → Feature Flags
   screen.
3. Test real photo upload end-to-end from an iPhone — both the camera and
   the Photos library — including at least one real HEIC file. This path
   has only ever been exercised with mocked/synthetic image bytes in
   Playwright; no real device has tested it yet.

**Database connection ambiguity resolved:** an earlier session raised a
question over whether the app was actually connected to Neon production or
Replit's internal "helium" Postgres, since `DATABASE_URL` is set separately
in Workspace Secrets and in Deployment Secrets (see the Replit-specific
gotcha at the bottom of this doc — Deployments don't inherit Workspace
secrets). This is now confirmed resolved: the published app
(`cheerful-easygoing-bytes.replit.app`) is connected to Neon production,
host `ep-aged-rice-arsrepg5.c-4.us-west-2.aws.neon.tech`. Verified by testing
real account signup/login on the published app and confirming accounts
persist. No production data was read or modified to confirm this — it was
confirmed via app-level behavior, not a direct database query.

The Settings page is fully functional and server-backed (merged via PR #5):
language and notification preferences persist to `users` (additive columns
`language`, `notify_push`, `notify_email`), are scoped per-account, and
every value shown (name, email, verification, admin access, subscription,
support contact) comes from `GET /api/me` — nothing is hardcoded or
localStorage-authoritative for a signed-in user. See "Settings screen —
exact sections" below for the current, accurate description.

**Preview-deployment health/500 investigation (merged via PR #6):** the Replit
deployment-preview healthcheck was failing (`/api` → 500, `/api/healthz` →
404) and "Continue with Replit" ended on a blank Internal Server Error.
Root cause, reproduced locally: `authMiddleware` (runs on every request)
called `getSession(sid)` with no error handling — any database failure
while resolving a session cookie (an unreachable/misconfigured
`DATABASE_URL`, exactly the kind of thing a preview deployment's own,
separately-configured secrets can get wrong per the gotcha documented
below) threw an unhandled exception, and Express's default handler turned
that into a raw "Internal Server Error" for **any** route, for any request
carrying a session cookie — including the OIDC callback and, if a probe or
browser ever carried a stale cookie, the healthcheck path itself. Fixed by:
wrapping that lookup in try/catch (fails closed to signed-out, logs the
real error, never crashes the pipeline), adding a real unauthenticated
`GET /api/healthz` (dependency-free — never touches the database) for the
platform's liveness probe, giving unmatched `/api/*` paths a clean 404 JSON
instead of silently falling through to the SPA shell (a regex bug meant
bare `/api` matched the SPA catch-all instead of the API 404), adding a
last-resort JSON error handler (never leaks secrets/stack traces), setting
`app.set("trust proxy", 1)` so the OIDC `redirect_uri` is built from
Express's trust-proxy-aware `req.protocol`/`req.get("host")` instead of
raw unauthenticated header reads, and making `/api/login` and
`/api/callback` degrade to an `authError` redirect instead of crashing or
looping when the OIDC provider is unreachable or rejects the request.
Also documented (not fixable in-app): Replit's OIDC (`replit.com/oidc`)
validates `redirect_uri` against callback URLs registered for the app's
`client_id`, with no dynamic/wildcard allowance — an ephemeral preview
domain is very unlikely to be pre-registered, so "Continue with Replit" on
a preview URL may be a genuine platform limitation rather than a bug in
this app; `/api/callback` now surfaces that rejection in logs instead of
crashing, so the next real deployment attempt confirms it unambiguously.
See `scripts/src/verify-deployment-health.ts` for regression coverage.
Production's database and authentication were not touched.

**New-user onboarding (branch `claude/onboarding-flow`, not merged):**
implemented item 1 of "Next priorities" below. A genuinely new user is
routed to a 4-step wizard right after their first successful sign-in
(display name + unique username → optional photo → optional city → taste
categories/interests); each step saves to the server immediately via the
*existing* `PUT /creator-profile`, `PUT /taste-preferences`, and media-
upload endpoints (no new profile/media storage was built), and a new
`POST /api/onboarding/advance` moves the user's `users.onboarding_step`
forward by exactly one step, re-checking that step's precondition server-
side every time (never trusting the client). Closing the app or signing
out mid-way resumes at the last-saved step, driven entirely by
`users.onboarding_step`/`onboarding_completed_at` (two additive, nullable/
defaulted columns) — never localStorage. `GET /api/me` gained
`needsOnboarding`/`onboardingStep` fields following the same pattern as
`isAdmin`/`language`/etc.

Gating (`artifacts/api-server/src/lib/onboarding.ts`,
`resolveOnboardingStatus`): an account is exempt from onboarding the
instant `onboarding_completed_at` is set, or it is Admin, or it is
`isVerified`, or its creator workspace already has real published content
(edits/collections — something onboarding itself can never produce, so
this is unambiguous evidence of a pre-existing creator). Two signals were
deliberately **not** used for this auto-exemption after they proved to
directly conflict with legitimate onboarding progress in testing:
`creator_workspaces.revision` (onboarding's own basics-step save bumps
this) and saved `user_taste_preferences` (onboarding's own taste step
writes these) — using either would retroactively "complete" onboarding out
from under a user still in the middle of it. The remaining gap — an
existing pre-feature account that saved a profile once but has no
edits/admin/verified flag — is closed by the new, one-time, operator-run,
dry-run-by-default `pnpm --filter scripts run backfill:onboarding -- --yes`
(mirrors the `admin:grant` script's safety pattern; only ever touches
`onboarding_step`/`onboarding_completed_at`). **Must be run once against
production, right after the schema push and before real traffic resumes,
to fully close that gap** — it was not run this session (no production
migration was performed).

Username uniqueness is enforced by a new additive functional unique index,
`creator_workspaces_username_unique` on `lower(profile->>'username')` —
the pre-existing check-then-write in `PUT /creator-profile` was racy
(advisory-locked only per-workspace, not per-username); a violation of the
new DB constraint is now caught and translated into the same `409 "That
username is already in use"` response instead of a raw 500.
`ensureCreatorAccount`'s own auto-username-generation (unrelated pre-
existing code, runs for every signed-in user) gained a small bounded retry
for the same reason, since the new index makes a same-slug race across two
different brand-new signups throw where it previously would have silently
gone unnoticed.

Deliberately out of scope, per the requirements: no AI/recommendation
claim anywhere — the taste step's initial ordering is just the categories/
tags the user picked, saved via the pre-existing `/taste-preferences`
endpoint; onboarding never sets `isAdmin`, `isVerified`, grants the Taste
Seal, or enables subscriber-only content. See
`scripts/src/verify-onboarding.ts` (20 checks) for regression coverage and
`artifacts/tastekin/e2e/onboarding.spec.ts` for the bilingual/RTL and
resume-on-reload UI coverage.

## Next priorities

1. ~~Complete onboarding~~ — merged (PR #7)
2. ~~Google Sign-In~~ — merged (PR #8); the gate requires both
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to be configured, not just
   one, and defaults to email/password-only when either is missing
3. ~~Report, Block, Mute, and content moderation~~ — merged (PRs #9, #10, #11)
4. ~~Feature flags + privacy-safe product analytics~~ — merged (PR #18);
   see `artifacts/api-server/src/lib/feature-flags.ts` for the registry
5. ~~KIN — My Things, PR-1 (backend/API/storage) and PR-2 (frontend UI)~~ —
   merged (PR #19, PR #20) and live in production. Still open before the
   next KIN phase: set `is_admin` for `dark.gcc.kw@gmail.com` in
   production, enable the `my_things` flag from the Admin screen, and
   verify real iPhone camera/Photos-library upload (including a real HEIC
   file) on an actual device — see "Next session focus" above.
6. Real video support
7. Stripe and subscriptions
8. Real Taste Match algorithm

**KIN roadmap, in order:** My Things backend foundation (PR-1, merged) →
Photo-first UI for My Things (PR-2, merged) → admin enablement + real-
device verification (next session, see above) → Match This (separately
approved). Image Analysis (auto-detecting item attributes from photos) is
a later, independent feature and is not part of PR-1 or PR-2. **Decision
gate:** Match This (its matching tables and numeric compatibility rules)
must not be implemented until it is separately reviewed and approved —
neither PR-1 nor PR-2 touches Match This, `match_this`, or any matching
logic.
9. Policies, security, and launch testing

## Stack

- pnpm workspace monorepo, Node.js 24, TypeScript 5.9
- `artifacts/tastekin` — React + Vite consumer/creator web app (single-file
  `App.tsx` state-machine app, no router — `screen` state + a `go()`
  navigation helper)
- `artifacts/api-server` — Express 5 API, bundled with esbuild
- `lib/db` — PostgreSQL + Drizzle ORM
- `lib/api-zod` — hand-maintained Zod request/response schemas (the
  `generated/` folder name is misleading — nothing regenerates it)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- `.replit`: `nodejs-24`, `python-base-3.13`, `postgresql-16` modules;
  deployment target is Autoscale, running `node artifacts/api-server/dist/index.mjs`

## Navigation map (`Screen` union in App.tsx)

Bottom nav (5 tabs): **Home, Explore, Add, Saved, You**

All screens: `home, explore, add, saved, you, profile, profileEdit,
verificationApply, collections, collection, about, edit, subscribe,
composer, creatorPreview, collectionManager, tune-taste, inbox,
conversation, insights, adminVerification, settings, auth`

There is **no onboarding/welcome gate**. The app boots straight to `home`
(or `auth` if the URL carries a password-reset token). "Tune your taste"
is an always-accessible preference screen, not a first-run flow.

## Auth

Three coexisting sign-in methods, all producing the same session:
1. **Replit OIDC** — the founder's original sign-in path.
2. **Email + password** — signup/login/forgot-password/reset-password,
   `bcrypt`-hashed, `password_reset_tokens` table.
3. **Google OAuth** — hand-rolled OIDC flow (no library), silently
   redirects with an error if `GOOGLE_CLIENT_ID` isn't configured rather
   than crashing.

Because `users.id` is derived differently per provider (Replit OIDC's own
`sub`, `google:<sub>` for Google, a random UUID for email/password), the
same person can end up with more than one `users` row if they've ever
signed in more than one way — there's no cross-provider identity merge
beyond Google refusing to create a second row for an email a password
account already owns.

`users` table: `authProvider`, `passwordHash`, `googleId`, `isVerified`,
`isAdmin`, `role`. Sessions are DB-backed (`sessions` table), not signed
cookies.

### Admin authorization

Admin status is `users.isAdmin`, a real boolean column, and Postgres is the
**sole** authority for it. `isCurrentUserAdmin(user)`
(`artifacts/api-server/src/lib/creator-account.ts`) does nothing but
`SELECT is_admin FROM users WHERE id = $1` for the specific authenticated
user id — no email comparison, no env var, no session/provider state, ever,
at request time. `GET /api/me` and both Admin routes
(`GET /admin/creators`, `PUT /admin/creators/:id/verification`) all call
this and only this. The frontend's Settings screen shows the Admin section
and Verification Review purely off `session.isAdmin` from `/me`'s
response — no localStorage, query params, or hardcoded emails on the
client. Switching accounts or auth providers always resolves to that
provider's own row and its own flag; nothing carries over.

`FOUNDER_AUTH_USER_ID` / `FOUNDER_EMAIL` / `ADMIN_AUTH_USER_IDS` are **not
read by any request handler**. They exist only as optional input to two
explicit, human-run scripts in `scripts/src/`:

- `pnpm --filter scripts run admin:grant -- --user-id <id> --yes` — sets
  `is_admin = true` for exactly one account, resolved by immutable id
  (preferred), `--email <email>` (explicit fallback), or `--from-env`
  (reads whichever of `FOUNDER_AUTH_USER_ID`/`FOUNDER_EMAIL` is configured
  in that invocation's environment — a one-time bootstrap a human
  deliberately runs once, never something the app does on its own). Dry-run
  by default; nothing is written unless `--yes` is passed.
- `pnpm --filter scripts run admin:revoke -- --user-id <id> --yes` — sets
  `is_admin = false`. Nothing else in the app will ever set it back to
  true; the only way an account becomes an admin again is another explicit
  `admin:grant` run.
- Both read `DATABASE_URL` by default. Pass `--prod` to use `PROD_DB_URL`
  instead (must already be set in that shell) — never a silent fallback;
  the resolved host + database name (never credentials) is printed before
  anything else happens, e.g. `Connecting via PROD_DB_URL → ep-xxx.neon.tech/neondb (PRODUCTION)`.
  This is implemented via `scripts/src/lib/resolve-database.ts`, which
  builds its own Postgres connection from whichever URL was resolved
  rather than importing `@workspace/db`'s pre-built one — that module
  constructs its pool from `DATABASE_URL` the instant it's imported,
  before a script's own `--prod` handling could ever run.

`pnpm --filter scripts run verify:admin-auth` (`DATABASE_URL` must point at
a disposable/test database — it creates real rows) is an automated
regression suite that spawns the real compiled server and drives it over
real HTTP to confirm: admin access works when `is_admin=true`; the same
user gets 403 immediately after `is_admin=false`; a `FOUNDER_EMAIL` that
matches an unflagged account's email never grants it access; an existing
`is_admin=true` row survives that env var being changed or removed
entirely; and switching sessions in the same cookie jar never carries over
the previous account's admin status.

**Confirmed live in production** (PR #4, merged): the production Neon
database's `users` table has the `is_admin` column (added via
`pnpm --filter @workspace/db run push`, additive, no data loss), and
`dark.gcc.kw@gmail.com` — the designated TASTEKIN admin account, separate
from the founder's own Replit login — has `is_admin = true` there via
`admin:grant --prod --email dark.gcc.kw@gmail.com --yes`, confirmed working
in the live app.

**Re-confirmed, fully resolved:** re-verified via live app testing on the
published deployment — signed in as `dark.gcc.kw@gmail.com`, the Settings
Admin section is visible, including both Verification Review and the
Report Queue. No further action needed on this item; `users.is_admin`
remains the sole authority, no env var runtime check was added or is
needed.

**Status unconfirmed as of the My Things PR-2 session:** a later session
needed to confirm/re-set `is_admin` for `dark.gcc.kw@gmail.com` in
production (to enable the `my_things` flag) and could not — the Replit
agent's connection to the production database is read-only, so it cannot
run `admin:grant --prod`. The Replit SQL editor can write to production
directly, but doing so from the mobile UI proved impractical, so this was
left undone. This does not necessarily mean the flag reverted from the
"Re-confirmed, fully resolved" state above — it means that state was not
re-checked. Next session: verify (and if needed, re-set) it from a
desktop, per "Next session focus" above.

## Creator workspace (Edits)

One `creator_workspaces` row per creator: `profile` (JSONB), `edits`
(JSONB array), `collections` (JSONB array), `revision` (optimistic
concurrency counter shared across the whole row, including profile saves).

- Composer supports draft/publish/archive, per-Edit `access: 'public' |
  'locked'`, category-specific place fields (Restaurants/Places/Travel),
  crop tool generating three renditions per photo (source, display crop,
  and a genuinely pixel-blurred preview rendition for locked Edits).
- Locked Edits show the real image only to the owner and to verified
  subscribers; everyone else gets the blurred `previewImage` served via
  `/api/public-media/:username/:editId/preview`.
- Saves are serialized through a client-side queue (`persistQueueRef`) with
  a ref-mirrored revision counter, so rapid successive saves (e.g. several
  uploads in a row) can't race the server's optimistic-concurrency check or
  silently overwrite each other — this replaced a plain "capture state at
  click time" pattern that produced false "workspace changed on another
  device" conflicts.

## Collections

`CreatorCollection`: `id, title, titleAr, description, descriptionAr,
access, coverEditId, coverImage?, coverImageObjectPath?, editIds: string[],
uploads?: CollectionUpload[], itemOrder?: string[]`.

- A Collection can hold Edit-backed items (`editIds`) **and** uploaded
  items with no backing Edit (`uploads`) that never appear as standalone
  Edits or in the creator's feed — added via the "Add content" chooser's
  "Upload new photo" path (multi-select, native file input) alongside the
  existing "Add from profile" picker. `uploads[].type` is `'photo'` today,
  deliberately typed so a `'video'` variant can be added later without
  another schema change.
- `itemOrder` is the single combined display/drag-reorder order across both
  kinds of items; drag-and-drop reordering, removal, and the
  add-from-profile picker all operate on this unified list.
- Custom cover image upload/clear, with a fallback chain: `coverImage` →
  `coverEditId`'s Edit → first item → generic placeholder.
- "Featured collections" on the public profile (up to 3, admin-orderable)
  — cover card, title below image, item count, public/lock badge,
  horizontal scroll strip, "View all" link into the full Collections list.
- Collection ownership for display/edit purposes is derived from whether
  the Collection is actually in the signed-in creator's own
  `creatorCollections` array, not from which profile page happens to be
  selected — this fixed a bug where browsing another creator and then
  managing your own Collection could render it with non-owner (blurred)
  treatment.
- Server-side, uploaded photo/cover object paths go through the same
  ownership-verification ledger (`creator_media_uploads`) as Edit images
  before a save can reference them, and the private-media serving route's
  authorization check (`referencedPaths` in `storage.ts`) now also covers
  collection cover/upload paths — it originally only knew about Edit
  images, which caused uploaded Collection photos to 404 (broken-image
  icon) even for the owner.

## Social / engagement

- Follow/unfollow (`creator_follows`, intentionally never exposes
  follower/following counts as social proof).
- Likes, saves, comments per Edit (`edit_likes`, `edit_saves`,
  `edit_comments`), with an engagement summary endpoint.
- Profile view tracking (`creator_view_events`).
- **Insights** (owner-only): real profile views/likes/saves/comments,
  aggregated overall and per-Edit — not simulated data.
- **Messaging**: 1:1 conversations (`conversations`,
  `conversation_messages`), gated to verified creators only
  (`onMessage` is only wired up when `profile.verified` is true).
- Home feed: 3 tabs (For You / Following / Subscribed). Header was
  redesigned to be compact and tab-dynamic — a small title + one-line
  description that change per tab, replacing a large static "Taste-led
  discovery" hero block, tags row, and tagline that used to push the first
  post far down the screen.
- Explore: search (debounced, matches title/caption/place/location) +
  category filter, plus creator search results.

## Verification ("Taste Seal")

- `verification_applications` table: `statement, evidenceLinks (jsonb),
  status ('pending'|'approved'|'rejected'|'needs_improvement'), reviewNote,
  reviewedByUserId, reviewedAt, reEligibleAt`.
- Applicant must have ≥1 published Edit to apply (blocked with a message +
  "Create an Edit" link otherwise).
- Form fields: Statement (min 40 chars, max 1500) + optional Evidence
  links, one per line. **No follower count or social-metric field exists
  anywhere in the app** — confirmed by full-repo search; this was a
  deliberate decision, not an oversight.
- Admin (`AdminVerificationScreen`) has three outcomes: Approve / Reject /
  Needs Improvement. Reject and Needs Improvement both require a written
  note. Needs Improvement sets a 60-day `reEligibleAt` cooldown before the
  applicant can resubmit. Admin can also "Bypass Edit requirement &
  Approve" for applicants with 0 published Edits (e.g. invited/outreach
  creators), gated server-side by the same `publishedEditsCount` shown in
  the admin queue.

## Settings screen — exact sections (in render order)

Same visual design and section order as before — the rebuild made every
section server-backed without redesigning the page. `GET /api/me` is the
single source read by `TasteSessionContext`; `PUT /api/settings`
(authenticated, per-user, additive columns on `users`) is the only write
path — localStorage is never authoritative once a user is signed in.

1. **Account** — Name/email always the currently authenticated user
   (`session.user.email`), never a hardcoded value. Password stays
   "managed by your sign-in provider" — no in-app password management.
2. **Language** — English / العربية toggle. Selecting a language calls
   `PUT /api/settings` immediately; the choice is restored from the
   database on sign-in, refresh, and on another device. Guests (no
   account) keep the old localStorage/URL-based behavior. `document.dir`/
   `document.lang` are driven globally by this value (LTR for English,
   RTL for Arabic) app-wide.
3. **Subscription** — `subscribed` comes verbatim from `GET /api/me`
   (`subscribed: false`, honestly, since no Stripe/entitlements table
   exists yet) — never simulated as true.
4. **Notifications** — Push / Email toggles read from and persisted to
   `users.notify_push` / `users.notify_email` via `PUT /api/settings`,
   scoped to `req.user.id`. An explicit note tells the user these are
   saved preferences only — no push/email delivery infrastructure is
   connected, so nothing pretends to actually send anything yet.
5. **Creator info** *(owner only)* — verification status, "Apply for the
   Taste Seal" button, note about per-Edit access control (unchanged;
   `isVerified` already came from the server).
6. **Admin** *(isAdmin only)* — "Verification review" button (unchanged,
   still gated by the server-computed `isAdmin` from `GET /api/me`).
7. **Help & Support** — renders a `mailto:` link only when the operator
   has set the `SUPPORT_EMAIL` env var (returned as `supportEmail` by
   `GET /api/me`); otherwise shows "Support contact is not configured
   yet." No hardcoded fallback address.
8. **Sign out** button at the bottom — unchanged, calls `/api/logout`.

There are two "Sign out" buttons in the app, but on two different screens,
not duplicated within one section: one on the "You" tab
(`data-testid="you-sign-out"`) and one inside Settings
(`data-testid="settings-sign-out"`). Both call the same `/api/logout`.
Functionally harmless, but a real UX redundancy if you want to simplify.

Regression coverage: `scripts/src/verify-settings.ts`
(`pnpm --filter scripts run verify:settings`) covers persistence,
per-user isolation, unauthorized/invalid requests, sign-out/sign-in
DB-persistence, partial updates, and an admin-authorization non-regression
check. `artifacts/tastekin/e2e/settings-direction.spec.ts` covers the
LTR/RTL direction toggle and its persistence across a reload.

## My Things (KIN) — PR-1

Private, per-user closet: create/list/read/update/delete a closet item
with a private photo. Backend/API and storage foundation only in PR-1 —
no user-facing UI, no Match This, no image analysis/AI, no brand
auto-detection, no Taste Profile changes. Gated behind the `my_things`
feature flag, `defaultEnabled: false` (see `feature-flags.ts`'s registry;
admin toggle via the existing generic `PUT /admin/feature-flags/my_things`
— `users.is_admin` remains the sole authority, no env var involved).

Two new tables (`lib/db/src/schema/closet.ts`):
- `closet_items` — one row per item: `owner_user_id` (FK → `users.id`,
  cascade), `image_object_key` (private storage key only, unique),
  `item_type`/`primary_color`/`style`/`occasion`/`season` (plain `text`,
  app-level allowlists — no DB enum/check, matching this repo's existing
  convention), `brand` (trimmed, ≤100 chars, `null` when absent — never
  the literal string `"unknown"`), `confirmation_status`
  (`confirmed`|`pending_review`).
- `closet_media_uploads` — the durable upload/deletion lifecycle ledger,
  separate from `creator_media_uploads`. `owner_user_id` and
  `closet_item_id` are both nullable with `onDelete: "set null"` (not
  cascade) so this ledger survives both account deletion and item
  deletion — it is the only durable record of a private object key once
  the row that referenced it is gone. States: `reserved`, `uploading`,
  `rejected`, `upload_failed`, `uploaded`, `attached`, `deletion_pending`,
  `cleanup_in_progress`, `delete_failed`, `deleted`. Every upload attempt
  (regardless of outcome) is one row here — this is what makes the
  30-per-hour upload rate limit durable and race-safe (a Postgres advisory
  lock, the same idiom as the feature-flags toggle route) and immune to
  being reset by deleting items afterward.

Upload is two steps: `POST /api/closet-items/media` (raw image bytes;
`multipart` is not used — a route-scoped `express.raw` limit instead)
validates via real decode (`sharp`, format/dimension/corruption checks —
never the client's declared Content-Type or filename), strips EXIF/GPS by
re-encoding to WebP (no `.withMetadata()` call), uploads the sanitized
bytes itself to private object storage, and returns an opaque `uploadId`
— never the storage key. `POST /api/closet-items` then atomically verifies
(in one transaction, `SELECT ... FOR UPDATE`, ownership and id in the same
`WHERE`) that the upload belongs to the caller, is unconsumed, and creates
the item.

Storage keys are `/objects/closet/<uuid>` — a distinct prefix and
independent validation regex from the pre-existing `/objects/uploads/<uuid>`
creator-media path (new sibling functions in `private-media-storage.ts`;
the original functions are untouched). Deleting an item hides it
immediately (a hard delete, no soft-delete column) and attempts physical
storage deletion synchronously in the same request; if that fails, the
ledger durably tracks `delete_failed` for later manual reconciliation
(`pnpm --filter scripts run reconcile:closet-media`, dry-run by default,
no automatic background retries — there is no scheduler in this repo).

New dependency: `sharp@0.35.4` (added to `artifacts/api-server`) —
already listed by name in `build.mjs`'s esbuild `external` array before
this PR, so no bundler change was needed. See
`scripts/src/verify-my-things.ts` (31 checks, grew from 29 after a
pre-merge audit closed two gaps) for regression coverage.

## My Things (KIN) — PR-2

Frontend UI on top of PR-1's backend (merged as PR #20). Frontend-only —
no backend, schema, or dependency changes.

- New `Screen` union entries `myThings`/`myThingsAdd`, added to the
  existing `go()` state machine — no router was added or activated, no
  literal URL route exists, no bottom-nav tab was added. A "My Things"
  entry appears under **You** only when
  `session.featureFlags.my_things === true`.
- Both new screens carry a `useEffect` guard that calls `go('you')` if the
  flag turns off or the session becomes unauthenticated while either is
  active. This is a UI convenience only — the backend's existing 401/403
  is the real enforcement layer.
- **Add Item** has no separate review step: local photo preview, required
  chip-selects (Item type / Primary color / Style, reusing the app's
  existing button-chip pattern from Tune Your Taste), a collapsible
  "Optional details" section (Occasion / Season / Brand), and one
  "Confirm & Add" button. Because `POST /closet-items` always creates
  `pending_review` and only `PUT` can confirm, the button drives
  upload → `POST` → `PUT` in sequence, and retries are idempotent: a
  failed `POST` reuses the already-returned `uploadId` rather than
  re-uploading; a failed `PUT` reuses the already-created item id and
  retries only the `PUT`. The button disables itself for the whole
  sequence to prevent double submission.
- Images render only via `GET /api/closet-items/:id/image`; the frontend
  never reads, stores, or logs `imageObjectKey`.
- Client-side upload validation: JPEG/PNG/WebP only, 10MB max, and
  best-effort HEIC/HEIF rejection by both MIME type and filename
  extension (no HEIC conversion, no new dependency added).
- New `artifacts/tastekin/src/closet-taxonomy.ts` mirrors the backend's
  exact tokens (`itemType`, `primaryColor`, `style`, `occasion`, `season`)
  with English display labels kept structurally separate from the stored
  values — no Arabic labels yet on these two screens.
- No new CSS — reuses `approved-grid`/`approved-grid-card`,
  `image-uploader`/`no-photo-uploader`, `profile-interests` chip buttons,
  `admin-confirm-actions`/`admin-detail-actions`, and `nested-details`.
- See `artifacts/tastekin/e2e/my-things.spec.ts` (12 tests) for regression
  coverage: flag gating, the guard, empty/populated grid, the image route
  with no object-key leakage (including a simulated backend leak), file
  validation, required-field gating, the full upload/create/confirm
  sequence and both its retry paths, duplicate-submit prevention, and
  200/202 delete handling.

**Not verified — manual device gate, still open (see "Next session
focus" above):** real iPhone camera and Photos-library upload, and a real
HEIC file on an actual device. Safari's known empty-`file.type` quirk for
HEIC is handled in code but has only been exercised with synthetic bytes
in Playwright, never a real device. `my_things` remains disabled in
production pending this.

## Subscription / billing — UI only, not wired up

The Subscribe screen and Settings' Subscription section both explicitly
say "Secure checkout will open here once Stripe entitlements are
connected. No payment or access is being simulated." There is no Stripe
SDK or billing logic anywhere in the repo — `subscribed` is now a real,
server-computed field from `GET /api/me` (always `false` today, honestly,
since no entitlements table exists), not a client-side placeholder.

## Data model (Postgres tables)

`sessions, users, password_reset_tokens, creator_workspaces,
creator_media_uploads, creator_featured_collections, edit_likes,
edit_saves, edit_comments, conversations, conversation_messages,
creator_view_events, creator_follows, verification_applications,
user_taste_preferences, user_blocks, user_mutes, reports,
moderation_audit_log, feature_flags, feature_flag_audit_log,
analytics_events, closet_items, closet_media_uploads`

`users` gained three additive columns for the Settings rebuild:
`language` (text, default `'en'`), `notify_push` (boolean, default
`true`), `notify_email` (boolean, default `true`). Applied via
`pnpm --filter @workspace/db run push` — no data reset/reseed, no
production database touched.

`users` gained two more additive columns for onboarding: `onboarding_step`
(text, default `'basics'`) and `onboarding_completed_at` (timestamptz,
nullable — the durable "has finished onboarding" value). `creator_workspaces`
gained one additive index (not a column): `creator_workspaces_username_unique`,
a case-insensitive unique index on `lower(profile->>'username')` — this is
what makes username uniqueness actually database-enforced rather than
just a racy pre-check. Both applied the same way (`drizzle-kit push`), not
run against production this session; run
`pnpm --filter scripts run backfill:onboarding -- --prod --yes` once after
pushing, before real traffic resumes, so pre-existing accounts with no
other exemption signal aren't shown onboarding once (see the onboarding
section above).

`creator_workspaces.edits` and `.collections` are untyped JSONB arrays —
adding fields to their shapes (as Collections' `uploads`/`itemOrder` did)
needs no migration, only Zod schema updates in `lib/api-zod`.

## API routes (by file)

- `auth.ts` — Replit OIDC (`/login`, `/callback`, `/logout`), `/me`,
  `/auth/user`, `/auth/signup`, `/auth/login`, `/auth/forgot-password`,
  `/auth/reset-password`, `/auth/google`, `/auth/google/callback`
- `creator-workspace.ts` — creator/public profile and workspace CRUD,
  featured collections, `/public-feed`
- `discovery.ts` — `/feed`, `/taste-catalog`, `/taste-preferences`,
  `/creators`, `/creators/:username`, `/taste-match/:username`,
  `/explore`, `/edits/:id`, `/relationships`
- `engagement.ts` — likes/saves/comments, `/me/saved-edits`, profile
  views, conversations/messages, `/creator-insights`
- `storage.ts` — signed upload URLs, cleanup, private object serving,
  public media/preview redirects
- `verification.ts` — applicant + admin verification endpoints
- `health.ts` — `/health`, `/healthz` (unauthenticated liveness probe, no DB
  dependency — for the deployment platform), `/version`, `/ready`
- `settings.ts` — `PUT /settings` (authenticated, per-user language/
  notifyPush/notifyEmail updates)
- `onboarding.ts` — `POST /onboarding/advance` (authenticated; advances the
  caller's own `onboarding_step` by one, server-checked precondition per
  step, no body)
- `blocks.ts`, `mutes.ts`, `moderation.ts` — user blocking/muting and the
  report/admin-review queue
- `feature-flags.ts` — `GET/PUT /admin/feature-flags[/:key]`,
  `GET /admin/feature-flags/:key/audit-log` (admin-only)
- `analytics.ts` — `POST /analytics/events` (auth-optional),
  `GET /admin/analytics/summary` (admin-only)
- `closet-items.ts` — My Things (KIN) PR-1: `POST /closet-items/media`,
  `POST /closet-items`, `GET /closet-items`, `GET/PUT/DELETE
  /closet-items/:id`, `GET /closet-items/:id/image` — all gated by the
  `my_things` flag and scoped to the authenticated owner in every query's
  `WHERE` clause

## Required environment variables

Only these two crash the process at **boot** (before the server can bind a
port) if missing — both checked at module-import time, not inside a
request handler:
- `DATABASE_URL` — thrown in `lib/db/src/index.ts`
- `PORT` — thrown in `artifacts/api-server/src/index.ts` (Replit Autoscale
  injects this automatically)

Everything else degrades a specific feature gracefully rather than
crashing boot: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (Google sign-in),
`PRIVATE_OBJECT_DIR` (object storage — throws only when an upload/serve
route is actually hit), `FOUNDER_EMAIL`/`FOUNDER_AUTH_USER_ID`/
`ADMIN_AUTH_USER_IDS` (read only by the explicit `admin:grant` script's
`--from-env` mode — see "Admin authorization" above; no request handler
reads them, and they never grant or restore `users.isAdmin` on their own),
`ALLOWED_ORIGINS`, `LOG_LEVEL` (all have safe defaults), `SUPPORT_EMAIL`
(Settings' "Contact support" link — absent by default, no hardcoded
fallback address; the section shows "not configured yet" until an
operator sets it).

**Replit-specific gotcha confirmed this session:** Autoscale Deployments do
not inherit the Workspace's own secrets — `DATABASE_URL` (provisioned
automatically for the dev workspace via the `postgresql-16` module) must be
explicitly added to the deployment's own Secrets panel, separately from
Workspace Secrets.

**Replit-agent gotcha confirmed in the My Things PR-2 session:** the
Replit agent's own connection to the production database is read-only —
it cannot run `admin:grant --prod`, `admin:revoke --prod`, or any other
write against production from inside an agent session. Production writes
(like granting `is_admin`) need either the Replit SQL editor directly, or
running the script from a machine with a writable `PROD_DB_URL` — and the
SQL editor is impractical from the mobile app, so this effectively
requires a desktop.
