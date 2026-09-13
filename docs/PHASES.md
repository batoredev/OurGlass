# Phase checklist

Tracking checklist for `docs/EXECUTION-PLAN.md`. No importers — read by contributors and
agents at the start of each phase to confirm scope and definition of done. Update the checkbox
and add the completion date/commit as each phase lands.

## Definition of done (every feature, every phase)

1. `pnpm typecheck && pnpm lint && pnpm test` green.
2. `/review` clean (run solo, in the lead, after all teammates shut down).
3. `/graphify --update` run; `graphify-out/GRAPH_REPORT.md` reviewed for God Nodes and
   Surprising Connections.
4. Findings from step 3 acted on or logged for the next Mission 1 plan review.
5. Committed and pushed.

## Phases

- [x] **Phase 0 — Foundation** *(lead session, sequential, no team)*
  Repo wired to `batoredev/OurGlass`; pnpm monorepo scaffolded; Postgres+pgvector via Docker
  Compose; GitHub Actions CI; execution docs committed to `docs/`.
  Demo: CI green on an empty-but-typechecked monorepo.

- [x] **Phase 1 — Structured state + validated tool layer** *(Mission 4 team: `database-data-engineer` + `backend-lead` + `staff-code-reviewer`, read-only. No `frontend-lead`, no `ai-agent-engineer`, no browser owner — see `docs/PHASE-1-DESIGN.md` §7.)* — **done, verified in CI**
  Full design, schema, and reasoning: **`docs/PHASE-1-DESIGN.md`** (Mission 1 four-lens review
  output). Nine tables with bitemporal columns; `entity_types`/`entity_type_fields`/
  `entity_records` registry; typed tool registry with validate → commit-in-transaction →
  log → undo, grained at the conversational turn. `node-pg-migrate` + numbered forward-only
  SQL. No LLM yet — tools are driven by tests.
  Definition of done adds two commands beyond the usual `pnpm typecheck/lint/test`:
  `pnpm db:migrate && pnpm --filter @ourglass/api test:integration`, plus: *a fresh clone with
  no pre-set environment variables reaches this phase's demo using only the commands in
  README.md.*
  Demo: `create_commitment` round-trips ownership direction structurally (spec §7), an unknown
  person is rejected with zero partial writes, a two-mutation turn (commitment + reminder)
  undoes as one unit, and a second "undo that" is refused by a DB constraint, not a check.
  **Verified against a live Postgres 17 + pgvector in CI** (not just locally): all 6 migrations
  applied cleanly, `packages/db` 12/12 integration tests passed (merge/resolve regression
  suite), `apps/api` 6/6 integration tests passed (`create_commitment` + undo). Took three CI
  pushes to get there — two real SQL/config bugs and two CI-job-isolation bugs, all recorded in
  `docs/DECISIONS.md`'s Phase 1 findings, none caught by local review alone. That gap was
  predicted by the team's own risk assessment and is exactly why this phase's gate required a
  live run before being called done.

- [x] **Phase 2 — Interpret + Resolve** *(Mission 4 team)* — **done, verified in CI**
  Structured-output extraction into the spec §5 intent taxonomy with `inference_level` per
  intent. `chrono-node` time resolution, three-tier split. Entity resolution, three-band
  policy with hard vetoes. Duplicate detection (§23). Eval harness (`packages/evals/`) built
  here, not deferred. Design: `docs/PHASE-2-DESIGN.md`.
  Demo: "Barkha needs to give me the article by 6. Remind me at 5 to ask her." produces one
  commitment and one reminder, correctly owned and correctly timed.
  **A read-only staff review found 11 issues — 3 confirmed blockers — while all 8 of the
  original unit tests passed.** That is `PHASE-1-DESIGN.md` §4.3's warning happening in
  practice, and it is the strongest argument in this repo for the independent-review gate:
  (1) `resolvePersonMention` auto-resolved "Arun" to one of two Aruns because the exact-match
  query *replaced* rather than joined the fuzzy candidates — the wrong-merge direction
  `DECISIONS.md` #9 names as the worst failure in the system, and the existing test passed
  only because it bypassed the broken function; (2) a DST bug in the very code written to
  prevent DST bugs, latent only because `Asia/Kolkata` has no DST; (3) `forwardDate: true`
  dated past-tense completions into the future — spec §5's own completion example resolved
  to *tomorrow*, and §20 computes lateness against it.
  Verified in CI against live Postgres: `apps/api` integration went 6 → 11 tests, the 5 new
  ones being the two-Aruns regression suite executing for the first time. 104 tests green
  locally; typecheck, lint, and full build clean.
  **The eval harness was rebuilt because the first one was hollow** — its fixture test
  compared a value to itself, and its comparator treated a *fully reversed* owner/recipient
  as a match. Now 69 hand-labelled fixtures and a comparator verified by mutation (reverting
  it to the old logic fails 11 tests; restoring passes 37).
  **Standing caveat:** none of this says anything about model behaviour. There is no recorded
  model output in the repo. Only `pnpm test:live` (paid, manual, 69 calls) speaks to whether
  Sonnet actually extracts correctly — and it has never been run.

