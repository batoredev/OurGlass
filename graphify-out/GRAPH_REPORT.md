# Graph Report - OurGlass  (2026-09-13)

## Corpus Check
- 44 files · ~160,104 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1403 nodes · 1794 edges · 143 communities (97 shown, 37 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 70 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Agent Roster Contracts
- Frontend Specialist Agents
- Tool Executor Errors
- Product Spec Concepts
- Orchestrator Stages
- Extraction Eval Harness
- TypeScript Project Refs
- Package Dependencies
- Delivery Lead Routing
- Assistant Contract Types
- Extraction Schema
- Respond Stage
- Core Entity Migrations
- Mission Playbooks
- Tool Contract Types
- Entity Resolution
- DB Client and Index
- Commitments Repository
- People Repository
- Web App Config
- Queryable Abstraction
- Reminder Poller
- Workflow Tools
- Browser QA Ownership
- Create Commitment Tool
- DevOps Deploy Guards
- Workflows Repository
- Base TypeScript Config
- Install Merge Notes
- Testing Rules
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 102
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 141
- Community 142

## God Nodes (most connected - your core abstractions)
1. `docs/SPEC.md — extracted spec text` - 41 edges
2. `compilerOptions` - 17 edges
3. `compilerOptions` - 16 edges
4. `CTO / Delivery Lead` - 16 edges
5. `QA / Browser Engineering Lead` - 15 edges
6. `Queryable` - 13 edges
7. `undoTurn()` - 12 edges
8. `Frontend Lead` - 12 edges
9. `Company Claude OS v2 (root governance doc)` - 12 edges
10. `runTurn()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Invalidate, never delete` --semantically_similar_to--> `Spec §17 — Memory correction`  [INFERRED] [semantically similar]
  docs/PHASE-1-DESIGN.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §29 — The primary UI (inspection surfaces)`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §28 — User control`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf
- `live job (manual workflow_dispatch only, costs tokens)` --semantically_similar_to--> `Paid calls need approval`  [INFERRED] [semantically similar]
  .github/workflows/evals.yml → .claude/rules/wat.md
- `docs/SPEC.md — extracted spec text` --references--> `Spec §7 — Ownership matters`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **File-ownership map enforced via /freeze across implementer agents** — claude_agents_04_solutions_architect_file_ownership_table, claude_agents_18_devops_sre_freeze [EXTRACTED 1.00]
- **Security practice engagement lifecycle (lead routes to offensive/defensive/dfir)** — claude_agents_34_security_lead_security_lead, claude_agents_35_offensive_security_engineer_offensive_security_engineer, claude_agents_36_dfir_analyst_dfir_analyst, claude_agents_37_detection_engineer_detection_engineer, claude_agents_38_threat_hunter_threat_hunter [EXTRACTED 1.00]
- **Single browser owner constraint across QA, performance, and devex roles** — claude_agents_12_qa_browser_lead_qa_browser_lead, claude_agents_14_performance_engineer_performance_engineer, claude_agents_17_devex_engineer_devex_engineer, claude_agents_07_frontend_lead_frontend_lead [EXTRACTED 1.00]
- **Merge-resolution invariant: pointer, view, resolver, cycle guard, lossy-inverse fix** — docs_phase_1_design_merged_into_id, docs_phase_1_design_people_current_view, docs_phase_1_design_resolve_person, docs_phase_1_design_resolve_merged_cycle_guard [EXTRACTED 1.00]
- **The Phase 2 trust boundary — model proposes typed mentions, backend resolves and commits** — docs_phase_2_design_extract_intents_tool, docs_phase_2_design_model_gets_no_db_handle, docs_phase_2_design_is_extraction_validator, docs_phase_2_design_verbatim_time_phrase, docs_phase_2_design_resolved_uuid_handoff, docs_phase_2_design_never_write_sql_from_model, docs_execution_plan_spec_37_rule [EXTRACTED 1.00]
- **Planning/execution chain: plan, decisions, phases, Phase 1 design** — docs_phase_1_design [EXTRACTED 1.00]
- **Turn-grained undo pipeline: validate, commit, log, undo** — docs_phase_1_design_validate_is_a_function, docs_phase_1_design_execute_turn, docs_phase_1_design_action_log_turn_id_grain, docs_phase_1_design_undo_turn, docs_phase_1_design_double_undo_partial_unique_index [EXTRACTED 1.00]
- **Read-only/deterministic QA roles distinct from browser daemon** — claude_agents_25_web_standards_engineer_web_standards_engineer, claude_agents_26_accessibility_engineer_accessibility_engineer, claude_agents_27_e2e_automation_engineer_e2e_automation_engineer [INFERRED 0.75]
- **CI/eval/security workflow triad gating merges to main** — github_workflows_ci_ci_workflow, github_workflows_evals_evals_workflow, github_workflows_codeql_codeql_workflow [INFERRED 0.85]
- **Frontend polish/QA specialist trio (motion, taste, visual critique)** — claude_agents_23_motion_engineer_motion_engineer, claude_agents_24_taste_director_taste_director, claude_agents_33_visual_critic_visual_critic [INFERRED 0.85]
- **Untrusted-content / prompt-injection trust boundary discipline across roles** — claude_agents_10_ai_agent_engineer_prompt_injection_trust_boundary, claude_agents_13_security_cso_prompt_injection_lens, claude_agents_12_qa_browser_lead_untrusted_page_content, claude_agents_11_integration_engineer_webhook_untrusted_principle [INFERRED 0.85]
- **The scheduled-job path: poll, fire, evaluate, refuse undo** — docs_phase_3_design_poller, docs_phase_3_design_fired_at_idempotency, docs_phase_3_design_scheduled_job_not_undoable, docs_phase_3_design_workflow_evaluate_at_deadline, docs_phase_3_design_early_completion_silences_rule [EXTRACTED 0.90]
- **Never guess when guessing can cause a meaningful mistake** — docs_decisions_wrong_merge_is_worse, docs_decisions_three_band_resolution, docs_phase_3_design_auto_match_unreachable, docs_decisions_llm_never_computes_time [INFERRED 0.85]
- **Verification gates that caught what green tests missed** — docs_phases_independent_review_gate, docs_phases_f6_unregistered_tools, docs_phases_registry_coverage_guard, docs_decisions_schema_with_no_code_path, docs_phases_listrecent_ordering [INFERRED 0.85]

## Communities (143 total, 37 thin omitted)

### Community 0 - "Agent Roster Contracts"
Cohesion: 0.05
Nodes (48): API Contract Engineer, Contract ownership (schema, versioning, breaking-change detection), /freeze schema/contract glob (first action), Publish contract before implementation starts, /document-generate skill (Diataxis structure), Every code example must run, /freeze developer docs glob (first action), Technical Writer (Developer-Facing) (+40 more)

### Community 1 - "Frontend Specialist Agents"
Cohesion: 0.05
Nodes (44): Common report format (Status/What changed/Verified/Risks/Blocked/Next action), animejs skill, Emil Kowalski reference, framer-motion skill, /freeze motion glob (first action), Motion Engineer, Motion principles (duration, easing, interruptibility, reduced-motion), motion / motion-dom / motion-utils skills (+36 more)

### Community 2 - "Tool Executor Errors"
Cohesion: 0.11
Nodes (22): makePerson(), NotInvertibleError, PG_UNIQUE_VIOLATION, ToolNotFoundError, TurnAlreadyUndoneError, TurnNotFoundError, ValidationFailedError, ActionLogEntry (+14 more)

### Community 3 - "Product Spec Concepts"
Cohesion: 0.06
Nodes (34): Spec §11 — Ambiguity handling, Spec §10 — Ask about people when necessary, Spec §3 — The central product principle, Spec §8 — Commitment lifecycle, Spec §21 — Completing the user's own work, Spec §25 — Conditional commitments / workflows, Spec §24 — Conflict detection, Spec §20 — Context after completion (+26 more)

### Community 4 - "Orchestrator Stages"
Cohesion: 0.12
Nodes (29): blockedIntentIndices(), describeMention(), formatLocal(), IntentPlan, persistAssistantMessage(), planCommitment(), planCompletion(), PlanContext (+21 more)

### Community 5 - "Extraction Eval Harness"
Cohesion: 0.09
Nodes (17): ANTHROPIC_API_KEY never in a fork-triggerable workflow, CI workflows (ci, evals, codeql, dependabot), Deterministic fixture eval lane (free, every PR), Live eval lane (test:live, paid, manual dispatch), allIntents, extractionTool, EXTRACTION_FIXTURES, ExtractionFixture (+9 more)

### Community 6 - "TypeScript Project Refs"
Cohesion: 0.06
Nodes (27): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.base.json, references, compilerOptions (+19 more)

### Community 7 - "Package Dependencies"
Cohesion: 0.07
Nodes (29): dependencies, node-pg-migrate, @ourglass/shared, pg, devDependencies, @types/node, @types/pg, typescript (+21 more)

### Community 8 - "Delivery Lead Routing"
Cohesion: 0.09
Nodes (27): Single browser owner rule, /context-save skill, CTO / Delivery Lead, File-ownership map, /learn skill, /office-hours skill, /plan-tune skill, /qa skill (+19 more)

### Community 9 - "Assistant Contract Types"
Cohesion: 0.11
Nodes (25): ENTITY_KEYS, EntityMention, ExtractedIntent, Extraction, ExtractionResult, ExtractionTrace, ExtractionUsage, FieldRequirement (+17 more)

### Community 10 - "Extraction Schema"
Cohesion: 0.08
Nodes (21): inference_level enum (CONFIRMED/INFERRED/UNCERTAIN), Shared contract prevents API/eval drift, Six spec §5 intent kinds, ENTITY_SCHEMA, EXTRACTION_INPUT_SCHEMA, EXTRACTION_MODEL, EXTRACTION_SYSTEM_PROMPT, EXTRACTION_TOOL_NAME (+13 more)

### Community 11 - "Respond Stage"
Cohesion: 0.13
Nodes (16): assertNever(), describeFact(), formatDuration(), HaikuResponder, HaikuResponderOptions, inWords(), isAbort(), plural() (+8 more)

### Community 12 - "Core Entity Migrations"
Cohesion: 0.14
Nodes (22): it, organizations, organizations_current, people, people_current, projects, projects_current, resolve_organization() (+14 more)

### Community 13 - "Mission Playbooks"
Cohesion: 0.11
Nodes (24): docs/MISSIONS.md — mission templates, Mission 0 — Discovery, Mission 1 — Four-lens plan review, Mission 2 — Four-lens code review, Mission 3 — Competing-hypothesis debug, Mission 4 — Cross-layer feature build, Mission 4c — Showcase-grade interface, Mission 6.5 — Codify (tools from repeated mechanical steps) (+16 more)

### Community 14 - "Tool Contract Types"
Cohesion: 0.11
Nodes (19): ActorKind, DatabaseTransaction, err(), ExecuteTurnResult, fakeQueryResult(), Invertibility, LoggedMutation, ok() (+11 more)

### Community 15 - "Entity Resolution"
Cohesion: 0.15
Nodes (21): CommitmentProposal, CompletionMatch, contentTokens(), detectDuplicate(), DuplicateDecision, EntityResolution, FIRST_PERSON_MENTIONS, hasHardVeto() (+13 more)

### Community 16 - "DB Client and Index"
Cohesion: 0.16
Nodes (13): users_current, createPool(), withTransaction(), commitmentNotes, commitments, organizations, people, projects (+5 more)

### Community 17 - "Commitments Repository"
Cohesion: 0.10
Nodes (11): assertUpdatableField(), Commitment, CommitmentFieldPatch, CompleteCommitmentResult, CreateCommitmentInput, CurrentCommitment, restoreCommitmentFields(), UPDATABLE_COLUMNS (+3 more)

### Community 18 - "People Repository"
Cohesion: 0.10
Nodes (10): CreatePersonInput, Person, NOTE: t_invalid is overwritten UNCONDITIONALLY here, unlike the invalidate*, NOTE: this is NOT the inverse of a merge. `mergePerson` sets `t_invalid` AND, ensureUser(), EnsureUserInput, getUser(), getUserWithPerson() (+2 more)

### Community 19 - "Web App Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, forceConsistentCasingInFileNames, incremental, isolatedModules, jsx, lib (+11 more)

### Community 20 - "Queryable Abstraction"
Cohesion: 0.12
Nodes (6): Queryable, Transactable, Organization, unmergeOrganization(), Project, unmergeProject()

### Community 21 - "Reminder Poller"
Cohesion: 0.16
Nodes (12): Clock, evaluateDueWorkflows(), deps(), frozen(), OnFire, OnRuleFired, PollerDeps, PollerHandle (+4 more)

### Community 22 - "Workflow Tools"
Cohesion: 0.12
Nodes (15): ACTION_KINDS, CONDITION_KINDS, CreateWorkflowInput, CreateWorkflowInversePatch, CreateWorkflowOutput, CreateWorkflowRawInput, createWorkflowTool, EvaluateWorkflowInput (+7 more)

### Community 23 - "Browser QA Ownership"
Cohesion: 0.13
Nodes (18): /autoplan skill, /benchmark skill, /browse skill, /open-gstack-browser skill, QA / Browser Engineering Lead, /qa-only skill, /scrape skill, /setup-browser-cookies skill (+10 more)

### Community 24 - "Create Commitment Tool"
Cohesion: 0.15
Nodes (14): classifyCommitmentsInverse(), CommitmentsInversePatch, CompleteInversePatch, CreateCommitmentInput, CreateCommitmentOutput, CreateCommitmentRawInput, createCommitmentTool, CreateInversePatch (+6 more)

### Community 25 - "DevOps Deploy Guards"
Cohesion: 0.14
Nodes (17): DevOps / SRE, /guard skill, /land-and-deploy skill (forbidden), Documented rollback for every deploy path, /setup-deploy skill, /ship skill (forbidden), /document-release skill, /land-and-deploy skill (+9 more)

### Community 26 - "Workflows Repository"
Cohesion: 0.12
Nodes (7): CommitmentStatus, TERMINAL_STATUSES, CreateWorkflowInput, DueWorkflow, Workflow, WorkflowActionKind, WorkflowConditionKind

### Community 27 - "Base TypeScript Config"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib (+8 more)

### Community 28 - "Install Merge Notes"
Cohesion: 0.12
Nodes (16): 46-role team structure (33 build + 11 security), .claude/rules/agent-teams.md added, Browser daemon collisions across up to eight agents (fixed mechanism 4), 21-documentation-engineer role added, Honest limits of agent teams (experimental), Merge Notes — v1 to v2 changes, No tools: allowlist anywhere in v1 (fixed mechanism 3), permissionMode: not applied at spawn (fixed mechanism 2) (+8 more)

### Community 29 - "Testing Rules"
Cohesion: 0.14
Nodes (15): Define success before implementing non-trivial behavior, Do not hide failing tests with skips unless justified, Add regression coverage for important bug fixes, Testing Rules, Unit / integration / E2E test layering, docker-compose.yml (Postgres service), ourglass-postgres-data volume, postgres service (pgvector/pgvector:pg17) (+7 more)

### Community 30 - "Community 30"
Cohesion: 0.20
Nodes (7): AnthropicExtractor, AnthropicExtractorOptions, EXTRACTION_TOOL, ExtractionError, ExtractionFailureReason, Extractor, Forced extract_intents tool call

### Community 31 - "Community 31"
Cohesion: 0.15
Nodes (12): DefineEntityTypeInput, DefineEntityTypeOutput, DefineEntityTypeRawInput, defineEntityTypeTool, EntityTypeRow, FieldDefInput, FieldKind, isFieldKind() (+4 more)

### Community 32 - "Community 32"
Cohesion: 0.20
Nodes (14): /browse skill (forbidden), /design-review skill (forbidden), Frontend Lead, /qa skill (forbidden), Backend Lead, /benchmark skill (forbidden), /health skill, /investigate skill (Iron Law) (+6 more)

### Community 33 - "Community 33"
Cohesion: 0.15
Nodes (13): Anti-slop list (kill on sight), awesome design / impeccable references, Taste Director, taste skill (variance system), ui-ux-pro-max skill (styles/palettes/pairings), Written direction (deliverable), AI-slop checklist, Review priority list (spacing, hierarchy, density, alignment, colour, ai-slop, resilience, absence) (+5 more)

### Community 34 - "Community 34"
Cohesion: 0.15
Nodes (12): description, engines, node, @types/node, vitest, name, packageManager, private (+4 more)

### Community 35 - "Community 35"
Cohesion: 0.21
Nodes (7): buildServer(), main(), ServerOptions, TurnBody, UndoBody, fastify, pg

### Community 36 - "Community 36"
Cohesion: 0.18
Nodes (10): CreateReminderInput, CreateReminderOutput, CreateReminderRawInput, createReminderTool, isUuid(), ReminderRow, validate(), handlers (+2 more)

### Community 37 - "Community 37"
Cohesion: 0.18
Nodes (5): Deps, FakeRow, __resetInverseHandlersForTests(), AnyToolDefinition, ToolRegistry

### Community 38 - "Community 38"
Cohesion: 0.17
Nodes (13): Spec §22 — Conversational state updates, Spec §29 — The primary UI (inspection surfaces), Spec §28 — User control, action_log — the undo substrate, action_log turn_id grain — the conversational turn, Undo traverses only actor_kind='user_turn', Double-undo impossible — partial unique index, invertibility enum (full / lossy / none) (+5 more)

### Community 39 - "Community 39"
Cohesion: 0.18
Nodes (13): AI-slop design patterns to avoid, /design-consultation skill, Design Director, DESIGN.md, /design-review skill (lead-only, auto-commits), /design-shotgun skill, ui-ux-pro-max skill, /design-html skill (+5 more)

### Community 40 - "Community 40"
Cohesion: 0.15
Nodes (12): typescript, devDependencies, typescript, vitest, exports, vitest, main, name (+4 more)

### Community 41 - "Community 41"
Cohesion: 0.24
Nodes (10): CivilDateTime, civilToUtc(), DIRECTION_BY_INTENT_KIND, offsetMinutesAt(), ResolvedTime, resolveTime(), now, TimeDirection (+2 more)

### Community 42 - "Community 42"
Cohesion: 0.17
Nodes (10): nextConfig, vitest, name, private, version, eslint, next, react-dom (+2 more)

### Community 43 - "Community 43"
Cohesion: 0.17
Nodes (12): Keep commits focused and understandable, Git Rules, Do not commit secrets, build artifacts, or local machine state, For AI systems, evaluate prompt injection, tool abuse, exfiltration, unsafe side effects, Never hardcode secrets, Security Rules, Validate authorization server-side, Review SSRF, XSS, CSRF, injection, privesc, data leakage, secret exposure (+4 more)

### Community 44 - "Community 44"
Cohesion: 0.17
Nodes (3): CreateReminderInput, DueReminder, Reminder

### Community 45 - "Community 45"
Cohesion: 0.18
Nodes (11): Auto-committing skills never run in a teammate, freeze is a single global slot that protects a session from itself, The ownership map plus discipline is the entire cross-agent mechanism, The tools allowlist is the only enforced per-teammate restriction, Truncate-per-test isolation requires fileParallelism false, Defect class: schema with no code path, F6: tools written, typechecked, and never registered, The independent-review gate earns its cost (+3 more)

### Community 46 - "Community 46"
Cohesion: 0.18
Nodes (10): @anthropic-ai/sdk, @ourglass/shared, dependencies, @anthropic-ai/sdk, @ourglass/shared, vitest, name, private (+2 more)

### Community 47 - "Community 47"
Cohesion: 0.24
Nodes (10): commit(), CompleteCommitmentInput, CompleteCommitmentInversePatch, CompleteCommitmentOutput, CompleteCommitmentRawInput, completeCommitmentTool, deriveCompletion(), isIsoDate() (+2 more)

### Community 48 - "Community 48"
Cohesion: 0.18
Nodes (11): Company Claude OS v2 (root governance doc), Remote github.com/batoredev/OurGlass — WRITE not ADMIN, Architecture Rules, Document important irreversible decisions, Explicit boundaries and simple dependencies, Treat authn/authz and trust boundaries as architecture concerns, Treat database migrations as production code, Production Rules (+3 more)

### Community 49 - "Community 49"
Cohesion: 0.24
Nodes (8): isNonCompletingStatus(), isUuid(), NON_COMPLETING_STATUSES, UpdateCommitmentInput, UpdateCommitmentOutput, UpdateCommitmentRawInput, updateCommitmentTool, validate()

### Community 50 - "Community 50"
Cohesion: 0.20
Nodes (10): /review skill, /codex skill, Fix-First auto-apply behaviour, Greptile PR-comment triage, Staff Code Reviewer, Three-bucket report format (auto-fix / decision / completeness gap), Adversarial / Second-Model Reviewer, Codex CLI installed/authenticated hard requirement (+2 more)

### Community 51 - "Community 51"
Cohesion: 0.20
Nodes (10): HOLD SCOPE mode, Margin rule (scope expansion destroys margin on fixed-price work), /plan-ceo-review skill, SCOPE EXPANSION mode, SCOPE REDUCTION mode, SELECTIVE EXPANSION mode, Observable/falsifiable acceptance criteria, Business Analyst / Spec Author (+2 more)

### Community 52 - "Community 52"
Cohesion: 0.20
Nodes (10): AI / Agent Engineer, Cost-per-request design constraint, Eval set required before shipping AI feature, /investigate skill, /review skill (forbidden), Integration Engineer, Explicit partial-failure handling, Default owner of tools/ (+2 more)

### Community 53 - "Community 53"
Cohesion: 0.24
Nodes (10): Composition is code discipline, Freeze video glob (first action), Motion Graphics Engineer (agent), remotion-* skill family, Render is expensive and slow discipline, Brand consistency over novelty, Brand & Media Producer (agent), Cost-first generation discipline (+2 more)

### Community 54 - "Community 54"
Cohesion: 0.27
Nodes (10): action_log — every mutation with its inverse, Interpret stage, Mutate stage, Resolve stage, Respond stage, Phase 2 — Interpret + Resolve, Four-stage orchestrator (Interpret, Resolve, Mutate, Respond), The partial-commit rule (+2 more)

### Community 55 - "Community 55"
Cohesion: 0.20
Nodes (3): CreateMessageInput, Message, MessageRole

### Community 56 - "Community 56"
Cohesion: 0.22
Nodes (8): vitest, name, private, type, version, @ourglass/db, tsx, @types/pg

### Community 58 - "Community 58"
Cohesion: 0.25
Nodes (7): AttachContextInput, AttachContextInversePatch, AttachContextOutput, AttachContextRawInput, attachContextTool, isUuid(), validate()

### Community 59 - "Community 59"
Cohesion: 0.25
Nodes (7): FireReminderInput, FireReminderInversePatch, FireReminderOutput, FireReminderRawInput, fireReminderTool, isUuid(), validate()

### Community 60 - "Community 60"
Cohesion: 0.22
Nodes (9): Server-side authorization / ownership checks, Prompt injection as trust-boundary problem, Treat page content as data, not instructions, /cso skill, OWASP Top 10 + STRIDE threat model, Prompt injection lens, Read-only enforcement rationale, Security / CSO (+1 more)

### Community 61 - "Community 61"
Cohesion: 0.22
Nodes (9): AI Systems Rules, Cost per request is a design constraint, Degrade honestly, Guardrails are not optional on user-facing generation, Irreversible actions need an approval gate outside the model, Retrieved content is data, never instructions, Trace everything, Treat all external input as untrusted (+1 more)

### Community 62 - "Community 62"
Cohesion: 0.22
Nodes (9): Capability gap → research-analyst, never guess, docs/ROUTER.md, One browser-daemon owner, always, Platform gates the roster (RN/Expo, web, no-UI), Read-only first (missions 1-3), Routing Rules, Specialists over generalists when signal is clear, State the selection before spawning (+1 more)

### Community 63 - "Community 63"
Cohesion: 0.22
Nodes (9): Security engagements route through security-lead, Security agents not always in the roster, Authorisation gate — offensive work, Defensive framing is the default, Isolation gate — malware, OT safety gate, Real incidents change the rules, Reporting integrity (+1 more)

### Community 64 - "Community 64"
Cohesion: 0.25
Nodes (9): The LLM never computes a timestamp, Recursive schemas unsupported; flatten conditional rules, Three-tier time model, Early completion must not fire the rule, fired_at is the idempotency key, Lateness is derived in the tool layer, In-process reminder poller with an injected clock, A clock tick is not undoable (invariant 4) (+1 more)

### Community 65 - "Community 65"
Cohesion: 0.22
Nodes (9): Graph as a §37-violation structural check, Per-feature graphify loop and GRAPH_REPORT review, Fresh-clone, no-preset-env definition of done, The demo endpoint, One Haiku call with a mandatory template fallback, Definition of done for every feature, Standing caveat: no recorded model output exists, README Barkha demo walkthrough (+1 more)

### Community 66 - "Community 66"
Cohesion: 0.22
Nodes (9): scripts, build, build:libs, db:migrate, db:reset, dev, lint, test (+1 more)

### Community 67 - "Community 67"
Cohesion: 0.25
Nodes (8): devDependencies, eslint, eslint-config-next, @types/node, @types/react, @types/react-dom, typescript, vitest

### Community 68 - "Community 68"
Cohesion: 0.25
Nodes (8): Default ownership map (packages/db -> database-data-engineer, apps/api/assistant -> ai-agent-engineer, apps/web -> frontend-lead), Project: Batore Personal Assistant / OurGlass, Stack: TypeScript pnpm monorepo (apps/web, apps/api, packages/shared, packages/db, packages/evals), Ships with an eval set, or does not ship, Evals workflow, fixtures job (recorded fixtures, free deterministic), Fork PR cannot reach ANTHROPIC_API_KEY constraint, live job (manual workflow_dispatch only, costs tokens)

### Community 69 - "Community 69"
Cohesion: 0.25
Nodes (8): WAT operating model (Workflows/Agents/Tools), Codify what repeats, The failure loop, File discipline (.tmp/, tools/, workflows/, .env), Never invent a tool's behaviour, Tool-first, always, WAT Rules — Workflows Agents Tools, Workflows are preserved, not replaced

### Community 70 - "Community 70"
Cohesion: 0.29
Nodes (8): add_entity_field must be non-breaking (optional-only), Deferrable ordinal uniqueness on entity_type_fields, define_entity_type rejects unknown field kinds at validation time, Dynamic entity registry (entity_types / fields / records), Caps: 32 fields per type, 64 types, entity_type_fields closed field_kind enum (six kinds), validate-is-a-function property, Zero-frontend-change guarantee for new entity types

### Community 72 - "Community 72"
Cohesion: 0.29
Nodes (7): dependencies, @anthropic-ai/sdk, chrono-node, fastify, @ourglass/db, @ourglass/shared, pg

### Community 73 - "Community 73"
Cohesion: 0.29
Nodes (7): scripts, build, dev, start, test, test:integration, typecheck

### Community 74 - "Community 74"
Cohesion: 0.29
Nodes (7): scripts, build, dev, lint, start, test, typecheck

### Community 75 - "Community 75"
Cohesion: 0.29
Nodes (7): Spec §7 — Ownership matters, create_commitment — the first tool to implement, executeTurn — validate then commit then log, Ownership direction is two explicit FK columns, The resolved-UUID input contract, ToolDefinition / ToolContext / ToolError / LoggedMutation, The tool registry (apps/api/src/tools)

### Community 76 - "Community 76"
Cohesion: 0.33
Nodes (7): docs/AGENT-FLOW.md — standard delivery flow, Escalation to the CTO, docs/AGENT-HANDBOOK.md — the 46-role handbook, docs/ROUTER.md — job to agents, docs/SECURITY-MISSIONS.md — security mission templates, docs/SECURITY-ROUTER.md — security family to agent, Authorisation / isolation / OT safety gates

### Community 77 - "Community 77"
Cohesion: 0.29
Nodes (7): devDependencies, eslint, @eslint/js, @types/node, typescript, typescript-eslint, vitest

### Community 78 - "Community 78"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, rootDir, extends, include, ./tsconfig.json

### Community 79 - "Community 79"
Cohesion: 0.33
Nodes (6): devDependencies, tsx, @types/node, @types/pg, typescript, vitest

### Community 80 - "Community 80"
Cohesion: 0.40
Nodes (6): Risk — prompt injection via ingested screenshot/PDF, Spec §37 — the LLM proposes, the backend validates and commits, isExtraction runtime validator, Model receives no DB handle, UUID, or mutation tool, Phase 2 creates no messages or state mutations, Phase 2 trust boundary

### Community 81 - "Community 81"
Cohesion: 0.33
Nodes (6): Phase 1 file-ownership map, No browser owner in Phase 1, docs/SKILL-COVERAGE.md — gstack skill coverage audit, Lead-only skills — deliberately not given to teammates, docs/SKILL-ROUTING.md — ecosystem responsibilities, Skill binding is advisory — teammates load from settings

### Community 82 - "Community 82"
Cohesion: 0.33
Nodes (6): chrono-node 2.10.1 deterministic time resolution, Deterministic time tier, Event trigger tier, Relational time tier, Three-tier time split, Model returns verbatim time phrases only

### Community 83 - "Community 83"
Cohesion: 0.60
Nodes (5): entity_records, entity_records_current, entity_type_fields, entity_types, entity_types_current

### Community 84 - "Community 84"
Cohesion: 0.40
Nodes (5): dependencies, next, @ourglass/shared, react, react-dom

### Community 85 - "Community 85"
Cohesion: 0.40
Nodes (5): Spec §12 — Inference levels (CONFIRMED/INFERRED/UNCERTAIN), Spec §17 — Memory correction, Spec §16 — Memory provenance, Invalidate, never delete, relationships.inference_level — enum, not a float

### Community 86 - "Community 86"
Cohesion: 0.50
Nodes (5): Three-band entity resolution with hard vetoes, LLM proposes, backend validates and commits, A wrong merge is worse than a duplicate, The auto_match band is near-unreachable by construction, One inverse handler per table, dispatching on patch shape

### Community 87 - "Community 87"
Cohesion: 0.40
Nodes (5): people_current view (filters, does not resolve), Repository discipline — raw people access in one file, resolve_merged cycle guard (16-hop depth cap), resolve_person(uuid) dereference function, Two read shapes — list vs dereference-by-id

### Community 88 - "Community 88"
Cohesion: 0.60
Nodes (4): commitment_notes, commitment_notes_current, messages_current, messages

### Community 89 - "Community 89"
Cohesion: 0.50
Nodes (4): main(), Do the actual work. Keep this deterministic., One-line description of what this tool does. Inputs: --example-id the thing to…, run()

### Community 91 - "Community 91"
Cohesion: 0.50
Nodes (4): Actionable brief output format (QUESTION/ANSWER/CONFIDENCE/SOURCES/HOW TO DO IT/GOTCHAS/UNKNOWNS/OPEN QUESTION), Spawned on capability gap (unfamiliar API/framework/protocol/regulation), Primary-sources-first research method, Research Analyst

### Community 92 - "Community 92"
Cohesion: 0.50
Nodes (4): commitments — the primary abstraction, not tasks, Ownership direction is structural (owner_id/recipient_id), Risk — wrong auto-merge silently destroys a commitment, Hard vetoes on owner/recipient and completion state

### Community 93 - "Community 93"
Cohesion: 0.50
Nodes (4): Ask band (0.65–0.92 or a tie), Auto-resolve band (>=0.92, single candidate), Reject band (below 0.65), Three-band entity resolution policy

### Community 94 - "Community 94"
Cohesion: 0.50
Nodes (4): devDependencies, @types/node, typescript, vitest

### Community 95 - "Community 95"
Cohesion: 0.50
Nodes (4): scripts, test, test:live, typecheck

### Community 96 - "Community 96"
Cohesion: 0.50
Nodes (4): scripts, build, test, typecheck

### Community 98 - "Community 98"
Cohesion: 0.67
Nodes (3): Bitemporal data model (invalidate, never delete), One Postgres, no separate vector store, commitment_notes is a table, not a column (finding F4)

### Community 99 - "Community 99"
Cohesion: 0.67
Nodes (3): ExtractionResult, resolvePersonMention, Resolved-UUID handoff to Phase 1 ToolCalls

### Community 100 - "Community 100"
Cohesion: 0.67
Nodes (3): Dependabot config, npm package-ecosystem (used for pnpm project), Pinned major-version ignores (typescript, eslint, @eslint/js, vitest)

## Ambiguous Edges - Review These
- `docs/SPEC.md — extracted spec text` → `Agent teams operating guide (PDF)`  [AMBIGUOUS]
  docs/SPEC.md · relation: conceptually_related_to

## Knowledge Gaps
- **598 isolated node(s):** `ExtractionFixture`, `EntityMention`, `ExtractedIntent`, `Extraction`, `ExtractionResult` (+593 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 792 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **37 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `docs/SPEC.md — extracted spec text` and `Agent teams operating guide (PDF)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `pg` connect `Community 35` to `Community 56`, `Community 57`, `Reminder Poller`, `DB Client and Index`?**
  _High betweenness centrality (0.146) - this node is a cross-community bridge._
- **Why does `typescript` connect `Community 40` to `Community 34`, `Package Dependencies`, `Community 42`, `Community 46`, `Community 56`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `Forced extract_intents tool call` connect `Community 30` to `Extraction Schema`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **What connects `ExtractionFixture`, `EntityMention`, `ExtractedIntent` to the rest of the system?**
  _598 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Agent Roster Contracts` be split into smaller, more focused modules?**
  _Cohesion score 0.04964539007092199 - nodes in this community are weakly interconnected._
- **Should `Frontend Specialist Agents` be split into smaller, more focused modules?**
  _Cohesion score 0.045454545454545456 - nodes in this community are weakly interconnected._