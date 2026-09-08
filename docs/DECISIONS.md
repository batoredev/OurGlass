# Decisions and research findings

This records the locked decisions behind `docs/EXECUTION-PLAN.md` and the research that drove
them, so a future contributor does not have to re-derive or re-litigate them. Importers:
none — this is a reference document read by contributors and agents before touching the
schema, the tool layer, or CI config.

## Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Repo visibility | Public | User's explicit choice, hardened with secret scanning + push protection and zero real names in fixtures |
| Stack | TypeScript end-to-end (Next.js + Node/TS API + Postgres/pgvector + Anthropic SDK, pnpm monorepo) | One language, shared commitment/entity types between UI and API, simplest CI |
| Scope | Full spec, all 38 sections, phased | User's explicit choice |
| LLM ↔ DB | Full write power through typed, validated tools; no raw SQL generation | Spec §37 plus the user's requirement that every operation be reachable by command |
| Dynamic entities | LLM may define new entity types at runtime; frontend renders them with no code change | User's explicit requirement |
| Confirmations | Act immediately on internal state, undo available; external actions confirm | Spec §27 (no confirmation fatigue) plus spec §35 (external actions are higher risk) |
| UI priority | Last; bare inspection surfaces for testing only | User's explicit priority |
| Execution unit | Agent teams always, never subagents | User's explicit standing instruction |
| Knowledge graph | `/graphify --update` after every feature | User's explicit standing instruction |

## Research findings that changed the design

Two `research-analyst` investigations (memory/extraction architecture; GitHub Actions/stack)
were run from primary sources before implementation. Findings that altered the plan rather than
confirmed it:

1. **`confidence: 0.97` (spec §37) cannot be schema-enforced.** Anthropic structured outputs
   support no `minimum`/`maximum` on numbers. Use spec §12's own `CONFIRMED` / `INFERRED` /
   `UNCERTAIN` enum instead.
2. **Recursive schemas are unsupported** by Anthropic structured outputs. The conditional-
   workflow representation in spec §25 must be flattened to a fixed depth, not a recursive AST.
3. **Spec §18 conflates two different things.** "in two hours" is a timestamp; "before the
   meeting" and "after Arun replies" are event triggers with no timestamp until another entity
   resolves. Split into three tiers: deterministic time (parsed library-side), relational time
   (resolved later against another entity), and event trigger (goes to the conditional-rule
   engine, not the reminder table).
4. **The LLM must not compute timestamps.** Date arithmetic across DST is exactly the "would
   produce a different result each run" case that belongs in a script. The LLM extracts the
   verbatim phrase (`"next Friday"`); `chrono-node` (2.10.1, MIT) resolves it deterministically
   from `(text, instant, timezone)`.
