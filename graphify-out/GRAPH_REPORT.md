# Graph Report - OurGlass  (2026-09-16)

## Corpus Check
- 75 files · ~223,756 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1859 nodes · 2619 edges · 162 communities (120 shown, 32 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 86 edges (avg confidence: 0.84)
- Token cost: 284,137 input · 0 output

## Community Hubs (Navigation)
- Web UI Pages
- Next Route Handlers
- Agent Roster: Contracts & Docs
- Agent Roster: Motion & Design
- Extraction Eval Harness
- Tool Layer & Errors
- Turn Orchestrator
- Migrations & Repositories
- Product Spec Sections
- TypeScript Project Config
- DB Client & Messages
- Lint & Package Config
- Assistant Contract Types
- Entity Resolution & Duplicates
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
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
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
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
- Community 153
- Community 154
- Community 160
- Community 161

## God Nodes (most connected - your core abstractions)
1. `docs/SPEC.md — extracted spec text` - 41 edges
2. `demoEnabled()` - 19 edges
3. `Queryable` - 17 edges
4. `compilerOptions` - 17 edges
5. `read()` - 17 edges
6. `compilerOptions` - 16 edges
7. `CTO / Delivery Lead` - 16 edges
8. `QA / Browser Engineering Lead` - 15 edges
9. `runTurn()` - 14 edges
10. `planOneIntent()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Invalidate, never delete` --semantically_similar_to--> `Spec §17 — Memory correction`  [INFERRED] [semantically similar]
  docs/PHASE-1-DESIGN.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §6 — Commitments are a core data model`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §22 — Conversational state updates`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §12 — Inference levels (CONFIRMED/INFERRED/UNCERTAIN)`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §16 — Memory provenance`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **The scheduled-job path: poll, fire, evaluate, refuse undo** — docs_phase_3_design_poller, docs_phase_3_design_fired_at_idempotency, docs_phase_3_design_scheduled_job_not_undoable, docs_phase_3_design_workflow_evaluate_at_deadline, docs_phase_3_design_early_completion_silences_rule [EXTRACTED 0.90]
- **File-ownership map enforced via /freeze across implementer agents** — claude_agents_04_solutions_architect_file_ownership_table, claude_agents_18_devops_sre_freeze [EXTRACTED 1.00]
- **Security practice engagement lifecycle (lead routes to offensive/defensive/dfir)** — claude_agents_34_security_lead_security_lead, claude_agents_35_offensive_security_engineer_offensive_security_engineer, claude_agents_36_dfir_analyst_dfir_analyst, claude_agents_37_detection_engineer_detection_engineer, claude_agents_38_threat_hunter_threat_hunter [EXTRACTED 1.00]
- **Single browser owner constraint across QA, performance, and devex roles** — claude_agents_12_qa_browser_lead_qa_browser_lead, claude_agents_14_performance_engineer_performance_engineer, claude_agents_17_devex_engineer_devex_engineer, claude_agents_07_frontend_lead_frontend_lead [EXTRACTED 1.00]
- **Merge-resolution invariant: pointer, view, resolver, cycle guard, lossy-inverse fix** — docs_phase_1_design_merged_into_id, docs_phase_1_design_people_current_view, docs_phase_1_design_resolve_person, docs_phase_1_design_resolve_merged_cycle_guard [EXTRACTED 1.00]
- **The Phase 2 trust boundary — model proposes typed mentions, backend resolves and commits** — docs_phase_2_design_extract_intents_tool, docs_phase_2_design_model_gets_no_db_handle, docs_phase_2_design_is_extraction_validator, docs_phase_2_design_verbatim_time_phrase, docs_phase_2_design_resolved_uuid_handoff, docs_phase_2_design_never_write_sql_from_model [EXTRACTED 1.00]
- **Planning/execution chain: plan, decisions, phases, Phase 1 design** — docs_phase_1_design [EXTRACTED 1.00]
- **Turn-grained undo pipeline: validate, commit, log, undo** — docs_phase_1_design_validate_is_a_function, docs_phase_1_design_execute_turn, docs_phase_1_design_action_log_turn_id_grain, docs_phase_1_design_undo_turn, docs_phase_1_design_double_undo_partial_unique_index [EXTRACTED 1.00]
- **Read-only/deterministic QA roles distinct from browser daemon** — claude_agents_25_web_standards_engineer_web_standards_engineer, claude_agents_26_accessibility_engineer_accessibility_engineer, claude_agents_27_e2e_automation_engineer_e2e_automation_engineer [INFERRED 0.75]
- **CI/eval/security workflow triad gating merges to main** — github_workflows_ci_ci_workflow, github_workflows_evals_evals_workflow, github_workflows_codeql_codeql_workflow [INFERRED 0.85]
- **Frontend polish/QA specialist trio (motion, taste, visual critique)** — claude_agents_23_motion_engineer_motion_engineer, claude_agents_24_taste_director_taste_director, claude_agents_33_visual_critic_visual_critic [INFERRED 0.85]
- **Untrusted-content / prompt-injection trust boundary discipline across roles** — claude_agents_10_ai_agent_engineer_prompt_injection_trust_boundary, claude_agents_13_security_cso_prompt_injection_lens, claude_agents_12_qa_browser_lead_untrusted_page_content, claude_agents_11_integration_engineer_webhook_untrusted_principle [INFERRED 0.85]
- **Phase 4 silent failure modes, all returning plausible output** — docs_phase_4_design_input_type_asymmetry, docs_phase_4_design_iterative_scan, docs_phase_4_design_structured_not_semantic, docs_phase_4_design_supersede_not_update [INFERRED 0.85]
- **The Interpret-Resolve-Mutate-Respond Turn Pipeline** — docs_execution_plan_four_stage_orchestrator, docs_planner_wiring_design_extracted_intent, docs_phase_2_design_three_band_resolution, docs_execution_plan_typed_tool_layer, docs_execution_plan_action_log [EXTRACTED 1.00]
- **Defect Classes Of Code That Exists But Nothing Reaches** — docs_decisions_schema_with_no_code_path, docs_decisions_citation_is_not_verification, docs_execution_plan_fake_tx_rule, docs_planner_wiring_design_intent_kinds_derivation, docs_phase_5_design_f12_entity_records_unreachable, docs_decisions_hollow_test_mutation_check [EXTRACTED 1.00]
- **GitHub Plus Supabase Plus Cloudflare Deployment Target** — docs_deployment_design_route_handlers_migration, docs_deployment_design_cron_trigger_poller, docs_deployment_design_supabase_direct_connection, docs_deployment_design_pg_version_pin, docs_your_actions_cloudflare_deploy_secrets [EXTRACTED 1.00]

## Communities (162 total, 32 thin omitted)

### Community 0 - "Web UI Pages"
Cohesion: 0.07
Nodes (53): ActivityPage(), dynamic, CommitmentsPage(), dynamic, metadata, dynamic, MemoryPage(), dynamic (+45 more)

### Community 1 - "Next Route Handlers"
Cohesion: 0.07
Nodes (37): dynamic, GET(), runtime, dynamic, GET(), runtime, HERE, { queryMock, demoMock, undoTurnMock } (+29 more)

### Community 2 - "Agent Roster: Contracts & Docs"
Cohesion: 0.05
Nodes (48): API Contract Engineer, Contract ownership (schema, versioning, breaking-change detection), /freeze schema/contract glob (first action), Publish contract before implementation starts, /document-generate skill (Diataxis structure), Every code example must run, /freeze developer docs glob (first action), Technical Writer (Developer-Facing) (+40 more)

### Community 3 - "Agent Roster: Motion & Design"
Cohesion: 0.05
Nodes (44): Common report format (Status/What changed/Verified/Risks/Blocked/Next action), animejs skill, Emil Kowalski reference, framer-motion skill, /freeze motion glob (first action), Motion Engineer, Motion principles (duration, easing, interruptibility, reduced-motion), motion / motion-dom / motion-utils skills (+36 more)

### Community 4 - "Extraction Eval Harness"
Cohesion: 0.09
Nodes (24): Deterministic fixture eval lane (free, every PR), allIntents, extractionTool, EXTRACTION_FIXTURES, ExtractionFixture, me, conditionMatches(), entityMatches() (+16 more)

### Community 5 - "Tool Layer & Errors"
Cohesion: 0.10
Nodes (25): OrchestratorDeps, makePerson(), NotInvertibleError, PG_UNIQUE_VIOLATION, ToolNotFoundError, TurnAlreadyUndoneError, TurnNotFoundError, ValidationFailedError (+17 more)

### Community 6 - "Turn Orchestrator"
Cohesion: 0.12
Nodes (35): blockedIntentIndices(), describeMention(), formatLocal(), IntentPlan, persistAssistantMessage(), planCommitment(), planCompletion(), PlanContext (+27 more)

### Community 7 - "Migrations & Repositories"
Cohesion: 0.09
Nodes (19): users_current, workflows, workflows_current, createPool(), commitmentNotes, commitments, entityRecords, events (+11 more)

### Community 8 - "Product Spec Sections"
Cohesion: 0.06
Nodes (33): Spec §11 — Ambiguity handling, Spec §10 — Ask about people when necessary, Spec §3 — The central product principle, Spec §8 — Commitment lifecycle, Spec §21 — Completing the user's own work, Spec §25 — Conditional commitments / workflows, Spec §24 — Conflict detection, Spec §20 — Context after completion (+25 more)

### Community 9 - "TypeScript Project Config"
Cohesion: 0.06
Nodes (27): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.base.json, references, compilerOptions (+19 more)

### Community 10 - "DB Client & Messages"
Cohesion: 0.08
Nodes (10): Queryable, Transactable, withTransaction(), CreateMessageInput, Message, MessageRole, Organization, unmergeOrganization() (+2 more)

### Community 11 - "Lint & Package Config"
Cohesion: 0.07
Nodes (28): description, devDependencies, eslint, @eslint/js, @types/node, typescript, typescript-eslint, vitest (+20 more)

### Community 12 - "Assistant Contract Types"
Cohesion: 0.08
Nodes (25): CommitmentStatusHint, CONDITION_KEYS, ConditionReference, ENTITY_KEYS, ENTITY_RECORD_KEYS, EntityFieldHint, EntityMention, EntityRecordHint (+17 more)

### Community 13 - "Entity Resolution & Duplicates"
Cohesion: 0.15
Nodes (22): CommitmentProposal, CompletionMatch, contentTokens(), decideCompletion(), detectDuplicate(), DuplicateDecision, EntityResolution, FIRST_PERSON_MENTIONS (+14 more)

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (21): CorrectRelationshipInput, CorrectRelationshipInversePatch, CorrectRelationshipOutput, correctRelationshipTool, ForgetMemoryInput, ForgetMemoryInversePatch, ForgetMemoryOutput, forgetMemoryTool (+13 more)

### Community 15 - "Community 15"
Cohesion: 0.14
Nodes (22): it, organizations, organizations_current, people, people_current, projects, projects_current, resolve_organization() (+14 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (12): assertUpdatableField(), Commitment, CommitmentFieldPatch, CompleteCommitmentResult, CreateCommitmentInput, CurrentCommitment, OverdueCommitment, restoreCommitmentFields() (+4 more)

### Community 17 - "Community 17"
Cohesion: 0.12
Nodes (15): main(), Clock, evaluateDueWorkflows(), deps(), frozen(), OnFire, OnRuleFired, PollerDeps (+7 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (24): docs/MISSIONS.md — mission templates, Mission 0 — Discovery, Mission 1 — Four-lens plan review, Mission 2 — Four-lens code review, Mission 3 — Competing-hypothesis debug, Mission 4 — Cross-layer feature build, Mission 4c — Showcase-grade interface, Mission 6.5 — Codify (tools from repeated mechanical steps) (+16 more)

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (19): ActorKind, DatabaseTransaction, err(), ExecuteTurnResult, fakeQueryResult(), Invertibility, LoggedMutation, ok() (+11 more)

### Community 20 - "Community 20"
Cohesion: 0.14
Nodes (13): EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EmbeddingError, EmbeddingFailureReason, EmbeddingResult, EmbeddingTrace, InputType, parseEmbeddings() (+5 more)

### Community 21 - "Community 21"
Cohesion: 0.13
Nodes (15): createMemory(), CreateMemoryInput, Memory, MemoryKind, MemorySubjectKind, RankedRow, RRF_K, ScoredMemory (+7 more)

### Community 22 - "Community 22"
Cohesion: 0.10
Nodes (10): CreatePersonInput, Person, NOTE: t_invalid is overwritten UNCONDITIONALLY here, unlike the invalidate*, NOTE: this is NOT the inverse of a merge. `mergePerson` sets `t_invalid` AND, ensureUser(), EnsureUserInput, getUser(), getUserWithPerson() (+2 more)

### Community 23 - "Community 23"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, forceConsistentCasingInFileNames, incremental, isolatedModules, jsx, lib (+11 more)

### Community 24 - "Community 24"
Cohesion: 0.11
Nodes (20): 46-Role Agent Roster, Company Claude OS v2, Core Operating Principles, Default File-Ownership Map, Independent Review Pipeline, Skill Ecosystem Routing, A Teammate Message Is Not A Permission Grant, WAT Operating Model (Workflows, Agents, Tools) (+12 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (20): /autoplan skill, Cost-per-request design constraint, /benchmark skill, /browse skill, /open-gstack-browser skill, QA / Browser Engineering Lead, /qa-only skill, /scrape skill (+12 more)

### Community 26 - "Community 26"
Cohesion: 0.17
Nodes (7): ClaudeProvider, EXTRACTION, provider(), REPLY, AIProvider, InterpretInput, RespondResult

### Community 27 - "Community 27"
Cohesion: 0.17
Nodes (13): assertNever(), describeFact(), formatDuration(), HaikuResponderOptions, inWords(), plural(), renderFacts(), RESPOND_SYSTEM_PROMPT (+5 more)

### Community 28 - "Community 28"
Cohesion: 0.12
Nodes (15): ACTION_KINDS, CONDITION_KINDS, CreateWorkflowInput, CreateWorkflowInversePatch, CreateWorkflowOutput, CreateWorkflowRawInput, createWorkflowTool, EvaluateWorkflowInput (+7 more)

### Community 29 - "Community 29"
Cohesion: 0.11
Nodes (18): Capability gap → research-analyst, never guess, docs/ROUTER.md, One browser-daemon owner, always, Platform gates the roster (RN/Expo, web, no-UI), Read-only first (missions 1-3), Routing Rules, Security engagements route through security-lead, Specialists over generalists when signal is clear (+10 more)

### Community 30 - "Community 30"
Cohesion: 0.15
Nodes (14): classifyCommitmentsInverse(), CommitmentsInversePatch, CompleteInversePatch, CreateCommitmentInput, CreateCommitmentOutput, CreateCommitmentRawInput, createCommitmentTool, CreateInversePatch (+6 more)

### Community 31 - "Community 31"
Cohesion: 0.15
Nodes (17): AI-slop design patterns to avoid, /design-consultation skill, Design Director, DESIGN.md, /design-review skill (lead-only, auto-commits), /design-shotgun skill, ui-ux-pro-max skill, /browse skill (forbidden) (+9 more)

### Community 32 - "Community 32"
Cohesion: 0.14
Nodes (17): DevOps / SRE, /guard skill, /land-and-deploy skill (forbidden), Documented rollback for every deploy path, /setup-deploy skill, /ship skill (forbidden), /document-release skill, /land-and-deploy skill (+9 more)

### Community 33 - "Community 33"
Cohesion: 0.12
Nodes (16): typescript, devDependencies, typescript, vitest, exports, vitest, main, name (+8 more)

### Community 34 - "Community 34"
Cohesion: 0.12
Nodes (7): CommitmentStatus, TERMINAL_STATUSES, CreateWorkflowInput, DueWorkflow, Workflow, WorkflowActionKind, WorkflowConditionKind

### Community 35 - "Community 35"
Cohesion: 0.12
Nodes (15): CommitmentCompletedFact, CommitmentCreatedFact, CommitmentUpdatedFact, CommittedFact, EntityRecordCreatedFact, EntityTypeDefinedFact, EventScheduledFact, MemoryForgottenFact (+7 more)

### Community 36 - "Community 36"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib (+8 more)

### Community 37 - "Community 37"
Cohesion: 0.12
Nodes (15): @anthropic-ai/sdk, @ourglass/shared, @ourglass/api, dependencies, @anthropic-ai/sdk, @ourglass/shared, vitest, name (+7 more)

### Community 38 - "Community 38"
Cohesion: 0.14
Nodes (16): File-ownership map, /learn skill, /diagram skill, File-ownership table appended to plan, /plan-eng-review skill, Shared task list (5-6 tasks per teammate), Solutions Architect, AI / Agent Engineer (+8 more)

### Community 39 - "Community 39"
Cohesion: 0.15
Nodes (16): Bitemporal Modelling, Flattened Conditional Workflows, Non-Destructive Merge, registry.coverage.test.ts Source Scan, resolve_merged Cycle-Guarded Dereference, A Wrong Merge Is Worse Than A Duplicate, commitments Table, correct_relationship Declared Gap (+8 more)

### Community 40 - "Community 40"
Cohesion: 0.17
Nodes (16): Per-Phase Graphify Findings, pg Betweenness Bridge Finding, Fastify Replaced By Next.js Route Handlers, Batore Personal Assistant, Graphify After Every Feature, Risk Register, Typed Validated Tool Layer (Spec 37), Multi-Provider AI Orchestration Layer (+8 more)

### Community 41 - "Community 41"
Cohesion: 0.12
Nodes (15): inference_level enum (CONFIRMED/INFERRED/UNCERTAIN), Shared contract prevents API/eval drift, Six spec §5 intent kinds, INTENT_KINDS, COMMITMENT_STATUS_HINTS, CONDITION_SCHEMA, ENTITY_FIELD_SCHEMA, ENTITY_RECORD_SCHEMA (+7 more)

### Community 42 - "Community 42"
Cohesion: 0.15
Nodes (10): CreateEntityRecordInput, EntityRecord, EntityType, EntityTypeField, EntityTypeWithFields, EnumOption, FieldKind, getTypeByKey() (+2 more)

### Community 43 - "Community 43"
Cohesion: 0.13
Nodes (14): pg, @types/pg, vitest, name, private, scripts, build, dev (+6 more)

### Community 44 - "Community 44"
Cohesion: 0.13
Nodes (12): @ourglass/db, config, nextConfig, vitest, name, private, version, eslint-config-next (+4 more)

### Community 45 - "Community 45"
Cohesion: 0.15
Nodes (12): AttachContextInput, AttachContextInversePatch, AttachContextOutput, AttachContextRawInput, attachContextTool, isUuid(), validate(), applyInverseForTable() (+4 more)

### Community 46 - "Community 46"
Cohesion: 0.14
Nodes (15): Single browser owner rule, /context-save skill, CTO / Delivery Lead, /plan-tune skill, /qa skill, research-analyst agent, /retro skill, /skillify skill (+7 more)

### Community 47 - "Community 47"
Cohesion: 0.13
Nodes (15): /office-hours skill, HOLD SCOPE mode, Margin rule (scope expansion destroys margin on fixed-price work), /plan-ceo-review skill, Product / CEO Strategist, SCOPE EXPANSION mode, SCOPE REDUCTION mode, SELECTIVE EXPANSION mode (+7 more)

### Community 48 - "Community 48"
Cohesion: 0.14
Nodes (15): Define success before implementing non-trivial behavior, Do not hide failing tests with skips unless justified, Add regression coverage for important bug fixes, Testing Rules, Unit / integration / E2E test layering, docker-compose.yml (Postgres service), ourglass-postgres-data volume, postgres service (pgvector/pgvector:pg17) (+7 more)

### Community 49 - "Community 49"
Cohesion: 0.17
Nodes (8): InferenceLevel, createRelationship(), CreateRelationshipInput, getById(), Relationship, RelationshipObjectKind, supersedeRelationship(), SupersedeResult

### Community 50 - "Community 50"
Cohesion: 0.15
Nodes (12): DefineEntityTypeInput, DefineEntityTypeOutput, DefineEntityTypeRawInput, defineEntityTypeTool, EntityTypeRow, FieldDefInput, FieldKind, isFieldKind() (+4 more)

### Community 51 - "Community 51"
Cohesion: 0.15
Nodes (14): Spec §22 — Conversational state updates, Spec §29 — The primary UI (inspection surfaces), Spec §28 — User control, action_log — the undo substrate, action_log turn_id grain — the conversational turn, Undo traverses only actor_kind='user_turn', Double-undo impossible — partial unique index, invertibility enum (full / lossy / none) (+6 more)

### Community 52 - "Community 52"
Cohesion: 0.15
Nodes (13): Anti-slop list (kill on sight), awesome design / impeccable references, Taste Director, taste skill (variance system), ui-ux-pro-max skill (styles/palettes/pairings), Written direction (deliverable), AI-slop checklist, Review priority list (spacing, hierarchy, density, alignment, colour, ai-slop, resilience, absence) (+5 more)

### Community 53 - "Community 53"
Cohesion: 0.14
Nodes (13): @types/node, dependencies, node-pg-migrate, @ourglass/shared, pg, pg, vitest, main (+5 more)

### Community 54 - "Community 54"
Cohesion: 0.28
Nodes (10): categoryForExtractionError(), categoryForStatus(), classifyProviderError(), FAILURE_POLICY, FailurePolicy, messageOf(), ProviderError, readCode() (+2 more)

### Community 55 - "Community 55"
Cohesion: 0.22
Nodes (7): AnthropicExtractor, AnthropicExtractorOptions, EXTRACTION_TOOL, ExtractionError, ExtractionFailureReason, Extractor, Forced extract_intents tool call

### Community 56 - "Community 56"
Cohesion: 0.22
Nodes (10): CivilDateTime, civilToUtc(), DIRECTION_BY_INTENT_KIND, offsetMinutesAt(), ResolvedTime, resolveTime(), now, TimeDirection (+2 more)

### Community 57 - "Community 57"
Cohesion: 0.21
Nodes (10): detectTimeConflicts(), findNewlyOverdue(), formatDuration(), ProactiveCandidate, ProactiveContext, renderProactiveLine(), selectProactiveLine(), conflict (+2 more)

### Community 58 - "Community 58"
Cohesion: 0.18
Nodes (13): action_log Grain Is The Conversational Turn, In-Process Reminder Poller, node-pg-migrate Forward-Only Migrations, One Postgres Instance With pgvector, Cloudflare Workers Port, Reminder Poller As Cron Trigger, Framework-Agnostic Repository Boundary, pg Pinned To 8.16.3 Or Higher (+5 more)

### Community 59 - "Community 59"
Cohesion: 0.17
Nodes (12): Keep commits focused and understandable, Git Rules, Do not commit secrets, build artifacts, or local machine state, For AI systems, evaluate prompt injection, tool abuse, exfiltration, unsafe side effects, Never hardcode secrets, Security Rules, Validate authorization server-side, Review SSRF, XSS, CSRF, injection, privesc, data leakage, secret exposure (+4 more)

### Community 60 - "Community 60"
Cohesion: 0.17
Nodes (3): CreateReminderInput, DueReminder, Reminder

### Community 61 - "Community 61"
Cohesion: 0.33
Nodes (8): commitmentOwedByBarkha(), deps(), fakeExtractor(), intent(), mention(), owedByBarkha(), recordingResponder(), scheduleIntent()

### Community 62 - "Community 62"
Cohesion: 0.24
Nodes (10): commit(), CompleteCommitmentInput, CompleteCommitmentInversePatch, CompleteCommitmentOutput, CompleteCommitmentRawInput, completeCommitmentTool, deriveCompletion(), isIsoDate() (+2 more)

### Community 63 - "Community 63"
Cohesion: 0.24
Nodes (9): CreateEventInput, CreateEventInversePatch, CreateEventOutput, CreateEventRawInput, createEventTool, isUuid(), readInstant(), readOptionalText() (+1 more)

### Community 64 - "Community 64"
Cohesion: 0.22
Nodes (11): Dynamic Entity Types Are An Owner Addition, Closed Six-Value field_kind Enum, Locked Decisions and Research Findings, entity_types Registry, create_entity_record Tool, validate() Is A Function, Not A Static Schema, F12 - A Type Can Be Defined And Nothing Can Record It, renderValue Exhaustiveness Check (+3 more)

### Community 65 - "Community 65"
Cohesion: 0.20
Nodes (11): Parallel Tool-Use Footgun, Four-Stage Orchestrator, AIModelRouter Behind Existing Interfaces, Transport-Failure-Only Fallback Policy, Gemini Provider, A Committed Mutation Is Never Replayed, Structured Provider Observability, Ask band (0.65–0.92 or a tie) (+3 more)

### Community 66 - "Community 66"
Cohesion: 0.38
Nodes (11): hasOnlyKeys(), isConditionOrUndefined(), isEntityMentionOrUndefined(), isEntityRecordOrUndefined(), isExtraction(), isInferenceLevel(), isRecord(), isStatusHintOrUndefined() (+3 more)

### Community 67 - "Community 67"
Cohesion: 0.20
Nodes (10): default, types, exports, ./assistant, ./reminders/poller, ./tools, default, types (+2 more)

### Community 68 - "Community 68"
Cohesion: 0.24
Nodes (8): checkValue(), CreateEntityRecordInversePatch, CreateEntityRecordOutput, CreateEntityRecordRawInput, createEntityRecordTool, CreateEntityRecordToolInput, isUuid(), validate()

### Community 69 - "Community 69"
Cohesion: 0.24
Nodes (8): isNonCompletingStatus(), isUuid(), NON_COMPLETING_STATUSES, UpdateCommitmentInput, UpdateCommitmentOutput, UpdateCommitmentRawInput, updateCommitmentTool, validate()

### Community 70 - "Community 70"
Cohesion: 0.20
Nodes (10): /review skill, /codex skill, Fix-First auto-apply behaviour, Greptile PR-comment triage, Staff Code Reviewer, Three-bucket report format (auto-fix / decision / completeness gap), Adversarial / Second-Model Reviewer, Codex CLI installed/authenticated hard requirement (+2 more)

### Community 71 - "Community 71"
Cohesion: 0.24
Nodes (10): Composition is code discipline, Freeze video glob (first action), Motion Graphics Engineer (agent), remotion-* skill family, Render is expensive and slow discipline, Brand consistency over novelty, Brand & Media Producer (agent), Cost-first generation discipline (+2 more)

### Community 72 - "Community 72"
Cohesion: 0.24
Nodes (10): Every CI Job Is A Clean Runner, ESLint 9.39.5 Pin, Truncate-Per-Test Requires fileParallelism False, Secrets Never Enter The Repo, GitHub Actions CI, Public-Repo Hardening, ADMIN Permission Gap On batoredev/OurGlass, Cloudflare and GitHub Deploy Secrets (+2 more)

### Community 73 - "Community 73"
Cohesion: 0.20
Nodes (8): AI_PROVIDER_NAMES, AI_STAGES, AIProviderName, AIRequestLog, AIStage, PROVIDER_FAILURE_CATEGORIES, ProviderFailureCategory, ProviderHealth

### Community 74 - "Community 74"
Cohesion: 0.28
Nodes (8): CommitmentSummary, InspectionQuery, InspectionResult, isOpen(), KnowledgeSummary, renderInspection(), runInspection(), summarise()

### Community 75 - "Community 75"
Cohesion: 0.25
Nodes (7): CreateReminderInput, CreateReminderOutput, CreateReminderRawInput, createReminderTool, isUuid(), ReminderRow, validate()

### Community 76 - "Community 76"
Cohesion: 0.25
Nodes (7): FireReminderInput, FireReminderInversePatch, FireReminderOutput, FireReminderRawInput, fireReminderTool, isUuid(), validate()

### Community 77 - "Community 77"
Cohesion: 0.22
Nodes (9): Server-side authorization / ownership checks, Prompt injection as trust-boundary problem, Treat page content as data, not instructions, /cso skill, OWASP Top 10 + STRIDE threat model, Prompt injection lens, Read-only enforcement rationale, Security / CSO (+1 more)

### Community 78 - "Community 78"
Cohesion: 0.25
Nodes (9): Backend Lead, /benchmark skill (forbidden), /health skill, /investigate skill (Iron Law), /review skill (forbidden, auto-fixes), /careful skill, Database / Data Engineer, Expand-then-contract migration pattern (+1 more)

### Community 79 - "Community 79"
Cohesion: 0.22
Nodes (9): AI Systems Rules, Cost per request is a design constraint, Degrade honestly, Guardrails are not optional on user-facing generation, Irreversible actions need an approval gate outside the model, Retrieved content is data, never instructions, Trace everything, Treat all external input as untrusted (+1 more)

### Community 81 - "Community 81"
Cohesion: 0.28
Nodes (5): ExtractedIntent, FULLY_POPULATED, EXTRACTION_INPUT_SCHEMA, HealthCheck, OURGLASS_SCHEMA_VERSION

### Community 82 - "Community 82"
Cohesion: 0.29
Nodes (6): db, dynamic, getUserId(), Pool, POST(), runtime

### Community 83 - "Community 83"
Cohesion: 0.25
Nodes (8): devDependencies, eslint, eslint-config-next, @types/node, @types/react, @types/react-dom, typescript, vitest

### Community 84 - "Community 84"
Cohesion: 0.39
Nodes (8): Defect Class: A Citation Is Not A Verification, Mutation-Proven Tests, Defect Class: Schema With No Code Path, A Query Tested Only With A Fake Transaction Is Untested, Defect-Class Sweep, Hybrid Retrieval Wiring, Phase 4 - Understanding Over Time, Voyage API Key For Semantic Memory

### Community 85 - "Community 85"
Cohesion: 0.29
Nodes (8): add_entity_field must be non-breaking (optional-only), Deferrable ordinal uniqueness on entity_type_fields, define_entity_type rejects unknown field kinds at validation time, Dynamic entity registry (entity_types / fields / records), Caps: 32 fields per type, 64 types, entity_type_fields closed field_kind enum (six kinds), validate-is-a-function property, Zero-frontend-change guarantee for new entity types

### Community 86 - "Community 86"
Cohesion: 0.25
Nodes (8): .claude/rules/agent-teams.md added, Browser daemon collisions across up to eight agents (fixed mechanism 4), 21-documentation-engineer role added, Honest limits of agent teams (experimental), Merge Notes — v1 to v2 changes, No tools: allowlist anywhere in v1 (fixed mechanism 3), permissionMode: not applied at spawn (fixed mechanism 2), skills: frontmatter ignored for teammates (fixed mechanism 1)

### Community 87 - "Community 87"
Cohesion: 0.36
Nodes (6): commitment_notes, commitment_notes_current, messages_current, memories, memories_current, messages

### Community 89 - "Community 89"
Cohesion: 0.33
Nodes (3): ClaudeProviderOptions, HaikuResponder, isAbort()

### Community 90 - "Community 90"
Cohesion: 0.29
Nodes (7): dependencies, next, @ourglass/api, @ourglass/db, @ourglass/shared, react, react-dom

### Community 91 - "Community 91"
Cohesion: 0.29
Nodes (7): scripts, build, dev, lint, start, test, typecheck

### Community 92 - "Community 92"
Cohesion: 0.29
Nodes (7): Codify what repeats, The failure loop, File discipline (.tmp/, tools/, workflows/, .env), Never invent a tool's behaviour, Tool-first, always, WAT Rules — Workflows Agents Tools, Workflows are preserved, not replaced

### Community 93 - "Community 93"
Cohesion: 0.33
Nodes (7): docs/AGENT-FLOW.md — standard delivery flow, Escalation to the CTO, docs/AGENT-HANDBOOK.md — the 46-role handbook, docs/ROUTER.md — job to agents, docs/SECURITY-MISSIONS.md — security mission templates, docs/SECURITY-ROUTER.md — security family to agent, Authorisation / isolation / OT safety gates

### Community 94 - "Community 94"
Cohesion: 0.29
Nodes (7): A citation is not a verification, Embedding is nullable; the write path must not need a vendor, input_type is asymmetric and getting it wrong is silent, hnsw.iterative_scan is a forward safety net, not today's mechanism, Reciprocal Rank Fusion, not a weighted score sum, Inspection queries are structured, never semantic, Memory correction is a supersede, never an update

### Community 95 - "Community 95"
Cohesion: 0.29
Nodes (7): scripts, build, migrate, reset, test, test:integration, typecheck

### Community 96 - "Community 96"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, rootDir, extends, include, ./tsconfig.json

### Community 97 - "Community 97"
Cohesion: 0.29
Nodes (7): 21 roles table (model, writes, browser), Company Claude OS v2 — Setup, Cost guidance (Sonnet default teammate, Opus lead, start at 3), gbrain optimisation (/sync-gbrain semantic code search), 5-week rollout schedule, Routing and governance layer positioning, Three rules that prevent data loss

### Community 98 - "Community 98"
Cohesion: 0.33
Nodes (6): dependencies, @anthropic-ai/sdk, chrono-node, @ourglass/db, @ourglass/shared, pg

### Community 99 - "Community 99"
Cohesion: 0.33
Nodes (6): devDependencies, tsx, @types/node, @types/pg, typescript, vitest

### Community 100 - "Community 100"
Cohesion: 0.33
Nodes (6): Spec §7 — Ownership matters, create_commitment — the first tool to implement, executeTurn — validate then commit then log, Ownership direction is two explicit FK columns, ToolDefinition / ToolContext / ToolError / LoggedMutation, The tool registry (apps/api/src/tools)

### Community 101 - "Community 101"
Cohesion: 0.33
Nodes (6): Phase 1 file-ownership map, No browser owner in Phase 1, docs/SKILL-COVERAGE.md — gstack skill coverage audit, Lead-only skills — deliberately not given to teammates, docs/SKILL-ROUTING.md — ecosystem responsibilities, Skill binding is advisory — teammates load from settings

### Community 102 - "Community 102"
Cohesion: 0.33
Nodes (6): chrono-node 2.10.1 deterministic time resolution, Deterministic time tier, Event trigger tier, Relational time tier, Three-tier time split, Model returns verbatim time phrases only

### Community 103 - "Community 103"
Cohesion: 0.60
Nodes (5): entity_records, entity_records_current, entity_type_fields, entity_types, entity_types_current

### Community 104 - "Community 104"
Cohesion: 0.40
Nodes (5): dropSchema(), main(), MIGRATIONS_DIR, reset, node-pg-migrate

### Community 105 - "Community 105"
Cohesion: 0.40
Nodes (4): Extraction, validateIntentCompleteness(), base, blockingFields()

### Community 107 - "Community 107"
Cohesion: 0.40
Nodes (5): Spec §12 — Inference levels (CONFIRMED/INFERRED/UNCERTAIN), Spec §17 — Memory correction, Spec §16 — Memory provenance, Invalidate, never delete, relationships.inference_level — enum, not a float

### Community 108 - "Community 108"
Cohesion: 0.40
Nodes (5): Ships with an eval set, or does not ship, Evals workflow, fixtures job (recorded fixtures, free deterministic), Fork PR cannot reach ANTHROPIC_API_KEY constraint, live job (manual workflow_dispatch only, costs tokens)

### Community 109 - "Community 109"
Cohesion: 0.40
Nodes (5): Treat database migrations as production code, Production Rules, No production deployment without applicable quality gates, Have a rollback/recovery strategy for risky releases, Perform smoke verification after deployment

### Community 110 - "Community 110"
Cohesion: 0.40
Nodes (5): people_current view (filters, does not resolve), Repository discipline — raw people access in one file, resolve_merged cycle guard (16-hop depth cap), resolve_person(uuid) dereference function, Two read shapes — list vs dereference-by-id

### Community 111 - "Community 111"
Cohesion: 0.40
Nodes (5): Phase 2 — Interpret + Resolve, isExtraction runtime validator, Model receives no DB handle, UUID, or mutation tool, Phase 2 creates no messages or state mutations, Phase 2 trust boundary

### Community 112 - "Community 112"
Cohesion: 0.50
Nodes (5): Early completion must not fire the rule, fired_at is the idempotency key, In-process reminder poller with an injected clock, A clock tick is not undoable (invariant 4), Conditional rules evaluate at the deadline, never continuously

### Community 113 - "Community 113"
Cohesion: 0.60
Nodes (5): Four-stage orchestrator (Interpret, Resolve, Mutate, Respond), The partial-commit rule, One Haiku call with a mandatory template fallback, Trace persistence on messages, turn_id originates inside executeTurn, never in the orchestrator

### Community 114 - "Community 114"
Cohesion: 0.40
Nodes (5): devDependencies, @types/node, @types/pg, typescript, vitest

### Community 115 - "Community 115"
Cohesion: 0.40
Nodes (5): devDependencies, @ourglass/api, @types/node, typescript, vitest

### Community 116 - "Community 116"
Cohesion: 0.50
Nodes (4): main(), Do the actual work. Keep this deterministic., One-line description of what this tool does. Inputs: --example-id the thing to…, run()

### Community 117 - "Community 117"
Cohesion: 0.50
Nodes (4): Auto-committing skills never run in a teammate, freeze is a single global slot that protects a session from itself, The ownership map plus discipline is the entire cross-agent mechanism, The tools allowlist is the only enforced per-teammate restriction

### Community 119 - "Community 119"
Cohesion: 0.50
Nodes (4): Actionable brief output format (QUESTION/ANSWER/CONFIDENCE/SOURCES/HOW TO DO IT/GOTCHAS/UNKNOWNS/OPEN QUESTION), Spawned on capability gap (unfamiliar API/framework/protocol/regulation), Primary-sources-first research method, Research Analyst

### Community 120 - "Community 120"
Cohesion: 0.50
Nodes (4): Architecture Rules, Document important irreversible decisions, Explicit boundaries and simple dependencies, Treat authn/authz and trust boundaries as architecture concerns

### Community 121 - "Community 121"
Cohesion: 0.50
Nodes (4): The auto_match band is near-unreachable by construction, The demo endpoint, README Barkha demo walkthrough, Public-repo hygiene rules

### Community 123 - "Community 123"
Cohesion: 0.67
Nodes (3): ExtractionResult, resolvePersonMention, Resolved-UUID handoff to Phase 1 ToolCalls

### Community 124 - "Community 124"
Cohesion: 0.67
Nodes (3): Dependabot config, npm package-ecosystem (used for pnpm project), Pinned major-version ignores (typescript, eslint, @eslint/js, vitest)

## Ambiguous Edges - Review These
- `docs/SPEC.md — extracted spec text` → `Agent teams operating guide (PDF)`  [AMBIGUOUS]
  docs/SPEC.md · relation: conceptually_related_to

## Knowledge Gaps
- **701 isolated node(s):** `CommitmentProposal`, `CompletionMatch`, `DuplicateDecision`, `MentionCandidate`, `ResolutionBand` (+696 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 948 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **32 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `docs/SPEC.md — extracted spec text` and `Agent teams operating guide (PDF)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `chrono-node` connect `Community 56` to `Community 43`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `Forced extract_intents tool call` connect `Community 55` to `Community 41`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `react` connect `Web UI Pages` to `Community 44`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `CommitmentProposal`, `CompletionMatch`, `DuplicateDecision` to the rest of the system?**
  _701 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Web UI Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.06881287726358148 - nodes in this community are weakly interconnected._
- **Should `Next Route Handlers` be split into smaller, more focused modules?**
  _Cohesion score 0.07312925170068027 - nodes in this community are weakly interconnected._