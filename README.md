# OurGlass — Batore Personal Assistant

An internal-use AI personal assistant for Batore. The user talks naturally; the assistant
converts unstructured conversation into structured state — commitments, people, projects,
reminders — without ever requiring forms, task lists, or manual categorization.

> **Don't make the user organize their life for the assistant. Make the assistant understand
> their life.**

Full spec: [`docs/SPEC.md`](docs/SPEC.md). Execution plan, phasing, and the reasoning behind
every non-obvious decision: [`docs/EXECUTION-PLAN.md`](docs/EXECUTION-PLAN.md),
[`docs/DECISIONS.md`](docs/DECISIONS.md), [`docs/PHASES.md`](docs/PHASES.md).

> If you landed here from `SETUP.md` — that file documents the Claude Code agent-team
> scaffolding this repo was bootstrapped with, not the product. This file documents the product.

## Stack

TypeScript end-to-end, pnpm monorepo:

| Path | What |
|---|---|
| `apps/web` | Next.js 16 — the minimal conversational UI (deliberately last-priority; see the execution plan) |
| `apps/api` | Fastify — the API, the typed tool registry, the assistant orchestrator (Phase 2+) |
| `packages/shared` | Types shared between `web` and `api` — the tool-call contract |
| `packages/db` | Schema, migrations (`node-pg-migrate`), repositories |
| `packages/evals` | Extraction eval harness — recorded fixtures (free, CI) + a live-model lane (manual, costs tokens) |

Postgres 17 + pgvector 0.8.6 is the only datastore — relational state and semantic memory
together, on purpose (see `docs/DECISIONS.md`).

## Prerequisites

- Node.js ≥ 24 (`node --version`)
- pnpm — if not installed: `npm install -g pnpm`
- Docker (for local Postgres) — or a Postgres 17 instance with the `vector` extension available

## Quickstart

```bash
git clone https://github.com/batoredev/OurGlass.git
cd OurGlass
pnpm install

cp .env.example .env
# .env's defaults already match docker-compose.yml — no edits needed for local dev

docker compose up -d postgres
pnpm db:migrate

pnpm typecheck && pnpm lint && pnpm test
```

That sequence is the whole fresh-clone path — no other setup exists. If any step here doesn't
work as described, that's a bug in this README or the scaffold, not a step you're missing.

> `pnpm db:migrate` and `pnpm db:reset` land with Phase 1 (schema + migration tooling — see
> `docs/PHASE-1-DESIGN.md`). Until then, `pnpm typecheck && pnpm lint && pnpm test` alone
> exercises everything that exists.

### Running the API

```bash
pnpm --filter @ourglass/api dev
# GET http://localhost:3001/health  ->  { ok: true, service: "api", db: true }
```

### Running the web app

```bash
pnpm --filter @ourglass/web dev
# http://localhost:3000
```

### Integration tests (require the Postgres container running)

```bash
docker compose up -d postgres
pnpm --filter @ourglass/api test:integration
```

`pnpm test` (no filter) runs only the fast, DB-free unit tests — it's what CI's first job runs
and what you should run on every save. The integration lane is separate and named explicitly
because it needs a live database.

## Commands (root)

| Command | What |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` across every package, in dependency order |
| `pnpm lint` | ESLint across every package |
| `pnpm test` | Unit tests — fast, no Docker required |
| `pnpm build` | Production build of every package |
| `pnpm dev` | Runs `apps/web` and `apps/api` in watch mode |
| `pnpm db:migrate` | Applies pending migrations (from Phase 1 — see `packages/db/migrations/`) |
| `pnpm db:reset` | Drops and recreates the local dev database, then migrates from zero (from Phase 1) |

## Project status

Phased build, features before UI. Current phase and full checklist:
[`docs/PHASES.md`](docs/PHASES.md). Phase 0 (this scaffold + CI) is done; Phase 1 (schema +
validated tool layer) is in progress — design in
[`docs/PHASE-1-DESIGN.md`](docs/PHASE-1-DESIGN.md).

## Contributing

Read [`docs/DECISIONS.md`](docs/DECISIONS.md) before touching the schema, the tool layer, or
CI config — several choices here depart from "the newest version of X" for specific, verified
reasons (dependency conflicts, missing features, correctness), and re-litigating a settled
decision costs more than reading why it was made.

This repo is public. Never commit secrets — all keys go through GitHub Actions secrets or a
local `.env` (gitignored). Never put real names, emails, or personal data of actual Batore team
members in code, fixtures, or tests; use the spec's own fictional names (Barkha, Arun, Karthik,
Hult, MTTN) instead.
