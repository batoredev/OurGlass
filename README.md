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
| `apps/web` | Next.js 16 — the app: the conversation, the read surfaces, and every HTTP route under `/api` |
| `apps/api` | The assistant itself — orchestrator, typed tool registry, AI providers, reminder poller. **A library the web app imports, not a server.** `pnpm dev` here runs the poller |
| `packages/shared` | Types shared between `web` and `api` — the tool-call contract |
| `packages/db` | Schema, migrations (`node-pg-migrate`), repositories |
| `packages/evals` | Extraction eval harness — recorded fixtures (free, CI) + a live-model lane (manual, costs tokens) |

Postgres 17 + pgvector 0.8.6 is the only datastore — relational state and semantic memory
together, on purpose (see `docs/DECISIONS.md`).

## Prerequisites

- Node.js ≥ 24 (`node --version`)
- pnpm — if not installed: `npm install -g pnpm`
- Postgres 17 with the `vector` extension — either Docker locally (`docker-compose.yml` is
  here) or a hosted one such as Supabase. Set `DATABASE_URL` to whichever you use.
- At least one model key. Without one, `/api/turn` returns 500 naming what is missing;
  everything else still runs. See [`docs/AI_PROVIDERS.md`](docs/AI_PROVIDERS.md).

## Quickstart

```bash
git clone https://github.com/batoredev/OurGlass.git
cd OurGlass
pnpm install

cp .env.example .env
# .env's defaults already match docker-compose.yml — no edits needed for local dev

docker compose up -d postgres     # or point DATABASE_URL at a hosted Postgres
pnpm db:migrate

pnpm dev                          # http://localhost:3000
```

That sequence is the whole fresh-clone path — no other setup exists. If any step here doesn't
work as described, that's a bug in this README or the scaffold, not a step you're missing.

`pnpm dev` builds the shared libraries first and then runs two things: the Next.js app on
port 3000, and the reminder poller. The web app imports `@ourglass/api` from its built
`dist/`, so the build step is not optional — skipping it on a fresh clone fails to resolve
the package.

To run the checks instead: `pnpm typecheck && pnpm lint && pnpm test`.

**Trying it out:** [`docs/DEMO-GUIDE.md`](docs/DEMO-GUIDE.md) is a scripted walkthrough —
what to type, what should happen, and what is deliberately not built yet.

### Talking to the assistant

Open <http://localhost:3000> and type. There is no separate API server: every route lives in
the Next.js app under `/api`, and `apps/api` is the library behind them.

The spec's own Barkha narrative, in the UI or over HTTP:

```bash
curl -s localhost:3000/api/turn -H 'content-type: application/json' \
  -d '{"utterance":"Barkha needs to give me the article by 6. Remind me at 5 to ask her."}'

# Complete it, late. This takes TWO turns, and that is correct behaviour --
# see the note below.
curl -s localhost:3000/api/turn -H 'content-type: application/json' \
  -d '{"utterance":"Barkha gave the article at 11."}'

# Undo -- pass the turnId from any response above.
curl -s localhost:3000/api/undo -H 'content-type: application/json' \
  -d '{"turnId":"<turnId from step 1>"}'
```

**Why the completion asks first.** Completion auto-matching requires the content-token sets to
be identical, so it fires only when you repeat the stored wording. `"give me the article"` vs
`"the article"` scores 0.850 against a 0.92 threshold — so it asks. That is spec §27 working
("never guess when guessing can cause a meaningful mistake"), not failing: marking the wrong
commitment complete is both a real mistake and a near-invisible one. Full arithmetic in
[`docs/PHASE-3-DESIGN.md`](docs/PHASE-3-DESIGN.md) §10.

**Answer a question with a whole sentence, not "yes".** Every message is interpreted on its
own — the model is never shown the conversation so far. So when it asks *"Which one — the
article, due 6 PM?"*, reply *"Barkha gave me the article at 11"*, repeating the wording it
used. Multi-turn context is not built; `docs/DEMO-GUIDE.md` says so plainly rather than
leaving a demo to discover it.

**On PowerShell**, `curl` is an alias for `Invoke-WebRequest` and the quoting differs — use
`curl.exe` explicitly, or `Invoke-RestMethod -Method Post -ContentType application/json -Body '...'`.

Reminders fire on a 30-second poll against real timestamps, so seeing one fire live means
setting it a minute out and waiting. That is also why the poller's own tests inject a clock
rather than sleeping.

### Access control

With no `OURGLASS_ACCESS_TOKEN` set, the app runs in one of two modes: **demo** (if
`ENABLE_DEMO_ENDPOINT=true`) where every route is open, or **closed**, where nothing is
served. Set a token of 32+ characters to require sign-in at `/login`. Never deploy anywhere
reachable without one.

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
[`docs/PHASES.md`](docs/PHASES.md); stage board in
[`docs/MASTER-EXECUTION-PLAN.md`](docs/MASTER-EXECUTION-PLAN.md).

Phases 0–5 are built and CI-verified: the schema and tool layer, extraction and resolution,
the four-stage conversational loop with reminders and conditional rules, memory and
inspection, the dynamic entity registry, the UI, multi-provider AI with a measured fallback
chain, and the §35 permission model with its control plane. Phases 6–8 — ingestion,
external integrations, voice — are not started.

**Standing caveats, kept here because a green CI badge does not cover them:**

- Model *quality* is measured for **one** provider, and it is the weakest one. All 99 fixtures
  have been run against local `qwen3:8b` (three times, results in
  [`docs/AI_EVALS.md`](docs/AI_EVALS.md)); Claude and Gemini never have, for want of credit and
  quota. On Qwen, 34 of 99 utterances extract fully correctly and about half would drive a write
  the label does not endorse — so treat the local provider as the no-key, offline option, not as
  the quality this product claims. Everything else green is evidence about the code.
- Single-user by construction. There is no tenant boundary, no login beyond one shared
  access token, and entity resolution searches all people. Do not put a second organisation's
  data in it.

## Contributing

Read [`docs/DECISIONS.md`](docs/DECISIONS.md) before touching the schema, the tool layer, or
CI config — several choices here depart from "the newest version of X" for specific, verified
reasons (dependency conflicts, missing features, correctness), and re-litigating a settled
decision costs more than reading why it was made.

This repo is public. Never commit secrets — all keys go through GitHub Actions secrets or a
local `.env` (gitignored). Never put real names, emails, or personal data of actual Batore team
members in code, fixtures, or tests; use the spec's own fictional names (Barkha, Arun, Karthik,
Hult, MTTN) instead.
