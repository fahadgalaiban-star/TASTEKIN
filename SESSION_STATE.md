# TASTEKIN — Session State

This document is a from-scratch audit of the actual codebase (not a running
log of past sessions). It reflects what is really implemented as of this
writing. Treat this as the source of truth over any prior state doc.

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

`pnpm --filter scripts run verify:admin-auth` (`DATABASE_URL` must point at
a disposable/test database — it creates real rows) is an automated
regression suite that spawns the real compiled server and drives it over
real HTTP to confirm: admin access works when `is_admin=true`; the same
user gets 403 immediately after `is_admin=false`; a `FOUNDER_EMAIL` that
matches an unflagged account's email never grants it access; an existing
`is_admin=true` row survives that env var being changed or removed
entirely; and switching sessions in the same cookie jar never carries over
the previous account's admin status.

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

1. **Account** — Name, Email, Password (static "managed by your sign-in
   provider" text)
2. **Language** — English / العربية toggle
3. **Subscription** — status + note that billing isn't wired up yet
4. **Notifications** — Push / Email toggles, persisted to `localStorage`
   only (no server-side notification preferences)
5. **Creator info** *(owner only)* — verification status, "Apply for the
   Taste Seal" button, note about per-Edit access control
6. **Admin** *(isAdmin only)* — "Verification review" button
7. **Help & Support** — `mailto:support@tastekin.app` link
8. **Sign out** button at the bottom

There are two "Sign out" buttons in the app, but on two different screens,
not duplicated within one section: one on the "You" tab
(`data-testid="you-sign-out"`) and one inside Settings
(`data-testid="settings-sign-out"`). Both call the same `/api/logout`.
Functionally harmless, but a real UX redundancy if you want to simplify.

## Subscription / billing — UI only, not wired up

The Subscribe screen and Settings' Subscription section both explicitly
say "Secure checkout will open here once Stripe entitlements are
connected. No payment or access is being simulated." There is no Stripe
SDK or billing logic anywhere in the repo — `subscribed` is a client-side
placeholder value, not derived from any real entitlement check.

## Data model (Postgres tables)

`sessions, users, password_reset_tokens, creator_workspaces,
creator_media_uploads, creator_featured_collections, edit_likes,
edit_saves, edit_comments, conversations, conversation_messages,
creator_view_events, creator_follows, verification_applications,
user_taste_preferences`

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
- `health.ts` — `/health`, `/version`, `/ready`

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
`ALLOWED_ORIGINS`, `LOG_LEVEL` (all have safe defaults).

**Replit-specific gotcha confirmed this session:** Autoscale Deployments do
not inherit the Workspace's own secrets — `DATABASE_URL` (provisioned
automatically for the dev workspace via the `postgresql-16` module) must be
explicitly added to the deployment's own Secrets panel, separately from
Workspace Secrets.
