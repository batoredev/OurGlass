# Graph Report - OurGlass  (2026-09-24)

## Corpus Check
- 52 files · ~296,586 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2566 nodes · 3924 edges · 231 communities (152 shown, 65 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 158 edges (avg confidence: 0.85)
- Token cost: 245,193 input · 0 output

## Community Hubs (Navigation)
- Extraction Eval Fixtures
- API Package Manifest
- Contract & Docs Roles
- Motion & Design Roles
- Tool Layer & Errors
- Commitments Surface
- Design Prototype Behaviour
- Claude Provider
- AI Systems Rules
- Turn Orchestrator
- Web API Routes
- Product Spec Sections
- Database Layer
- Respond Stage
- TypeScript Project Config
- Conversation UI
- DB Package Manifest
- Repository Layer
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
- Community 154
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 177
- Community 178
- Community 179
- Community 180
- Community 181
- Community 182
- Community 183
- Community 184
- Community 185
- Community 186
- Community 187
- Community 188
- Community 189
- Community 190
- Community 191
- Community 192
- Community 193
- Community 194
- Community 195
- Community 196
- Community 197
- Community 198
- Community 199
- Community 200
- Community 201
- Community 202
- Community 203
- Community 204
- Community 205
- Community 206
- Community 207
- Community 208
- Community 209
- Community 210
- Community 211
- Community 212
- Community 213
- Community 214
- Community 215
- Community 216
- Community 217
- Community 218
- Community 219
- Community 220
- Community 221
- Community 222
- Community 230

## God Nodes (most connected - your core abstractions)
1. `docs/SPEC.md — extracted spec text` - 40 edges
2. `authorize()` - 32 edges
3. `runTurn()` - 21 edges
4. `read()` - 20 edges
5. `Queryable` - 18 edges
6. `compilerOptions` - 17 edges
7. `compilerOptions` - 16 edges
8. `CTO / Delivery Lead` - 16 edges
9. `templateReply()` - 16 edges
10. `QA / Browser Engineering Lead` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Invalidate, never delete` --semantically_similar_to--> `Spec §17 — Memory correction`  [INFERRED] [semantically similar]
  docs/PHASE-1-DESIGN.md → Batore_Personal_Assistant_Spec.pdf
- `Completion Auto-Matching Threshold` --semantically_similar_to--> `WrongMut - Wrong-Mutation Risk Metric`  [INFERRED] [semantically similar]
  README.md → docs/AI_EVALS.md
- `docs/SPEC.md — extracted spec text` --references--> `Spec §7 — Ownership matters`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §12 — Inference levels (CONFIRMED/INFERRED/UNCERTAIN)`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf
- `docs/SPEC.md — extracted spec text` --references--> `Spec §16 — Memory provenance`  [EXTRACTED]
  docs/SPEC.md → Batore_Personal_Assistant_Spec.pdf

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **The scheduled-job path: poll, fire, evaluate, refuse undo** — docs_phase_3_design_poller, docs_phase_3_design_fired_at_idempotency, docs_phase_3_design_scheduled_job_not_undoable, docs_phase_3_design_workflow_evaluate_at_deadline, docs_phase_3_design_early_completion_silences_rule [EXTRACTED 0.90]
- **Turn Pipeline Stages (Interpret / Resolve / Mutate / Respond)** — docs_ai_architecture_interpret_stage, docs_ai_architecture_resolve_stage, docs_ai_architecture_mutate_stage, docs_ai_architecture_respond_stage [EXTRACTED 1.00]
- **AI_ARCHITECTURE, AI_PROVIDERS, AI_FALLBACK, and AI_EVALS form one cross-linked documentation set** — docs_ai_architecture, docs_ai_fallback [EXTRACTED 1.00]
- **Claude, Gemini, and Qwen implement the AIProvider contract** — apps_api_src_ai_provider, apps_api_src_ai_claude, apps_api_src_ai_gemini, apps_api_src_ai_qwen [EXTRACTED 1.00]
- **The Interpret-Resolve-Mutate-Respond Turn Pipeline** — docs_execution_plan_four_stage_orchestrator, docs_planner_wiring_design_extracted_intent, docs_phase_2_design_three_band_resolution, docs_execution_plan_typed_tool_layer, docs_execution_plan_action_log [EXTRACTED 1.00]
- **File-ownership map enforced via /freeze across implementer agents** — claude_agents_04_solutions_architect_file_ownership_table, claude_agents_18_devops_sre_freeze [EXTRACTED 1.00]
- **Security practice engagement lifecycle (lead routes to offensive/defensive/dfir)** — claude_agents_34_security_lead_security_lead, claude_agents_35_offensive_security_engineer_offensive_security_engineer, claude_agents_36_dfir_analyst_dfir_analyst, claude_agents_37_detection_engineer_detection_engineer, claude_agents_38_threat_hunter_threat_hunter [EXTRACTED 1.00]
- **Single browser owner constraint across QA, performance, and devex roles** — claude_agents_12_qa_browser_lead_qa_browser_lead, claude_agents_14_performance_engineer_performance_engineer, claude_agents_17_devex_engineer_devex_engineer, claude_agents_07_frontend_lead_frontend_lead [EXTRACTED 1.00]
- **Merge-resolution invariant: pointer, view, resolver, cycle guard, lossy-inverse fix** — docs_phase_1_design_merged_into_id, docs_phase_1_design_people_current_view, docs_phase_1_design_resolve_person, docs_phase_1_design_resolve_merged_cycle_guard [EXTRACTED 1.00]
- **decidePermission Policy Rules** — docs_phase_7_permissions_design_decidepermission_policy, docs_phase_7_permissions_design_stricter_grant_honoured, docs_phase_7_permissions_design_looser_grant_limits, docs_phase_7_permissions_design_unclassified_tool_fails_closed [EXTRACTED 1.00]
- **The Phase 2 trust boundary — model proposes typed mentions, backend resolves and commits** — docs_phase_2_design_extract_intents_tool, docs_phase_2_design_model_gets_no_db_handle, docs_phase_2_design_is_extraction_validator, docs_phase_2_design_verbatim_time_phrase, docs_phase_2_design_resolved_uuid_handoff, docs_phase_2_design_never_write_sql_from_model [EXTRACTED 1.00]
- **Planning/execution chain: plan, decisions, phases, Phase 1 design** — docs_phase_1_design [EXTRACTED 1.00]
- **Turn-grained undo pipeline: validate, commit, log, undo** — docs_phase_1_design_validate_is_a_function, docs_phase_1_design_execute_turn, docs_phase_1_design_action_log_turn_id_grain, docs_phase_1_design_undo_turn, docs_phase_1_design_double_undo_partial_unique_index [EXTRACTED 1.00]
- **Turn pipeline: route handler, orchestrator, router, and respond stage** — apps_web_app_api_turn_route, apps_api_src_assistant_orchestrator, apps_api_src_ai_router, apps_api_src_assistant_respond [EXTRACTED 1.00]
- **Read-only/deterministic QA roles distinct from browser daemon** — claude_agents_25_web_standards_engineer_web_standards_engineer, claude_agents_26_accessibility_engineer_accessibility_engineer, claude_agents_27_e2e_automation_engineer_e2e_automation_engineer [INFERRED 0.75]
- **Ask rather than guess (§27 stance across resolution, routing and rendering)** — docs_demo_guide_whos_x, docs_demo_guide_deadline_without_time, docs_master_execution_plan_fallback_policy [INFERRED 0.85]
- **CI/eval/security workflow triad gating merges to main** — github_workflows_ci_ci_workflow, github_workflows_codeql_codeql_workflow [INFERRED 0.85]
- **Frontend polish/QA specialist trio (motion, taste, visual critique)** — claude_agents_23_motion_engineer_motion_engineer, claude_agents_24_taste_director_taste_director, claude_agents_33_visual_critic_visual_critic [INFERRED 0.85]
- **Untrusted-content / prompt-injection trust boundary discipline across roles** — claude_agents_10_ai_agent_engineer_prompt_injection_trust_boundary, claude_agents_13_security_cso_prompt_injection_lens, claude_agents_12_qa_browser_lead_untrusted_page_content, claude_agents_11_integration_engineer_webhook_untrusted_principle [INFERRED 0.85]
- **Phase 4 silent failure modes, all returning plausible output** — docs_phase_4_design_input_type_asymmetry, docs_phase_4_design_iterative_scan, docs_phase_4_design_structured_not_semantic, docs_phase_4_design_supersede_not_update [INFERRED 0.85]
- **The §35 Permission Model, Documented Across Three Files** — docs_master_execution_plan_stage12_permission_model, docs_phase_7_permissions_design_the_35_permission_model, docs_ai_architecture_permission_gate_enforcement [INFERRED 0.85]
- **Production Deployment Pipeline** — _github_workflows_deploy_deploy_workflow, _github_workflows_uptime_uptime_workflow, docs_runbook_runbook, docs_deployment_design_target, docs_remaining_execution_plan_track_p1, docs_your_actions_cloudflare_secrets [INFERRED 0.85]
- **Multi-Provider Interpret and Respond Stack** — docs_ai_providers_claude_provider, docs_ai_providers_gemini_provider, docs_ai_providers_qwen_provider, docs_master_execution_plan_ai_model_router, docs_master_execution_plan_fallback_policy, docs_ai_evals_eval_ai_lane [EXTRACTED 1.00]
- **Wrong-Write Prevention Across Layers** — docs_ai_evals_wrong_mutation_risk, docs_master_execution_plan_risk_policy, readme_completion_match_threshold, docs_remaining_execution_plan_ingested_content_is_data, docs_ai_providers_qwen_field_order, docs_phases_no_mutation_endpoint [INFERRED 0.85]

## Communities (231 total, 65 thin omitted)

### Community 0 - "Extraction Eval Fixtures"
Cohesion: 0.07
Nodes (38): Deterministic fixture eval lane (free, every PR), allIntents, extractionTool, EXTRACTION_FIXTURES, ExtractionFixture, me, conditionMatches(), entityMatches() (+30 more)

### Community 1 - "API Package Manifest"
Cohesion: 0.04
Nodes (47): default, types, default, types, dependencies, @anthropic-ai/sdk, chrono-node, @google/genai (+39 more)

### Community 2 - "Contract & Docs Roles"
Cohesion: 0.05
Nodes (48): API Contract Engineer, Contract ownership (schema, versioning, breaking-change detection), /freeze schema/contract glob (first action), Publish contract before implementation starts, /document-generate skill (Diataxis structure), Every code example must run, /freeze developer docs glob (first action), Technical Writer (Developer-Facing) (+40 more)

### Community 3 - "Motion & Design Roles"
Cohesion: 0.05
Nodes (44): Common report format (Status/What changed/Verified/Risks/Blocked/Next action), animejs skill, Emil Kowalski reference, framer-motion skill, /freeze motion glob (first action), Motion Engineer, Motion principles (duration, easing, interruptibility, reduced-motion), motion / motion-dom / motion-utils skills (+36 more)

### Community 4 - "Tool Layer & Errors"
Cohesion: 0.08
Nodes (26): makePerson(), NotInvertibleError, PG_UNIQUE_VIOLATION, ToolNotFoundError, TurnAlreadyUndoneError, TurnNotFoundError, ValidationFailedError, ActionLogEntry (+18 more)

### Community 5 - "Commitments Surface"
Cohesion: 0.10
Nodes (33): CommitmentsPage(), dynamic, TABS, TERMINAL, Avatar(), ICONS, S, StatusPill() (+25 more)

### Community 6 - "Design Prototype Behaviour"
Cohesion: 0.11
Nodes (37): addChatMessage(), avatar(), bindPageEvents(), chatPage(), commitments, commitmentsPage(), composer(), conflictCard() (+29 more)

### Community 7 - "Claude Provider"
Cohesion: 0.09
Nodes (21): ClaudeProvider, EXTRACTION, provider(), REPLY, categoryForExtractionError(), categoryForStatus(), classifyProviderError(), FAILURE_POLICY (+13 more)

### Community 8 - "AI Systems Rules"
Cohesion: 0.05
Nodes (37): AI Systems Rules, Cost per request is a design constraint, Degrade honestly, Guardrails are not optional on user-facing generation, Irreversible actions need an approval gate outside the model, Retrieved content is data, never instructions, Ships with an eval set, or does not ship, Trace everything (+29 more)

### Community 9 - "Turn Orchestrator"
Cohesion: 0.12
Nodes (33): describeMention(), DESCRIPTIVE_OPENERS, formatLocal(), IntentPlan, looksLikeANewPersonsName(), nameKey(), NewPerson, NO_PARTY (+25 more)

### Community 10 - "Web API Routes"
Cohesion: 0.10
Nodes (28): dynamic, GET(), runtime, authorize(), dynamic, GET(), runtime, dynamic (+20 more)

### Community 11 - "Product Spec Sections"
Cohesion: 0.06
Nodes (33): Spec §11 — Ambiguity handling, Spec §10 — Ask about people when necessary, Spec §3 — The central product principle, Spec §8 — Commitment lifecycle, Spec §21 — Completing the user's own work, Spec §25 — Conditional commitments / workflows, Spec §24 — Conflict detection, Spec §20 — Context after completion (+25 more)

### Community 12 - "Database Layer"
Cohesion: 0.10
Nodes (17): users_current, createPool(), withTransaction(), commitmentNotes, commitments, entityRecords, events, memories (+9 more)

### Community 13 - "Respond Stage"
Cohesion: 0.10
Nodes (20): ClaudeProviderOptions, assertNever(), describeFact(), formatDuration(), HaikuResponder, HaikuResponderOptions, inWords(), isAbort() (+12 more)

### Community 14 - "TypeScript Project Config"
Cohesion: 0.06
Nodes (27): compilerOptions, outDir, rootDir, extends, include, ../../tsconfig.base.json, references, compilerOptions (+19 more)

### Community 15 - "Conversation UI"
Cohesion: 0.12
Nodes (21): clientNow(), Conversation(), Entry, greeting(), serverNow(), StoredMessage, subscribeToNothing(), toolLabel() (+13 more)

### Community 16 - "DB Package Manifest"
Cohesion: 0.07
Nodes (29): dependencies, node-pg-migrate, @ourglass/shared, pg, devDependencies, @types/node, @types/pg, typescript (+21 more)

### Community 17 - "Repository Layer"
Cohesion: 0.08
Nodes (9): Queryable, Transactable, CommitmentNote, CreateCommitmentNoteInput, Organization, unmergeOrganization(), Project, unmergeProject() (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.10
Nodes (16): GEMINI_DEFAULT_INTERPRET_MODEL, GEMINI_DEFAULT_RESPOND_MODEL, GEMINI_RESPOND_TIMEOUT_MS, GeminiLikeClient, GeminiLikeResponse, GeminiProvider, GeminiProviderOptions, generateContent() (+8 more)

### Community 19 - "Community 19"
Cohesion: 0.14
Nodes (24): AccessMode, base64url(), clearedSessionCookie(), constantTimeEqual(), cookieValue(), createSessionValue(), encoder, Env (+16 more)

### Community 20 - "Community 20"
Cohesion: 0.15
Nodes (18): ControlPlaneToolEmittedError, GateDecision, gateIntentCalls(), loadGrants(), none, canPersistentlyAllow(), CONTROL_PLANE_TOOLS, decidePermission() (+10 more)

### Community 21 - "Community 21"
Cohesion: 0.08
Nodes (25): CommitmentStatusHint, CONDITION_KEYS, ConditionReference, ENTITY_KEYS, ENTITY_RECORD_KEYS, EntityFieldHint, EntityMention, EntityRecordHint (+17 more)

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (22): CommitmentProposal, CompletionMatch, contentTokens(), decideCompletion(), detectDuplicate(), DuplicateDecision, EntityResolution, FIRST_PERSON_MENTIONS (+14 more)

### Community 23 - "Community 23"
Cohesion: 0.09
Nodes (21): CorrectRelationshipInput, CorrectRelationshipInversePatch, CorrectRelationshipOutput, correctRelationshipTool, ForgetMemoryInput, ForgetMemoryInversePatch, ForgetMemoryOutput, forgetMemoryTool (+13 more)

### Community 24 - "Community 24"
Cohesion: 0.12
Nodes (14): ActivityPage(), dynamic, LoginPage(), dynamic, TypesPage(), Column, LoadError(), Page() (+6 more)

### Community 25 - "Community 25"
Cohesion: 0.14
Nodes (22): it, organizations, organizations_current, people, people_current, projects, projects_current, resolve_organization() (+14 more)

### Community 26 - "Community 26"
Cohesion: 0.09
Nodes (12): assertUpdatableField(), Commitment, CommitmentFieldPatch, CompleteCommitmentResult, CreateCommitmentInput, CurrentCommitment, OverdueCommitment, restoreCommitmentFields() (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.14
Nodes (24): What is not built (do not promise in a demo), Fastify Retired for Next.js Route Handlers, Framework-Agnostic Database Boundary, Prototype screens not ported, and why, Risk Register, graphify update After Every Stage, The Model Is Never the Source of Truth, Master Execution Plan (+16 more)

### Community 28 - "Community 28"
Cohesion: 0.11
Nodes (24): docs/MISSIONS.md — mission templates, Mission 0 — Discovery, Mission 1 — Four-lens plan review, Mission 2 — Four-lens code review, Mission 3 — Competing-hypothesis debug, Mission 4 — Cross-layer feature build, Mission 4c — Showcase-grade interface, Mission 6.5 — Codify (tools from repeated mechanical steps) (+16 more)

### Community 29 - "Community 29"
Cohesion: 0.10
Nodes (11): CreatePersonInput, Person, NOTE: t_invalid is overwritten UNCONDITIONALLY here, unlike the invalidate*, NOTE: this is NOT the inverse of a merge. `mergePerson` sets `t_invalid` AND, currentAccount(), ensureUser(), EnsureUserInput, getUser() (+3 more)

### Community 30 - "Community 30"
Cohesion: 0.11
Nodes (19): ActorKind, DatabaseTransaction, err(), ExecuteTurnResult, fakeQueryResult(), Invertibility, LoggedMutation, ok() (+11 more)

### Community 31 - "Community 31"
Cohesion: 0.13
Nodes (14): AIProvider, InterpretInput, NO_THINKING, OLLAMA_DEFAULT_BASE_URL, OLLAMA_DEFAULT_MODEL, QWEN_DEFAULT_INTERPRET_TIMEOUT_MS, QWEN_EXTRACTION_SCHEMA, QWEN_FIELD_ORDER (+6 more)

### Community 32 - "Community 32"
Cohesion: 0.15
Nodes (7): AIModelRouter, AllProvidersFailedError, correlationId(), RoutedResponder, GOOD_REPLY, OK, router()

### Community 33 - "Community 33"
Cohesion: 0.10
Nodes (18): AttachContextInput, AttachContextInversePatch, AttachContextOutput, AttachContextRawInput, attachContextTool, isUuid(), validate(), CreateReminderInput (+10 more)

### Community 34 - "Community 34"
Cohesion: 0.13
Nodes (22): Credential Skip Gate, Deploy Workflow, Migrations Are Not Run by the Deploy Workflow, Deploys Are Never Cancelled In Flight, Post-Deploy Smoke Check, Staging on Push, Production on Manual Dispatch, api health Probe Job, Best-Effort Signal, Not Alerting (+14 more)

### Community 35 - "Community 35"
Cohesion: 0.10
Nodes (22): Mutate Stage, §35 Permission Gate Enforcement, Risk Policy, Stage 7: Risk Policy, action_type Is a Tool Name, Confirming a Held Action Is a Button, Not a Chat Reply, Control Plane Outside the Model, Control-Plane Surface (Permission Routes) (+14 more)

### Community 36 - "Community 36"
Cohesion: 0.13
Nodes (15): createMemory(), CreateMemoryInput, Memory, MemoryKind, MemorySubjectKind, RankedRow, RRF_K, ScoredMemory (+7 more)

### Community 37 - "Community 37"
Cohesion: 0.14
Nodes (18): RESPOND_FALLBACK_REASONS, RoutedExtractor, RoutedInterpretation, toExtractionError(), AI Architecture, The AI Layer Dependency Boundary, Observability (per-attempt log line and persisted trace), Resolve Stage (+10 more)

### Community 38 - "Community 38"
Cohesion: 0.15
Nodes (11): EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EmbeddingError, EmbeddingTrace, InputType, parseEmbeddings(), clientWith(), toVectorLiteral() (+3 more)

### Community 39 - "Community 39"
Cohesion: 0.15
Nodes (14): { authMock, executeTurnMock, releaseMock, declineMock }, params, sameOriginJson, rejectCrossSite(), db, dynamic, POST(), runtime (+6 more)

### Community 40 - "Community 40"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, forceConsistentCasingInFileNames, incremental, isolatedModules, jsx, lib (+11 more)

### Community 41 - "Community 41"
Cohesion: 0.12
Nodes (20): /autoplan skill, Cost-per-request design constraint, /benchmark skill, /browse skill, /open-gstack-browser skill, QA / Browser Engineering Lead, /qa-only skill, /scrape skill (+12 more)

### Community 42 - "Community 42"
Cohesion: 0.15
Nodes (9): commitmentOwedByBarkha(), deps(), fakeExtractor(), intent(), mention(), owedByBarkha(), recordingResponder(), scheduleIntent() (+1 more)

### Community 43 - "Community 43"
Cohesion: 0.19
Nodes (15): dynamic, isOpen(), PermissionsPage(), dynamic, isOpen(), SettingsPage(), apiBase(), EnumOption (+7 more)

### Community 44 - "Community 44"
Cohesion: 0.16
Nodes (19): A Worker Cannot Reach localhost Ollama, Deployment Definition of Done, Supabase Direct Connection, Never the Transaction Pooler, Deployment Order of Work, pg Pinned to 8.16.3 or Higher, Secrets Never Enter the Repo, GitHub, Supabase and Cloudflare Deployment Target, Blocked - Needs Repository ADMIN (+11 more)

### Community 45 - "Community 45"
Cohesion: 0.12
Nodes (15): ACTION_KINDS, CONDITION_KINDS, CreateWorkflowInput, CreateWorkflowInversePatch, CreateWorkflowOutput, CreateWorkflowRawInput, createWorkflowTool, EvaluateWorkflowInput (+7 more)

### Community 46 - "Community 46"
Cohesion: 0.12
Nodes (11): HERE, { queryMock, authMock, undoTurnMock }, dynamic, GET(), runtime, getPool(), Pool, dynamic (+3 more)

### Community 47 - "Community 47"
Cohesion: 0.21
Nodes (14): dynamic, EntityTypePage(), formatWhen(), EntityRecord, EntityTypeField, fetchEntityRecords(), fetchPeople(), FieldKind (+6 more)

### Community 48 - "Community 48"
Cohesion: 0.11
Nodes (18): Capability gap → research-analyst, never guess, docs/ROUTER.md, One browser-daemon owner, always, Platform gates the roster (RN/Expo, web, no-UI), Read-only first (missions 1-3), Routing Rules, Security engagements route through security-lead, Specialists over generalists when signal is clear (+10 more)

### Community 49 - "Community 49"
Cohesion: 0.15
Nodes (14): classifyCommitmentsInverse(), CommitmentsInversePatch, CompleteInversePatch, CreateCommitmentInput, CreateCommitmentOutput, CreateCommitmentRawInput, createCommitmentTool, CreateInversePatch (+6 more)

### Community 50 - "Community 50"
Cohesion: 0.15
Nodes (13): DECISIONS, declinePendingActionTool, PendingActionDecisionInput, PendingActionInversePatch, releasePendingActionTool, RevokePermissionInput, RevokePermissionInversePatch, revokePermissionTool (+5 more)

### Community 51 - "Community 51"
Cohesion: 0.15
Nodes (17): AI-slop design patterns to avoid, /design-consultation skill, Design Director, DESIGN.md, /design-review skill (lead-only, auto-commits), /design-shotgun skill, ui-ux-pro-max skill, /browse skill (forbidden) (+9 more)

### Community 52 - "Community 52"
Cohesion: 0.14
Nodes (17): DevOps / SRE, /guard skill, /land-and-deploy skill (forbidden), Documented rollback for every deploy path, /setup-deploy skill, /ship skill (forbidden), /document-release skill, /land-and-deploy skill (+9 more)

### Community 53 - "Community 53"
Cohesion: 0.13
Nodes (17): Composition is code discipline, Freeze video glob (first action), Motion Graphics Engineer (agent), remotion-* skill family, Render is expensive and slow discipline, Brand consistency over novelty, Brand & Media Producer (agent), Cost-first generation discipline (+9 more)

### Community 54 - "Community 54"
Cohesion: 0.12
Nodes (17): Extraction Comparator, Extraction Eval Harness, 99 Hand-Labelled Fixtures, forbids - Negative Fixtures Against Over-Triggering, Fixture Labelling Rules, Structured Output Guarantees Shape, Not Meaning, Every CI Job Is A Clean Runner, ESLint 9.39.5 Pin (+9 more)

### Community 55 - "Community 55"
Cohesion: 0.12
Nodes (7): CommitmentStatus, TERMINAL_STATUSES, CreateWorkflowInput, DueWorkflow, Workflow, WorkflowActionKind, WorkflowConditionKind

### Community 56 - "Community 56"
Cohesion: 0.12
Nodes (15): CommitmentCompletedFact, CommitmentCreatedFact, CommitmentUpdatedFact, CommittedFact, EntityRecordCreatedFact, EntityTypeDefinedFact, EventScheduledFact, MemoryForgottenFact (+7 more)

### Community 57 - "Community 57"
Cohesion: 0.12
Nodes (16): compilerOptions, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib (+8 more)

### Community 58 - "Community 58"
Cohesion: 0.26
Nodes (13): AIConfig, AIEnv, buildAIRouter(), buildProvider(), BuildRouterOptions, describeProviders(), loadAIConfig(), NoProviderConfiguredError (+5 more)

### Community 59 - "Community 59"
Cohesion: 0.15
Nodes (8): FetchLike, OllamaChatResponse, QwenProvider, Captured, fakeFetch(), Intents, provider(), VALID

### Community 60 - "Community 60"
Cohesion: 0.13
Nodes (15): blockedIntentIndices(), confirmationQuestion(), embedRecallQueries(), persistAssistantMessage(), planIntents(), previousAssistantTurnAt(), questionsFor(), reconcileFacts() (+7 more)

### Community 61 - "Community 61"
Cohesion: 0.14
Nodes (16): File-ownership map, /learn skill, /diagram skill, File-ownership table appended to plan, /plan-eng-review skill, Shared task list (5-6 tasks per teammate), Solutions Architect, AI / Agent Engineer (+8 more)

### Community 62 - "Community 62"
Cohesion: 0.12
Nodes (15): inference_level enum (CONFIRMED/INFERRED/UNCERTAIN), Shared contract prevents API/eval drift, Six spec §5 intent kinds, INTENT_KINDS, COMMITMENT_STATUS_HINTS, CONDITION_SCHEMA, ENTITY_FIELD_SCHEMA, ENTITY_RECORD_SCHEMA (+7 more)

### Community 63 - "Community 63"
Cohesion: 0.15
Nodes (10): CreateEntityRecordInput, EntityRecord, EntityType, EntityTypeField, EntityTypeWithFields, EnumOption, FieldKind, getTypeByKey() (+2 more)

### Community 64 - "Community 64"
Cohesion: 0.12
Nodes (4): PendingAction, PendingActionStatus, PermissionDecision, PermissionGrant

### Community 65 - "Community 65"
Cohesion: 0.12
Nodes (15): devDependencies, typescript, vitest, exports, vitest, main, name, private (+7 more)

### Community 66 - "Community 66"
Cohesion: 0.19
Nodes (11): EmbeddingFailureReason, main(), Clock, evaluateDueWorkflows(), OnFire, OnRuleFired, PollerHandle, pollOnce() (+3 more)

### Community 67 - "Community 67"
Cohesion: 0.16
Nodes (11): Icon(), dmSans, manrope, metadata, viewport, SignOutButton(), AppShell(), isActive() (+3 more)

### Community 68 - "Community 68"
Cohesion: 0.13
Nodes (12): config, vitest, name, private, version, eslint, eslint-config-next, @opennextjs/cloudflare (+4 more)

### Community 69 - "Community 69"
Cohesion: 0.14
Nodes (15): Single browser owner rule, /context-save skill, CTO / Delivery Lead, /plan-tune skill, /qa skill, research-analyst agent, /retro skill, /skillify skill (+7 more)

### Community 70 - "Community 70"
Cohesion: 0.13
Nodes (15): /office-hours skill, HOLD SCOPE mode, Margin rule (scope expansion destroys margin on fixed-price work), /plan-ceo-review skill, Product / CEO Strategist, SCOPE EXPANSION mode, SCOPE REDUCTION mode, SELECTIVE EXPANSION mode (+7 more)

### Community 71 - "Community 71"
Cohesion: 0.14
Nodes (15): Define success before implementing non-trivial behavior, Do not hide failing tests with skips unless justified, Add regression coverage for important bug fixes, Testing Rules, Unit / integration / E2E test layering, docker-compose.yml (Postgres service), ourglass-postgres-data volume, postgres service (pgvector/pgvector:pg17) (+7 more)

### Community 72 - "Community 72"
Cohesion: 0.14
Nodes (13): description, engines, node, @types/node, typescript, vitest, name, packageManager (+5 more)

### Community 73 - "Community 73"
Cohesion: 0.17
Nodes (8): InferenceLevel, createRelationship(), CreateRelationshipInput, getById(), Relationship, RelationshipObjectKind, supersedeRelationship(), SupersedeResult

### Community 74 - "Community 74"
Cohesion: 0.13
Nodes (14): dependencies, @anthropic-ai/sdk, @ourglass/shared, devDependencies, @ourglass/api, @types/node, typescript, vitest (+6 more)

### Community 75 - "Community 75"
Cohesion: 0.20
Nodes (11): CivilDateTime, civilToUtc(), DIRECTION_BY_INTENT_KIND, END_OF_DAY, offsetMinutesAt(), ResolvedTime, resolveTime(), now (+3 more)

### Community 76 - "Community 76"
Cohesion: 0.21
Nodes (11): capitalize(), detectTimeConflicts(), formatDuration(), ownedThing(), ProactiveCandidate, ProactiveContext, renderProactiveLine(), selectProactiveLine() (+3 more)

### Community 77 - "Community 77"
Cohesion: 0.15
Nodes (12): DefineEntityTypeInput, DefineEntityTypeOutput, DefineEntityTypeRawInput, defineEntityTypeTool, EntityTypeRow, FieldDefInput, FieldKind, isFieldKind() (+4 more)

### Community 78 - "Community 78"
Cohesion: 0.32
Nodes (11): PendingActionButtons(), RevokeButton(), SetPermissionForm(), useControl(), ActionType, confirmPendingAction(), ControlResult, declinePendingAction() (+3 more)

### Community 79 - "Community 79"
Cohesion: 0.15
Nodes (14): Spec §22 — Conversational state updates, Spec §29 — The primary UI (inspection surfaces), Spec §28 — User control, action_log — the undo substrate, action_log turn_id grain — the conversational turn, Undo traverses only actor_kind='user_turn', Double-undo impossible — partial unique index, invertibility enum (full / lossy / none) (+6 more)

### Community 80 - "Community 80"
Cohesion: 0.15
Nodes (13): Anti-slop list (kill on sight), awesome design / impeccable references, Taste Director, taste skill (variance system), ui-ux-pro-max skill (styles/palettes/pairings), Written direction (deliverable), AI-slop checklist, Review priority list (spacing, hierarchy, density, alignment, colour, ai-slop, resilience, absence) (+5 more)

### Community 81 - "Community 81"
Cohesion: 0.27
Nodes (10): BackfillDeps, backfillMemoryEmbeddings(), BackfillResult, DocumentEmbedder, embedDocuments(), remember(), result(), unit() (+2 more)

### Community 82 - "Community 82"
Cohesion: 0.22
Nodes (10): CreatePersonInput, CreatePersonInversePatch, CreatePersonOutput, CreatePersonRawInput, createPersonTool, isUuid(), MAX_DISPLAY_NAME_LENGTH, NEVER_A_NAME (+2 more)

### Community 83 - "Community 83"
Cohesion: 0.27
Nodes (9): DEFAULT_TURN_LIMITS, readLimit(), rejectOverLimit(), NOW, TurnLimits, dynamic, getUserId(), POST() (+1 more)

### Community 84 - "Community 84"
Cohesion: 0.21
Nodes (13): Failure Taxonomy, Interpret Stage, Limitations, Stated Plainly, Qwen Provider, Respond Stage, AIModelRouter, Claude Provider, Gemini Provider (+5 more)

### Community 85 - "Community 85"
Cohesion: 0.22
Nodes (13): pnpm check:models, Listed and Callable Are Different Facts, Provider Troubleshooting Table, Injected Clock Makes pollOnce Cron-Callable, Reminder Poller Becomes a Cron Trigger, Five Recorded Defect Classes, Phase 3 - Conversational Loop and Reminders, Phase 4 - Understanding Over Time (+5 more)

### Community 86 - "Community 86"
Cohesion: 0.20
Nodes (12): Typecheck, Lint and Test Before Deploy, pnpm eval:ai Provider Comparison, Paid Lanes Need Owner Approval Every Time, WrongMut - Wrong-Mutation Risk Metric, Adding a Provider, Provider Configuration Variables, An Unset Provider Is a Choice, Not an Error, Stage 12d - Demo Readiness (+4 more)

### Community 87 - "Community 87"
Cohesion: 0.26
Nodes (10): OrchestratorDeps, holdAForget(), requireConfirmationFor(), storeArun(), turnDeps(), DeclineOutcome, declinePendingAction(), heldCalls() (+2 more)

### Community 88 - "Community 88"
Cohesion: 0.18
Nodes (6): deps(), frozen(), PollerDeps, buildToolRegistry(), ORCHESTRATOR, pg

### Community 89 - "Community 89"
Cohesion: 0.17
Nodes (3): CreateReminderInput, DueReminder, Reminder

### Community 90 - "Community 90"
Cohesion: 0.24
Nodes (10): commit(), CompleteCommitmentInput, CompleteCommitmentInversePatch, CompleteCommitmentOutput, CompleteCommitmentRawInput, completeCommitmentTool, deriveCompletion(), isIsoDate() (+2 more)

### Community 91 - "Community 91"
Cohesion: 0.24
Nodes (9): CreateEventInput, CreateEventInversePatch, CreateEventOutput, CreateEventRawInput, createEventTool, isUuid(), readInstant(), readOptionalText() (+1 more)

### Community 92 - "Community 92"
Cohesion: 0.18
Nodes (11): scripts, build, build:worker, deploy, deploy:staging, dev, lint, preview (+3 more)

### Community 93 - "Community 93"
Cohesion: 0.18
Nodes (11): scripts, build, build:libs, check:models, db:migrate, db:reset, dev, eval:ai (+3 more)

### Community 94 - "Community 94"
Cohesion: 0.18
Nodes (3): CreateMessageInput, Message, MessageRole

### Community 95 - "Community 95"
Cohesion: 0.18
Nodes (10): AI_PROVIDER_NAMES, AI_STAGES, AIProviderName, AIRequestLog, AIStage, isAIProviderName(), PROVIDER_FAILURE_CATEGORIES, ProviderFailureCategory (+2 more)

### Community 96 - "Community 96"
Cohesion: 0.38
Nodes (11): hasOnlyKeys(), isConditionOrUndefined(), isEntityMentionOrUndefined(), isEntityRecordOrUndefined(), isExtraction(), isInferenceLevel(), isRecord(), isStatusHintOrUndefined() (+3 more)

### Community 97 - "Community 97"
Cohesion: 0.24
Nodes (8): checkValue(), CreateEntityRecordInversePatch, CreateEntityRecordOutput, CreateEntityRecordRawInput, createEntityRecordTool, CreateEntityRecordToolInput, isUuid(), validate()

### Community 98 - "Community 98"
Cohesion: 0.24
Nodes (8): isNonCompletingStatus(), isUuid(), NON_COMPLETING_STATUSES, UpdateCommitmentInput, UpdateCommitmentOutput, UpdateCommitmentRawInput, updateCommitmentTool, validate()

### Community 99 - "Community 99"
Cohesion: 0.31
Nodes (10): OurGlass Accessible Image Label, OurGlass Brand Mark, Conversation Surface Motif, Arc Of A Day, Favicon 404 And Blank Tab Rationale, Next.js App Favicon Convention, Icon Colour Palette, Rounded Square Backdrop (+2 more)

### Community 100 - "Community 100"
Cohesion: 0.31
Nodes (6): contentSecurityPolicy(), Header, securityHeaders(), header(), nextConfig, next

### Community 101 - "Community 101"
Cohesion: 0.20
Nodes (10): /review skill, /codex skill, Fix-First auto-apply behaviour, Greptile PR-comment triage, Staff Code Reviewer, Three-bucket report format (auto-fix / decision / completeness gap), Adversarial / Second-Model Reviewer, Codex CLI installed/authenticated hard requirement (+2 more)

### Community 102 - "Community 102"
Cohesion: 0.27
Nodes (10): qwen3:8b Eval Results, QWEN_FIELD_ORDER - Schema Field Order Decides the Answer, Qwen Is Opt-In via OLLAMA_BASE_URL, Qwen via Ollama Provider, Ollama format Constrains Decoding but the Model Never Reads It, Gate 0 - Model Provider Capacity, Track Sequencing and Recommended Order, C1 - Tenancy Foundation With RLS (+2 more)

### Community 103 - "Community 103"
Cohesion: 0.20
Nodes (10): Defect Class: A Citation Is Not A Verification, Mutation-Proven Tests, In-Process Reminder Poller, Locked Decisions and Research Findings, One Postgres Instance With pgvector, A Query Tested Only With A Fake Transaction Is Untested, Ask band (0.65–0.92 or a tie), Auto-resolve band (>=0.92, single candidate) (+2 more)

### Community 104 - "Community 104"
Cohesion: 0.27
Nodes (10): Flattened Conditional Workflows, registry.coverage.test.ts Source Scan, Defect Class: Schema With No Code Path, Tool Reachability Audit, create_entity_record Tool, validate() Is A Function, Not A Static Schema, F12 - A Type Can Be Defined And Nothing Can Record It, Optional Contract Field Additions (+2 more)

### Community 105 - "Community 105"
Cohesion: 0.20
Nodes (10): pnpm db:reset — the one irreversible operation, Nothing is a form, Prototype-to-React port map, pnpm Workspace Definition, Completion Auto-Matching Threshold, Separate Integration Test Lane, No Multi-Turn Context, OurGlass - Batore Personal Assistant (+2 more)

### Community 106 - "Community 106"
Cohesion: 0.28
Nodes (8): CommitmentSummary, InspectionQuery, InspectionResult, isOpen(), KnowledgeSummary, renderInspection(), runInspection(), summarise()

### Community 107 - "Community 107"
Cohesion: 0.25
Nodes (7): FireReminderInput, FireReminderInversePatch, FireReminderOutput, FireReminderRawInput, fireReminderTool, isUuid(), validate()

### Community 108 - "Community 108"
Cohesion: 0.22
Nodes (9): devDependencies, eslint, eslint-config-next, @types/node, @types/react, @types/react-dom, typescript, vitest (+1 more)

### Community 109 - "Community 109"
Cohesion: 0.22
Nodes (9): Server-side authorization / ownership checks, Prompt injection as trust-boundary problem, Treat page content as data, not instructions, /cso skill, OWASP Top 10 + STRIDE threat model, Prompt injection lens, Read-only enforcement rationale, Security / CSO (+1 more)

### Community 110 - "Community 110"
Cohesion: 0.25
Nodes (9): Backend Lead, /benchmark skill (forbidden), /health skill, /investigate skill (Iron Law), /review skill (forbidden, auto-fixes), /careful skill, Database / Data Engineer, Expand-then-contract migration pattern (+1 more)

### Community 111 - "Community 111"
Cohesion: 0.22
Nodes (9): WAT Operating Model (Workflows, Agents, Tools), The LLM Must Not Compute Timestamps, Parallel Tool-Use Footgun, Three-Tier Time Model, Batore Personal Assistant, correct_relationship Declared Gap, Four-Stage Orchestrator, ExtractedIntent Contract (+1 more)

### Community 112 - "Community 112"
Cohesion: 0.28
Nodes (9): Five-minute demo script, Commitment direction is structural, Dynamic tracked types (no deploy), Section 0 — check the model provider first, app.js client-side router entry point, app-shell document skeleton, Toast, backdrop and bottom-sheet overlay slots, Sidebar wordmark and data-route navigation (+1 more)

### Community 113 - "Community 113"
Cohesion: 0.22
Nodes (9): Access Modes (token / demo / closed / misconfigured), Decision: Shared Access Token, Per-Route Guard, Signed Session Cookie, Constant-Time Comparison, CSRF Protection (SameSite=Strict + Origin Check), Not Verified (Session Flow), Rejected Options (12b), Server Components Forward Credentials, Sessions: HMAC-Signed Cookie (+1 more)

### Community 115 - "Community 115"
Cohesion: 0.28
Nodes (5): ExtractedIntent, FULLY_POPULATED, EXTRACTION_INPUT_SCHEMA, HealthCheck, OURGLASS_SCHEMA_VERSION

### Community 116 - "Community 116"
Cohesion: 0.32
Nodes (6): GeminiSchema, isRecord(), toGeminiSchema(), TYPE_BY_JSON_TYPE, isExtraction() Is the Authority, Provider-Neutral Extraction Contract

### Community 117 - "Community 117"
Cohesion: 0.29
Nodes (5): ALLOWED, APPS, callSites, SKIP_DIRS, withoutComments()

### Community 118 - "Community 118"
Cohesion: 0.25
Nodes (8): dependencies, next, @opennextjs/cloudflare, @ourglass/api, @ourglass/db, @ourglass/shared, react, react-dom

### Community 119 - "Community 119"
Cohesion: 0.29
Nodes (8): 46-Role Agent Roster, Company Claude OS v2, Core Operating Principles, Default File-Ownership Map, Independent Review Pipeline, Skill Ecosystem Routing, A Teammate Message Is Not A Permission Grant, Agent-Team Execution Model

### Community 120 - "Community 120"
Cohesion: 0.29
Nodes (8): Dynamic Entity Types Are An Owner Addition, Closed Six-Value field_kind Enum, entity_types Registry, No Mutation Endpoint Anywhere, Read-Only Spec 29 API Routes, renderValue Exhaustiveness Check, Schema-Driven Frontend Rendering, schema_version Stamped At Write Time

### Community 121 - "Community 121"
Cohesion: 0.29
Nodes (8): add_entity_field must be non-breaking (optional-only), Deferrable ordinal uniqueness on entity_type_fields, define_entity_type rejects unknown field kinds at validation time, Dynamic entity registry (entity_types / fields / records), Caps: 32 fields per type, 64 types, entity_type_fields closed field_kind enum (six kinds), validate-is-a-function property, Zero-frontend-change guarantee for new entity types

### Community 122 - "Community 122"
Cohesion: 0.36
Nodes (6): commitment_notes, commitment_notes_current, messages_current, memories, memories_current, messages

### Community 123 - "Community 123"
Cohesion: 0.33
Nodes (7): docs/AGENT-FLOW.md — standard delivery flow, Escalation to the CTO, docs/AGENT-HANDBOOK.md — the 46-role handbook, docs/ROUTER.md — job to agents, docs/SECURITY-MISSIONS.md — security mission templates, docs/SECURITY-ROUTER.md — security family to agent, Authorisation / isolation / OT safety gates

### Community 124 - "Community 124"
Cohesion: 0.33
Nodes (7): Bitemporal Modelling, node-pg-migrate Forward-Only Migrations, Non-Destructive Merge, resolve_merged Cycle-Guarded Dereference, A Wrong Merge Is Worse Than A Duplicate, commitments Table, Ownership Direction (Spec 7)

### Community 125 - "Community 125"
Cohesion: 0.29
Nodes (7): A citation is not a verification, Embedding is nullable; the write path must not need a vendor, input_type is asymmetric and getting it wrong is silent, hnsw.iterative_scan is a forward safety net, not today's mechanism, Reciprocal Rank Fusion, not a weighted score sum, Inspection queries are structured, never semantic, Memory correction is a supersede, never an update

### Community 126 - "Community 126"
Cohesion: 0.29
Nodes (7): devDependencies, eslint, @eslint/js, @types/node, typescript, typescript-eslint, vitest

### Community 127 - "Community 127"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, rootDir, extends, include, ./tsconfig.json

### Community 128 - "Community 128"
Cohesion: 0.33
Nodes (5): atOrAbove(), CONFIRMATION_FLOOR, RISK_LEVELS, RiskLevel, riskRank()

### Community 129 - "Community 129"
Cohesion: 0.33
Nodes (3): worker, Env, worker

### Community 130 - "Community 130"
Cohesion: 0.33
Nodes (6): Spec §7 — Ownership matters, create_commitment — the first tool to implement, executeTurn — validate then commit then log, Ownership direction is two explicit FK columns, ToolDefinition / ToolContext / ToolError / LoggedMutation, The tool registry (apps/api/src/tools)

### Community 131 - "Community 131"
Cohesion: 0.33
Nodes (6): action_log Grain Is The Conversational Turn, Per-Phase Graphify Findings, pg Betweenness Bridge Finding, action_log and Undo, Graphify After Every Feature, Typed Validated Tool Layer (Spec 37)

### Community 132 - "Community 132"
Cohesion: 0.33
Nodes (6): Phase 1 file-ownership map, No browser owner in Phase 1, docs/SKILL-COVERAGE.md — gstack skill coverage audit, Lead-only skills — deliberately not given to teammates, docs/SKILL-ROUTING.md — ecosystem responsibilities, Skill binding is advisory — teammates load from settings

### Community 133 - "Community 133"
Cohesion: 0.33
Nodes (6): chrono-node 2.10.1 deterministic time resolution, Deterministic time tier, Event trigger tier, Relational time tier, Three-tier time split, Model returns verbatim time phrases only

### Community 134 - "Community 134"
Cohesion: 0.60
Nodes (5): entity_records, entity_records_current, entity_type_fields, entity_types, entity_types_current

### Community 135 - "Community 135"
Cohesion: 0.33
Nodes (6): scripts, check:models, eval:ai, test, test:live, typecheck

### Community 136 - "Community 136"
Cohesion: 0.40
Nodes (4): Extraction, validateIntentCompleteness(), base, blockingFields()

### Community 137 - "Community 137"
Cohesion: 0.40
Nodes (3): API, EXEMPT, routes

### Community 138 - "Community 138"
Cohesion: 0.40
Nodes (5): Spec §12 — Inference levels (CONFIRMED/INFERRED/UNCERTAIN), Spec §17 — Memory correction, Spec §16 — Memory provenance, Invalidate, never delete, relationships.inference_level — enum, not a float

### Community 139 - "Community 139"
Cohesion: 0.40
Nodes (5): Treat database migrations as production code, Production Rules, No production deployment without applicable quality gates, Have a rollback/recovery strategy for risky releases, Perform smoke verification after deployment

### Community 140 - "Community 140"
Cohesion: 0.40
Nodes (5): people_current view (filters, does not resolve), Repository discipline — raw people access in one file, resolve_merged cycle guard (16-hop depth cap), resolve_person(uuid) dereference function, Two read shapes — list vs dereference-by-id

### Community 141 - "Community 141"
Cohesion: 0.40
Nodes (5): Phase 2 — Interpret + Resolve, isExtraction runtime validator, Model receives no DB handle, UUID, or mutation tool, Phase 2 creates no messages or state mutations, Phase 2 trust boundary

### Community 142 - "Community 142"
Cohesion: 0.50
Nodes (5): Early completion must not fire the rule, fired_at is the idempotency key, In-process reminder poller with an injected clock, A clock tick is not undoable (invariant 4), Conditional rules evaluate at the deadline, never continuously

### Community 143 - "Community 143"
Cohesion: 0.60
Nodes (5): Four-stage orchestrator (Interpret, Resolve, Mutate, Respond), The partial-commit rule, One Haiku call with a mandatory template fallback, Trace persistence on messages, turn_id originates inside executeTurn, never in the orchestrator

### Community 144 - "Community 144"
Cohesion: 0.50
Nodes (4): main(), Do the actual work. Keep this deterministic., One-line description of what this tool does. Inputs: --example-id the thing to…, run()

### Community 145 - "Community 145"
Cohesion: 0.50
Nodes (4): Auto-committing skills never run in a teammate, freeze is a single global slot that protects a session from itself, The ownership map plus discipline is the entire cross-agent mechanism, The tools allowlist is the only enforced per-teammate restriction

### Community 146 - "Community 146"
Cohesion: 0.50
Nodes (4): Actionable brief output format (QUESTION/ANSWER/CONFIDENCE/SOURCES/HOW TO DO IT/GOTCHAS/UNKNOWNS/OPEN QUESTION), Spawned on capability gap (unfamiliar API/framework/protocol/regulation), Primary-sources-first research method, Research Analyst

### Community 147 - "Community 147"
Cohesion: 0.50
Nodes (4): Architecture Rules, Document important irreversible decisions, Explicit boundaries and simple dependencies, Treat authn/authz and trust boundaries as architecture concerns

### Community 148 - "Community 148"
Cohesion: 0.50
Nodes (3): messages, pending_actions, permission_grants

### Community 149 - "Community 149"
Cohesion: 0.67
Nodes (3): Evals CI Workflow, fixtures job (recorded-fixtures lane, free, deterministic), live job (live-model lane, manual dispatch only)

### Community 150 - "Community 150"
Cohesion: 0.67
Nodes (3): ExtractionResult, resolvePersonMention, Resolved-UUID handoff to Phase 1 ToolCalls

### Community 151 - "Community 151"
Cohesion: 0.67
Nodes (3): Double Release Cannot Execute Twice, Holding and Releasing, Undo of a Release Reopens the Row

### Community 152 - "Community 152"
Cohesion: 0.67
Nodes (3): Dependabot config, npm package-ecosystem (used for pnpm project), Pinned major-version ignores (typescript, eslint, @eslint/js, vitest)

## Ambiguous Edges - Review These
- `docs/SPEC.md — extracted spec text` → `Agent teams operating guide (PDF)`  [AMBIGUOUS]
  docs/SPEC.md · relation: conceptually_related_to
- `Conversation Surface Motif` → `Icon Colour Palette`  [AMBIGUOUS]
  apps/web/app/icon.svg · relation: semantically_similar_to
- `Toast, backdrop and bottom-sheet overlay slots` → `Five-minute demo script`  [AMBIGUOUS]
  docs/design-prototype/index.html · relation: conceptually_related_to

## Knowledge Gaps
- **866 isolated node(s):** `PermissionOutcome`, `Cell`, `UpdateCommitmentInput`, `UpdateCommitmentOutput`, `UpdateCommitmentRawInput` (+861 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1234 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **65 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `docs/SPEC.md — extracted spec text` and `Agent teams operating guide (PDF)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Conversation Surface Motif` and `Icon Colour Palette`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `Toast, backdrop and bottom-sheet overlay slots` and `Five-minute demo script`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `The Turn Pipeline` connect `Community 37` to `Turn Orchestrator`, `Community 83`, `Community 84`, `Community 35`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `pg` connect `Community 88` to `Community 81`, `API Package Manifest`, `Community 42`, `Community 87`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `react` connect `Community 67` to `Community 68`, `Commitments Surface`, `Community 78`, `Community 47`, `Conversation UI`, `Community 24`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **What connects `PermissionOutcome`, `Cell`, `UpdateCommitmentInput` to the rest of the system?**
  _866 weakly-connected nodes found - possible documentation gaps or missing edges._