# Batore Personal Assistant — Execution Plan

## Context

`Batore_Personal_Assistant_Spec.pdf` (38 sections) specifies an internal-use AI personal
assistant for the Batore team. The product thesis, in the spec's own words:

> **Don't make the user organize their life for the assistant. Make the assistant understand their life.**

The user talks naturally; the assistant converts unstructured human communication into
structured state. It is explicitly **not** a productivity app, **not** a life coach, and
**not** a chatbot with a task database. The user must never be required to create a task,
pick a category, choose a priority, open a calendar, or mark something complete.

**Current state:** `C:\Users\sriva\Desktop\OurGlass` holds only the Company Claude OS agent
scaffolding (`.claude/`, `docs/`, `tools/`, `workflows/`) and one baseline commit. There is
no application code, no `package.json`, no remote. `github.com/batoredev/OurGlass` exists,
is **public**, is **empty** (no default branch), and we have WRITE permission. `gh` is
authenticated as `SriVaibhav14` with `repo` + `workflow` scopes.

**Outcome:** a working conversational assistant covering all 38 spec sections, built
features-first with a deliberately minimal UI, developed by agent teams, with GitHub
Actions CI live on `batoredev/OurGlass`.

### Decisions taken (locked)

| Decision | Choice |
|---|---|
| Repo visibility | **Public** — hardened: secret scanning + push protection, zero real names in fixtures |
| Stack | **TypeScript end-to-end** — Next.js UI + Node/TS API + Postgres/pgvector + Anthropic SDK, pnpm monorepo |
| Scope | **Full spec, all 38 sections**, phased |
| LLM ↔ DB | **Full write power through typed, validated tools.** No raw SQL generation |
| Dynamic entities | The LLM may define **new entity types at runtime**; the frontend renders them with **no code change** |
| Confirmations | **Act immediately on internal state, undo available.** External actions confirm (§35) |
| UI priority | **Last.** Bare inspection surfaces for testing only |
| Plan storage | This plan + all execution docs are **also committed to `docs/` in the project repo** |
| Execution unit | **Agent teams always — never subagents.** Standing rule, every phase |
| Knowledge graph | **`/graphify --update` after every feature lands.** Standing rule |

### The non-negotiable architectural rule

Spec §37 — the LLM **proposes**, the backend **validates and commits**:

```
User utterance
  → LLM emits typed tool calls (update_commitment, merge_person, define_entity_type, …)
  → Backend validates: does the row exist? is the shape legal? is the actor permitted?
  → Commit in a transaction + append to action_log (undoable)
  → Assistant replies conversationally ("Got it — Hult poster marked complete.")
```

The user still gets "just tell it what to do" for **every** operation, including deletes and
merges. The tool layer makes that power reliable rather than limiting it, and it closes the
injection path: an ingested screenshot that says "delete all commitments" produces at most a
*proposed* call that validation and permission checks reject.

---

## Research findings that change the design

Two `research-analyst` agents investigated from primary sources. Findings that alter the
plan, rather than confirm it:

**1. `confidence: 0.97` (spec §37) cannot be enforced by the schema.** Anthropic structured
outputs support no `minimum`/`maximum`. Use spec §12's own `CONFIRMED` / `INFERRED` /
`UNCERTAIN` enum instead — the spec already contains the better design. *(Verified against
Anthropic docs.)*

**2. Recursive schemas are unsupported.** A nested conditional-workflow AST (§25) is not
expressible. Conditional rules must be **flattened to fixed depth**.

**3. Spec §18 conflates two different things.** "in two hours" is a timestamp; "before the
meeting" and "after Arun replies" are **event triggers with no timestamp until another entity
resolves**. Building these as one type produces reminders that fire at invented times. They
split into: deterministic time (chrono-node), relational time (resolve later), and event
trigger (goes to the conditional-rule engine, not the reminder table).

**4. Do not let the LLM compute timestamps.** LLM date arithmetic across DST is exactly the
"different result each run" case. The LLM extracts the *verbatim phrase* (`"next Friday"`);
`chrono-node` 2.10.1 resolves it deterministically from `(text, instant, timezone)`.

