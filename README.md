# Workspace

A pnpm monorepo containing multiple Replit artifacts (apps and shared libraries). New contributors should read this file first to get oriented, then consult `replit.md` and the `pnpm-workspace` skill for deeper details.

## Artifacts

- `artifacts/tunnel-shooter` — Tunnel Shooter web game (Vite + React)
- `artifacts/api-server` — Express 5 API server
- `artifacts/mockup-sandbox` — Canvas component preview / design sandbox

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Prerequisites

- Node.js 24
- pnpm (the repo enforces pnpm via a `preinstall` check)
- A Postgres database for any work touching the API/DB

## Install

```bash
pnpm install
```

Do not use `npm` or `yarn` — the `preinstall` script will refuse them.

## Develop

On Replit, each artifact runs via its own workflow (started with `restart_workflow <slug>`), which wires up `PORT` and `BASE_PATH`. Off-Replit, you can run an artifact directly with a pnpm filter:

- API server: `pnpm --filter @workspace/api-server run dev` (port 5000)
- Tunnel Shooter: `pnpm --filter @workspace/tunnel-shooter run dev`
- Mockup sandbox: `pnpm --filter @workspace/mockup-sandbox run dev`

On Replit, `restart_workflow <slug>` starts an artifact's workflow — the slug is the artifact's folder name under `artifacts/` (e.g. `api-server`, `tunnel-shooter`, `mockup-sandbox`).

When running on Replit, all services are reached through the shared proxy at `localhost:80` (e.g. `localhost:80/api/healthz`); do not hit service ports directly there. Off-Replit, hit each dev server on its own port as printed by Vite/Express. Do not run `pnpm dev` at the repo root — there is no root `dev` script by design.

## Common scripts

Run from the repo root:

- `pnpm run typecheck` — full typecheck across all packages (builds libs first, then checks leaves)
- `pnpm run typecheck:libs` — typecheck/build the composite libs only
- `pnpm run build` — typecheck + build every package
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API React Query hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

To verify a single artifact, prefer `pnpm --filter @workspace/<slug> run typecheck` over `build` (build needs workflow-provided env vars).

## Environment

- `DATABASE_URL` — Postgres connection string (required for API/DB work)

Per-artifact env vars (such as `PORT` and `BASE_PATH`) are supplied automatically by the Replit workflow configuration.

## Repo layout

```text
.
├── artifacts/    # Deployable applications (one folder per artifact)
├── lib/          # Shared libraries (composite TS projects)
├── scripts/      # Shared utility scripts (@workspace/scripts)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json # Solution file referencing composite libs
└── package.json  # Root task orchestration
```

- `lib/*` packages are composite and emit declarations via `tsc --build`.
- `artifacts/*` and `scripts` are leaf packages checked with `tsc --noEmit` and must not import from each other — share code through a `lib/*` package instead.

## Pointers

- `replit.md` — project overview, architecture decisions, user preferences, gotchas
- `pnpm-workspace` skill — full details on workspace structure, TypeScript project references, server/API contracts, codegen, logging, and proxy routing
