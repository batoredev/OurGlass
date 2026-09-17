# Master execution plan — multi-provider AI, then Phases 6–8

**Written 2026-09-16.** This is the plan of record for all remaining work: the
multi-provider AI orchestration layer, the unfinished half of Phase 4, and Phases 6, 7 and 8.
It supersedes nothing — `EXECUTION-PLAN.md` stays the project plan; this is the execution
order for what is left.

> **Standing rules that constrain every stage below**
>
> - **Claude tiers: Sonnet and Haiku only. Never Opus.** Owner decision, recorded in
>   `DECISIONS.md`. The new provider layer must not become a way around it.
> - **The repository is PUBLIC.** No key, no real name, no personal datum, ever. `.env` is
>   gitignored; `.env.example` carries blank values only.
> - **`/graphify --update` after every major step**, then read `GRAPH_REPORT.md` — God Nodes
>   and Surprising Connections are architecture findings, not decoration.
> - **The model is never the source of truth.** Postgres plus application state is. The model
>   proposes; the tool layer validates and commits.

---

## 0. Architecture assessment — what exists, and what gets reused

Read before planning, not assumed. The honest finding is that **most of the requested
provider architecture already exists in single-provider form**, so this is largely an
interface extraction plus two new implementations — not a rewrite.

| Requested | Already in the repo | Action |
|---|---|---|
| Provider interface | `Extractor` (`extract.ts`), `Responder` (`respond-contract.ts`) | **Reuse.** Both are already narrow, injectable, and depended on by `runTurn` through `OrchestratorDeps`. |
| Claude provider | `AnthropicExtractor`, `HaikuResponder` | **Reuse, wrap.** Becomes `ClaudeProvider`. |
| Model-neutral contract | `Extraction` / `ExtractedIntent` (`assistant-contract.ts`) | **Reuse.** Already provider-neutral, already validated by `isExtraction`, already pinned by `contract-sync.test.ts`. |
| Error taxonomy | `ExtractionFailureReason` (5 values), `ExtractionError` | **Extend.** Needs transport-level categories (timeout, rate limit, auth) that a single-provider design never had to distinguish. |
| Deterministic response fallback | `templateReply()` | **Reuse.** §18's requirement is already met and unit-tested. |
| Tool registry | 14 tools, typed `validate`/`commit`, `Result<T,E>` outputs | **Reuse. Do not duplicate.** |
| Transactions, action log, undo | `executeTurn`, `action_log`, `undoTurn` | **Reuse untouched.** |
| Stage separation | Interpret → Resolve → Mutate → Respond in `runTurn` | **Preserve exactly.** The router plugs into stages 1 and 4 only. |
| Eval harness | `packages/evals`, 97 fixtures, comparator, `forbids` | **Extend** with a provider-comparison runner. |
| Risk policy | none | **Build.** |
| Provider router / fallback | none | **Build.** |
| Structured observability | partial — `ExtractionTrace`, `RespondTrace` persisted to `messages.trace` | **Extend**, do not add a second system. |

### The one structural change

`runTurn` currently takes `extractor` and `responder` as separate dependencies. The router
sits **behind** those interfaces rather than replacing them:

```
OrchestratorDeps.extractor  ->  RoutedExtractor  ->  AIModelRouter  ->  [Claude, Gemini, Qwen]
OrchestratorDeps.responder  ->  RoutedResponder  ->  AIModelRouter  ->  [Claude, Gemini, Qwen]
```

`runTurn` does not change. That is deliberate: the orchestrator is the most heavily tested
file in the project, and a provider layer that requires editing it has leaked.

---

## 1. Known limitations, stated before starting

Recorded now so the final report cannot quietly omit them.

- **Gemini cannot be verified live.** There is no `GEMINI_API_KEY` in this environment. The
  provider will be built against `@google/genai` 2.22.0's documented API and tested with an
  injected fake client. Its default model name is **configurable and unverified**.
- **Qwen cannot be verified live.** Ollama is not installed on this machine and nothing is
  serving on `:11434`. The provider will be built against Ollama's documented HTTP API and
  tested with an injected fake `fetch`.