5. **Vendor memory-system benchmarks are actively disputed** (Zep and Mem0 publicly contradict
   each other's published numbers). Decision: borrow the bitemporal design — four timestamps,
   invalidate-never-delete — and implement it directly in Postgres rather than adopting
   Graphiti/Zep/Mem0/Letta as a dependency. Graphiti's default backend is Neo4j, which would add
   a second datastore for no capability that cannot be written in a migration.
6. **Entity-resolution: never a single cosine cutoff, never transitive closure.** A published
   benchmark showed adding transitive closure collapsed Pair-F1 from 0.540 to 0.000 on one
   dataset — "one false-positive link can silently merge unrelated entities." Hard vetoes
   (never merge across differing owner/recipient, or completed-vs-pending) raised cluster
   purity from 51.6% to 84.4% in the same research. Decision: three-band similarity policy
   (reject / ask / auto-merge) with domain vetoes, not a single threshold.
7. **One Postgres instance is correct at this scale.** pgvector 0.8.6 with HNSW indexing and
   `hnsw.iterative_scan` enabled (queries here are almost always filtered — "what does Barkha
   owe me"). The deciding argument is transactional consistency: a separate vector database
   would let an embedding write succeed while the corresponding commitment write fails.
8. **Parallel tool-use footgun (Anthropic docs, verified):** all `tool_result` blocks for one
   turn must be in a single user message. Splitting them across messages teaches the model to
   stop making parallel calls, which would silently degrade multi-intent extraction (spec §5).
9. **Unresolved conflict in the spec, resolved for this build.** §23 (avoid duplicates) implies
   a wrong split is worse; §7 (ownership matters) implies a wrong merge is worse. These cannot
   both be optimized by the same threshold. Decision: a wrong merge is worse — it silently
   destroys a commitment, while a duplicate is visible and correctable by saying "those are the
   same thing." Bias toward splitting in the ambiguous band; ask rather than guess.

## GitHub / CI findings (verified against live registries, not recalled)

- We hold **WRITE**, not **ADMIN**, on `batoredev/OurGlass` — confirmed via
  `gh api repos/batoredev/OurGlass --jq .permissions`. Branch protection, rulesets, and repo
  security toggles must be applied by the repo owner.
- The repo had **zero branches** at Phase 0 start. Required-status-check configuration needs a
  check to have reported at least once, so the order is forced: push → CI green once → owner
  applies protection.
- Verified current versions (registry-checked, not memory): `actions/checkout` v7.0.1,
  `actions/setup-node` v7.0.0, `actions/cache` v6.1.0, `actions/upload-artifact` v7.0.1
  (`download-artifact` is v8 — majors are not in lockstep), `pnpm/action-setup` v6.1.0,
  `github/codeql-action` v4, pgvector 0.8.6, `chrono-node` 2.10.1.
- Dependabot's ecosystem value for a pnpm project is `"npm"`, not `"pnpm"`.
- CodeQL's TypeScript+JavaScript language identifier is `javascript-typescript` (one entry
  covers both).
- `actions/checkout` v7 blocks fork-PR checkout by default under `pull_request_target` — we
  never use `pull_request_target`, so this does not apply, but it is why we never will.
- Chose TypeScript 6.0.3 over 7.x (a two-month-old full Go-port rewrite with unverified
  `ts-eslint` compatibility) and Vitest 4.1.11 over 5.0.0 (released four days before this
  decision) for stability on a greenfield repo that has no migration cost either way later.
- Chose pnpm workspaces alone over Turborepo/Nx at this package count (3–5 packages);
  `pnpm -r --filter` covers the task graph, and the expensive cache (install) comes from
  `setup-node`'s `cache: pnpm`, which is a different cache from Turborepo's remote cache.
  Revisit only if package count or CI wall-time grows.
- **ESLint 9.39.5, not 10.x — discovered during Phase 0 install, not in the original
  research.** `eslint-config-next@16.3.4` itself declares `eslint: >=9.0.0` (ESLint 10
  compatible), but its transitive dependency `eslint-plugin-import@2.32.0` caps its own peer
  range at `^9`, so ESLint 10 with Next.js's config throws a peer-dependency conflict
  (verified via `pnpm install` and `npm view eslint-plugin-import@2.32.0 peerDependencies`).
  ESLint 9.39.5 is the latest 9.x and satisfies every plugin. Revisit once
  `eslint-plugin-import` (or Next.js dropping it) supports ESLint 10.
- **`next lint` does not exist in Next.js 16 — discovered running `pnpm lint`, not in
  research.** `next --help` no longer lists `lint` as a subcommand. `eslint-config-next`'s
  default export is already a native flat-config array (it includes TypeScript handling too),
  so `apps/web/eslint.config.mjs` spreads it directly via plain `eslint .`. Do not wrap it in
  `@eslint/eslintrc`'s `FlatCompat` — that throws `Converting circular structure to JSON`
  against this package's `eslint-plugin-react` config (verified while wiring this up);
  `FlatCompat` expects a legacy `.eslintrc`-shaped config, not an already-flat array.
- **`pnpm/action-setup@v6`'s `version:` input conflicts with `package.json`'s
  `"packageManager"` field — discovered from a failed CI run, not research.** Setting both
  throws `Error: Multiple versions of pnpm specified`. Fix: omit `version:` entirely in every
  workflow; the action reads it from `packageManager`.
- **Dependabot's first PR proposed exactly the four majors we pinned below latest**
  (TypeScript 7, ESLint 10 x2, Vitest 5) — expected, since Dependabot has no notion of our
  stability rationale. Closed that PR and added `ignore: [... semver-major]` entries for
  `typescript`, `eslint`, `@eslint/js`, `vitest` in `.github/dependabot.yml` so it still
  proposes patch/minor security fixes on the pinned line without re-litigating the major
  bump every week. Revisit the ignores when the plan's "TS 7 as a measured spike" and
  "Vitest 5" follow-ups actually happen.

## Phase 1 decisions (Mission 1 four-lens review — full design in `docs/PHASE-1-DESIGN.md`)

A 4-teammate review (`ceo`, `design`, `dx`, `arch`) ran before any Phase 1 code was written.
Verdict: APPROVE WITH CHANGES. Full schema, tool-registry design, and reasoning in
`docs/PHASE-1-DESIGN.md` — this is the compressed decision log.

1. **Migration tooling: `node-pg-migrate` + numbered forward-only SQL files.** Verified
   `node-pg-migrate@9.0.0`, MIT, peer `pg >=4.3.0 <9.0.0` (compatible with `pg ^8.13.0` already
   in `packages/db`, no second driver). Chosen over a schema-first generator because this
   product's schema is unusual exactly where a generator would fight it (bitemporal columns,
   `hnsw.iterative_scan`, JSONB validated against a runtime registry). No down-migrations for
   raw SQL — `db:reset` is the rollback model for a greenfield repo with no production data.
