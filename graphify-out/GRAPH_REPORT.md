# Graph Report - OurGlass  (2026-09-17)

## Corpus Check
- 29 files · ~250,630 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2050 nodes · 3095 edges · 161 communities (118 shown, 32 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 93 edges (avg confidence: 0.84)
- Token cost: 204,024 input · 0 output

## Community Hubs (Navigation)
- Orchestrator Integration Tests
- Web UI Pages
- Extraction Eval Harness
- Next Route Handlers
- Agent Roster Contracts and Docs
- Agent Roster Motion and Design
- Evals CI and Router Fallback
- Turn Orchestrator Planners
- Web App Config
- AI Systems Rules
- Respond Stage
- Migrations and Repositories
- Tool Layer and Errors
- Product Spec Sections
- API TypeScript Config
- DB Package Manifest
- AI Model Router
- Provider Error Classification
- Assistant Contract
- Resolve and Deduplication
- Core Entity Migrations
- Commitments Repository
- Mission Templates
- Tool Contract and Transactions
- Memory Tools
- Claude Provider
- Memories Repository
- People Repository
- Qwen Provider
- Web TypeScript Config
- QA and Browser Skills
- Database Client and Orgs
- API Package Manifest
- Activity Log and Reminder Firing
- Workflow Tools
- Agent Routing Rules
- Create Commitment Tool
- Design Direction Roles
- DevOps and Release Roles
- Motion Graphics Role
- Workflows Repository
- Respond Contract Facts
- Base TypeScript Config
- Package Manifests
- Tool Registry
- Solutions Architect Planning
- Extraction Contract Decisions
- Entity Records Repository
- Shared Package Manifest
- Typed AI Configuration
- Gemini Provider
- Attach Context Tool
- CTO Delivery Lead
- Product CEO Strategy
- Testing Rules
- Architecture Decisions
- Relationships Repository
- Proactive Behaviour
- Define Entity Type Tool
- Spec State and UI Sections
- Taste Direction Role
- Entity Resolution Decisions
- Lint and Root Manifest
- Locked Decisions and Pins
- Deterministic Time Resolution
- Community 65
- Reminders Repository
- Complete Commitment Tool
- Create Event Tool
- Defect Classes and Test Discipline
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Graph and Action Log Findings
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
- Shared Barrel and Risk Levels
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
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
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
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
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 159
- Community 160

## God Nodes (most connected - your core abstractions)
1. `docs/SPEC.md — extracted spec text` - 40 edges
2. `demoEnabled()` - 19 edges
3. `Queryable` - 17 edges
4. `read()` - 17 edges
5. `compilerOptions` - 17 edges
6. `compilerOptions` - 16 edges
7. `CTO / Delivery Lead` - 16 edges
8. `ProviderError` - 16 edges
9. `classifyProviderError()` - 16 edges
10. `ExtractionError` - 16 edges

## Surprising Connections (you probably didn't know these)
- `Invalidate, never delete` --semantically_similar_to--> `Spec §17 — Memory correction`  [INFERRED] [semantically similar]
  docs/PHASE-1-DESIGN.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §7 — Ownership matters`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §12 — Inference levels (CONFIRMED/INFERRED/UNCERTAIN)`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §16 — Memory provenance`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §6 — Commitments are a core data model`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **The scheduled-job path: poll, fire, evaluate, refuse undo** — docs_phase_3_design_poller, docs_phase_3_design_fired_at_idempotency, docs_phase_3_design_scheduled_job_not_undoable, docs_phase_3_design_workflow_evaluate_at_deadline, docs_phase_3_design_early_completion_silences_rule [EXTRACTED 0.90]
- **GitHub Plus Supabase Plus Cloudflare Deployment Target** — docs_deployment_design_route_handlers_migration, docs_deployment_design_cron_trigger_poller, docs_deployment_design_supabase_direct_connection, docs_deployment_design_pg_version_pin, docs_your_actions_cloudflare_deploy_secrets [EXTRACTED 1.00]
- **The Interpret-Resolve-Mutate-Respond Turn Pipeline** — docs_execution_plan_four_stage_orchestrator, docs_planner_wiring_design_extracted_intent, docs_phase_2_design_three_band_resolution, docs_execution_plan_typed_tool_layer, docs_execution_plan_action_log [EXTRACTED 1.00]
- **File-ownership map enforced via /freeze across implementer agents** — claude_agents_04_solutions_architect_file_ownership_table, claude_agents_18_devops_sre_freeze [EXTRACTED 1.00]
- **Security practice engagement lifecycle (lead routes to offensive/defensive/dfir)** — claude_agents_34_security_lead_security_lead, claude_agents_35_offensive_security_engineer_offensive_security_engineer, claude_agents_36_dfir_analyst_dfir_analyst, claude_agents_37_detection_engineer_detection_engineer, claude_agents_38_threat_hunter_threat_hunter [EXTRACTED 1.00]
- **Single browser owner constraint across QA, performance, and devex roles** — claude_agents_12_qa_browser_lead_qa_browser_lead, claude_agents_14_performance_engineer_performance_engineer, claude_agents_17_devex_engineer_devex_engineer, claude_agents_07_frontend_lead_frontend_lead [EXTRACTED 1.00]
- **Merge-resolution invariant: pointer, view, resolver, cycle guard, lossy-inverse fix** — docs_phase_1_design_merged_into_id, docs_phase_1_design_people_current_view, docs_phase_1_design_resolve_person, docs_phase_1_design_resolve_merged_cycle_guard [EXTRACTED 1.00]
- **The Phase 2 trust boundary — model proposes typed mentions, backend resolves and commits** — docs_phase_2_design_extract_intents_tool, docs_phase_2_design_model_gets_no_db_handle, docs_phase_2_design_is_extraction_validator, docs_phase_2_design_verbatim_time_phrase, docs_phase_2_design_resolved_uuid_handoff, docs_phase_2_design_never_write_sql_from_model [EXTRACTED 1.00]
- **Planning/execution chain: plan, decisions, phases, Phase 1 design** — docs_phase_1_design [EXTRACTED 1.00]
- **Turn-grained undo pipeline: validate, commit, log, undo** — docs_phase_1_design_validate_is_a_function, docs_phase_1_design_execute_turn, docs_phase_1_design_action_log_turn_id_grain, docs_phase_1_design_undo_turn, docs_phase_1_design_double_undo_partial_unique_index [EXTRACTED 1.00]
- **Read-only/deterministic QA roles distinct from browser daemon** — claude_agents_25_web_standards_engineer_web_standards_engineer, claude_agents_26_accessibility_engineer_accessibility_engineer, claude_agents_27_e2e_automation_engineer_e2e_automation_engineer [INFERRED 0.75]
- **CI/eval/security workflow triad gating merges to main** — github_workflows_ci_ci_workflow, github_workflows_codeql_codeql_workflow [INFERRED 0.85]
- **Frontend polish/QA specialist trio (motion, taste, visual critique)** — claude_agents_23_motion_engineer_motion_engineer, claude_agents_24_taste_director_taste_director, claude_agents_33_visual_critic_visual_critic [INFERRED 0.85]
- **Untrusted-content / prompt-injection trust boundary discipline across roles** — claude_agents_10_ai_agent_engineer_prompt_injection_trust_boundary, claude_agents_13_security_cso_prompt_injection_lens, claude_agents_12_qa_browser_lead_untrusted_page_content, claude_agents_11_integration_engineer_webhook_untrusted_principle [INFERRED 0.85]
- **Phase 4 silent failure modes, all returning plausible output** — docs_phase_4_design_input_type_asymmetry, docs_phase_4_design_iterative_scan, docs_phase_4_design_structured_not_semantic, docs_phase_4_design_supersede_not_update [INFERRED 0.85]
- **Claude, Gemini, and Qwen implement the AIProvider contract** — apps_api_src_ai_provider, apps_api_src_ai_claude, apps_api_src_ai_gemini, apps_api_src_ai_qwen [EXTRACTED 1.00]
- **Turn pipeline: route handler, orchestrator, router, and respond stage** — apps_web_app_api_turn_route, apps_api_src_assistant_orchestrator, apps_api_src_ai_router, apps_api_src_assistant_respond [EXTRACTED 1.00]
- **AI_ARCHITECTURE, AI_PROVIDERS, AI_FALLBACK, and AI_EVALS form one cross-linked documentation set** — docs_ai_architecture, docs_ai_providers, docs_ai_fallback, docs_ai_evals [EXTRACTED 1.00]

## Communities (161 total, 32 thin omitted)

### Community 0 - "Orchestrator Integration Tests"
Cohesion: 0.05
Nodes (48): commitmentOwedByBarkha(), deps(), fakeExtractor(), intent(), mention(), owedByBarkha(), recordingResponder(), scheduleIntent() (+40 more)

### Community 1 - "Web UI Pages"
Cohesion: 0.07
Nodes (53): ActivityPage(), dynamic, CommitmentsPage(), dynamic, metadata, dynamic, MemoryPage(), dynamic (+45 more)

### Community 2 - "Extraction Eval Harness"
Cohesion: 0.07
Nodes (38): The Fixture Set (99 hand-labelled utterances), Deterministic fixture eval lane (free, every PR), allIntents, extractionTool, EXTRACTION_FIXTURES, ExtractionFixture, me, conditionMatches() (+30 more)

### Community 3 - "Next Route Handlers"
Cohesion: 0.07
Nodes (37): dynamic, GET(), runtime, dynamic, GET(), runtime, HERE, { queryMock, demoMock, undoTurnMock } (+29 more)

### Community 4 - "Agent Roster Contracts and Docs"
Cohesion: 0.05
Nodes (48): API Contract Engineer, Contract ownership (schema, versioning, breaking-change detection), /freeze schema/contract glob (first action), Publish contract before implementation starts, /document-generate skill (Diataxis structure), Every code example must run, /freeze developer docs glob (first action), Technical Writer (Developer-Facing) (+40 more)

### Community 5 - "Agent Roster Motion and Design"
Cohesion: 0.05
Nodes (44): Common report format (Status/What changed/Verified/Risks/Blocked/Next action), animejs skill, Emil Kowalski reference, framer-motion skill, /freeze motion glob (first action), Motion Engineer, Motion principles (duration, easing, interruptibility, reduced-motion), motion / motion-dom / motion-utils skills (+36 more)

### Community 6 - "Evals CI and Router Fallback"
Cohesion: 0.10
Nodes (37): Evals CI Workflow, fixtures job (recorded-fixtures lane, free, deterministic), live job (live-model lane, manual dispatch only), RESPOND_FALLBACK_REASONS, RoutedInterpretation, RoutedReply, AI Architecture, AI Layer Dependency Boundary (ai depends on assistant, never the reverse) (+29 more)

### Community 7 - "Turn Orchestrator Planners"
Cohesion: 0.12
Nodes (36): blockedIntentIndices(), describeMention(), embedRecallQueries(), formatLocal(), IntentPlan, persistAssistantMessage(), planCommitment(), planCompletion() (+28 more)

### Community 8 - "Web App Config"
Cohesion: 0.05
Nodes (34): config, nextConfig, dependencies, next, @ourglass/api, @ourglass/db, @ourglass/shared, react (+26 more)

### Community 9 - "AI Systems Rules"
Cohesion: 0.05
Nodes (37): AI Systems Rules, Cost per request is a design constraint, Degrade honestly, Guardrails are not optional on user-facing generation, Irreversible actions need an approval gate outside the model, Retrieved content is data, never instructions, Ships with an eval set, or does not ship, Trace everything (+29 more)

### Community 10 - "Respond Stage"
Cohesion: 0.10
Nodes (24): ClaudeProviderOptions, GEMINI_DEFAULT_INTERPRET_MODEL, GEMINI_DEFAULT_RESPOND_MODEL, GeminiProviderOptions, REFUSAL_REASONS, assertNever(), describeFact(), formatDuration() (+16 more)

### Community 11 - "Migrations and Repositories"
Cohesion: 0.10
Nodes (18): users_current, createPool(), withTransaction(), commitmentNotes, commitments, entityRecords, events, memories (+10 more)

### Community 12 - "Tool Layer and Errors"
Cohesion: 0.11
Nodes (21): makePerson(), NotInvertibleError, PG_UNIQUE_VIOLATION, ToolNotFoundError, TurnAlreadyUndoneError, TurnNotFoundError, ValidationFailedError, ActionLogEntry (+13 more)

### Community 13 - "Product Spec Sections"
Cohesion: 0.06
Nodes (33): Spec §11 — Ambiguity handling, Spec §10 — Ask about people when necessary, Spec §3 — The central product principle, Spec §8 — Commitment lifecycle, Spec §21 — Completing the user's own work, Spec §25 — Conditional commitments / workflows, Spec §24 — Conflict detection, Spec §20 — Context after completion (+25 more)

### Community 14 - "API TypeScript Config"
Cohesion: 0.06
Nodes (27): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.base.json, references, compilerOptions (+19 more)

### Community 15 - "DB Package Manifest"
Cohesion: 0.07
Nodes (29): dependencies, node-pg-migrate, @ourglass/shared, pg, devDependencies, @types/node, @types/pg, typescript (+21 more)

### Community 16 - "AI Model Router"
Cohesion: 0.11
Nodes (11): ProviderError, AIModelRouter, AllProvidersFailedError, correlationId(), RoutedExtractor, RoutedResponder, FakeOptions, GOOD_REPLY (+3 more)

### Community 17 - "Provider Error Classification"
Cohesion: 0.13
Nodes (18): categoryForExtractionError(), categoryForStatus(), classifyProviderError(), FAILURE_POLICY, FailurePolicy, messageOf(), readCode(), readName() (+10 more)

### Community 18 - "Assistant Contract"
Cohesion: 0.08
Nodes (25): CommitmentStatusHint, CONDITION_KEYS, ConditionReference, ENTITY_KEYS, ENTITY_RECORD_KEYS, EntityFieldHint, EntityMention, EntityRecordHint (+17 more)

### Community 19 - "Resolve and Deduplication"
Cohesion: 0.15
Nodes (22): CommitmentProposal, CompletionMatch, contentTokens(), decideCompletion(), detectDuplicate(), DuplicateDecision, EntityResolution, FIRST_PERSON_MENTIONS (+14 more)

### Community 20 - "Core Entity Migrations"
Cohesion: 0.14
Nodes (22): it, organizations, organizations_current, people, people_current, projects, projects_current, resolve_organization() (+14 more)

### Community 21 - "Commitments Repository"
Cohesion: 0.09
Nodes (12): assertUpdatableField(), Commitment, CommitmentFieldPatch, CompleteCommitmentResult, CreateCommitmentInput, CurrentCommitment, OverdueCommitment, restoreCommitmentFields() (+4 more)

### Community 22 - "Mission Templates"
Cohesion: 0.11
Nodes (24): docs/MISSIONS.md — mission templates, Mission 0 — Discovery, Mission 1 — Four-lens plan review, Mission 2 — Four-lens code review, Mission 3 — Competing-hypothesis debug, Mission 4 — Cross-layer feature build, Mission 4c — Showcase-grade interface, Mission 6.5 — Codify (tools from repeated mechanical steps) (+16 more)

### Community 23 - "Tool Contract and Transactions"
Cohesion: 0.11
Nodes (19): ActorKind, DatabaseTransaction, err(), ExecuteTurnResult, fakeQueryResult(), Invertibility, LoggedMutation, ok() (+11 more)

### Community 24 - "Memory Tools"
Cohesion: 0.10
Nodes (19): CorrectRelationshipInput, CorrectRelationshipInversePatch, CorrectRelationshipOutput, ForgetMemoryInput, ForgetMemoryInversePatch, ForgetMemoryOutput, INFERENCE_LEVELS, InferenceLevel (+11 more)

### Community 25 - "Claude Provider"
Cohesion: 0.14
Nodes (7): ClaudeProvider, EXTRACTION, provider(), REPLY, AIProvider, InterpretInput, RespondResult

### Community 26 - "Memories Repository"
Cohesion: 0.13
Nodes (15): createMemory(), CreateMemoryInput, Memory, MemoryKind, MemorySubjectKind, RankedRow, RRF_K, ScoredMemory (+7 more)

### Community 27 - "People Repository"
Cohesion: 0.10
Nodes (10): CreatePersonInput, Person, NOTE: t_invalid is overwritten UNCONDITIONALLY here, unlike the invalidate*, NOTE: this is NOT the inverse of a merge. `mergePerson` sets `t_invalid` AND, ensureUser(), EnsureUserInput, getUser(), getUserWithPerson() (+2 more)

### Community 28 - "Qwen Provider"
Cohesion: 0.13
Nodes (11): FetchLike, OLLAMA_DEFAULT_BASE_URL, OLLAMA_DEFAULT_MODEL, OllamaChatResponse, QWEN_DEFAULT_INTERPRET_TIMEOUT_MS, QwenProvider, QwenProviderOptions, Captured (+3 more)

### Community 29 - "Web TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, forceConsistentCasingInFileNames, incremental, isolatedModules, jsx, lib (+11 more)

### Community 30 - "QA and Browser Skills"
Cohesion: 0.12
Nodes (20): /autoplan skill, Cost-per-request design constraint, /benchmark skill, /browse skill, /open-gstack-browser skill, QA / Browser Engineering Lead, /qa-only skill, /scrape skill (+12 more)

### Community 31 - "Database Client and Orgs"
Cohesion: 0.12
Nodes (6): Queryable, Transactable, Organization, unmergeOrganization(), Project, unmergeProject()

### Community 32 - "API Package Manifest"
Cohesion: 0.12
Nodes (17): @anthropic-ai/sdk, @ourglass/shared, vitest, name, private, type, version, @types/node (+9 more)

### Community 33 - "Activity Log and Reminder Firing"
Cohesion: 0.13
Nodes (13): ActivityEntry, listRecentActivity(), FireReminderInput, FireReminderInversePatch, FireReminderOutput, FireReminderRawInput, fireReminderTool, isUuid() (+5 more)

### Community 34 - "Workflow Tools"
Cohesion: 0.12
Nodes (15): ACTION_KINDS, CONDITION_KINDS, CreateWorkflowInput, CreateWorkflowInversePatch, CreateWorkflowOutput, CreateWorkflowRawInput, createWorkflowTool, EvaluateWorkflowInput (+7 more)

### Community 35 - "Agent Routing Rules"
Cohesion: 0.11
Nodes (18): Capability gap → research-analyst, never guess, docs/ROUTER.md, One browser-daemon owner, always, Platform gates the roster (RN/Expo, web, no-UI), Read-only first (missions 1-3), Routing Rules, Security engagements route through security-lead, Specialists over generalists when signal is clear (+10 more)

### Community 36 - "Create Commitment Tool"
Cohesion: 0.15
Nodes (14): classifyCommitmentsInverse(), CommitmentsInversePatch, CompleteInversePatch, CreateCommitmentInput, CreateCommitmentOutput, CreateCommitmentRawInput, createCommitmentTool, CreateInversePatch (+6 more)

### Community 37 - "Design Direction Roles"
Cohesion: 0.15
Nodes (17): AI-slop design patterns to avoid, /design-consultation skill, Design Director, DESIGN.md, /design-review skill (lead-only, auto-commits), /design-shotgun skill, ui-ux-pro-max skill, /browse skill (forbidden) (+9 more)

### Community 38 - "DevOps and Release Roles"
Cohesion: 0.14
Nodes (17): DevOps / SRE, /guard skill, /land-and-deploy skill (forbidden), Documented rollback for every deploy path, /setup-deploy skill, /ship skill (forbidden), /document-release skill, /land-and-deploy skill (+9 more)

### Community 39 - "Motion Graphics Role"
Cohesion: 0.13
Nodes (17): Composition is code discipline, Freeze video glob (first action), Motion Graphics Engineer (agent), remotion-* skill family, Render is expensive and slow discipline, Brand consistency over novelty, Brand & Media Producer (agent), Cost-first generation discipline (+9 more)

### Community 40 - "Workflows Repository"
Cohesion: 0.12
Nodes (7): CommitmentStatus, TERMINAL_STATUSES, CreateWorkflowInput, DueWorkflow, Workflow, WorkflowActionKind, WorkflowConditionKind

### Community 41 - "Respond Contract Facts"
Cohesion: 0.12
Nodes (15): CommitmentCompletedFact, CommitmentCreatedFact, CommitmentUpdatedFact, CommittedFact, EntityRecordCreatedFact, EntityTypeDefinedFact, EventScheduledFact, MemoryForgottenFact (+7 more)

### Community 42 - "Base TypeScript Config"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib (+8 more)

### Community 43 - "Package Manifests"
Cohesion: 0.12
Nodes (16): default, types, default, types, default, types, exports, ./ai (+8 more)

### Community 44 - "Tool Registry"
Cohesion: 0.21
Nodes (8): AnyToolDefinition, ToolRegistry, assertRiskTableCovers(), highestRisk(), requiresConfirmation(), RISK_BY_TOOL, riskFor(), UnclassifiedToolError

### Community 45 - "Solutions Architect Planning"
Cohesion: 0.14
Nodes (16): File-ownership map, /learn skill, /diagram skill, File-ownership table appended to plan, /plan-eng-review skill, Shared task list (5-6 tasks per teammate), Solutions Architect, AI / Agent Engineer (+8 more)

### Community 46 - "Extraction Contract Decisions"
Cohesion: 0.12
Nodes (15): inference_level enum (CONFIRMED/INFERRED/UNCERTAIN), Shared contract prevents API/eval drift, Six spec §5 intent kinds, INTENT_KINDS, COMMITMENT_STATUS_HINTS, CONDITION_SCHEMA, ENTITY_FIELD_SCHEMA, ENTITY_RECORD_SCHEMA (+7 more)

### Community 47 - "Entity Records Repository"
Cohesion: 0.15
Nodes (10): CreateEntityRecordInput, EntityRecord, EntityType, EntityTypeField, EntityTypeWithFields, EnumOption, FieldKind, getTypeByKey() (+2 more)

### Community 48 - "Shared Package Manifest"
Cohesion: 0.12
Nodes (15): devDependencies, typescript, vitest, exports, vitest, main, name, private (+7 more)

### Community 49 - "Typed AI Configuration"
Cohesion: 0.27
Nodes (12): AIConfig, AIEnv, buildAIRouter(), buildProvider(), BuildRouterOptions, describeProviders(), loadAIConfig(), NoProviderConfiguredError (+4 more)

### Community 50 - "Gemini Provider"
Cohesion: 0.17
Nodes (8): GeminiLikeClient, GeminiLikeResponse, GeminiProvider, generateContent(), client(), provider(), VALID_EXTRACTION, @google/genai

### Community 51 - "Attach Context Tool"
Cohesion: 0.15
Nodes (12): AttachContextInput, AttachContextInversePatch, AttachContextOutput, AttachContextRawInput, attachContextTool, isUuid(), validate(), applyInverseForTable() (+4 more)

### Community 52 - "CTO Delivery Lead"
Cohesion: 0.14
Nodes (15): Single browser owner rule, /context-save skill, CTO / Delivery Lead, /plan-tune skill, /qa skill, research-analyst agent, /retro skill, /skillify skill (+7 more)

### Community 53 - "Product CEO Strategy"
Cohesion: 0.13
Nodes (15): /office-hours skill, HOLD SCOPE mode, Margin rule (scope expansion destroys margin on fixed-price work), /plan-ceo-review skill, Product / CEO Strategist, SCOPE EXPANSION mode, SCOPE REDUCTION mode, SELECTIVE EXPANSION mode (+7 more)

### Community 54 - "Testing Rules"
Cohesion: 0.14
Nodes (15): Define success before implementing non-trivial behavior, Do not hide failing tests with skips unless justified, Add regression coverage for important bug fixes, Testing Rules, Unit / integration / E2E test layering, docker-compose.yml (Postgres service), ourglass-postgres-data volume, postgres service (pgvector/pgvector:pg17) (+7 more)

### Community 55 - "Architecture Decisions"
Cohesion: 0.15
Nodes (15): action_log Grain Is The Conversational Turn, In-Process Reminder Poller, node-pg-migrate Forward-Only Migrations, One Postgres Instance With pgvector, Cloudflare Workers Port, Reminder Poller As Cron Trigger, Framework-Agnostic Repository Boundary, pg Pinned To 8.16.3 Or Higher (+7 more)

### Community 56 - "Relationships Repository"
Cohesion: 0.17
Nodes (8): InferenceLevel, createRelationship(), CreateRelationshipInput, getById(), Relationship, RelationshipObjectKind, supersedeRelationship(), SupersedeResult

### Community 57 - "Proactive Behaviour"
Cohesion: 0.19
Nodes (10): detectTimeConflicts(), findNewlyOverdue(), formatDuration(), ProactiveCandidate, ProactiveContext, renderProactiveLine(), selectProactiveLine(), conflict (+2 more)

### Community 58 - "Define Entity Type Tool"
Cohesion: 0.15
Nodes (12): DefineEntityTypeInput, DefineEntityTypeOutput, DefineEntityTypeRawInput, defineEntityTypeTool, EntityTypeRow, FieldDefInput, FieldKind, isFieldKind() (+4 more)

### Community 59 - "Spec State and UI Sections"
Cohesion: 0.15
Nodes (14): Spec §22 — Conversational state updates, Spec §29 — The primary UI (inspection surfaces), Spec §28 — User control, action_log — the undo substrate, action_log turn_id grain — the conversational turn, Undo traverses only actor_kind='user_turn', Double-undo impossible — partial unique index, invertibility enum (full / lossy / none) (+6 more)

### Community 60 - "Taste Direction Role"
Cohesion: 0.15
Nodes (13): Anti-slop list (kill on sight), awesome design / impeccable references, Taste Director, taste skill (variance system), ui-ux-pro-max skill (styles/palettes/pairings), Written direction (deliverable), AI-slop checklist, Review priority list (spacing, hierarchy, density, alignment, colour, ai-slop, resilience, absence) (+5 more)

### Community 61 - "Entity Resolution Decisions"
Cohesion: 0.16
Nodes (14): Independent Review Pipeline, Bitemporal Modelling, Dynamic Entity Types Are An Owner Addition, Locked Decisions and Research Findings, Non-Destructive Merge, resolve_merged Cycle-Guarded Dereference, A Wrong Merge Is Worse Than A Duplicate, commitments Table (+6 more)

### Community 62 - "Lint and Root Manifest"
Cohesion: 0.15
Nodes (12): description, engines, node, vitest, name, packageManager, private, type (+4 more)

### Community 63 - "Locked Decisions and Pins"
Cohesion: 0.15
Nodes (13): WAT Operating Model (Workflows, Agents, Tools), Every CI Job Is A Clean Runner, ESLint 9.39.5 Pin, Truncate-Per-Test Requires fileParallelism False, CONFIRMED / INFERRED / UNCERTAIN Enum, The LLM Must Not Compute Timestamps, Sonnet and Haiku Only, Never Opus, Three-Tier Time Model (+5 more)

### Community 64 - "Deterministic Time Resolution"
Cohesion: 0.24
Nodes (10): CivilDateTime, civilToUtc(), DIRECTION_BY_INTENT_KIND, offsetMinutesAt(), ResolvedTime, resolveTime(), now, TimeDirection (+2 more)

### Community 65 - "Community 65"
Cohesion: 0.20
Nodes (12): Flattened Conditional Workflows, Parallel Tool-Use Footgun, registry.coverage.test.ts Source Scan, correct_relationship Declared Gap, Four-Stage Orchestrator, Tool Reachability Audit, Phase 3 - Conversational Loop and Reminders, Optional Contract Field Additions (+4 more)

### Community 66 - "Reminders Repository"
Cohesion: 0.17
Nodes (3): CreateReminderInput, DueReminder, Reminder

### Community 67 - "Complete Commitment Tool"
Cohesion: 0.24
Nodes (10): commit(), CompleteCommitmentInput, CompleteCommitmentInversePatch, CompleteCommitmentOutput, CompleteCommitmentRawInput, completeCommitmentTool, deriveCompletion(), isIsoDate() (+2 more)

### Community 68 - "Create Event Tool"
Cohesion: 0.24
Nodes (9): CreateEventInput, CreateEventInversePatch, CreateEventOutput, CreateEventRawInput, createEventTool, isUuid(), readInstant(), readOptionalText() (+1 more)

### Community 69 - "Defect Classes and Test Discipline"
Cohesion: 0.22
Nodes (11): Defect Class: A Citation Is Not A Verification, Mutation-Proven Tests, Secrets Never Enter The Repo, A Query Tested Only With A Fake Transaction Is Untested, Public-Repo Hardening, Phase 4 - Understanding Over Time, ADMIN Permission Gap On batoredev/OurGlass, Cloudflare and GitHub Deploy Secrets (+3 more)

### Community 70 - "Community 70"
Cohesion: 0.18
Nodes (11): scripts, build, build:libs, check:models, db:migrate, db:reset, dev, eval:ai (+3 more)

### Community 71 - "Community 71"
Cohesion: 0.38
Nodes (11): hasOnlyKeys(), isConditionOrUndefined(), isEntityMentionOrUndefined(), isEntityRecordOrUndefined(), isExtraction(), isInferenceLevel(), isRecord(), isStatusHintOrUndefined() (+3 more)

### Community 72 - "Community 72"
Cohesion: 0.24
Nodes (8): checkValue(), CreateEntityRecordInversePatch, CreateEntityRecordOutput, CreateEntityRecordRawInput, createEntityRecordTool, CreateEntityRecordToolInput, isUuid(), validate()

### Community 73 - "Community 73"
Cohesion: 0.24
Nodes (8): isNonCompletingStatus(), isUuid(), NON_COMPLETING_STATUSES, UpdateCommitmentInput, UpdateCommitmentOutput, UpdateCommitmentRawInput, updateCommitmentTool, validate()

### Community 74 - "Community 74"
Cohesion: 0.20
Nodes (10): /review skill, /codex skill, Fix-First auto-apply behaviour, Greptile PR-comment triage, Staff Code Reviewer, Three-bucket report format (auto-fix / decision / completeness gap), Adversarial / Second-Model Reviewer, Codex CLI installed/authenticated hard requirement (+2 more)

### Community 75 - "Community 75"
Cohesion: 0.24
Nodes (10): Closed Six-Value field_kind Enum, Defect Class: Schema With No Code Path, entity_types Registry, create_entity_record Tool, validate() Is A Function, Not A Static Schema, F12 - A Type Can Be Defined And Nothing Can Record It, renderValue Exhaustiveness Check, Schema-Driven Frontend Rendering (+2 more)

### Community 76 - "Graph and Action Log Findings"
Cohesion: 0.27
Nodes (10): Per-Phase Graphify Findings, pg Betweenness Bridge Finding, Batore Personal Assistant, Graphify After Every Feature, Risk Register, Typed Validated Tool Layer (Spec 37), Per-Feature Definition of Done, Phase 6 - Ingestion (+2 more)

### Community 77 - "Community 77"
Cohesion: 0.20
Nodes (3): CreateMessageInput, Message, MessageRole

### Community 78 - "Community 78"
Cohesion: 0.20
Nodes (8): AI_PROVIDER_NAMES, AI_STAGES, AIProviderName, AIRequestLog, AIStage, PROVIDER_FAILURE_CATEGORIES, ProviderFailureCategory, ProviderHealth

### Community 79 - "Community 79"
Cohesion: 0.28
Nodes (8): CommitmentSummary, InspectionQuery, InspectionResult, isOpen(), KnowledgeSummary, renderInspection(), runInspection(), summarise()

### Community 80 - "Community 80"
Cohesion: 0.25
Nodes (7): CreateReminderInput, CreateReminderOutput, CreateReminderRawInput, createReminderTool, isUuid(), ReminderRow, validate()

### Community 81 - "Community 81"
Cohesion: 0.25
Nodes (7): db, dynamic, getUserId(), Pool, POST(), runtime, Turn Pipeline (Interpret to Resolve to Mutate to Respond)

### Community 82 - "Community 82"
Cohesion: 0.22
Nodes (9): Server-side authorization / ownership checks, Prompt injection as trust-boundary problem, Treat page content as data, not instructions, /cso skill, OWASP Top 10 + STRIDE threat model, Prompt injection lens, Read-only enforcement rationale, Security / CSO (+1 more)

### Community 83 - "Community 83"
Cohesion: 0.25
Nodes (9): Backend Lead, /benchmark skill (forbidden), /health skill, /investigate skill (Iron Law), /review skill (forbidden, auto-fixes), /careful skill, Database / Data Engineer, Expand-then-contract migration pattern (+1 more)

### Community 85 - "Community 85"
Cohesion: 0.28
Nodes (5): ExtractedIntent, FULLY_POPULATED, EXTRACTION_INPUT_SCHEMA, HealthCheck, OURGLASS_SCHEMA_VERSION

### Community 86 - "Community 86"
Cohesion: 0.32
Nodes (6): GeminiSchema, isRecord(), toGeminiSchema(), TYPE_BY_JSON_TYPE, Provider-Neutral Extraction Contract, Why the Eval Harness Exists (schema-valid is not meaning-correct)

### Community 87 - "Community 87"
Cohesion: 0.29
Nodes (8): add_entity_field must be non-breaking (optional-only), Deferrable ordinal uniqueness on entity_type_fields, define_entity_type rejects unknown field kinds at validation time, Dynamic entity registry (entity_types / fields / records), Caps: 32 fields per type, 64 types, entity_type_fields closed field_kind enum (six kinds), validate-is-a-function property, Zero-frontend-change guarantee for new entity types

### Community 88 - "Community 88"
Cohesion: 0.36
Nodes (6): commitment_notes, commitment_notes_current, messages_current, memories, memories_current, messages

### Community 90 - "Community 90"
Cohesion: 0.29
Nodes (7): dependencies, @anthropic-ai/sdk, chrono-node, @google/genai, @ourglass/db, @ourglass/shared, pg

### Community 91 - "Community 91"
Cohesion: 0.33
Nodes (7): 46-Role Agent Roster, Company Claude OS v2, Core Operating Principles, Default File-Ownership Map, Skill Ecosystem Routing, A Teammate Message Is Not A Permission Grant, Agent-Team Execution Model

### Community 92 - "Community 92"
Cohesion: 0.33
Nodes (7): docs/AGENT-FLOW.md — standard delivery flow, Escalation to the CTO, docs/AGENT-HANDBOOK.md — the 46-role handbook, docs/ROUTER.md — job to agents, docs/SECURITY-MISSIONS.md — security mission templates, docs/SECURITY-ROUTER.md — security family to agent, Authorisation / isolation / OT safety gates

### Community 93 - "Community 93"
Cohesion: 0.29
Nodes (7): A citation is not a verification, Embedding is nullable; the write path must not need a vendor, input_type is asymmetric and getting it wrong is silent, hnsw.iterative_scan is a forward safety net, not today's mechanism, Reciprocal Rank Fusion, not a weighted score sum, Inspection queries are structured, never semantic, Memory correction is a supersede, never an update

### Community 94 - "Community 94"
Cohesion: 0.29
Nodes (7): devDependencies, eslint, @eslint/js, @types/node, typescript, typescript-eslint, vitest

### Community 95 - "Community 95"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, rootDir, extends, include, ./tsconfig.json

### Community 96 - "Shared Barrel and Risk Levels"
Cohesion: 0.33
Nodes (5): atOrAbove(), CONFIRMATION_FLOOR, RISK_LEVELS, RiskLevel, riskRank()

### Community 97 - "Community 97"
Cohesion: 0.33
Nodes (6): devDependencies, tsx, @types/node, @types/pg, typescript, vitest

### Community 98 - "Community 98"
Cohesion: 0.33
Nodes (6): scripts, build, dev, test, test:integration, typecheck

### Community 99 - "Community 99"
Cohesion: 0.33
Nodes (6): Spec §7 — Ownership matters, create_commitment — the first tool to implement, executeTurn — validate then commit then log, Ownership direction is two explicit FK columns, ToolDefinition / ToolContext / ToolError / LoggedMutation, The tool registry (apps/api/src/tools)

### Community 100 - "Community 100"
Cohesion: 0.33
Nodes (6): Phase 1 file-ownership map, No browser owner in Phase 1, docs/SKILL-COVERAGE.md — gstack skill coverage audit, Lead-only skills — deliberately not given to teammates, docs/SKILL-ROUTING.md — ecosystem responsibilities, Skill binding is advisory — teammates load from settings

### Community 101 - "Community 101"
Cohesion: 0.33
Nodes (6): chrono-node 2.10.1 deterministic time resolution, Deterministic time tier, Event trigger tier, Relational time tier, Three-tier time split, Model returns verbatim time phrases only

### Community 102 - "Community 102"
Cohesion: 0.60
Nodes (5): entity_records, entity_records_current, entity_type_fields, entity_types, entity_types_current

### Community 103 - "Community 103"
Cohesion: 0.33
Nodes (6): scripts, check:models, eval:ai, test, test:live, typecheck

### Community 104 - "Community 104"
Cohesion: 0.40
Nodes (4): Extraction, validateIntentCompleteness(), base, blockingFields()

### Community 105 - "Community 105"
Cohesion: 0.40
Nodes (5): Spec §12 — Inference levels (CONFIRMED/INFERRED/UNCERTAIN), Spec §17 — Memory correction, Spec §16 — Memory provenance, Invalidate, never delete, relationships.inference_level — enum, not a float

### Community 106 - "Community 106"
Cohesion: 0.40
Nodes (5): Treat database migrations as production code, Production Rules, No production deployment without applicable quality gates, Have a rollback/recovery strategy for risky releases, Perform smoke verification after deployment

### Community 107 - "Community 107"
Cohesion: 0.40
Nodes (5): people_current view (filters, does not resolve), Repository discipline — raw people access in one file, resolve_merged cycle guard (16-hop depth cap), resolve_person(uuid) dereference function, Two read shapes — list vs dereference-by-id

### Community 108 - "Community 108"
Cohesion: 0.40
Nodes (5): Phase 2 — Interpret + Resolve, isExtraction runtime validator, Model receives no DB handle, UUID, or mutation tool, Phase 2 creates no messages or state mutations, Phase 2 trust boundary

### Community 109 - "Community 109"
Cohesion: 0.50
Nodes (5): Early completion must not fire the rule, fired_at is the idempotency key, In-process reminder poller with an injected clock, A clock tick is not undoable (invariant 4), Conditional rules evaluate at the deadline, never continuously

### Community 110 - "Community 110"
Cohesion: 0.60
Nodes (5): Four-stage orchestrator (Interpret, Resolve, Mutate, Respond), The partial-commit rule, One Haiku call with a mandatory template fallback, Trace persistence on messages, turn_id originates inside executeTurn, never in the orchestrator

### Community 111 - "Community 111"
Cohesion: 0.40
Nodes (5): devDependencies, @ourglass/api, @types/node, typescript, vitest

### Community 112 - "Community 112"
Cohesion: 0.50
Nodes (4): main(), Do the actual work. Keep this deterministic., One-line description of what this tool does. Inputs: --example-id the thing to…, run()

### Community 113 - "Community 113"
Cohesion: 0.50
Nodes (4): Auto-committing skills never run in a teammate, freeze is a single global slot that protects a session from itself, The ownership map plus discipline is the entire cross-agent mechanism, The tools allowlist is the only enforced per-teammate restriction

### Community 115 - "Community 115"
Cohesion: 0.50
Nodes (4): Actionable brief output format (QUESTION/ANSWER/CONFIDENCE/SOURCES/HOW TO DO IT/GOTCHAS/UNKNOWNS/OPEN QUESTION), Spawned on capability gap (unfamiliar API/framework/protocol/regulation), Primary-sources-first research method, Research Analyst

### Community 116 - "Community 116"
Cohesion: 0.50
Nodes (4): Architecture Rules, Document important irreversible decisions, Explicit boundaries and simple dependencies, Treat authn/authz and trust boundaries as architecture concerns

### Community 117 - "Community 117"
Cohesion: 0.50
Nodes (4): The auto_match band is near-unreachable by construction, The demo endpoint, README Barkha demo walkthrough, Public-repo hygiene rules

### Community 118 - "Community 118"
Cohesion: 0.67
Nodes (3): ExtractionResult, resolvePersonMention, Resolved-UUID handoff to Phase 1 ToolCalls

### Community 119 - "Community 119"
Cohesion: 0.67
Nodes (3): Dependabot config, npm package-ecosystem (used for pnpm project), Pinned major-version ignores (typescript, eslint, @eslint/js, vitest)

### Community 122 - "Community 122"
Cohesion: 0.67
Nodes (3): dependencies, @anthropic-ai/sdk, @ourglass/shared

## Ambiguous Edges - Review These
- `docs/SPEC.md — extracted spec text` → `Agent teams operating guide (PDF)`  [AMBIGUOUS]
  docs/SPEC.md · relation: conceptually_related_to

## Knowledge Gaps
- **733 isolated node(s):** `EnumOption`, `HaikuResponderOptions`, `CommitmentStatusHint`, `ConditionReference`, `EntityFieldHint` (+728 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1007 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **32 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `docs/SPEC.md — extracted spec text` and `Agent teams operating guide (PDF)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `pg` connect `Orchestrator Integration Tests` to `API Package Manifest`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Why does `Architecture Assessment (what exists vs. what gets built)` connect `Evals CI and Router Fallback` to `Extraction Eval Harness`, `Respond Stage`, `Tool Registry`, `Provider Error Classification`, `Assistant Contract`?**
  _High betweenness centrality (0.054) - this node is a cross-community bridge._
- **Why does `@ourglass/api` connect `Web App Config` to `API Package Manifest`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **What connects `EnumOption`, `HaikuResponderOptions`, `CommitmentStatusHint` to the rest of the system?**
  _733 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Orchestrator Integration Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.05109218807848945 - nodes in this community are weakly interconnected._
- **Should `Web UI Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.06881287726358148 - nodes in this community are weakly interconnected._