- [x] **Phase 3 — Conversational loop + reminders** *(Mission 4 team)* — **built, verified in CI**
  Full four-stage orchestrator (Interpret → Resolve → Mutate → Respond). Reminder firing is
  an **in-process poller** — `pg_cron` is absent from `pgvector/pgvector:pg17` (verified from
  the image's Dockerfile) and the custom-image path needs GHCR publish rights we do not hold.
  Conditional rules (§25), flattened, evaluated against live state at the deadline.
  Completion updates and late-completion context (§20, §21). Concise response style (§30, §31).

  All 11 tasks of `PHASE-3-DESIGN.md` §10's build order are done. **93 integration tests pass
  against live Postgres 17 + pgvector in CI** (56 in `packages/db`, 37 in `apps/api`), plus
  147 unit tests. Migrations 007, 008 and 009 applied cleanly on the first run — the first
  schema phase here without a syntax-level surprise, though the phase found three other
  defects instead.

  **Three defects this phase found in its own work, none visible to a green local suite:**

  1. **F6 — `complete_commitment` and `update_commitment` were written, typechecked and
     unit-tested while absent from `buildToolRegistry`.** The fifth instance of the class
     `DECISIONS.md` records as *"schema with no code path"*, in its tool-layer form. Nothing
     failed: their unit tests import them directly, and the only registry test exercised a
     Phase 1 tool. `runTurn` emits `complete_commitment` for the phase demo, so the first
     symptom would have been a runtime *unknown tool* on the one utterance Phase 3 exists to
     support. Closed permanently by `registry.coverage.test.ts`, which scans the orchestrator
     source for emitted tool names and asserts each is registered — verified by mutation, and
     it caught `attach_context` automatically two commits later with no edit to the test.
  2. **A duplicate inverse-handler registration that would have been a startup crash, not a
     test failure.** `registerInverseHandler` throws on a duplicate table key, and
     `fire_reminder` initially registered its own `reminders` handler alongside
     `create_reminder`'s. Consolidated to one handler per TABLE dispatching on patch shape —
     the pattern `create-commitment.ts` §1.3 established for `commitments`, now used for
     `reminders`, `workflows` and `commitment_notes` too.
  3. **`listRecent`'s ordering was undefined for a same-transaction batch.** `t_created`
     defaults to `now()`, which in Postgres is TRANSACTION start time, so rows inserted in one
     transaction share a byte-identical timestamp and the `id DESC` tiebreak is arbitrary. The
     test was a coin flip; it failed in CI. Fixed in the test — production writes the two
     messages in separate transactions — with the limitation now documented on `listRecent`
     and pinned by a second test.

  **`runTurn` itself had ZERO tests** until the end of the phase: every stage it wires had
  passing unit tests while the wire between them had none — `PHASE-1-DESIGN.md` §4.3's warning
  again. Now 11 integration tests covering §3.2's turn_id ordering, §3.3's partial-commit rule,
  §8's trace persistence, §2's lateness reconciliation, and §3.4's honest degradation.

  **Standing caveat, unchanged and now in `README.md` too:** there is still no recorded model
  output in this repo. `pnpm test:live` (69 paid calls, manual) has never been run. Phase 3
  adds a *second* model call (Respond), so the unmeasured surface grew. §5's mandatory template
  fallback makes a Respond failure cosmetic — a mitigation, not evidence.

  Not yet done for this phase: `/graphify --update` and the human demo run through §9's
  endpoint (needs an API key the repo does not hold).

  **Scope fixed by the Phase 3 review (`ceo3`), HOLD SCOPE mode.** Explicitly OUT: proactive
  behaviour (§26) → Phase 4, it keys off "actual relevance" which is Phase 4's retrieval layer;
  conflict detection (§24) → Phase 4; all UI (§29) → Phase 5; memory and §16/§17 correction →
  Phase 4 (§17 *looks* conversational but is a memory mutation); §28 inspection queries —
  classify the `question` intent and decline honestly rather than build lexical retrieval that
  gets thrown away; §34 `execution` → Phase 7, gated by §35.

  **Explicitly IN, because the demo sentence below is unreachable without them:**
  `complete_commitment` and `update_commitment` tools, lateness derived in the tool layer
  (never from model output), and context attachment (§20) as a note with message provenance.

  > ⚠️ **The stated demo is unimplementable as of Phase 2.** Verified against the code, not the
  > plan: `apps/api/src/tools/index.ts` registers only `create_commitment`, `create_reminder`,
  > and `define_entity_type`; `packages/db/src/repositories/commitments.ts` exports no function
  > that writes `completed_at` or transitions status. The `completed_late` enum value and the
  > `completed_at` column exist (migration 003) with **no code path reaching them**. Building
  > `complete_commitment` is therefore the first task of Phase 3, not an assumed prerequisite.
  > Its inverse must capture pre-update status and `completed_at` via the self-join pattern —
  > Phase 1 build finding #4 is exactly this bug.

  **Respond stage decision (`ceo3`):** one Haiku call, tightly constrained — no tools, no DB
  handle, so a hallucination produces a wrong sentence and never a wrong row. Templating alone
  fails the two places the spec is most insistent, both inside this phase's demo: §20's optional
  late-completion prompt (whose "don't keep asking" clause is conversational state, not string
  formatting) and §30's "Karthik from Hult?" (choosing the natural disambiguating attribute is
  judgement). A deterministic template fallback is **mandatory** — the mutation has already
  committed, so a cosmetic model failure must not 500.
  Demo: the spec's own Barkha/Hult/Arun narratives end-to-end, including "Barkha gave the
  article at 11" correctly producing `completed_late` with a 5-hour delay.

