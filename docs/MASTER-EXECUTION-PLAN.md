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
| 9 | Provider evals (`pnpm eval:ai`) | ✅ built *(never run — paid)* | `2cc9f16` |
| 10 | AI documentation | ✅ done | `ade2183` |
| 11 | Hybrid retrieval *(closes Phase 4)* | ✅ done *(Voyage unverified live)* | *(this commit)* |
| 12 | §35 permission model *(Phase 7a)* | ✅ done — 12a model/gate/hold/release/UI, 12b access control | `c3d87ab`, *(this commit)* |
| 12d | Demo readiness — first-mention people, time precision, provider budgets | ✅ done | `8b3fc68`, `c382868` |
| 13 | Phase 6 — ingestion | ⬜ next | |
| 14 | Phase 7 — integrations (§34) | ⬜ | |
| 15 | Phase 8 — voice | ⬜ | |
| 16 | Full recheck + run | ⬜ | |

Graphify runs after each major stage. Last refresh: after stage 12d — 2467 nodes, 3769
edges, 227 communities, health clean (0 dangling, 0 missing, 0 collapsed), no import cycles.
Re-verified from it and by direct grep: the AI layer still reaches neither `@ourglass/db`
nor the tool layer, and the Respond stage still holds no database handle — the §37 boundary
survives `create_person`. `authorize()` remains the second-largest hub (33 edges).

Earlier (stage 12) — 2280 nodes, 3503 edges, 185 communities.
Verified from it: `demoEnabled()` no longer exists anywhere in the graph, and `authorize()` is
now the second-largest hub (33 edges) — every data route depends on ONE access guard, which is
the intended shape. `ExtractionError` / `ProviderError` / `classifyProviderError` remain hubs
as the failure contract crossing ai → assistant. The provider layer still has no path to
`@ourglass/db` or the tool layer.

**Blocked on the owner, not on me** (neither stops the build; both stop the *claim*):

| What | Why it matters |
|---|---|
| ~~`GEMINI_API_KEY` absent~~ | **Resolved 2026-09-18/19.** Both Gemini stages verified against the live endpoint; two defects found only because of it (a model id that 404s for new keys, and thinking tokens consuming the whole reply budget) |
| Ollama not installed | Stage 4 ships untested against a live endpoint. Also the only provider with no quota — worth installing if the hosted ones stay throttled |
| **No provider has capacity (2026-09-21)** | Anthropic account out of credit (`400 … credit balance is too low`); the Gemini free-tier key returns `429 … exceeded your current quota`. **With neither, Interpret cannot run and no turn succeeds.** Not a code fault, and nothing in the build can route around it |
| `pnpm test:live` never run | ~99 paid Sonnet calls. The only measurement of extraction quality against a real model. Blocked on the credit above |

### Stage 12d — demo readiness (2026-09-19 → 21)

Not a planned stage. It came out of driving the product like a user before showing it to
anyone, and every item below was found that way rather than by a failing test.

| Fixed | What was wrong |
|---|---|
| `create_person` | Designed in PHASE-1-DESIGN §3, DECISIONS #5 and the executor's header — and never built. Every unfamiliar name became "Who's Karthik?", a question answering could not resolve, because nothing could write a person |
| Ownership direction in replies | Facts rendered as "Karthik → You". A live Gemini reply read that backwards as "you owe Karthik the venue quote" — on the one distinction (§7) the product exists to get right |
| Fabricated clock times | "by 6 tomorrow" resolved to "due Tuesday at 11:25 AM", 11:25 being the moment the user pressed enter. chrono implies the reference clock and `.get("hour")` cannot tell that from a real parse |
| Respond budget | 3s is Haiku's. Gemini measured 5–19s, so every Gemini reply degraded to the template with `degraded: true` permanently on — indistinguishable from an outage |
| `errorCategory: "unknown"` | The router logged a constant for every degraded reply, so a timeout, a refusal and an exhausted budget were identical in the one field operators are told to read |
| `pnpm dev` | Never started the web app: `pnpm -r` runs in dependency order and the poller never exits. The documented way to run the product ran only the poller |
| Two connection pools | `/api/turn` held a byte-identical copy of `_lib`'s pool singleton, so the app reserved twenty Supabase connections where both copies' comments argued for ten |
| A stale README | Still described Phase 3: no UI, a server on port 3001, curl against routes that no longer exist |

Every fix is mutation-verified and CI-green. `docs/DEMO-GUIDE.md` is the walkthrough, and its
first section is the provider capacity above, because that is what actually stops a demo.

### Defects found while executing (not waiting for stage 16)

Each was invisible to the suite that existed, and each is now pinned by a test that was shown
to fail without its fix.

| Commit | Defect | Why nothing caught it |
|---|---|---|
| `5067898` | `evals.yml` never built the workspace libraries; every PR run failed to resolve `@ourglass/shared` | Stages land by direct push to `main`, where that workflow does not trigger. Surfaced on a Dependabot PR |
| `ad06f76` | `RESPOND_MODEL` was `claude-haiku-5`, a model that does not exist — every live reply silently fell back to the template | Unit tests inject fake clients; Respond never throws, and the template reply looks correct. Found by asking `GET /v1/models`; `pnpm check:models` now does |
| `a932d7d` | Since stage 5, any Interpret-stage provider failure (outage, bad key, refusal) returned **HTTP 500** with the user message orphaned | `runTurn` catches only `ExtractionError`; the router throws its own types. Router and orchestrator tests each injected the type their own side expected |
| `5af1efe` | Qwen's Interpret aborted after Respond's 3-second budget — the local fallback could never succeed | One `timeoutMs` shared by both stages; tests used instant fakes |

All four are the recorded defect class *a citation is not a verification*, at a seam.


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