2. **`due_soon`/`overdue` are computed in a view, never stored.** A scheduled job writing
   status would either let undo reverse a clock tick, or leave `action_log` incomplete history
   with no actor. `commitment_status` enum is nine values, not eleven.
3. **Merge (`merge_person`, and the same operation on organizations and projects) is purely
   non-destructive.** Sets the loser's `t_invalid` + `merged_into_id`; repoints no FKs, rewrites
   no JSONB. **Two distinct read shapes, not one, on all three mergeable tables:**
   list/enumerate uses each table's `*_current` view (merged rows correctly absent);
   dereference-by-id uses `resolve_merged(tbl, uuid)`, one shared cycle-guarded function
   (raises past 16 hops rather than looping — merges are undoable/redoable, which is exactly how
   a cycle gets created by accident) that every table wraps (`resolve_person`, etc.). Two
   earlier drafts of this decision were wrong in the same way, caught only by reading the
   finished artifact against its own claims rather than trusting a summary of it: first, "reads
   resolve through `merged_into_id` via a `*_current` view" — `*_current` *filters out* merged
   rows rather than resolving through them, which would have reproduced the dangling-reference
   bug the pointer exists to prevent; second, generalizing that fix to `merge_person` only,
   which silently left organizations and projects with the identical unresolved bug one
   paragraph later. Both corrected before any schema code was written. This is what makes merge
   honestly `invertibility='full'` — the lossy alternative (`UPDATE ... SET owner_id = winner`)
   has no cheap inverse, and per finding #9 a wrong merge
   is the worst failure mode in the system.
4. **`action_log`'s grain is the conversational turn, not the row mutation.** `turn_id` + `seq`
   per entry. Undo is transactional at turn grain (all inverses in one transaction, descending
   `seq`), append-only (writes new rows with `undoes_turn_id`, never mutates/deletes), once-only
   (enforced by a partial unique index, not a check-then-act race), and traverses only
   `actor_kind='user_turn'` (scheduled writes are never undoable). Driven by the Phase 2 demo
   utterance itself producing one turn with two mutations (a commitment and a reminder).
5. **Tool inputs take resolved UUIDs for entity references; content fields stay raw strings.**
   `create_commitment` naming an unknown person **fails** rather than auto-creating — the
   inverse of an auto-create is ambiguous (cascade-delete the person, or not?). Resolve creates
   the person first, same `turn_id`, so undo reverses the pair.
6. **`field_kind` is a closed six-value enum** (`text`, `number`, `bool`, `date`, `enum`,
   `person_ref`), never open JSON Schema stored on disk — JSON Schema is generated from the
   registry for the model's tool input, not what's persisted. `define_entity_type` rejects an
   unknown kind at validation time with a clean error, not at Phase 5 render time.
   `add_entity_field` is non-breaking: optional-only, absent keys render as an em-dash, no
   backfill. Caps: 32 fields per type, 64 types. This is what makes "a new entity type requires
   zero frontend code changes, always" true without qualification — the LLM can invent types
   freely; it cannot invent field kinds.
