# TASTEKIN Phase 1 — Multi-creator foundation

## Product contract

- Every authenticated member receives a private, isolated creator workspace.
- A member may publish public Edits immediately.
- Public follower and following totals are intentionally never exposed.
- The public username may change; the internal `creator_id` never changes.
- Only a TASTEKIN administrator can approve the Taste Seal.
- Only verified creators may publish subscriber-only Edits or collections.
- A visitor may start a new conversation only with a verified creator.
- Paid subscription entitlements are **not** simulated in Phase 1. Stripe belongs to Phase 3.

## What changed

1. Account creation now provisions one creator workspace per authenticated user.
2. Existing founder data is claimed only by the explicitly configured founder account.
3. Profile, Edits, collections, featured collections, saves, follows, taste preferences,
   conversations, comments, likes, views, and uploads use PostgreSQL/API state.
4. Upload records carry both `creator_id` and `owner_user_id`; private object access and
   cleanup are checked against both values.
5. Public creator/profile/media routes resolve by username and never expose source media.
6. Explore and Home can aggregate published work from every creator.
7. Verification applications are stored for admin review. Approval cannot be performed
   from Edit Profile or the public application endpoint.

## Required deployment secrets

- `DATABASE_URL` — production PostgreSQL connection string.
- `REPL_ID` — Replit OIDC application identifier used by the existing authentication flow.
- `FOUNDER_AUTH_USER_ID` — preferred immutable Replit OIDC subject for the founder account.
- `FOUNDER_EMAIL` — fallback founder mapping only when the immutable subject is not yet known.
- `ADMIN_AUTH_USER_IDS` — optional comma-separated immutable OIDC subjects for additional admins.
- Existing private object storage variables required by `private-media-storage.ts`.

Never expose these values through Vite/client environment variables.

## First production migration

From the project root on Replit:

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/db migrate
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/tastekin test:e2e
```

Set `FOUNDER_AUTH_USER_ID` before the founder signs in on the migrated deployment. This
prevents any unrelated account from claiming the seeded Fheed workspace.

## Acceptance checklist

Use two real test accounts (A and B), plus the configured admin.

1. Sign in as A and B; confirm each receives a different immutable creator ID and workspace.
2. A publishes a public Edit; B can see it but cannot edit, archive, delete, or access its source media.
3. B follows and saves A; refresh and sign in again; both states persist without public counts.
4. B changes username; confirm their creator ID and media ownership remain unchanged.
5. An unverified account cannot publish a locked Edit or locked collection and has no Subscribe button.
6. Submit a Taste Seal application; confirm it is pending and cannot self-approve.
7. An admin approves it; confirm the seal, Subscribe button, locked publishing, and inbound DMs become available.
8. A non-admin receives `403` from every `/api/admin/*` endpoint.
9. Repeat image crop, upload, draft, Publish, refresh, profile grid, Home, and public detail checks at 390 px.

## Known boundary before launch

Phase 1 establishes identity, ownership, persistence, and authorization. A public paid launch
must wait for Phase 2 moderation/admin operations and Phase 3 Stripe entitlements/webhooks.
The current subscription screen is presentation only and must not be treated as payment proof.