- [x] **Phase 4 — Understanding over time** *(Mission 4 team)* — **all 8 tasks built, CI-verified;
  demo NOT runnable (see below)**
  Semantic memory, hybrid retrieval (HNSW + BM25). Memory provenance and conversational
  correction (§16, §17). Conflict detection (§24). Proactive behaviour with a relevance gate
  (§26). Inspection queries (§28). Design: `docs/PHASE-4-DESIGN.md`.

  **118 integration tests** against live Postgres 17 + pgvector, **176 unit tests**, migration 010
  applied cleanly on the first run.

  **Five prerequisites were schema-only when the phase opened** (F7–F11, `DECISIONS.md`), which is
  why the design doc was written before any code: `object_embedding` had existed since migration
  003 with nothing ever writing to it; no embedding provider had been chosen, so `vector(1024)` was
  a guess (correct — Voyage's default — by luck, not derivation); `relationships` had a table,
  indexes, a view and a comment describing §17 correction, and no repository; `memories` did not
  exist; and every §28 example in the spec turned out to be a *structured* query, not semantic
  search. `events` was found to be a sixth instance mid-build.

  **The retrieval test was proven decorative by mutation, and the design was wrong about why.**
  A probe removing `SET LOCAL hnsw.iterative_scan` left CI green; a second probe asserting the plan
  used the HNSW index *failed*, because for a filter this selective Postgres picks the B-tree on
  subject and sorts. Recall is correct today because of the **planner**, not the setting. Recorded
  in `DECISIONS.md` as a second defect class — *a citation is not a verification*: §2.1 quoted
  pgvector's README accurately and applied it to a query shape nobody had run. The suite now
  records the actual plan, asserts full recall, and separately **forces** the HNSW path, which is
  the only honest demonstration of the setting's value at this fixture size.

  > ⚠️ **THE DEMO DOES NOT RUN.** Verified against the code, not assumed. Two gaps, both the
  > "schema with no code path" class recurring inside this phase's own work:
  > **(1)** `events.createEvent` exists and **no tool calls it**, so there is never a Hult meeting
  > to conflict with. **(2)** `detectTimeConflicts` and `selectProactiveLine` are **never called by
  > the orchestrator** — both are unit-tested in isolation and unreachable from a turn.
  > *"Schedule Arun at 5 tomorrow"* therefore surfaces nothing.
  >
  > Closing this out is the user's call, taken deliberately. What it costs: §24 and §26 are built
  > and tested but **not wired**, so no user-facing behaviour exists for either. Finishing needs a
  > `create_event` tool, two call sites in `runTurn`, and one end-to-end test.

  **Standing caveat, now in its third phase:** `pnpm test:live` has still never run. Phase 4 adds a
  *third* model dependency (Voyage), and unlike Sonnet and Haiku its failure mode is silent — a
  wrong `input_type` or a degraded model returns 1024 plausible floats and worse recall, with
  nothing to fail. **Retrieval quality is unmeasured.**

- [ ] **Phase 5 — Dynamic entities + minimal UI** *(Mission 4 team)*
  `entity_types` registry, schema-driven frontend rendering. Bare inspection surfaces:
  conversation view plus Today / Commitments / People / Projects / Memory / Activity as
  read-only tables (§29). Deliberately unstyled.
  Demo: "track my gym sessions with a date and a duration" creates a new type that appears in
  the UI immediately, with no deploy.

- [ ] **Phase 6 — Ingestion** *(Mission 4 team)*
  Images and documents (§32, §33). Extract and associate with people/projects/commitments.
  Interpret first, act only when appropriate. Ingested content is untrusted input.

- [ ] **Phase 7 — External integrations + permissions** *(Mission 4 team + integration specialist)*
  Permission model first (§35). Then Gmail, Calendar, Drive (§34). External actions always
  confirm.

- [ ] **Phase 8 — Voice**
  Deferred, per spec §1 ("eventually").

## Blocked / needs owner action

- [ ] Branch protection / ruleset on `main` — needs ADMIN on `batoredev/OurGlass` (we hold
  WRITE). See `docs/DECISIONS.md` open question 1.
- [ ] Confirm secret scanning, push protection, and Dependabot alerts toggle state — also
  needs ADMIN to read/confirm.
