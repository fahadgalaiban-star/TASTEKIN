# TASTEKIN — Project Instructions

Read this file at the start of every session. It is the master rule set. If any other instruction conflicts with this file, this file wins.

---

## 1. Context

TASTEKIN is a mobile-first social creator app: taste-matching, admin-controlled creator verification ("Taste Seal"), and an AI styling/travel feature called **KIN**. **v1 is completely free** — no subscriptions, paid or locked content, in-app purchases or payment SDKs.

- Solo founder/developer. **Works from an iPhone.** No desktop.
- Stack: pnpm monorepo, Drizzle ORM, Neon PostgreSQL, Express 5, React, Replit Autoscale
- Repo: `fahadgalaiban-star/TASTEKIN`
- Live: `cheerful-easygoing-bytes.replit.app`
- Revenue: none in v1 (founder decision: the app is free). Do not add payment SDKs, product IDs, paywalls or payout code.

### iPhone constraint (hard)

Mobile Safari autocorrect corrupts `/`, `@`, `$`, and quotes in the Replit Shell. **Claude Code runs terminal commands itself.** Never hand the founder a long shell command to type. If a command must be run manually, keep it under ~40 characters with no special characters, or find another way.

---

## 2. Authorization gates (stop and ask)

Claude Code has **no autonomous authority**. Stop, report, and wait for explicit approval before any of these:

| Gate | Why |
|---|---|
| Creating or altering a DB table/column | Production data |
| Adding a dependency | Bundle + supply chain |
| Adding or renaming an env var / secret | Deployment breakage |
| Any change to auth, sessions, or admin checks | Security |
| Merging to main | Founder-only action |
| Any spend-affecting change (rate limits, model choice, provider calls) | Cost |
| Deleting or rewriting existing code paths | Regression risk |

**Read-only audit first.** Before writing code for a new feature, inspect the codebase and report: what exists, what conflicts, what must be decided. Surface conflicts before implementing, never during.

---

## 3. The deploy loop (mandatory, every change)

No step is optional. No step runs out of order.

1. **Branch + PR.** Claude Code commits to a named branch and opens a PR. Never commit directly to `main`.
2. **Founder merges the PR on GitHub.**
3. **Sync Replit:** `git fetch origin main` then `git merge origin/main`. Verify the remote first with `git remote -v` — the Replit↔GitHub remote breaks silently and often.
4. **Schema changes:** make sure the Development database already has the new schema (the post-merge `drizzle-kit push` does this), then read the schema diff the Publishing panel shows and approve it. Publishing is what changes production's schema. See §4.
5. **Republish** from the Replit Publishing panel. Pull ≠ Republish. The live site does not change until Republish completes.
6. **Verify on the live URL** before starting anything else.
7. **Update `SESSION_STATE.md`** (see the session-state skill).

### Known failure patterns — check these before debugging anything else

- `lib/db/migrations/` files are never applied to production by anything: Publishing applies a dev→prod schema diff instead (§4).
- Replit **Deployment Secrets** and **Workspace Secrets** are separate stores. Setting one does not set the other.
- When Claude Code pushes to an already-merged branch, GitHub creates a new PR instead of updating `main`.
- After a merge, reset the Replit workspace with `git reset --hard origin/main` to discard stale Replit-generated commits. Prefer `reset --hard` over `merge` when syncing after a PR — merging while the workspace sits on an old branch produces conflicts that have to be aborted.
- **HTTPS push credentials fail regularly.** When they do, work gets uploaded as a snapshot commit through the GitHub API instead. The tree content is identical but the local SHA will differ from the GitHub SHA. This is expected; verify by comparing tree SHAs, not commit SHAs.
- **Dev and production are separate databases.** Admin status, feature flags, and My Things items do not carry across. A missing Admin section in the dev preview means `users.is_admin` is false in the dev database, not a bug.

---

## 4. Database rules