7. **`pg_cron` is absent from `pgvector/pgvector:pg17`** (verified from the image's Dockerfile
   source — plain `postgres` + pgvector compiled in, nothing else). `EXECUTION-PLAN.md`'s and
   `PHASES.md`'s mentions of `pg_cron` are corrected below to an open Phase 3 decision.
   Building a custom image is more expensive than it looks: GitHub Actions `services:` accepts
   only a pre-built `image:`, not a `build:`, so a custom image needs a GHCR publish step —
   infra we can't fully control without ADMIN. Recommended default: an in-process poller
   (`SELECT ... FOR UPDATE SKIP LOCKED` on `reminders`, injectable clock, same idempotency
   requirement `pg_cron` would need anyway). Decide formally in Phase 3.
8. **The `ci.yml:71` explicit `CREATE EXTENSION vector` step's deletion is atomic with
   migration 001 landing — same commit, not a follow-up cleanup.** Deleting it earlier turns CI
   red for a reason unrelated to whatever change is under review (the extension is gone with
   nothing yet replacing it); deleting it later leaves a window where both mechanisms create the
   extension (harmless under `IF NOT EXISTS`, but it's the two-mechanisms state this decision
   exists to remove).
9. **`README.md` did not exist and was unowned** — root `SETUP.md` is the Company Claude OS
   install guide, not documentation for this product. Lead-owned, written before the Phase 1
   build team spawns. Phase 1's definition of done gains the clause: *"a fresh clone with no
   pre-set environment variables reaches this phase's demo using only the commands in
   README.md."*

**Correction to earlier plan text:** `EXECUTION-PLAN.md`'s "Dynamic entity types" section
overstated its own provenance — it read as spec-derived. Verified twice, independently, by
grep of `docs/SPEC.md` and `docs/SPEC-raw.txt`: dynamic entity types appear in **zero** of the
38 spec sections. It is a user requirement from this build's design conversation, not the spec.
User confirmed (asked directly): the schema-builder capability is wanted as designed — kept as
Phase 1 scope, now correctly labelled as an owner addition rather than spec-derived.

## Phase 1 build findings (Mission 4: `database-data-engineer` + `backend-lead` + `staff-code-reviewer`)

Three teammates working in parallel — `schema`, `api`, and a read-only `reviewer` — built and
cross-checked Phase 1 against `docs/PHASE-1-DESIGN.md`. All four typecheck/lint/test/build
gates are green locally. Real bugs the review process caught before they mattered, all in code
whose lossy path was unreachable from any current caller — worth carrying into Phase 2/3, since
new callers make exactly these paths reachable:

1. **Migrations live at `packages/db/migrations/**`, not repo-root `migrations/**`** as
   `docs/EXECUTION-PLAN.md` originally stated. Co-locating with `node-pg-migrate` and its config
   is the conventional layout for this tool; still entirely inside `database-data-engineer`'s
   one owned glob (`packages/db/**`). `docs/PHASE-1-DESIGN.md` §7 corrected to match.
2. **`node-pg-migrate@9` has no default export.** `import runner from "node-pg-migrate"`
   resolves to `undefined` and fails only at call time — caught by inspection
   (`Object.keys` on the installed module), not by a type error.
3. **`USING ERRCODE = 'invalid_recursion'` is not a documented Postgres condition name.**
   An unrecognized name fails `CREATE FUNCTION` itself. Replaced with the literal SQLSTATE
   `'P0001'` in the cycle-guard `resolve_merged` raises.
4. **The merge-inverse was silently lossy on a re-merge — the most serious finding.**
   `mergePerson`/`mergeOrganization`/`mergeProject` originally used `RETURNING *` on the UPDATE,
   which yields post-update state, so the captured "previous" pointer was already the *new*
   value — undoing a second merge (A→B, then A→C) would have restored `NULL` instead of B. Per
   `DECISIONS.md` #6/#9, a wrong merge inverse is the worst failure mode in this system. Fixed
   with a self-join capturing `prev_merged_into_id`/`prev_t_invalid` in the same statement, and
   `unmerge*` now takes both captured values as explicit parameters rather than defaulting them
   — a default would silently un-merge a chain instead of restoring one link.
