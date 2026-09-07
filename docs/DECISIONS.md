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

## Open questions (do not block Phase 0)

1. Who has ADMIN on `batoredev/OurGlass`? Needed for branch protection and repo security
   toggles.
2. Model tier for the extraction stage — Opus asks for missing parameters, Sonnet may infer
   them; spec §27 favors the model that asks. Recommend Opus for extraction, a cheaper tier for
   response generation.
3. Timezone scope — single-timezone team assumed; multi-timezone changes the schema.
4. Cost budget per message — unstated in the spec, and spec §22 means every message triggers
   extraction.
5. Branch protection with 1 required approval on a solo-maintainer repo needs a `bypass_actors`
   decision from the owner, or they cannot merge their own PRs.

See `docs/EXECUTION-PLAN.md` for the full plan and `docs/PHASES.md` for the phase checklist.