- **How production schema changes happen (confirmed by Replit Support):** Publishing compares the Development database schema with the Production database schema and applies the difference. It does **not** run the files in `lib/db/migrations/` and does **not** write Drizzle's ledger (`drizzle.__drizzle_migrations`). The official workflow is therefore: apply the schema change to Development (`drizzle-kit push` via `scripts/post-merge.sh`, or `pnpm --filter @workspace/db run push`) → open the Publishing panel → read the schema diff it proposes → approve and publish. Full detail: `docs/DATABASE-SCHEMA-WORKFLOW.md`.
- **The production ledger mismatch is expected and must not be "fixed".** The ledger stops at 0022 while the schema is current; that is the normal state under this workflow. Do not delete, renumber or replay migration files to make the ledger match, do not run `drizzle-kit migrate` / `pnpm --filter @workspace/db run migrate` against production, and do not add a migration runner to the build or to boot (it would apply changes a second time). `RUN_MIGRATIONS_ON_BOOT=true` in `.replit` is inert (the boot runner was removed) and is left as is.
- `lib/db/migrations/*.sql` stay as the reviewed, hand-authored record of each schema change and are used to build disposable databases for the verify scripts. Every schema change still gets a migration file plus the Drizzle schema change in `lib/db/src/schema/`; the file documents and tests the change, Publishing ships it.
- Do not run `drizzle-kit generate`. There is a known snapshot/history gap (documented in PR #25). Migrations are hand-authored, minimal SQL.
- Before approving a Publish diff, check it against the migration file: only the intended additive statements (CREATE TABLE / ADD COLUMN / CREATE INDEX / ADD CONSTRAINT). Stop and investigate if it proposes a DROP, a type change or anything you did not write. Two harmless items reappear in every diff (a truncated FK name on `my_circle_memberships` and a `profile` default) and can be approved.
- Every new table gets: `owner_user_id` FK to `users(id)` `ON DELETE cascade`, a `created_at timestamptz DEFAULT now() NOT NULL`, and an index on `(owner_user_id, created_at)`.
- Neon SQL console is reachable on iPhone in landscape mode — use it for read-only verification, not for schema changes.

---

## 5. Architecture principles (non-negotiable)

- **Admin authority:** PostgreSQL `users.is_admin` is the single source of truth. Env vars are used only for a one-time bootstrap grant, never for runtime checks.
- **Image storage:** private object storage; file keys in the DB; served via authorized routes or short-lived signed URLs. Never permanent public URLs.
- **AI scope:** image understanding only. The model must never invent product data, prices, availability, or merchant names.
- **Limit messages:** the server returns a Reason Code; the UI resolves it through the existing translation files. Never store multilingual strings in the DB.
- **Content policy:** clean content only, across all creator types.

---

## 6. Financial protection model (KIN / any provider call)

This is the most expensive part of the system. Treat it as such.

1. **Reserve before calling.** The image-attempt guard, the daily counter, and the monthly counter are incremented in one atomic transaction before any provider request is issued.
2. **A missing API key must never consume a reservation.** Check key presence first; fail fast with a clear Reason Code.
3. Current limits (Founder Trial phase):
   - Global daily analysis limit: 50
   - Global monthly analysis limit: 1,000
   - Per-user daily limit: disabled (`null`)
   - My Things item cap: removed
4. Per-user rate limiting infrastructure exists and is wired but disabled. `null` means disabled. Do not delete it.
5. **Never retry a failed provider call automatically.** A retry is a second charge.

---

## 7. Provider configuration

Secrets in Replit: `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY` (Maps key restricted to Places API New + Routes API).

Optional, referral-only (not secrets, no partner is hard-coded, both features stay invisible until the founder picks a partner AND turns the flag on): `KIN_CAR_RENTAL_REFERRAL_URL` / `KIN_CAR_RENTAL_PARTNER_NAME` (flag `kin_travel_car_rental`) and `KIN_RESTAURANT_RESERVATION_URL` / `KIN_RESTAURANT_RESERVATION_PARTNER_NAME` (flag `kin_travel_restaurant_reservations`). See `docs/KIN-TRAVEL-REFERRALS.md`.

**Model and tool identifiers are version-pinned and must be verified against the official docs before use, not recalled from memory.**

The current model string and web search tool identifier are correct as configured. Do not change them without a specific, evidenced reason. Docs: https://docs.claude.com/en/docs/agents-and-tools/tool-use/web-search-tool

**Diagnostics rule:** provider failures must log the actual upstream error `type` and `message` fields server-side. Never let a provider error collapse into a generic "temporarily unavailable" with no log line.

**Confirmed failure causes, in the order to check them:**

1. **The deploy was never published.** A "temporarily unavailable" that persisted for days turned out to be an unpublished merge. Check this first, every time, before touching any code.
2. **`max_uses_exceeded`.** The model is allowed three web searches per request (`KIN_SEARCH_MAX_WEB_USES`). Using all three and attempting a fourth returns a structured `web_search_tool_result_error`. The provider request itself succeeded. This is not a failure of the answer — a complete recommendation stays valid.
3. **Structured errors only.** Provider failure is detected from Anthropic's typed error blocks, never inferred from the model's prose.

---

## 7b. KIN output rules (learned the hard way, all confirmed in production)

- **Images.** A look card shows only member-supplied imagery: the uploaded photo or the selected My Things item's authorized image. Web-search thumbnails never become outfit images — they belong in citation cards only. With neither, the answer is text-only. No fallback image of any kind.
- **The reference is captured at submit time**, not read from live form state. Editing the form mid-request must not retroactively change a finished result.
- **The model must never claim to see an image it was not given.** No prompt may invite phrases like "shown in the photo".
- **No verbatim copying from sources.** Paraphrase. Sources appear in citation cards.
- **One final answer.** Progress narration ("I'll resume searching…", "give me a moment") must never render as a result. In Travel, a narration-only response is a failure returning `KIN_TRAVEL_INVALID_PLAN`.
- **Travel routing.** Google Routes is requested in `DRIVE` mode. Walking was the old default and produced real but useless numbers (492 min for 35 km). Distance and duration display only when a verified route matches the exact from/to place IDs. Otherwise show nothing rather than a wrong number.
- **Travel ordering.** Stops are ordered geographically (nearest-neighbour) and nearby places are grouped into the same day. The old round-robin distribution across days produced impossible itineraries.
- **The AI describes and explains; the code calculates and orders.** Distances, durations, sequencing, and prices are code and API concerns. Never ask the model to compute them — it will invent them.

Open inconsistency to resolve: Looks reply in the language of the query; Travel replies in the UI locale. Pick one after observing real users.

---

## 8. Working style

- **One feature at a time.** Verified on production before the next starts.
- **Decision-first replies.** Lead with the decision or the answer. Then the reasoning, briefly. No preamble.
- **No multi-round prompt refinement.** Propose the minimal direct approach once. Do not iterate on elaborations.
- **Trim scope aggressively.** Optional fields, extra confirmation steps, and "while we're here" additions are cut before implementation begins.
- **Language:** conversation may mix Iraqi Arabic and English. All code, commit messages, PR titles, branch names, and documentation stay in English.
- Plans may be cross-reviewed in another model before authorization. Write plans so they survive being read out of context.

---

## 9. Skills

Skills live in `.claude/skills/`. Load the relevant one when its trigger fires.

| Skill | Trigger |
|---|---|
| session-state | Session start, session end, or after any merge/publish |
| deploy-loop | Any change that reaches production |
| pr-planning | Before opening any PR |

---

## 10. Current state pointer

`SESSION_STATE.md` in the repo root is the live handoff document. Read it immediately after this file, before doing anything else.
