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

### Running the API

```bash
pnpm --filter @ourglass/api dev
# GET http://localhost:3001/health  ->  { ok: true, service: "api", db: true }
```

### Talking to the assistant (Phase 3 demo)

There is no UI until Phase 5, so this is the only way to *read* the replies — and reading
them matters: tone, brevity, and whether it asks instead of guessing are judgements no test
suite can settle.

**This endpoint is off by default and is a test surface, not a product surface.** It is
unauthenticated and it spends model tokens on whatever it is sent, so when enabled it binds
`127.0.0.1` only and refuses to start without an API key. Do not enable it on a shared host.

```bash
docker compose up -d postgres
pnpm db:migrate

# Needs a real key — this lane calls Sonnet (Interpret) and Haiku (Respond).
ENABLE_DEMO_ENDPOINT=true pnpm --filter @ourglass/api dev
```

Then walk the spec's own Barkha narrative:

```bash
# 1. Create — one commitment and one reminder, correctly owned and timed.
curl -s localhost:3001/turn -H 'content-type: application/json' \
  -d '{"utterance":"Barkha needs to give me the article by 6. Remind me at 5 to ask her."}'

# 2. Complete it, late. This takes TWO turns, and that is correct behaviour,
#    not a degraded demo — see the note below.
curl -s localhost:3001/turn -H 'content-type: application/json' \
  -d '{"utterance":"Barkha gave the article at 11."}'
curl -s localhost:3001/turn -H 'content-type: application/json' \
  -d '{"utterance":"Yes."}'

# 3. Undo — pass the turnId from any response above.
curl -s localhost:3001/undo -H 'content-type: application/json' \
  -d '{"turnId":"<turnId from step 1>"}'
```

**Why step 2 asks first.** Completion auto-matching requires the content-token sets to be
identical, so it fires only when you repeat the stored wording verbatim. `"give me the
article"` vs `"the article"` scores 0.850 against a 0.92 threshold — so it asks. That is spec
§27 working ("never guess when guessing can cause a meaningful mistake"), not failing:
marking the wrong commitment complete is both a real mistake and a near-invisible one.
Full arithmetic in [`docs/PHASE-3-DESIGN.md`](docs/PHASE-3-DESIGN.md) §10.

**On PowerShell**, `curl` is an alias for `Invoke-WebRequest` and the quoting differs — use
`curl.exe` explicitly, or `Invoke-RestMethod -Method Post -ContentType application/json -Body '...'`.

Reminders fire on a 30-second poll against real timestamps, so seeing one fire live means
setting it a minute out and waiting. That is also why the poller's own tests inject a clock
rather than sleeping.

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
[`docs/PHASES.md`](docs/PHASES.md). Phases 0–2 are done and CI-verified. Phase 3 adds the
end-to-end conversational loop (Interpret → Resolve → Mutate → Respond), the reminder poller,
conditional rules, and the demo endpoint above; see
[`docs/PHASE-3-DESIGN.md`](docs/PHASE-3-DESIGN.md). The UI remains Phase 5.

**One standing caveat, carried since Phase 2 and still true:** there is no recorded model
output in this repo. The eval harness has 69 hand-labelled fixtures and a comparator verified
by mutation, but `pnpm test:live` — the only lane that speaks to whether the model actually
extracts correctly — has never been run. Everything green here is evidence about the code,
not about the model.

## Contributing

Read [`docs/DECISIONS.md`](docs/DECISIONS.md) before touching the schema, the tool layer, or
CI config — several choices here depart from "the newest version of X" for specific, verified
reasons (dependency conflicts, missing features, correctness), and re-litigating a settled
decision costs more than reading why it was made.

This repo is public. Never commit secrets — all keys go through GitHub Actions secrets or a
local `.env` (gitignored). Never put real names, emails, or personal data of actual Batore team
members in code, fixtures, or tests; use the spec's own fictional names (Barkha, Arun, Karthik,
Hult, MTTN) instead.
