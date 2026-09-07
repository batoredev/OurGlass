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

- [ ] **Phase 1 — Structured state + validated tool layer** *(Mission 4 team: `database-data-engineer` + `backend-lead` + `staff-code-reviewer`, read-only. No `frontend-lead`, no `ai-agent-engineer`, no browser owner — see `docs/PHASE-1-DESIGN.md` §7.)*
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

- [ ] **Phase 2 — Interpret + Resolve** *(Mission 4 team)*
  Structured-output extraction into the spec §5 intent taxonomy with `inference_level` per
  intent. `chrono-node` time resolution, three-tier split. Entity resolution, three-band
  policy with hard vetoes. Duplicate detection (§23). Eval harness (`packages/evals/`) built
  here, not deferred.
  Demo: "Barkha needs to give me the article by 6. Remind me at 5 to ask her." produces one
  commitment and one reminder, correctly owned and correctly timed.

- [ ] **Phase 3 — Conversational loop + reminders** *(Mission 4 team)*
  Full four-stage orchestrator (Interpret → Resolve → Mutate → Respond). Reminder-firing
  mechanism is an **open decision** — `pg_cron` is absent from `pgvector/pgvector:pg17`
  (verified from the image's Dockerfile); default is an in-process poller, see
  `docs/DECISIONS.md`. Conditional rules (§25), flattened, evaluated against live state.
  Completion updates and late-completion context (§20, §21). Concise response style (§30, §31).
  Demo: the spec's own Barkha/Hult/Arun narratives end-to-end, including "Barkha gave the
  article at 11" correctly producing `completed_late` with a 5-hour delay.

- [ ] **Phase 4 — Understanding over time** *(Mission 4 team)*
  Semantic memory, hybrid retrieval (HNSW + BM25). Memory provenance and conversational
  correction (§16, §17). Conflict detection (§24). Proactive behaviour with a relevance gate
  (§26). Inspection queries (§28).
  Demo: "Schedule Arun at 5 tomorrow" surfaces the Hult conflict and asks rather than choosing.

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
