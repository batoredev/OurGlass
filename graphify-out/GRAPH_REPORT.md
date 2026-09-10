# Graph Report - OurGlass  (2026-09-10)

## Corpus Check
- 27 files · ~107,731 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1193 nodes · 1437 edges · 105 communities (75 shown, 21 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- db client + repositories
- API contract & docs agents
- Motion & design agents
- /freeze semantics (rewritten §3)
- apps/web app shell
- Model decision & eval safeguard
- Team structure & routing
- Spec: core product principles
- Research findings 1-4
- apps/api tsconfig
- packages/db package config
- Root package config
- Phase 2 eval harness
- Assistant shared contract
- Phase 2 extractor
- Migration 002: core entities
- Mission templates
- Tool contract types
- File ownership map
- Tool executor & undo
- Phase 2 resolver
- apps/web tsconfig
- Browser QA agents
- Design director role
- DevOps & release agents
- Dynamic entity registry
- tsconfig.base.json
- CTO delivery lead role
- define_entity_type tool
- Taste & aesthetic direction
- packages/shared config
- Cross-package dep refs
- Spec: UI & user control
- Testing rules + Docker Compose
- Tool error types
- Product & discovery roles
- Code review agents
- CEO scope modes
- Media production agents
- Security & secrets rules
- apps/api package meta
- create_reminder tool
- Executor unit tests
- Trust boundaries & injection
- create_commitment tool
- Tool registry
- Governance & git hygiene
- Project stack & ownership
- WAT operating model
- AI systems rules
- pg_cron & cost budget
- apps/api dependencies
- apps/api scripts
- Fastify server
- Commitment lifecycle & status
- Ownership direction & first tool
- Agent flow & handbook
- packages/db test tsconfig
- apps/api devDependencies
- action_log turn grain
- Four-stage orchestrator
- Phase 1 ownership & skills
- Migration 006: entity registry
- Spec: memory & inference
- Production rules
- tools/_template.py
- Research analyst role
- Architecture rules
- packages/evals devDeps
- packages/evals scripts
- packages/shared scripts
- Pinned-below-latest versions
- Bitemporal columns
- ADMIN blocker
- Dependabot config
- Commitments as core model
- task-completed-gate hook
- teammate-idle-gate hook
- tool-cost-guard hook
- Auto-commit segregation
- Publish contracts early
- One Postgres datastore
- No invented reminder times
- Non-destructive merge
- Lexical duplicate interim
- Migration 005: action_log
- Ecosystem routing table
- Mission: durable quality
- Never-assume principle
- Planning pipeline
- Review pipeline
- CREATE EXTENSION in migration 001
- reminders.source_phrase
- users.timezone
- pnpm workspace
- .tmp directory notes

## God Nodes (most connected - your core abstractions)
1. `docs/SPEC.md — extracted spec text` - 41 edges
2. `compilerOptions` - 17 edges
3. `compilerOptions` - 16 edges
4. `CTO / Delivery Lead` - 16 edges
5. `QA / Browser Engineering Lead` - 15 edges
6. `Frontend Lead` - 12 edges
7. `Company Claude OS v2 (root governance doc)` - 12 edges
8. `undoTurn()` - 11 edges
9. `Engagement routing table` - 11 edges
10. `ToolRegistry` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Invalidate, never delete` --semantically_similar_to--> `Spec §17 — Memory correction`  [INFERRED] [semantically similar]
  docs/PHASE-1-DESIGN.md → Batore_Personal_Assistant_Spec.pdf
- `live job (manual workflow_dispatch only, costs tokens)` --semantically_similar_to--> `Paid calls need approval`  [INFERRED] [semantically similar]
  .github/workflows/evals.yml → .claude/rules/wat.md
- `docs/SPEC.md — extracted spec text` --references--> `Spec §8 — Commitment lifecycle`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §22 — Conversational state updates`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §28 — User control`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **File-ownership map enforced via /freeze across implementer agents** — claude_agents_04_solutions_architect_file_ownership_table, claude_agents_18_devops_sre_freeze [EXTRACTED 1.00]
- **Security practice engagement lifecycle (lead routes to offensive/defensive/dfir)** — claude_agents_34_security_lead_security_lead, claude_agents_35_offensive_security_engineer_offensive_security_engineer, claude_agents_36_dfir_analyst_dfir_analyst, claude_agents_37_detection_engineer_detection_engineer, claude_agents_38_threat_hunter_threat_hunter [EXTRACTED 1.00]
- **Single browser owner constraint across QA, performance, and devex roles** — claude_agents_12_qa_browser_lead_qa_browser_lead, claude_agents_14_performance_engineer_performance_engineer, claude_agents_17_devex_engineer_devex_engineer, claude_agents_07_frontend_lead_frontend_lead [EXTRACTED 1.00]
- **Merge-resolution invariant: pointer, view, resolver, cycle guard, lossy-inverse fix** — docs_phase_1_design_merged_into_id, docs_phase_1_design_people_current_view, docs_phase_1_design_resolve_person, docs_phase_1_design_resolve_merged_cycle_guard [EXTRACTED 1.00]
- **Planning/execution chain: plan, decisions, phases, Phase 1 design** — docs_phase_1_design [EXTRACTED 1.00]
- **Turn-grained undo pipeline: validate, commit, log, undo** — docs_phase_1_design_validate_is_a_function, docs_phase_1_design_execute_turn, docs_phase_1_design_action_log_turn_id_grain, docs_phase_1_design_undo_turn, docs_phase_1_design_double_undo_partial_unique_index [EXTRACTED 1.00]
- **Read-only/deterministic QA roles distinct from browser daemon** — claude_agents_25_web_standards_engineer_web_standards_engineer, claude_agents_26_accessibility_engineer_accessibility_engineer, claude_agents_27_e2e_automation_engineer_e2e_automation_engineer [INFERRED 0.75]
- **CI/eval/security workflow triad gating merges to main** — github_workflows_ci_ci_workflow, github_workflows_evals_evals_workflow, github_workflows_codeql_codeql_workflow [INFERRED 0.85]
- **Frontend polish/QA specialist trio (motion, taste, visual critique)** — claude_agents_23_motion_engineer_motion_engineer, claude_agents_24_taste_director_taste_director, claude_agents_33_visual_critic_visual_critic [INFERRED 0.85]
- **Untrusted-content / prompt-injection trust boundary discipline across roles** — claude_agents_10_ai_agent_engineer_prompt_injection_trust_boundary, claude_agents_13_security_cso_prompt_injection_lens, claude_agents_12_qa_browser_lead_untrusted_page_content, claude_agents_11_integration_engineer_webhook_untrusted_principle [INFERRED 0.85]
- **Three Phase 2 blockers that all passed the existing tests while being live** — docs_phases_blocker_two_aruns, docs_phases_blocker_dst_bug, docs_phases_blocker_forward_date, docs_phases_staff_review_11_issues, docs_phases_independent_review_gate, docs_phases_hollow_eval_harness_rebuild [EXTRACTED 1.00]
- **The Phase 2 trust boundary — model proposes typed mentions, backend resolves and commits** — docs_phase_2_design_extract_intents_tool, docs_phase_2_design_model_gets_no_db_handle, docs_phase_2_design_is_extraction_validator, docs_phase_2_design_verbatim_time_phrase, docs_phase_2_design_resolved_uuid_handoff, docs_phase_2_design_never_write_sql_from_model, docs_execution_plan_spec_37_rule [EXTRACTED 1.00]
- **The wrong-merge-is-worse lineage across research, schema, and Phase 2 resolution** — docs_decisions_finding_6_no_single_cutoff_no_transitive_closure, docs_decisions_finding_9_wrong_merge_is_worse, docs_decisions_non_destructive_merge, docs_decisions_merge_inverse_lossy_bug, docs_phase_2_design_three_band_resolution, docs_phase_2_design_hard_vetoes, docs_phases_blocker_two_aruns [EXTRACTED 1.00]

## Communities (105 total, 21 thin omitted)

### Community 0 - "db client + repositories"
Cohesion: 0.06
Nodes (24): createPool(), Queryable, Transactable, withTransaction(), commitments, organizations, people, projects (+16 more)

### Community 1 - "API contract & docs agents"
Cohesion: 0.05
Nodes (48): API Contract Engineer, Contract ownership (schema, versioning, breaking-change detection), /freeze schema/contract glob (first action), Publish contract before implementation starts, /document-generate skill (Diataxis structure), Every code example must run, /freeze developer docs glob (first action), Technical Writer (Developer-Facing) (+40 more)

### Community 2 - "Motion & design agents"
Cohesion: 0.05
Nodes (44): Common report format (Status/What changed/Verified/Risks/Blocked/Next action), animejs skill, Emil Kowalski reference, framer-motion skill, /freeze motion glob (first action), Motion Engineer, Motion principles (duration, easing, interruptibility, reduced-motion), motion / motion-dom / motion-utils skills (+36 more)

### Community 3 - "/freeze semantics (rewritten §3)"
Cohesion: 0.05
Nodes (43): ~/.gstack/freeze-dir.txt, /freeze protects a session from itself, not from teammates, /freeze is a single global slot, Global state, per-session hook enforcement, Never route edits around another agent's guard rail, Between agents the ownership map plus discipline is the whole mechanism, Report failures; do not route around them, Agent Teams Rules (+35 more)

### Community 4 - "apps/web app shell"
Cohesion: 0.05
Nodes (33): metadata, config, nextConfig, dependencies, next, @ourglass/shared, react, react-dom (+25 more)

### Community 5 - "Model decision & eval safeguard"
Cohesion: 0.06
Nodes (36): claude-sonnet-5 as injectable extractor default, The eval harness is the safeguard, not the model tier, Varying the wrong variable manufactures false generality, Finding 6 — never one cosine cutoff, never transitive closure, Finding 9 — a wrong merge is worse than a wrong split, Merge-inverse lossy on re-merge (RETURNING * bug), Non-destructive merge with merged_into_id + resolve_merged, Open question 2 — model tier for extraction (resolved) (+28 more)

### Community 6 - "Team structure & routing"
Cohesion: 0.06
Nodes (35): 46-role team structure (33 build + 11 security), One browser owner per mission, Capability gap → research-analyst, never guess, docs/ROUTER.md, One browser-daemon owner, always, Platform gates the roster (RN/Expo, web, no-UI), Read-only first (missions 1-3), Routing Rules (+27 more)

### Community 7 - "Spec: core product principles"
Cohesion: 0.06
Nodes (33): Spec §11 — Ambiguity handling, Spec §10 — Ask about people when necessary, Spec §3 — The central product principle, Spec §21 — Completing the user's own work, Spec §25 — Conditional commitments / workflows, Spec §24 — Conflict detection, Spec §20 — Context after completion, Spec §30 — Conversation design (+25 more)

### Community 8 - "Research findings 1-4"
Cohesion: 0.07
Nodes (29): Finding 1 — confidence 0.97 not schema-enforceable, Finding 2 — recursive schemas unsupported, flatten §25, Finding 3 — spec §18 conflates timestamp and event trigger, Finding 4 — the LLM must not compute timestamps, Finding 8 — all tool_result blocks in one user message, Open question 3 — timezone scope (resolved), users.timezone default Asia/Kolkata, chrono-node 2.10.1 deterministic time resolution (+21 more)

### Community 9 - "apps/api tsconfig"
Cohesion: 0.06
Nodes (27): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.base.json, references, compilerOptions (+19 more)

### Community 10 - "packages/db package config"
Cohesion: 0.07
Nodes (29): dependencies, node-pg-migrate, @ourglass/shared, pg, devDependencies, @types/node, @types/pg, typescript (+21 more)

### Community 11 - "Root package config"
Cohesion: 0.07
Nodes (28): description, devDependencies, eslint, @eslint/js, @types/node, typescript, typescript-eslint, vitest (+20 more)

### Community 12 - "Phase 2 eval harness"
Cohesion: 0.11
Nodes (13): allIntents, extractionTool, EXTRACTION_FIXTURES, ExtractionFixture, me, entityMatches(), hasPerfectMatching(), intentMatches() (+5 more)

### Community 13 - "Assistant shared contract"
Cohesion: 0.11
Nodes (25): ENTITY_KEYS, EntityMention, ExtractedIntent, Extraction, ExtractionResult, ExtractionTrace, ExtractionUsage, FieldRequirement (+17 more)

### Community 14 - "Phase 2 extractor"
Cohesion: 0.11
Nodes (17): AnthropicExtractor, AnthropicExtractorOptions, EXTRACTION_TOOL, ExtractionError, ExtractionFailureReason, Extractor, CivilDateTime, civilToUtc() (+9 more)

### Community 15 - "Migration 002: core entities"
Cohesion: 0.14
Nodes (22): it, organizations, organizations_current, people, people_current, projects, projects_current, resolve_organization() (+14 more)

### Community 16 - "Mission templates"
Cohesion: 0.11
Nodes (24): docs/MISSIONS.md — mission templates, Mission 0 — Discovery, Mission 1 — Four-lens plan review, Mission 2 — Four-lens code review, Mission 3 — Competing-hypothesis debug, Mission 4 — Cross-layer feature build, Mission 4c — Showcase-grade interface, Mission 6.5 — Codify (tools from repeated mechanical steps) (+16 more)

### Community 17 - "Tool contract types"
Cohesion: 0.11
Nodes (19): ActorKind, DatabaseTransaction, err(), ExecuteTurnResult, fakeQueryResult(), Invertibility, LoggedMutation, ok() (+11 more)

### Community 18 - "File ownership map"
Cohesion: 0.11
Nodes (22): File-ownership map, File-ownership table appended to plan, Backend Lead, /benchmark skill (forbidden), /health skill, /investigate skill (Iron Law), /review skill (forbidden, auto-fixes), /careful skill (+14 more)

### Community 19 - "Tool executor & undo"
Cohesion: 0.19
Nodes (16): makePerson(), TurnAlreadyUndoneError, ActionLogEntry, appendActionLog(), applyInverse(), Deps, executeTurn(), ExecuteTurnFailure (+8 more)

### Community 20 - "Phase 2 resolver"
Cohesion: 0.16
Nodes (17): CommitmentProposal, contentTokens(), detectDuplicate(), DuplicateDecision, EntityResolution, hasHardVeto(), isCompleted(), MentionCandidate (+9 more)

### Community 21 - "apps/web tsconfig"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, forceConsistentCasingInFileNames, incremental, isolatedModules, jsx, lib (+11 more)

### Community 22 - "Browser QA agents"
Cohesion: 0.13
Nodes (18): /autoplan skill, /benchmark skill, /browse skill, /open-gstack-browser skill, QA / Browser Engineering Lead, /qa-only skill, /scrape skill, /setup-browser-cookies skill (+10 more)

### Community 23 - "Design director role"
Cohesion: 0.15
Nodes (17): AI-slop design patterns to avoid, /design-consultation skill, Design Director, DESIGN.md, /design-review skill (lead-only, auto-commits), /design-shotgun skill, ui-ux-pro-max skill, /browse skill (forbidden) (+9 more)

### Community 24 - "DevOps & release agents"
Cohesion: 0.14
Nodes (17): DevOps / SRE, /guard skill, /land-and-deploy skill (forbidden), Documented rollback for every deploy path, /setup-deploy skill, /ship skill (forbidden), /document-release skill, /land-and-deploy skill (+9 more)

### Community 25 - "Dynamic entity registry"
Cohesion: 0.12
Nodes (17): Dynamic entity types (owner requirement, not spec), field_kind is a closed six-value enum, entity_types / entity_records registry, add_entity_field must be non-breaking (optional-only), Deferrable ordinal uniqueness on entity_type_fields, define_entity_type rejects unknown field kinds at validation time, Dynamic entity registry (entity_types / fields / records), Caps: 32 fields per type, 64 types (+9 more)

### Community 26 - "tsconfig.base.json"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib (+8 more)

### Community 27 - "CTO delivery lead role"
Cohesion: 0.14
Nodes (15): Single browser owner rule, /context-save skill, CTO / Delivery Lead, /plan-tune skill, /qa skill, research-analyst agent, /retro skill, /skillify skill (+7 more)

### Community 28 - "define_entity_type tool"
Cohesion: 0.15
Nodes (12): DefineEntityTypeInput, DefineEntityTypeOutput, DefineEntityTypeRawInput, defineEntityTypeTool, EntityTypeRow, FieldDefInput, FieldKind, isFieldKind() (+4 more)

### Community 29 - "Taste & aesthetic direction"
Cohesion: 0.15
Nodes (13): Anti-slop list (kill on sight), awesome design / impeccable references, Taste Director, taste skill (variance system), ui-ux-pro-max skill (styles/palettes/pairings), Written direction (deliverable), AI-slop checklist, Review priority list (spacing, hierarchy, density, alignment, colour, ai-slop, resilience, absence) (+5 more)

### Community 30 - "packages/shared config"
Cohesion: 0.15
Nodes (12): typescript, devDependencies, typescript, vitest, exports, vitest, main, name (+4 more)

### Community 31 - "Cross-package dep refs"
Cohesion: 0.17
Nodes (11): @anthropic-ai/sdk, @ourglass/shared, @types/node, dependencies, @anthropic-ai/sdk, @ourglass/shared, vitest, name (+3 more)

### Community 32 - "Spec: UI & user control"
Cohesion: 0.20
Nodes (11): Spec §29 — The primary UI (inspection surfaces), Spec §28 — User control, action_log — the undo substrate, Undo traverses only actor_kind='user_turn', Double-undo impossible — partial unique index, invertibility enum (full / lossy / none), TRUNCATE RESTART IDENTITY CASCADE test isolation, Undo is append-only (undoes_turn_id) (+3 more)

### Community 33 - "Testing rules + Docker Compose"
Cohesion: 0.20
Nodes (11): Unit / integration / E2E test layering, docker-compose.yml (Postgres service), ourglass-postgres-data volume, postgres service (pgvector/pgvector:pg17), build job (typecheck/lint/test/build), pnpm run build:libs step, CI workflow, integration job (Postgres + pgvector) (+3 more)

### Community 34 - "Tool error types"
Cohesion: 0.20
Nodes (5): NotInvertibleError, PG_UNIQUE_VIOLATION, ToolNotFoundError, TurnNotFoundError, ValidationFailedError

### Community 35 - "Product & discovery roles"
Cohesion: 0.20
Nodes (10): /learn skill, /office-hours skill, Product / CEO Strategist, /diagram skill, /plan-eng-review skill, Shared task list (5-6 tasks per teammate), Solutions Architect, Evidence vs assumption labeling standard (+2 more)

### Community 36 - "Code review agents"
Cohesion: 0.20
Nodes (10): /review skill, /codex skill, Fix-First auto-apply behaviour, Greptile PR-comment triage, Staff Code Reviewer, Three-bucket report format (auto-fix / decision / completeness gap), Adversarial / Second-Model Reviewer, Codex CLI installed/authenticated hard requirement (+2 more)

### Community 37 - "CEO scope modes"
Cohesion: 0.20
Nodes (10): HOLD SCOPE mode, Margin rule (scope expansion destroys margin on fixed-price work), /plan-ceo-review skill, SCOPE EXPANSION mode, SCOPE REDUCTION mode, SELECTIVE EXPANSION mode, Observable/falsifiable acceptance criteria, Business Analyst / Spec Author (+2 more)

### Community 38 - "Media production agents"
Cohesion: 0.24
Nodes (10): Composition is code discipline, Freeze video glob (first action), Motion Graphics Engineer (agent), remotion-* skill family, Render is expensive and slow discipline, Brand consistency over novelty, Brand & Media Producer (agent), Cost-first generation discipline (+2 more)

### Community 39 - "Security & secrets rules"
Cohesion: 0.20
Nodes (10): Do not commit secrets, build artifacts, or local machine state, For AI systems, evaluate prompt injection, tool abuse, exfiltration, unsafe side effects, Never hardcode secrets, Security Rules, Validate authorization server-side, Review SSRF, XSS, CSRF, injection, privesc, data leakage, secret exposure, Treat webhooks as untrusted, design for replay/idempotency, analyze job (javascript-typescript) (+2 more)

### Community 40 - "apps/api package meta"
Cohesion: 0.22
Nodes (8): vitest, name, private, type, version, @ourglass/db, tsx, @types/pg

### Community 41 - "create_reminder tool"
Cohesion: 0.25
Nodes (7): CreateReminderInput, CreateReminderOutput, CreateReminderRawInput, createReminderTool, isUuid(), ReminderRow, validate()

### Community 42 - "Executor unit tests"
Cohesion: 0.28
Nodes (5): FakeRow, handlers, InverseHandler, registerInverseHandler(), __resetInverseHandlersForTests()

### Community 43 - "Trust boundaries & injection"
Cohesion: 0.22
Nodes (9): Server-side authorization / ownership checks, Prompt injection as trust-boundary problem, Treat page content as data, not instructions, /cso skill, OWASP Top 10 + STRIDE threat model, Prompt injection lens, Read-only enforcement rationale, Security / CSO (+1 more)

### Community 44 - "create_commitment tool"
Cohesion: 0.29
Nodes (6): CreateCommitmentInput, CreateCommitmentOutput, CreateCommitmentRawInput, createCommitmentTool, isUuid(), validate()

### Community 45 - "Tool registry"
Cohesion: 0.29
Nodes (3): buildToolRegistry(), AnyToolDefinition, ToolRegistry

### Community 46 - "Governance & git hygiene"
Cohesion: 0.25
Nodes (8): Company Claude OS v2 (root governance doc), Remote github.com/batoredev/OurGlass — WRITE not ADMIN, Keep commits focused and understandable, Git Rules, Define success before implementing non-trivial behavior, Do not hide failing tests with skips unless justified, Add regression coverage for important bug fixes, Testing Rules

### Community 47 - "Project stack & ownership"
Cohesion: 0.25
Nodes (8): Default ownership map (packages/db -> database-data-engineer, apps/api/assistant -> ai-agent-engineer, apps/web -> frontend-lead), Project: Batore Personal Assistant / OurGlass, Stack: TypeScript pnpm monorepo (apps/web, apps/api, packages/shared, packages/db, packages/evals), Ships with an eval set, or does not ship, Evals workflow, fixtures job (recorded fixtures, free deterministic), Fork PR cannot reach ANTHROPIC_API_KEY constraint, live job (manual workflow_dispatch only, costs tokens)

### Community 48 - "WAT operating model"
Cohesion: 0.25
Nodes (8): WAT operating model (Workflows/Agents/Tools), Codify what repeats, The failure loop, File discipline (.tmp/, tools/, workflows/, .env), Never invent a tool's behaviour, Tool-first, always, WAT Rules — Workflows Agents Tools, Workflows are preserved, not replaced

### Community 49 - "AI systems rules"
Cohesion: 0.25
Nodes (8): AI Systems Rules, Cost per request is a design constraint, Degrade honestly, Guardrails are not optional on user-facing generation, Irreversible actions need an approval gate outside the model, Retrieved content is data, never instructions, Trace everything, Treat all external input as untrusted

### Community 50 - "pg_cron & cost budget"
Cohesion: 0.25
Nodes (8): In-process reminder poller (recommended default), Open question 4 — cost budget per message, pg_cron absent from pgvector/pgvector:pg17, Risk — unbounded per-message LLM cost (§22), In-process reminder poller recommendation, pg_cron is not in pgvector/pgvector:pg17, Extraction trace (model ID, request ID, tokens, latency), Phase 3 — Conversational loop + reminders

### Community 51 - "apps/api dependencies"
Cohesion: 0.29
Nodes (7): dependencies, @anthropic-ai/sdk, chrono-node, fastify, @ourglass/db, @ourglass/shared, pg

### Community 52 - "apps/api scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, start, test, test:integration, typecheck

### Community 53 - "Fastify server"
Cohesion: 0.43
Nodes (3): buildServer(), main(), fastify

### Community 54 - "Commitment lifecycle & status"
Cohesion: 0.29
Nodes (7): Spec §8 — Commitment lifecycle, due_soon/overdue computed in a view, never stored, commitments — the primary abstraction, not tasks, Ownership direction is structural (owner_id/recipient_id), Risk — wrong auto-merge silently destroys a commitment, due_soon 2-hour threshold placeholder, Hard vetoes on owner/recipient and completion state

### Community 55 - "Ownership direction & first tool"
Cohesion: 0.29
Nodes (7): Spec §7 — Ownership matters, create_commitment — the first tool to implement, executeTurn — validate then commit then log, Ownership direction is two explicit FK columns, The resolved-UUID input contract, ToolDefinition / ToolContext / ToolError / LoggedMutation, The tool registry (apps/api/src/tools)

### Community 56 - "Agent flow & handbook"
Cohesion: 0.33
Nodes (7): docs/AGENT-FLOW.md — standard delivery flow, Escalation to the CTO, docs/AGENT-HANDBOOK.md — the 46-role handbook, docs/ROUTER.md — job to agents, docs/SECURITY-MISSIONS.md — security mission templates, docs/SECURITY-ROUTER.md — security family to agent, Authorisation / isolation / OT safety gates

### Community 57 - "packages/db test tsconfig"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, rootDir, extends, include, ./tsconfig.json

### Community 58 - "apps/api devDependencies"
Cohesion: 0.33
Nodes (6): devDependencies, tsx, @types/node, @types/pg, typescript, vitest

### Community 59 - "action_log turn grain"
Cohesion: 0.33
Nodes (6): Spec §22 — Conversational state updates, action_log grained at the conversational turn, action_log — every mutation with its inverse, Mutate stage, action_log turn_id grain — the conversational turn, Phase 2 demo utterance (Barkha article + 5pm reminder)

### Community 60 - "Four-stage orchestrator"
Cohesion: 0.40
Nodes (6): Four-stage orchestrator (Interpret → Resolve → Mutate → Respond), Interpret stage, Resolve stage, Respond stage, Phase 2 — Interpret + Resolve, Phase 2 — Interpret + Resolve, done and verified in CI

### Community 61 - "Phase 1 ownership & skills"
Cohesion: 0.33
Nodes (6): Phase 1 file-ownership map, No browser owner in Phase 1, docs/SKILL-COVERAGE.md — gstack skill coverage audit, Lead-only skills — deliberately not given to teammates, docs/SKILL-ROUTING.md — ecosystem responsibilities, Skill binding is advisory — teammates load from settings

### Community 62 - "Migration 006: entity registry"
Cohesion: 0.60
Nodes (5): entity_records, entity_records_current, entity_type_fields, entity_types, entity_types_current

### Community 63 - "Spec: memory & inference"
Cohesion: 0.40
Nodes (5): Spec §12 — Inference levels (CONFIRMED/INFERRED/UNCERTAIN), Spec §17 — Memory correction, Spec §16 — Memory provenance, Invalidate, never delete, relationships.inference_level — enum, not a float

### Community 64 - "Production rules"
Cohesion: 0.40
Nodes (5): Treat database migrations as production code, Production Rules, No production deployment without applicable quality gates, Have a rollback/recovery strategy for risky releases, Perform smoke verification after deployment

### Community 65 - "tools/_template.py"
Cohesion: 0.50
Nodes (4): main(), Do the actual work. Keep this deterministic., One-line description of what this tool does. Inputs: --example-id the thing to…, run()

### Community 66 - "Research analyst role"
Cohesion: 0.50
Nodes (4): Actionable brief output format (QUESTION/ANSWER/CONFIDENCE/SOURCES/HOW TO DO IT/GOTCHAS/UNKNOWNS/OPEN QUESTION), Spawned on capability gap (unfamiliar API/framework/protocol/regulation), Primary-sources-first research method, Research Analyst

### Community 67 - "Architecture rules"
Cohesion: 0.50
Nodes (4): Architecture Rules, Document important irreversible decisions, Explicit boundaries and simple dependencies, Treat authn/authz and trust boundaries as architecture concerns

### Community 68 - "packages/evals devDeps"
Cohesion: 0.50
Nodes (4): devDependencies, @types/node, typescript, vitest

### Community 69 - "packages/evals scripts"
Cohesion: 0.50
Nodes (4): scripts, test, test:live, typecheck

### Community 70 - "packages/shared scripts"
Cohesion: 0.50
Nodes (4): scripts, build, test, typecheck

### Community 71 - "Pinned-below-latest versions"
Cohesion: 0.67
Nodes (3): Dependabot semver-major ignores for pinned deps, Deliberate pins below latest (TS 6.0.3, ESLint 9.39.5, Vitest 4.1.11), Read DECISIONS.md before touching schema/tools/CI

### Community 72 - "Bitemporal columns"
Cohesion: 0.67
Nodes (3): Finding 5 — borrow bitemporal design, skip vendor memory deps, invalidate* overwrote an already-set t_invalid, Bitemporal columns (t_valid/t_invalid/t_created/t_expired)

### Community 73 - "ADMIN blocker"
Cohesion: 0.67
Nodes (3): WRITE not ADMIN on batoredev/OurGlass, Open question 1 — who has ADMIN on the repo, Blocked — branch protection needs ADMIN

### Community 74 - "Dependabot config"
Cohesion: 0.67
Nodes (3): Dependabot config, npm package-ecosystem (used for pnpm project), Pinned major-version ignores (typescript, eslint, @eslint/js, vitest)

## Ambiguous Edges - Review These
- `Agent teams operating guide (PDF)` → `docs/SPEC.md — extracted spec text`  [AMBIGUOUS]
  docs/SPEC.md · relation: conceptually_related_to

## Knowledge Gaps
- **546 isolated node(s):** `ActionLogEntry`, `ExecuteTurnFailure`, `ExecuteTurnOutcome`, `UndoResult`, `DefineEntityTypeInput` (+541 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 669 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Agent teams operating guide (PDF)` and `docs/SPEC.md — extracted spec text`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Read-only staff review found 11 issues, 3 blockers` connect `Research findings 1-4` to `/freeze semantics (rewritten §3)`, `Four-stage orchestrator`, `Model decision & eval safeguard`?**
  _High betweenness centrality (0.193) - this node is a cross-community bridge._
- **What connects `ActionLogEntry`, `ExecuteTurnFailure`, `ExecuteTurnOutcome` to the rest of the system?**
  _546 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `db client + repositories` be split into smaller, more focused modules?**
  _Cohesion score 0.06140350877192982 - nodes in this community are weakly interconnected._
- **Should `API contract & docs agents` be split into smaller, more focused modules?**
  _Cohesion score 0.04964539007092199 - nodes in this community are weakly interconnected._
- **Should `Motion & design agents` be split into smaller, more focused modules?**
  _Cohesion score 0.045454545454545456 - nodes in this community are weakly interconnected._
- **Should `/freeze semantics (rewritten §3)` be split into smaller, more focused modules?**
  _Cohesion score 0.048726467331118496 - nodes in this community are weakly interconnected._