5. **`invalidateCommitment`/`invalidatePerson` overwrote an already-set `t_invalid` with
   `now()`**, destroying the recorded moment a fact actually stopped being true — a correctness
   bug in the bitemporal design's own core promise (§2.1). Fixed to
   `COALESCE($2::timestamptz, t_invalid, now())`, which preserves an existing invalidation while
   still letting an explicit correction timestamp win. Note the asymmetry with `merge_person`'s
   own timestamp columns, which correctly overwrite unconditionally — the two functions do
   opposite things for a reason specific to each, annotated at both call sites so a later
   "consistency fix" doesn't reintroduce either bug.
6. **The `toThrow` false alarm.** A reviewer initially reported vitest 4.1.11's `toThrow`
   broken for regex/string matchers repo-wide. Root cause: the reviewer's isolating probe held
   the same (buggy) error-message string constant across all three matcher-form variants it
   tested, so it read "one string bug reproduced three ways" as "three independent matcher
   failures." Retracted after a properly varied re-test. No vitest issue exists; kept here as a
   reminder that varying the wrong variable in an isolation test manufactures false generality.
7. **CI gap from the `ci.yml:71` deletion.** Removing the explicit `CREATE EXTENSION vector`
   step (per decision #8 above) left nothing running migrations in CI. Fixed: `pnpm db:migrate`
   added to the integration job, and `packages/db` gained its own `test:integration` script so
   `pnpm -r --if-present run test:integration` (also added to CI) exercises the merge-resolution
   regression suite there, not just `apps/api`'s.
8. **No SQL had executed anywhere in this build** — until the first push to CI. The prediction
   in this very list held: real bugs surfaced only once a live Postgres actually ran the SQL,
   confirming the "static evidence only" gap was real rather than defensive hedging. Two CI-only
   failures, both fixed the same day:
   - **`CREATE UNIQUE INDEX ... DEFERRABLE INITIALLY DEFERRED` is not valid Postgres syntax** —
     `DEFERRABLE` is a constraint property, not an index option. `entity_type_fields`'s
     ordinal-uniqueness check moved to `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (...)
     DEFERRABLE INITIALLY DEFERRED`, which achieves the identical deferred-uniqueness guarantee
     the correct way. Nothing else in the six migrations used this pattern.
   - **`apps/api` depends on `@ourglass/db`, but root `build:libs` only built
     `@ourglass/shared`.** Passed locally only because a stale `packages/db/dist/` from earlier
     manual builds masked it — exactly the class of false-green the team's own root-drift
     concerns were about, just one level up the dependency graph. Fixed:
     `build:libs` now builds both `@ourglass/shared` and `@ourglass/db`.

   CI's own Postgres+pgvector service container is what caught the first bug; nothing short of
   a real database execution would have. **Lesson for every future migration: a migration that
   only ever ran through this team's own reading is not verified — schedule the first real run
   against CI (or a working local Postgres) before calling a schema phase done, and expect a
   syntax-level surprise even after thorough review.**

## Open questions (do not block Phase 1)

1. Who has ADMIN on `batoredev/OurGlass`? Needed for branch protection and repo security
   toggles.
2. Model tier for the extraction stage — Opus asks for missing parameters, Sonnet may infer
   them; spec §27 favors the model that asks. Recommend Opus for extraction, a cheaper tier for
   response generation.
3. ~~Timezone scope~~ — **resolved, not blocking.** `timestamptz` everywhere plus
   `users.timezone` (default `Asia/Kolkata`) makes the schema indifferent to single- vs
   multi-timezone; that becomes a Phase 2 behaviour question, not a migration.
4. Cost budget per message — unstated in the spec, and spec §22 means every message triggers
   extraction.
5. Branch protection with 1 required approval on a solo-maintainer repo needs a `bypass_actors`
   decision from the owner, or they cannot merge their own PRs.
6. `due_soon`'s 2-hour threshold (`docs/PHASE-1-DESIGN.md` §2.4) is a placeholder — product
   judgement, not architecture. The spec's own narrative implies "soon" should key off the
   commitment's own reminder rather than a global constant. Not a Phase 1 blocker.

See `docs/EXECUTION-PLAN.md` for the full plan and `docs/PHASES.md` for the phase checklist.
