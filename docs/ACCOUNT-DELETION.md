# Account deletion (free v1)

TASTEKIN v1 is completely free (no subscriptions, purchases, locked content
or payment SDKs). Both app stores require that a member can permanently
delete their account from inside the app; Google Play additionally requires a
web page that explains and offers deletion without the app.

## Where it is

| Surface | Path |
| --- | --- |
| In the app / web app | Settings → **Delete account** (bottom of Settings, signed-in only) |
| Public web page (Google Play "data deletion" URL) | `https://<production-host>/delete-account` |
| Privacy Policy | Settings → Legal, and `https://<production-host>/privacy` |
| Terms of Use | Settings → Legal, and `https://<production-host>/terms` |
| API | `POST /api/me/delete-account` with JSON body `{ "confirm": "DELETE" }` (web cookie or native bearer) |

The legal copy (EN + AR) lives in `artifacts/tastekin/src/legal.ts`. Bump
`LEGAL_EFFECTIVE_DATE` there whenever the text changes — the date is shown in
Settings and at the top of both documents.

## The flow

1. **Explain.** What is deleted and what is kept, a link to the Privacy
   Policy, and (signed-out visitors on `/delete-account`) a sign-in button
   that returns to the page afterwards. No support contact is required.
2. **Confirm.** A checkbox acknowledgement *and* typing `DELETE`; the final
   button is disabled until both are present. The client then calls the API
   with `{ "confirm": "DELETE" }` — the server rejects anything else (400).
3. **Done.** The server revokes every session; the client finishes its own
   sign-out (the native shell forgets its Keychain/Keystore token) and shows
   a confirmation.

The API is authenticated by the caller's own credential only, so it can never
name, probe or reveal any other account.

## What the server deletes (one transaction, per-account advisory lock)

Deleted outright: the `users` row; every web cookie session and native
session for the account; the creator workspace (profile, Edits, collections);
likes, saves, saved lists, comments, follows (both directions), Circle
memberships, creator view events for the creator's content; every
conversation the account took part in, with its messages; taste preferences;
verification application; closet items; KIN quota rows, saved
recommendations, trips (FK cascade); blocks and mutes (FK cascade); password
reset tokens (FK cascade); likes/saves/comments/saved-list references *from
other members* to the deleted creator's Edits (those Edits no longer exist).

Anonymized: the account's own views of other creators (viewer id set null,
so other creators keep their aggregate counts); product-analytics events
(user id set null via FK); `feature_flags.updated_by_user_id` set null.

Retained with an opaque id that no longer resolves to anyone: reports the
member filed or that targeted them, moderation audit log, feature-flag audit
log.

## Media outside Postgres

After the transaction commits, the server deletes media best-effort and
records targets and outcomes in the existing ledgers. All referenced creator
photos, including legacy paths without upload rows, are registered before
the workspace is removed. An unreachable provider does not roll back account
deletion:

| Media | Provider | Ledger state on failure | Retried by |
| --- | --- | --- | --- |
| Creator photos (`/objects/uploads/...`) | private object storage | `delete_failed`, or `deleting` after interruption | Account-media runner |
| My Things photos (`/objects/closet/...`) | private object storage | `delete_failed`, `deletion_pending`, or expired cleanup claim (owner already null) | Account-media runner |
| Videos | Bunny Stream | `delete_failed`, `deletion_pending`, or orphan cleanup pending | Account-media runner |

The response reports `mediaCleanup: "completed" | "pending" | "none"`.
It includes previously pending work and ambiguous/in-flight video creation,
not just deletes attempted by this request. The English/Arabic UI distinguishes
deleted account/content records from physical files still pending, and promises
no cleanup deadline. Lost responses are not described as "nothing changed".

### Prepared runner — not scheduled

After building the API artifact with its usual API-only build command:

```
pnpm --filter @workspace/api-server run reconcile:account-media
pnpm --filter @workspace/api-server run reconcile:account-media --yes
```

The first command is read-only dry-run; `--yes` applies bounded batches (up to
50 per media type). It only claims media belonging to deleted accounts, and
protects creator photos whose workspace still exists. Claims expire after
five minutes and use fences so older workers cannot overwrite newer results.
Failures stay durable, with five-minute photo retries and capped exponential
backoff for closet/video retries; deleted-account work is not abandoned after
an arbitrary attempt limit. Provider 404 is success; an inconclusive video
lookup is not. No database transaction spans a provider call.

No timer, startup job, schedule, or deployment was added. Pending files will
remain pending until an operator explicitly runs this command or a separately
approved schedule invokes it. Existing closet/video reconciliation commands
remain available, but this runner covers all three account-deletion media
types, including interrupted confirmed-video deletions.

The focused regression command is:

```
pnpm --filter @workspace/api-server run test:account-media
```

It discards inherited application credentials, creates a Unix-socket-only
PostgreSQL cluster under `/tmp`, exports the schema offline, uses in-memory
provider mocks with all network access rejected, and removes its cluster
and temporary files on exit. It never reads a managed database or rebuilds
the running API.

## Refusals (nothing is changed)

| Case | Response |
| --- | --- |
| Not signed in | 401 |
| Body is not exactly `{ "confirm": "DELETE" }` | 400 |
| `users.is_admin = true` | 409 `admin_account` — another administrator removes the role first (`scripts/src/admin-revoke.ts`) |
| The account authored `feature_flag_audit_log` rows | 409 `audit_trail` — that table's `admin_user_id` is a NOT NULL foreign key with no `ON DELETE`; an operator must hand the record over before the account can be deleted. The audit trail is never destroyed to make a delete succeed. |

Both refusal cases only ever apply to TASTEKIN's own administrators.

## Verification

`DATABASE_URL=<disposable> pnpm --filter scripts run verify:account-deletion`
runs the compiled server against a disposable database and checks every row
listed above, the refusals, session revocation (cookie and bearer), the
honest `mediaCleanup: "pending"` answer when providers are unreachable, and
that another member's data is untouched. The Playwright spec
`e2e/account-and-legal.spec.ts` covers the two-step UI (EN + AR/RTL), the
public URLs and the refusal path.
