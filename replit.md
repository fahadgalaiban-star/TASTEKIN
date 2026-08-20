# TASTEKIN

TASTEKIN helps people discover creators, places, products, and routines through compatible taste rather than popularity.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/tastekin run dev` — run the TASTEKIN web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/tastekin/` — Phase 1 React + Vite consumer web app
- `artifacts/api-server/src/routes/discovery.ts` — seeded discovery and relationship API
- `lib/api-spec/openapi.yaml` — source-of-truth API contract
- `artifacts/tastekin/src/index.css` — TASTEKIN editorial design tokens and responsive styles

## Architecture decisions

- Phase 1 uses deterministic seeded discovery data and a provider-neutral relationship endpoint; production persistence and auth expansion belong to the next phases.
- Browser demo state (taste selections, saved edits, follows) is stored under a TASTEKIN-prefixed localStorage namespace so refreshes preserve the consumer journey without exposing secrets.
- Locked media is represented with an explicit access label and presentation blur/lock state; subscriber entitlement and protected object storage are intentionally deferred to Phase 2.

## Product

- Welcome, sign-in/sign-up, and Taste onboarding.
- Mobile-first Home, Explore, Saved, and You navigation.
- Creator profiles with explainable Taste Match details and creator-scoped Collections.
- Public and Subscribers Only Edit cards/details, persistent save/follow relationships, and intentional loading, empty, error, and unavailable states.

## User preferences

- Use Noto Sans for accessible UI copy and restrained serif display treatment for names and feature titles.
- Keep canonical creator follower counts hidden; verification is an admin-controlled trust signal.

## Gotchas

- Vite build commands need `PORT` and `BASE_PATH` in direct shell runs; managed artifact workflows provide them automatically.
- Run API codegen after OpenAPI changes before typechecking packages.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