- **Claude is verified only by the paid lane.** `pnpm test:live` has still never run. It now
  costs ~97 Sonnet calls and needs the owner's explicit go-ahead.
- Therefore: **no provider-comparison numbers will be produced unless keys exist.** The
  runner will be built and will refuse loudly rather than emit fabricated numbers.

---

## 2. Execution order

### Progress

**Updated as each stage lands. A stage is DONE only when CI is green on it** —
integration tests do not run on the dev machine here, so a local pass is not evidence.

| # | Stage | Status | Landed as |
|---|---|---|---|
| 1 | Provider contracts + ClaudeProvider | ✅ done | `6b5df31` |
| 2 | Error classification, retry, router | ✅ done | `4ab9580` |
| 3 | Gemini provider | ✅ done *(unverified live)* | `e738ac9` |
| 4 | Qwen provider via Ollama | ✅ done *(unverified live)* | `f461f86` |
| 5 | Typed configuration | ✅ done | `bef65be` |
| 6 | Idempotency + stage separation | ✅ done | `56a16a5`, `72b8786` |
| 7 | Risk policy | ✅ done | `73c9779` |
| 8 | Observability | ✅ done | `d71e2e0` |
| 9 | Provider evals (`pnpm eval:ai`) | ✅ built *(never run — paid)* | *(this commit)* |
| 10 | AI documentation | ⬜ next | |
| 11 | Hybrid retrieval *(closes Phase 4)* | ⬜ | |
| 12 | §35 permission model *(Phase 7a)* | ⬜ | |
| 13 | Phase 6 — ingestion | ⬜ | |
| 14 | Phase 7 — integrations (§34) | ⬜ | |
| 15 | Phase 8 — voice | ⬜ | |
| 16 | Full recheck + run | ⬜ | |

Graphify runs after each major stage. Last refresh: `737fac1` — 1859 nodes,
2619 edges, 162 communities, health clean.

**Blocked on the owner, not on me** (neither stops the build; both stop the *claim*):

| What | Why it matters |
|---|---|
| `GEMINI_API_KEY` absent | Stage 3 ships untested against a live endpoint |
| Ollama not installed | Stage 4 ships untested against a live endpoint |
| `pnpm test:live` never run | ~97 paid Sonnet calls. The only measurement of extraction quality against a real model |


Each stage ends with the same gate: `pnpm typecheck && pnpm lint && pnpm test`, a green CI
run, `/graphify --update`, and a commit. A stage is not done until CI says so.

### Stage 1 — Provider contracts and the Claude provider
Formalise `AIProvider`, extract the transport-error taxonomy, wrap the existing Anthropic
code as `ClaudeProvider`. **No behaviour change**; the existing tests must pass untouched,
which is the proof the extraction was faithful.

### Stage 2 — Error classification, retry, and the router
The heart of the work, and the part most likely to be got subtly wrong.

**Fallback IS for:** timeout, network failure, provider unavailable, auth/config failure,
rate limit, provider 5xx, malformed structured output after one retry, schema validation
failure after one retry.

**Fallback is NOT for** — and this is the distinction that matters most:
legitimate user ambiguity, low semantic confidence, a valid clarification request,
application validation failure, business-rule rejection, authorization failure.

> *"Which Karthik do you mean?"* is the product **working**. Falling back to Gemini because
> Claude asked a question would shop for a model willing to guess — which is precisely the
> §27 failure the whole resolution design exists to prevent.

Bounded retry: one retry per provider, exponential backoff with jitter, never on a
permanent auth/config error.

### Stage 3 — Gemini provider
`@google/genai`, schema-constrained output normalised into the **same** `Extraction`.
Provider-specific JSON must not leak past the adapter.

### Stage 4 — Qwen provider via Ollama
Plain `fetch` against `/api/chat` with JSON-schema `format`. No new dependency; works under
Workers. Model name configurable, defaulting to a modest Qwen3 size.