**5. Vendor memory benchmarks are actively disputed** (Zep vs Mem0 publicly contradict each
other's numbers; there is an open issue disputing Zep's own figure). **Borrow the bitemporal
design — four timestamps, invalidate-never-delete — and skip the dependency.** Graphiti
defaults to Neo4j, which would add a second datastore for no capability we cannot write in a
migration.

**6. Entity-resolution thresholds: never use one cosine cutoff, never use transitive closure.**
Published result: adding transitivity collapsed one benchmark's Pair-F1 from 0.540 to **0.000**
— "one false-positive link can silently merge unrelated entities." Hard vetoes raised cluster
purity 51.6% → 84.4%. Use a three-band policy with domain vetoes (never merge across differing
`owner`/`recipient`, or completed-vs-pending).

**7. One Postgres is correct.** pgvector 0.8.6, HNSW, `hnsw.iterative_scan` enabled (our
queries are nearly always filtered — "what does Barkha owe me"). The real argument is
transactional: a separate vector DB lets an embedding write succeed while the commitment write
fails.

**8. Parallel tool-use has a documented footgun.** All `tool_result` blocks must go in **one**
user message; splitting them across messages teaches the model to stop making parallel calls.

**9. Unresolved conflict in the spec.** §23 (don't duplicate) implies a wrong *split* is worse;
§7 (ownership matters) implies a wrong *merge* is worse. These cannot both be optimised.
**Resolved for this build: a wrong merge is worse** — it silently destroys a commitment, while
a duplicate is visible and correctable by saying "those are the same thing." Bias toward
splitting; ask in the ambiguous band.

---

## Architecture

```
Next.js UI (minimal)  →  Node/TS API  →  Assistant Orchestrator
                                            ├── Interpret stage (structured outputs)
                                            ├── Resolve stage (entities, time, dedup)
                                            ├── Mutate stage (typed tools, validated)
                                            └── Respond stage (concise, conversational)
                                                        ↓
                            Postgres 17 + pgvector 0.8.6  (single datastore)
                            relational state · vector memory · event log · action log
```

Four stages, because they have different failure modes and must be independently testable:
**Interpret** (what did they mean) → **Resolve** (which existing rows, what real timestamps) →
**Mutate** (validated writes) → **Respond** (short, human).

### Data model — the core tables

**`commitments`** is the primary abstraction, not `tasks` (§6). Columns: `owner_id`,
`recipient_id`, `object_text`, `object_embedding`, `expected_at`, `status`, `project_id`,
plus bitemporal `t_valid` / `t_invalid` / `t_created` / `t_expired`.

Ownership direction (§7) is two explicit FK columns — this is the product's stated
differentiator and must be structural, never inferred at read time.

Status enum covers all of §8: `pending`, `in_progress`, `waiting`, `waiting_on_someone`,
`due_soon`, `overdue`, `completed`, `completed_late`, `cancelled`, `blocked`, `superseded`.
Never user-selected; always derived.

**`people`**, **`organizations`**, **`projects`**, **`events`**, **`reminders`**,
**`relationships`**, **`workflows`**, **`permissions`**, **`messages`**, **`documents`**,
**`memories`**, **`action_log`** (§14, §38).

**`relationships`** carries `type`, `source`, `inference_level`, and the four bitemporal
timestamps (§15, §16). "Arun handles backend" → "No, Karthik handles it now" sets the Arun
edge's `t_invalid` to the Karthik edge's `t_valid` and **keeps the row** (§17). History is
preserved; contradictions do not accumulate forever.

**`action_log`** records every mutation with its inverse, making "undo that" a real feature
rather than a promise.

### Dynamic entity types — the user's explicit requirement

The LLM can define new entity types at runtime and **the frontend must render them without a
code change**. This is a first-class subsystem, not a detail:

- `entity_types` — a registry: name, JSON-schema field definitions, display config, icon, label field.
- `entity_records` — rows for user-defined types, `JSONB` payload validated against the registered schema.
- `define_entity_type` and `add_entity_field` are **tools like any other**, so the user creates new structure by talking.
- The frontend has **no hardcoded list of entity types**. It fetches the registry and renders generically from field types (`text`, `date`, `person_ref`, `enum`, `number`, `bool`). A new type appears in the UI the moment it is defined.
- Guardrails: new types cannot shadow core table names; field count and type count are capped; every definition is logged and reversible.

This means core entities get purpose-built handling while anything the user invents still gets
list, detail, search, and linking for free.

---

## Phasing — features first, UI last

Each phase ends with a demo that can be verified by talking to the assistant.

### Phase 0 — Foundation *(no agent team; lead session, sequential)*
Repo wired to `batoredev/OurGlass`, pnpm monorepo (`apps/web`, `apps/api`, `packages/shared`),
Postgres+pgvector via Docker Compose, GitHub Actions CI green, secret scanning + push
protection on, plan and spec-derived docs committed to `docs/`.
**Demo:** CI green on an empty-but-typechecked monorepo.

### Phase 1 — Structured state + validated tool layer *(Mission 4 team)*
Schema and migrations for all core tables with bitemporal columns. The typed tool registry and
validation/commit/log/undo path. No LLM yet — tools are driven by tests.
**Demo:** every mutation callable programmatically, every one undoable.

### Phase 2 — Interpret + Resolve *(Mission 4 team)*
Structured-output extraction into the §5 intent taxonomy with `inference_level` per intent.
chrono-node time resolution with the three-tier split. Entity resolution with the three-band
policy and hard vetoes. Duplicate detection (§23).
**Demo:** "Barkha needs to give me the article by 6. Remind me at 5 to ask her." produces one
commitment and one reminder, correctly owned and correctly timed.

### Phase 3 — Conversational loop + reminders *(Mission 4 team)*
The full four-stage orchestrator. Reminder firing — mechanism **open**: `pg_cron` was assumed
in earlier drafts but is absent from `pgvector/pgvector:pg17` (verified from the image's
Dockerfile); default recommendation is an in-process poller, see `docs/DECISIONS.md` and
`docs/PHASE-1-DESIGN.md` §6 for the tradeoff. Conditional rules (§25) with flattened conditions
evaluated against live state. Completion updates and late-completion context (§20, §21).
Concise response style (§30, §31).
**Demo:** the spec's own Barkha/Hult/Arun narratives end-to-end, including "Barkha gave the
article at 11" correctly producing `completed_late` with a 5-hour delay.

### Phase 4 — Understanding over time *(Mission 4 team)*
Semantic memory with hybrid retrieval (HNSW + BM25). Memory provenance and conversational
correction (§16, §17). Conflict detection (§24). Proactive behaviour with a relevance gate
(§26). Inspection queries — "what am I waiting on", "what does Barkha owe me" (§28).
**Demo:** "Schedule Arun at 5 tomorrow" surfaces the Hult conflict and asks rather than choosing.

### Phase 5 — Dynamic entities + minimal UI *(Mission 4 team)*
The `entity_types` registry, schema-driven frontend rendering, and the bare inspection
surfaces: conversation view plus Today / Commitments / People / Projects / Memory / Activity
as read-only tables (§29). Deliberately unstyled.
**Demo:** "track my gym sessions with a date and a duration" creates a new type that appears in
the UI immediately, with no deploy.

### Phase 6 — Ingestion *(Mission 4 team)*
Images and documents (§32, §33) — screenshots, posters, PDFs, DOCX, XLSX. Extract and associate
with people/projects/commitments. **Interpret first, act only when appropriate** — never
auto-create a calendar event just because an event was detected. Ingested content is untrusted
input and cannot authorise actions.

### Phase 7 — External integrations + permissions *(Mission 4 team + integration specialist)*
Permission model first (§35): one-time, persistent, by-action-type, revocable. Then Gmail,
Calendar, Drive (§34). External actions always confirm. Nothing ships here until the permission
layer is reviewed.

### Phase 8 — Voice
Deferred. Listed in §1 as "eventually."

---

## Agent-team execution model

**Standing rule: agent teams, never subagents.** This applies to every phase without
exception. Teammates run concurrently, message each other directly by name, and publish
contracts the moment they settle — a subagent returns one report and dies, which serialises
work that has no reason to be serial. Where this plan says "team", it means a real agent team
with named teammates, not a fan-out of one-shot agents.

The only work that runs solo is the work that *must* be solo: the auto-committing skills
(`/review`, `/qa`, `/ship`, `/land-and-deploy`), which sync and push and would destroy any
teammate still holding files.

Each feature phase runs as **Mission 4** (`docs/MISSIONS.md`) with 4–5 teammates:

- `database-data-engineer` — **sole owner** of `migrations/**`, `packages/db/**`. Runs `/careful`.
- `backend-lead` — `apps/api/src/**` minus the AI layer.
- `ai-agent-engineer` — `apps/api/src/assistant/**` (prompts, tools, extraction, evals).
- `frontend-lead` — `apps/web/**`. Idle until Phase 5.
- `qa-browser-lead` — **exclusive browser owner**, `/qa-only`, reports defects, does not fix.

**Rules enforced throughout** (`.claude/rules/agent-teams.md`):
- Every implementer runs `/freeze <its glob>` as its first action.
- Schema publishes final table shape to backend **before** backend starts; backend publishes the
  tool contract to AI and frontend **before** they build against it.
- Auto-committing skills (`/review`, `/qa`, `/ship`) run **only in the lead, after all teammates
  have shut down**.
- Read-only reviewers (`staff-code-reviewer`, `security-cso`, `performance-engineer`) run in
  parallel with implementers — they hold no write tools.

**Before each phase:** Mission 1 (four-lens plan review). **After each phase:** Mission 2
(four-lens code review), then Mission 6.5 (codify repeated mechanical steps into `tools/`).

---

## Graphify — knowledge graph maintained after every feature

**Standing rule: `/graphify --update` runs after every feature lands, not once at the end.**

The codebase grows across eight phases with entity resolution, bitemporal memory, a dynamic
type registry, and a tool layer that all reference each other. A stale graph is worse than no
graph, so it gets refreshed as part of the definition of done.

**The per-feature loop**, run in the **lead session after the team has shut down** (the same
slot as `/review` and `/qa` — graphify dispatches its own workers and writes to
`graphify-out/`, so it must not run while implementers hold files):

1. `/graphify --update` — incremental, re-extracts only new and changed files.
2. Read the regenerated `graphify-out/GRAPH_REPORT.md` — specifically **God Nodes** (what
   became a hub) and **Surprising Connections** (unintended coupling).
3. Act on what it shows. A God Node that should not be central, or a surprising edge between
   two modules that were meant to be independent, is an architecture finding — feed it into
   the next phase's Mission 1 plan review rather than letting it accumulate.

**Definition of done for a feature** — all five, in order:
`tests green` → `/review` clean → **`/graphify --update` run** → `GRAPH_REPORT.md` reviewed →
committed and pushed.

**Where it pays off specifically here:**
- **Phase 1→2 boundary:** confirms the tool layer is actually the only path to the DB. Any
  edge from the assistant module straight to a repository or SQL layer is a §37 violation the
  graph will surface structurally, which review can miss.
- **Phase 5:** the dynamic entity registry touches API, DB, and UI. The graph shows whether
  schema-driven rendering stayed generic or quietly grew per-type special-casing.
- **Phase 6–7:** ingestion and integrations are the untrusted-input boundary. A graph edge
  from a document parser into anything with write authority is exactly the injection path the
  design forbids.

**Also used as a question-answering tool, not just a report.** Once `graphify-out/graph.json`
exists, architecture questions go through it first — e.g.
`/graphify query "what writes to the commitments table?"` or
`/graphify path "DocumentIngest" "ActionLog"` to check no path exists that should not.

`graphify-out/` is committed so the graph is shared, except the large `graph.html` which is
regenerated on demand.

---

## GitHub Actions — `batoredev/OurGlass`

The repo is **empty and public**; `main` does not exist yet. Everything below is verified
directly against the GitHub and Docker registries today, not recalled:

| Component | Version (verified) |
|---|---|
| `actions/checkout` | **v7.0.1** |
| `actions/setup-node` | **v7.0.0** |
| `actions/cache` | **v6.1.0** |
| `actions/upload-artifact` | **v7.0.1** (note: `download-artifact` is **v8** — majors are not in lockstep) |
| `pnpm/action-setup` | **v6.1.0** |
| `github/codeql-action` | **v4** |
| pgvector Docker image | **`pgvector/pgvector:pg18`** / `0.8.6-pg17-trixie` (official) |
| pgvector extension | **v0.8.6** |
| `chrono-node` | **2.10.1**, MIT |
| Node | **24** (active LTS) |
| Vitest | **4.1.11** — pinning, not 5.0.0 (released 4 days ago) |
| TypeScript | **6.0.3** — not 7.x (Go-port rewrite, 2 months old; ts-eslint compat unverified) |
| ESLint | **9.39.5**, not 10.x — `eslint-config-next`'s `eslint-plugin-import` peer-caps at `^9` (found during Phase 0 install; see `docs/DECISIONS.md`) |

### ⚠ Two blockers confirmed empirically

**1. We do not have ADMIN.** `gh api repos/batoredev/OurGlass --jq .permissions` returns
`{"admin":false,"maintain":false,"pull":true,"push":true,"triage":true}`. Branch protection,
rulesets, and repo security toggles **cannot be set by us** — they need the `batoredev` owner.
Everything in committed config still ships fine.

**2. The repo has zero branches.** `default_branch` reads `main` but `GET /branches` returns
`[]`. Rulesets and required status checks cannot be configured until after the first push, so
**order is forced: push → let CI go green once → then the owner applies protection** (a
required check must have reported at least once, and its context must match the job name).

The owner is a **User** account, so secret scanning + push protection are *likely* on by
default for a new public repo — but that is unreadable without admin and must be confirmed by
them, not assumed.

**Corrections worth noting** (things that would have been wrong):
- Dependabot's ecosystem value for a pnpm project is **`"npm"`**, not `"pnpm"`.
- CodeQL language identifier is **`javascript-typescript`** — one entry covers both.
- `actions/checkout` v7 now **blocks fork-PR checkout by default** under `pull_request_target`.
  We use plain `pull_request` only; `allow-unsafe-pr-checkout` is never set.
- A path filter that skips a *required* check leaves it pending forever and deadlocks the
  merge. Filter inside the job, not the workflow.
- Public repos get **unlimited free Actions minutes**, so optimise for wall-clock, not billing.
  No version matrix — we deploy one Node version.

**Workflows to create:**

1. **`ci.yml`** — typecheck → lint → test → build on push and PR. Postgres+pgvector as a
   service container with a health check, so integration tests run against real SQL and real
   `vector` columns rather than mocks. `concurrency` group cancels superseded runs.
2. **`evals.yml`** — the extraction eval suite against recorded fixtures on every PR (free,
   deterministic), plus a `workflow_dispatch` lane that runs live against the model.
3. **`codeql.yml`** — CodeQL for TypeScript, on PR and a weekly schedule.
4. **`dependabot.yml`** — npm + GitHub Actions update PRs.

**Public-repo hardening** (this repo holds an assistant that will store personal data):
- `permissions: {}` at workflow top level, escalating per job. Specifying any one scope sets
  the rest to `none` — that is what makes a narrow block safe. This matters more than usual
  here: the org-level default is unreadable without admin, so the workflow file is the only
  token scoping we control.
- Third-party actions SHA-pinned; `actions/*` on major tags. The `github-actions` Dependabot
  entry is what stops pins from rotting.
- No `pull_request_target` anywhere; plain `pull_request` runs fork code with a read-only
  token and no secrets.
- **`ANTHROPIC_API_KEY` never in a workflow a fork PR can trigger.** The live eval lane is
  `workflow_dispatch` only.
- `timeout-minutes: 15` on every job (the default is 360 — a hung job burns six hours).

**Monorepo tooling: pnpm workspaces alone, no Turborepo.** At 3–5 packages `pnpm -r --filter`
covers the task graph natively, and the expensive cache (install) comes free from
`setup-node`'s `cache: pnpm` — a different cache from Turborepo's, which people conflate.
Turborepo's real differentiator is its *remote* cache, which points at Vercel. Adopting it
later is additive, so deferring costs nothing. Pin pnpm via `packageManager` rather than
floating — pnpm 12 turned unrecognised workspace keys into hard errors.

## The eval harness — built in Phase 2, not deferred

Research was explicit: Anthropic guarantees **schema conformance**, not **semantic
correctness**. Valid JSON that says the wrong thing is fully consistent with that guarantee.
There is no published benchmark for multi-intent extraction, so we build our own.

`packages/evals/` holds ~50 hand-labelled utterances drawn from the spec's own examples — the
Barkha article, the Hult poster, the two Aruns, the 5 PM conflict, "she had a family emergency"
— each with expected structured output. CI runs them against recorded fixtures on every PR
(free, deterministic); a manually-triggered lane runs them live against the model.

This is what makes prompt changes safe. Without it, every prompt edit is an unmeasured
regression risk.

---

## Verification

**Per phase:** `pnpm typecheck && pnpm lint && pnpm test` green; the phase's demo script
performed end-to-end against a real database; eval suite passing from Phase 2 onward.

**Integration:** Postgres+pgvector service container in CI, migrations applied fresh, tool layer
exercised against real SQL rather than mocks.

**Manual acceptance:** replay the spec's narratives verbatim and confirm the assistant behaves as
§§19–23 describe — including that it does *not* over-ask (§27), does *not* give unsolicited
advice (§4), and answers in one line, not a paragraph (§31).

**Security (public repo):** no real names in any fixture; all keys via GitHub secrets; secret
scanning and push protection enabled; `security-cso` reviews the permission model in Phase 7
and the ingestion trust boundary in Phase 6.

---

## Risks

| Risk | Mitigation |
|---|---|
| Wrong auto-merge silently destroys a commitment | Hard vetoes on owner/recipient/status; bias toward splitting; ask in the ambiguous band |
| Reminders fire at invented times | Deterministic parsing only; three-tier time model; resolved time echoed to the user |
| Prompt injection via ingested screenshot/PDF | Ingested content is data, never instructions; it cannot authorise a tool call |
| Per-message LLM cost unbounded (§22: *every* message triggers extraction) | Measure from Phase 2; cost per message is a tracked budget, not an afterthought |
| Dynamic entity types used to shadow or corrupt core tables | Reserved names, capped counts, schema validation, every definition logged and reversible |
| Assistant drifts into life-coach behaviour | Explicit negative evals — §4 violations are test failures, not style notes |

---

## Open questions (do not block starting Phase 0)

1. **Who has ADMIN on `batoredev/OurGlass`?** Branch protection and the security toggles are
   blocked without them. Everything else proceeds regardless — this gates step 7, not the build.
2. **Model tier for extraction.** Opus asks for missing parameters; Sonnet may infer them.
   Spec §27 demands "never guess when guessing can cause a meaningful mistake" — a documented
   behavioural difference with a real cost delta. *Recommend Opus for extraction, a cheaper
   tier for response generation.*
3. **Timezone scope.** Single-timezone team, or multi-timezone from day one? Changes the schema.
4. **Cost budget per message.** Unstated in the spec, and §22 means *every* message triggers
   extraction.
5. **Branch protection with 1 required approval on a solo repo** locks the owner out of merging
   their own PRs unless a `bypass_actors` entry is added. Their call.

---

## Immediate next steps (Phase 0)

Run in the lead session, sequentially — no team needed to scaffold a repo.

1. **Write the execution docs into the project** (your request — they live in the repo, not
   only in the plans folder):
   - `docs/EXECUTION-PLAN.md` — this plan
   - `docs/SPEC.md` — the extracted spec text, now readable and diffable instead of locked in
     a PDF
   - `docs/DECISIONS.md` — the locked decisions and the research findings that drove them
   - `docs/PHASES.md` — the phase checklist with per-feature definition of done
2. `git remote add origin https://github.com/batoredev/OurGlass.git`, rename `master` → `main`,
   push and set it as the default branch.
3. Scaffold the pnpm monorepo — `apps/web`, `apps/api`, `packages/shared`, `packages/db`,
   `packages/evals` — plus `docker-compose.yml` on `pgvector/pgvector:0.8.6-pg17-trixie`,
   `.env.example`, `tsconfig` base, linting.
4. Add the four workflows with the verified action versions above, plus `dependabot.yml`
   (`package-ecosystem: "npm"`) and `codeql.yml` (`javascript-typescript`).
5. Push, **let CI run green once** so the check contexts exist — required checks cannot be
   configured before they have reported.
6. Run `/graphify` to establish the baseline graph; commit `graphify-out/`.
7. **Hand the owner** the ruleset `gh api` call and the settings checklist (secret scanning,
   push protection, Dependabot alerts). Blocked on them, not on us — everything else ships.
8. Start Phase 1 with the first Mission 4 agent team.
