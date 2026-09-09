# Graph Report - OurGlass  (2026-09-09)

## Corpus Check
- 127 files · ~90,867 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1024 nodes · 1279 edges · 91 communities (70 shown, 11 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 61 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- db client + repositories
- API contract & docs agents
- Motion & design agents
- Agent team safety rules
- apps/web app shell
- apps/api package config
- apps/api tsconfig
- Spec: core product principles
- Root package config
- Shared tool contract types
- CTO delivery lead role
- Migration 002: core entities
- Tool executor & undo
- apps/web tsconfig
- Browser QA agents
- Media production agents
- DevOps & release agents
- tsconfig.base.json
- define_entity_type tool
- Frontend/backend lead roles
- Taste & aesthetic direction
- Spec: time & resolution decisions
- Design director role
- Testing rules + CI build job
- packages/shared config
- Commitment lifecycle & status
- action_log turn grain
- AI systems rules
- Architecture rules
- Project stack & CodeQL
- Dynamic entity registry
- packages/db package config
- Tool error types
- packages/evals config
- Merge resolution & read shapes
- Code review agents
- CEO scope modes
- AI agent & integration roles
- File ownership & missions
- Planning docs hub
- create_reminder tool
- Executor unit tests
- Spec: documents & duplicates
- Spec: LLM must not write DB
- Security trust boundaries
- CI config decisions
- Mission templates
- create_commitment tool
- Tool registry
- Phase 1 build findings
- Security rules
- Agent flow & routing docs
- CI job isolation fixes
- packages/db scripts
- packages/db test tsconfig
- Production rules
- Migration 006: entity registry
- Migration runner script
- Spec: memory & inference
- Git & secrets rules
- Docker Compose Postgres
- DEFERRABLE syntax bug
- packages/db devDependencies
- tools/_template.py
- Research analyst role
- packages/db dependencies
- packages/evals devDependencies
- packages/evals scripts
- packages/shared scripts
- CREATE EXTENSION atomicity
- task-completed-gate hook
- teammate-idle-gate hook
- tool-cost-guard hook
- ESLint/Next lint pins
- Migration 005: action_log
- Ecosystem routing table
- Mission: durable quality
- Never-assume principle
- Planning pipeline
- Review pipeline
- .tmp directory notes

## God Nodes (most connected - your core abstractions)
1. `docs/SPEC.md — extracted spec text` - 42 edges
2. `compilerOptions` - 17 edges
3. `Company Claude OS v2 (root governance doc)` - 17 edges
4. `compilerOptions` - 16 edges
5. `CTO / Delivery Lead` - 16 edges
6. `QA / Browser Engineering Lead` - 15 edges
7. `Frontend Lead` - 12 edges
8. `undoTurn()` - 11 edges
9. `Engagement routing table` - 11 edges
10. `Agent Teams Rules` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Invalidate, never delete` --semantically_similar_to--> `Spec §17 — Memory correction`  [INFERRED] [semantically similar]
  docs/PHASE-1-DESIGN.md → Batore_Personal_Assistant_Spec.pdf
- `Document important irreversible decisions` --semantically_similar_to--> `docs/DECISIONS.md`  [INFERRED] [semantically similar]
  .claude/rules/architecture.md → README.md
- `CodeQL workflow` --semantically_similar_to--> `Security Rules`  [INFERRED] [semantically similar]
  .github/workflows/codeql.yml → .claude/rules/security.md
- `live job (manual workflow_dispatch only, costs tokens)` --semantically_similar_to--> `Paid calls need approval`  [INFERRED] [semantically similar]
  .github/workflows/evals.yml → .claude/rules/wat.md
- `docs/SPEC.md — extracted spec text` --references--> `Spec §5 — Information vs action (intent taxonomy)`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **File-ownership map enforced via /freeze across implementer agents** — claude_agents_04_solutions_architect_file_ownership_table, claude_agents_18_devops_sre_freeze [EXTRACTED 1.00]
- **Single browser owner constraint across QA, performance, and devex roles** — claude_agents_12_qa_browser_lead_qa_browser_lead, claude_agents_14_performance_engineer_performance_engineer, claude_agents_17_devex_engineer_devex_engineer, claude_agents_07_frontend_lead_frontend_lead [EXTRACTED 1.00]
- **Untrusted-content / prompt-injection trust boundary discipline across roles** — claude_agents_10_ai_agent_engineer_prompt_injection_trust_boundary, claude_agents_13_security_cso_prompt_injection_lens, claude_agents_12_qa_browser_lead_untrusted_page_content, claude_agents_11_integration_engineer_webhook_untrusted_principle [INFERRED 0.85]
- **Frontend polish/QA specialist trio (motion, taste, visual critique)** — claude_agents_23_motion_engineer_motion_engineer, claude_agents_24_taste_director_taste_director, claude_agents_33_visual_critic_visual_critic [INFERRED 0.85]
- **Read-only/deterministic QA roles distinct from browser daemon** — claude_agents_25_web_standards_engineer_web_standards_engineer, claude_agents_26_accessibility_engineer_accessibility_engineer, claude_agents_27_e2e_automation_engineer_e2e_automation_engineer [INFERRED 0.75]
- **Security practice engagement lifecycle (lead routes to offensive/defensive/dfir)** — claude_agents_34_security_lead_security_lead, claude_agents_35_offensive_security_engineer_offensive_security_engineer, claude_agents_36_dfir_analyst_dfir_analyst, claude_agents_37_detection_engineer_detection_engineer, claude_agents_38_threat_hunter_threat_hunter [EXTRACTED 1.00]
- **Agent team safety governance pattern across .claude/rules** — claude_rules_agent_teams_agent_teams_rules, claude_rules_security_ethics_security_engagement_rules, claude_rules_routing_routing_rules, claude_rules_ai_systems_ai_systems_rules, claude_rules_architecture_architecture_rules, claude_rules_git_git_rules, claude_rules_production_production_rules, claude_rules_security_security_rules, claude_rules_testing_testing_rules, claude_rules_wat_wat_rules [INFERRED 0.85]
- **CI/eval/security workflow triad gating merges to main** — github_workflows_ci_ci_workflow, github_workflows_evals_evals_workflow, github_workflows_codeql_codeql_workflow [INFERRED 0.85]
- **OurGlass product doc triad (SPEC, EXECUTION-PLAN, DECISIONS) referenced from README and CLAUDE.md** — readme_ourglass_batore_personal_assistant, claude_md_company_claude_os_v2, readme_docs_spec_md, readme_docs_execution_plan_md, readme_docs_decisions_md [EXTRACTED 1.00]
- **Planning/execution chain: plan, decisions, phases, Phase 1 design** — docs_execution_plan, docs_decisions, docs_phases, docs_phase_1_design [EXTRACTED 1.00]
- **Merge-resolution invariant: pointer, view, resolver, cycle guard, lossy-inverse fix** — docs_phase_1_design_merged_into_id, docs_phase_1_design_people_current_view, docs_phase_1_design_resolve_person, docs_phase_1_design_resolve_merged_cycle_guard, docs_decisions_merge_inverse_lossy_on_remerge [EXTRACTED 1.00]
- **Turn-grained undo pipeline: validate, commit, log, undo** — docs_phase_1_design_validate_is_a_function, docs_phase_1_design_execute_turn, docs_phase_1_design_action_log_turn_id_grain, docs_phase_1_design_undo_turn, docs_phase_1_design_double_undo_partial_unique_index [EXTRACTED 1.00]

## Communities (91 total, 11 thin omitted)

### Community 0 - "db client + repositories"
Cohesion: 0.07
Nodes (26): createPool(), Queryable, Transactable, withTransaction(), commitments, organizations, people, projects (+18 more)

### Community 1 - "API contract & docs agents"
Cohesion: 0.05
Nodes (48): API Contract Engineer, Contract ownership (schema, versioning, breaking-change detection), /freeze schema/contract glob (first action), Publish contract before implementation starts, /document-generate skill (Diataxis structure), Every code example must run, /freeze developer docs glob (first action), Technical Writer (Developer-Facing) (+40 more)

### Community 2 - "Motion & design agents"
Cohesion: 0.05
Nodes (44): Common report format (Status/What changed/Verified/Risks/Blocked/Next action), animejs skill, Emil Kowalski reference, framer-motion skill, /freeze motion glob (first action), Motion Engineer, Motion principles (duration, easing, interruptibility, reduced-motion), motion / motion-dom / motion-utils skills (+36 more)

### Community 3 - "Agent team safety rules"
Cohesion: 0.05
Nodes (44): 46-role team structure (33 build + 11 security), Agent Teams Rules, Auto-committing skills never run in a teammate, Every implementer runs /freeze first, One browser owner per mission, Publish contracts early, qa-browser-lead default browser owner, Read-only roles have no Write or Edit (+36 more)

### Community 4 - "apps/web app shell"
Cohesion: 0.05
Nodes (33): metadata, config, nextConfig, dependencies, next, @ourglass/shared, react, react-dom (+25 more)

### Community 5 - "apps/api package config"
Cohesion: 0.06
Nodes (31): dependencies, @anthropic-ai/sdk, fastify, @ourglass/db, @ourglass/shared, pg, devDependencies, tsx (+23 more)

### Community 6 - "apps/api tsconfig"
Cohesion: 0.06
Nodes (27): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.base.json, references, compilerOptions (+19 more)

### Community 7 - "Spec: core product principles"
Cohesion: 0.07
Nodes (31): Spec §11 — Ambiguity handling, Spec §10 — Ask about people when necessary, Spec §3 — The central product principle, Spec §6 — Commitments are a core data model, Spec §21 — Completing the user's own work, Spec §25 — Conditional commitments / workflows, Spec §24 — Conflict detection, Spec §20 — Context after completion (+23 more)

### Community 8 - "Root package config"
Cohesion: 0.07
Nodes (28): description, devDependencies, eslint, @eslint/js, @types/node, typescript, typescript-eslint, vitest (+20 more)

### Community 9 - "Shared tool contract types"
Cohesion: 0.10
Nodes (21): HealthCheck, OURGLASS_SCHEMA_VERSION, ActorKind, DatabaseTransaction, err(), ExecuteTurnResult, fakeQueryResult(), Invertibility (+13 more)

### Community 10 - "CTO delivery lead role"
Cohesion: 0.09
Nodes (27): Single browser owner rule, /context-save skill, CTO / Delivery Lead, File-ownership map, /learn skill, /office-hours skill, /plan-tune skill, /qa skill (+19 more)

### Community 11 - "Migration 002: core entities"
Cohesion: 0.14
Nodes (22): it, organizations, organizations_current, people, people_current, projects, projects_current, resolve_organization() (+14 more)

### Community 12 - "Tool executor & undo"
Cohesion: 0.19
Nodes (16): makePerson(), TurnAlreadyUndoneError, ActionLogEntry, appendActionLog(), applyInverse(), Deps, executeTurn(), ExecuteTurnFailure (+8 more)

### Community 13 - "apps/web tsconfig"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, forceConsistentCasingInFileNames, incremental, isolatedModules, jsx, lib (+11 more)

### Community 14 - "Browser QA agents"
Cohesion: 0.13
Nodes (18): /autoplan skill, /benchmark skill, /browse skill, /open-gstack-browser skill, QA / Browser Engineering Lead, /qa-only skill, /scrape skill, /setup-browser-cookies skill (+10 more)

### Community 15 - "Media production agents"
Cohesion: 0.12
Nodes (18): Composition is code discipline, Freeze video glob (first action), Motion Graphics Engineer (agent), remotion-* skill family, Render is expensive and slow discipline, Brand consistency over novelty, Brand & Media Producer (agent), Cost-first generation discipline (+10 more)

### Community 16 - "DevOps & release agents"
Cohesion: 0.14
Nodes (17): DevOps / SRE, /guard skill, /land-and-deploy skill (forbidden), Documented rollback for every deploy path, /setup-deploy skill, /ship skill (forbidden), /document-release skill, /land-and-deploy skill (+9 more)

### Community 17 - "tsconfig.base.json"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib (+8 more)

### Community 18 - "define_entity_type tool"
Cohesion: 0.15
Nodes (12): DefineEntityTypeInput, DefineEntityTypeOutput, DefineEntityTypeRawInput, defineEntityTypeTool, EntityTypeRow, FieldDefInput, FieldKind, isFieldKind() (+4 more)

### Community 19 - "Frontend/backend lead roles"
Cohesion: 0.20
Nodes (14): /browse skill (forbidden), /design-review skill (forbidden), Frontend Lead, /qa skill (forbidden), Backend Lead, /benchmark skill (forbidden), /health skill, /investigate skill (Iron Law) (+6 more)

### Community 20 - "Taste & aesthetic direction"
Cohesion: 0.15
Nodes (13): Anti-slop list (kill on sight), awesome design / impeccable references, Taste Director, taste skill (variance system), ui-ux-pro-max skill (styles/palettes/pairings), Written direction (deliverable), AI-slop checklist, Review priority list (spacing, hierarchy, density, alignment, colour, ai-slop, resilience, absence) (+5 more)

### Community 21 - "Spec: time & resolution decisions"
Cohesion: 0.15
Nodes (13): Spec §5 — Information vs action (intent taxonomy), Spec §18 — Temporal understanding, Finding 4 — the LLM must not compute timestamps (chrono-node), Phase 1 decision 5 — tool inputs take resolved UUIDs, Finding 6 — three-band entity resolution with hard vetoes, Finding 3 — three-tier time split, The eval harness — packages/evals, built in Phase 2, Four-stage orchestrator: Interpret, Resolve, Mutate, Respond (+5 more)

### Community 22 - "Design director role"
Cohesion: 0.18
Nodes (13): AI-slop design patterns to avoid, /design-consultation skill, Design Director, DESIGN.md, /design-review skill (lead-only, auto-commits), /design-shotgun skill, ui-ux-pro-max skill, /design-html skill (+5 more)

### Community 23 - "Testing rules + CI build job"
Cohesion: 0.17
Nodes (13): Define success before implementing non-trivial behavior, Do not hide failing tests with skips unless justified, Add regression coverage for important bug fixes, Testing Rules, Unit / integration / E2E test layering, build job (typecheck/lint/test/build), pnpm run build:libs step, CI workflow (+5 more)

### Community 24 - "packages/shared config"
Cohesion: 0.15
Nodes (12): typescript, devDependencies, typescript, vitest, exports, vitest, main, name (+4 more)

### Community 25 - "Commitment lifecycle & status"
Cohesion: 0.21
Nodes (12): Spec §8 — Commitment lifecycle, Open questions (do not block Phase 1), Mission 6.5 — Codify (tools from repeated mechanical steps), due_soon / overdue computed in a view, never stored, due_soon 2-hour threshold placeholder, docs/WAT-AUDIT.md — WAT framework compliance audit, /skillify — the one place the pack does WAT correctly, tools/README.md — deterministic script conventions (+4 more)

### Community 26 - "action_log turn grain"
Cohesion: 0.18
Nodes (12): Spec §22 — Conversational state updates, Spec §28 — User control, Phase 1 decision 4 — action_log grain is the conversational turn, Finding 8 — parallel tool-use footgun, action_log — the undo substrate, action_log turn_id grain — the conversational turn, Double-undo impossible — partial unique index, invertibility enum (full / lossy / none) (+4 more)

### Community 27 - "AI systems rules"
Cohesion: 0.17
Nodes (12): AI Systems Rules, Cost per request is a design constraint, Degrade honestly, Guardrails are not optional on user-facing generation, Irreversible actions need an approval gate outside the model, Ships with an eval set, or does not ship, Trace everything, Evals workflow (+4 more)

### Community 28 - "Architecture rules"
Cohesion: 0.24
Nodes (11): Company Claude OS v2 (root governance doc), Remote github.com/batoredev/OurGlass — WRITE not ADMIN, Architecture Rules, Document important irreversible decisions, Explicit boundaries and simple dependencies, Treat authn/authz and trust boundaries as architecture concerns, Dependabot config, npm package-ecosystem (used for pnpm project) (+3 more)

### Community 29 - "Project stack & CodeQL"
Cohesion: 0.24
Nodes (11): Default ownership map (packages/db -> database-data-engineer, apps/api/assistant -> ai-agent-engineer, apps/web -> frontend-lead), Project: Batore Personal Assistant / OurGlass, Stack: TypeScript pnpm monorepo (apps/web, apps/api, packages/shared, packages/db, packages/evals), analyze job (javascript-typescript), CodeQL workflow, Weekly cron per docs/EXECUTION-PLAN.md GitHub Actions section, docs/EXECUTION-PLAN.md, docs/PHASES.md (+3 more)

### Community 30 - "Dynamic entity registry"
Cohesion: 0.20
Nodes (11): Phase 1 decision 6 — field_kind is a closed six-value enum, Dynamic entity types — the user's explicit requirement, add_entity_field must be non-breaking (optional-only), define_entity_type rejects unknown field kinds at validation time, Provenance warning — dynamic entity types are an owner addition, Dynamic entity registry (entity_types / fields / records), Caps: 32 fields per type, 64 types, entity_type_fields closed field_kind enum (six kinds) (+3 more)

### Community 31 - "packages/db package config"
Cohesion: 0.20
Nodes (9): @types/pg, pg, vitest, main, name, private, type, types (+1 more)

### Community 32 - "Tool error types"
Cohesion: 0.20
Nodes (5): NotInvertibleError, PG_UNIQUE_VIOLATION, ToolNotFoundError, TurnNotFoundError, ValidationFailedError

### Community 33 - "packages/evals config"
Cohesion: 0.20
Nodes (9): @ourglass/shared, @types/node, dependencies, @ourglass/shared, vitest, name, private, type (+1 more)

### Community 34 - "Merge resolution & read shapes"
Cohesion: 0.22
Nodes (10): Spec §29 — The primary UI (inspection surfaces), Build finding 3 — invalid_recursion is not a Postgres condition name, Phase 1 decision 3 — merge non-destructive, two read shapes, Undo traverses only actor_kind='user_turn', people_current view (filters, does not resolve), Repository discipline — raw people access in one file, resolve_merged cycle guard (16-hop depth cap), resolve_person(uuid) dereference function (+2 more)

### Community 35 - "Code review agents"
Cohesion: 0.20
Nodes (10): /review skill, /codex skill, Fix-First auto-apply behaviour, Greptile PR-comment triage, Staff Code Reviewer, Three-bucket report format (auto-fix / decision / completeness gap), Adversarial / Second-Model Reviewer, Codex CLI installed/authenticated hard requirement (+2 more)

### Community 36 - "CEO scope modes"
Cohesion: 0.20
Nodes (10): HOLD SCOPE mode, Margin rule (scope expansion destroys margin on fixed-price work), /plan-ceo-review skill, SCOPE EXPANSION mode, SCOPE REDUCTION mode, SELECTIVE EXPANSION mode, Observable/falsifiable acceptance criteria, Business Analyst / Spec Author (+2 more)

### Community 37 - "AI agent & integration roles"
Cohesion: 0.20
Nodes (10): AI / Agent Engineer, Cost-per-request design constraint, Eval set required before shipping AI feature, /investigate skill, /review skill (forbidden), Integration Engineer, Explicit partial-failure handling, Default owner of tools/ (+2 more)

### Community 38 - "File ownership & missions"
Cohesion: 0.20
Nodes (10): Agent teams operating guide (PDF), Build finding 1 — migrations live at packages/db/migrations, Agent-team execution model (teams, never subagents), Mission 4 — Cross-layer feature build, Phase 1 file-ownership map, No browser owner in Phase 1, docs/SKILL-COVERAGE.md — gstack skill coverage audit, Lead-only skills — deliberately not given to teammates (+2 more)

### Community 39 - "Planning docs hub"
Cohesion: 0.29
Nodes (10): docs/DECISIONS.md — decisions and research findings, Build finding 2 — node-pg-migrate@9 has no default export, Phase 1 decision 7 — pg_cron absent from the image, Phase 1 decisions (Mission 1 four-lens review), docs/EXECUTION-PLAN.md — Batore execution plan, Phase 1 design — structured state + validated tool layer, node-pg-migrate + numbered forward-only SQL files, pg_cron is not in pgvector/pgvector:pg17 (+2 more)

### Community 40 - "create_reminder tool"
Cohesion: 0.25
Nodes (7): CreateReminderInput, CreateReminderOutput, CreateReminderRawInput, createReminderTool, isUuid(), ReminderRow, validate()

### Community 41 - "Executor unit tests"
Cohesion: 0.28
Nodes (5): FakeRow, handlers, InverseHandler, registerInverseHandler(), __resetInverseHandlersForTests()

### Community 42 - "Spec: documents & duplicates"
Cohesion: 0.25
Nodes (9): Spec §33 — Documents, Spec §23 — Duplicate detection, Spec §32 — Image input, Build finding 4 — merge inverse silently lossy on a re-merge, Finding 9 — a wrong merge is worse than a wrong split, Risk register, merge_person is purely non-destructive, merged_into_id forwarding pointer (+1 more)

### Community 43 - "Spec: LLM must not write DB"
Cohesion: 0.22
Nodes (9): Spec §37 — LLM should not directly modify the database, Spec §7 — Ownership matters, Finding 1 — confidence 0.97 cannot be schema-enforced, The non-negotiable architectural rule (LLM proposes, backend commits), create_commitment — the first tool to implement, executeTurn — validate then commit then log, Ownership direction is two explicit FK columns, ToolDefinition / ToolContext / ToolError / LoggedMutation (+1 more)

### Community 44 - "Security trust boundaries"
Cohesion: 0.22
Nodes (9): Server-side authorization / ownership checks, Prompt injection as trust-boundary problem, Treat page content as data, not instructions, /cso skill, OWASP Top 10 + STRIDE threat model, Prompt injection lens, Read-only enforcement rationale, Security / CSO (+1 more)

### Community 45 - "CI config decisions"
Cohesion: 0.22
Nodes (9): Dependabot semver-major ignores for pinned majors, pnpm/action-setup version input conflicts with packageManager, We hold WRITE, not ADMIN, on batoredev/OurGlass, GitHub Actions workflows (ci, evals, codeql, dependabot), Public-repo hardening (empty permissions, SHA pinning), In-process reminder poller recommendation, Blocked / needs owner action (branch protection), Phase 0 — Foundation (+1 more)

### Community 46 - "Mission templates"
Cohesion: 0.22
Nodes (9): docs/MISSIONS.md — mission templates, Mission 0 — Discovery, Mission 1 — Four-lens plan review, Mission 2 — Four-lens code review, Mission 4c — Showcase-grade interface, Mission 8 — Research a capability gap, Capability gap — the research-analyst fallback, docs/SHOWCASE-FRONTEND.md — why the frontend isn't showcase-grade (+1 more)

### Community 47 - "create_commitment tool"
Cohesion: 0.29
Nodes (6): CreateCommitmentInput, CreateCommitmentOutput, CreateCommitmentRawInput, createCommitmentTool, isUuid(), validate()

### Community 48 - "Tool registry"
Cohesion: 0.29
Nodes (3): buildToolRegistry(), AnyToolDefinition, ToolRegistry

### Community 49 - "Phase 1 build findings"
Cohesion: 0.25
Nodes (8): Finding 5 — borrow the bitemporal design, skip Graphiti/Zep/Mem0, Build finding 5 — invalidate* overwrote an already-set t_invalid, Phase 1 build findings (Mission 4), Build finding 6 — the toThrow false alarm, Mission 3 — Competing-hypothesis debug, add_bitemporal_columns(tbl regclass) shared migration helper, Bitemporal columns on every table, Phase 1 — Structured state + validated tool layer

### Community 50 - "Security rules"
Cohesion: 0.29
Nodes (7): Retrieved content is data, never instructions, For AI systems, evaluate prompt injection, tool abuse, exfiltration, unsafe side effects, Security Rules, Treat all external input as untrusted, Validate authorization server-side, Review SSRF, XSS, CSRF, injection, privesc, data leakage, secret exposure, Treat webhooks as untrusted, design for replay/idempotency

### Community 51 - "Agent flow & routing docs"
Cohesion: 0.33
Nodes (7): docs/AGENT-FLOW.md — standard delivery flow, Escalation to the CTO, docs/AGENT-HANDBOOK.md — the 46-role handbook, docs/ROUTER.md — job to agents, docs/SECURITY-MISSIONS.md — security mission templates, docs/SECURITY-ROUTER.md — security family to agent, Authorisation / isolation / OT safety gates

### Community 52 - "CI job isolation fixes"
Cohesion: 0.29
Nodes (7): build:libs only built @ourglass/shared, masked by stale dist, Build finding 9 — CI jobs are independent clean runners, Phase 1 decision 9 — README.md did not exist and was unowned, vitest.config / vitest.integration.config split per package, Graphify --update after every feature (standing rule), Fresh-clone, no-preset-env definition of done, Definition of done (every feature, every phase)

### Community 53 - "packages/db scripts"
Cohesion: 0.29
Nodes (7): scripts, build, migrate, reset, test, test:integration, typecheck

### Community 54 - "packages/db test tsconfig"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, rootDir, extends, include, ./tsconfig.json

### Community 55 - "Production rules"
Cohesion: 0.33
Nodes (6): Treat database migrations as production code, Production Rules, No production deployment without applicable quality gates, Have a rollback/recovery strategy for risky releases, Perform smoke verification after deployment, docs/PHASE-1-DESIGN.md

### Community 56 - "Migration 006: entity registry"
Cohesion: 0.60
Nodes (5): entity_records, entity_records_current, entity_type_fields, entity_types, entity_types_current

### Community 57 - "Migration runner script"
Cohesion: 0.40
Nodes (5): dropSchema(), main(), MIGRATIONS_DIR, reset, node-pg-migrate

### Community 58 - "Spec: memory & inference"
Cohesion: 0.40
Nodes (5): Spec §12 — Inference levels (CONFIRMED/INFERRED/UNCERTAIN), Spec §17 — Memory correction, Spec §16 — Memory provenance, Invalidate, never delete, relationships.inference_level — enum, not a float

### Community 59 - "Git & secrets rules"
Cohesion: 0.40
Nodes (5): Keep commits focused and understandable, Git Rules, Do not commit secrets, build artifacts, or local machine state, Never hardcode secrets, Contributing: use spec's fictional names, never real Batore team data

### Community 60 - "Docker Compose Postgres"
Cohesion: 0.50
Nodes (5): docker-compose.yml (Postgres service), ourglass-postgres-data volume, postgres service (pgvector/pgvector:pg17), Postgres 17 + pgvector 0.8.6 single datastore decision, Stack table (apps/web, apps/api, packages/shared, packages/db, packages/evals)

### Community 61 - "DEFERRABLE syntax bug"
Cohesion: 0.40
Nodes (5): CREATE UNIQUE INDEX DEFERRABLE is invalid Postgres syntax, Build finding 8 — no SQL executed anywhere until the first CI push, Deferrable ordinal uniqueness on entity_type_fields, Green tests are not evidence of correctness under model input, Layer 3 (Tools) absent — the finding that matters

### Community 62 - "packages/db devDependencies"
Cohesion: 0.40
Nodes (5): devDependencies, @types/node, @types/pg, typescript, vitest

### Community 63 - "tools/_template.py"
Cohesion: 0.50
Nodes (4): main(), Do the actual work. Keep this deterministic., One-line description of what this tool does. Inputs: --example-id the thing to…, run()

### Community 64 - "Research analyst role"
Cohesion: 0.50
Nodes (4): Actionable brief output format (QUESTION/ANSWER/CONFIDENCE/SOURCES/HOW TO DO IT/GOTCHAS/UNKNOWNS/OPEN QUESTION), Spawned on capability gap (unfamiliar API/framework/protocol/regulation), Primary-sources-first research method, Research Analyst

### Community 65 - "packages/db dependencies"
Cohesion: 0.50
Nodes (4): dependencies, node-pg-migrate, @ourglass/shared, pg

### Community 66 - "packages/evals devDependencies"
Cohesion: 0.50
Nodes (4): devDependencies, @types/node, typescript, vitest

### Community 67 - "packages/evals scripts"
Cohesion: 0.50
Nodes (4): scripts, test, test:live, typecheck

### Community 68 - "packages/shared scripts"
Cohesion: 0.50
Nodes (4): scripts, build, test, typecheck

### Community 69 - "CREATE EXTENSION atomicity"
Cohesion: 0.67
Nodes (3): Phase 1 decision 8 — ci.yml:71 deletion atomic with migration 001, Build finding 7 — CI gap from the ci.yml:71 deletion, CREATE EXTENSION vector moves into migration 001

## Ambiguous Edges - Review These
- `docs/SPEC.md — extracted spec text` → `Agent teams operating guide (PDF)`  [AMBIGUOUS]
  docs/SPEC.md · relation: conceptually_related_to

## Knowledge Gaps
- **445 isolated node(s):** `metadata`, `config`, `nextConfig`, `next`, `@ourglass/shared` (+440 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 551 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `docs/SPEC.md — extracted spec text` and `Agent teams operating guide (PDF)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Company Claude OS v2 (root governance doc)` connect `Architecture rules` to `Agent team safety rules`, `Git & secrets rules`, `Media production agents`, `Security rules`, `Testing rules + CI build job`, `Production rules`, `AI systems rules`, `Project stack & CodeQL`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `Routing Rules` connect `Agent team safety rules` to `Architecture rules`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `CTO / Delivery Lead` connect `CTO delivery lead role` to `Code review agents`, `Agent team safety rules`, `Browser QA agents`, `DevOps & release agents`, `Frontend/backend lead roles`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `metadata`, `config`, `nextConfig` to the rest of the system?**
  _445 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `db client + repositories` be split into smaller, more focused modules?**
  _Cohesion score 0.06558441558441558 - nodes in this community are weakly interconnected._
- **Should `API contract & docs agents` be split into smaller, more focused modules?**
  _Cohesion score 0.04964539007092199 - nodes in this community are weakly interconnected._