### Stage 5 — Typed configuration
`AI_PROVIDER_ORDER`, per-provider keys and models, timeouts, retries, `AI_ENABLE_FALLBACK`,
and **per-stage** order overrides (§29). Server-side only — never reachable from `apps/web`
client code.

### Stage 6 — Idempotency and stage separation
The rule: **a committed mutation is never replayed because response generation failed.**
`runTurn` already commits before Respond and cannot structurally re-run the mutation — so
this stage is mostly *proving* it with tests for scenarios C and D, plus threading a
`requestId` through the trace.

### Stage 7 — Risk policy
`READ`, `REVERSIBLE_WRITE`, `IMPORTANT_STATE_CHANGE`, `EXTERNAL_ACTION`, `HIGH_IMPACT_ACTION`,
classified **per tool** and enforced in the executor — not in the model, and not in the
prompt. A policy the model can talk its way past is not a policy.

### Stage 8 — Observability
`requestId`, `conversationId`, provider, model, stage, latency, attempt, `fallbackUsed`,
outcome, error category. Extends the existing trace; never logs a key or an unnecessary
user datum.

### Stage 9 — Provider evals
`pnpm eval:ai`, running the existing 97 fixtures against each configured provider.
**Wrong mutations is the headline metric.** Refuses to run for an unconfigured provider
rather than reporting zeros.

### Stage 10 — AI documentation
`docs/AI_ARCHITECTURE.md`, `AI_PROVIDERS.md`, `AI_FALLBACK.md`, `AI_EVALS.md`, including
local Ollama setup and troubleshooting.

### Stage 11 — Hybrid retrieval *(closes Phase 4 for real)*
`searchHybrid` is built, indexed, integration-tested — and has no caller. Wire recall into
the turn, plus the embedding backfill that `remember` deliberately defers.

### Stage 12 — §35 permission model *(Phase 7a)*
One-time / persistent / by-action-type / revocable, on top of Stage 7's risk levels. This is
what stands between "works locally" and "can be deployed": `/api/undo` and eight read
surfaces currently have **no authorisation at all**.

### Stage 13 — Phase 6 ingestion
`documents` table and migration; images and documents (§32, §33). **Ingested content is data,
never instructions** — it cannot authorise a tool call. The prompt-injection boundary gets
explicit tests, not a comment.

### Stage 14 — Phase 7 integrations (§34)
Gmail, Calendar, Drive behind Stage 12's permission model. External actions always confirm.
Nothing ships here until the permission layer is reviewed.

### Stage 15 — Phase 8 voice
The spec says "eventually". Scope honestly: transcription boundary and contracts, or a
recorded decision to defer with the reason.

### Stage 16 — Full recheck and run
Re-read everything built; hunt for the recorded defect classes specifically:

1. *schema with no code path* — an object nothing reaches
2. *a citation is not a verification* — a comment asserting a behaviour nobody ran
3. *two declarations of one fact* — the shape behind nearly every bug this project has had
4. *a fake-`tx` test* — a query whose only coverage never touched SQL
5. *vacuous green* — a test that would pass with the feature deleted

Then a full local run: migrations, poller, web app, a real conversation end to end.

---

## 3. Verification gates

| Gate | Command | Rule |
|---|---|---|
| Types | `pnpm typecheck` | zero errors |
| Lint | `pnpm lint` | zero errors |
| Unit | `pnpm test` | all green |
| Integration | CI (Postgres + pgvector) | all green — no Docker on this machine, so **CI is the judge** |
| Build | `pnpm build` | clean |
| Graph | `/graphify --update` | report read, findings acted on |
| Paid | `pnpm test:live`, `pnpm eval:ai` | **owner approval, every time** |

**No stage is reported complete on a local pass alone.** Integration tests only run in CI
here, and this session has already had three failures that were green locally.

---

## 4. What "finished" means

- Every stage above landed, CI green.
- Every registered tool reachable or declared unreachable with a reason.
- Every provider either verified live, or documented as unverified with the reason.
- The defect-class sweep in Stage 16 run and its findings fixed.
- Documentation updated; the knowledge graph refreshed.
- Remaining limitations and architectural risks stated plainly, not omitted.
