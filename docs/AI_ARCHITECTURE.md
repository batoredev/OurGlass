# AI architecture

How the assistant uses language models, and — more importantly — where it does not.

Companion documents: [AI_PROVIDERS.md](AI_PROVIDERS.md) (each provider and its configuration),
[AI_FALLBACK.md](AI_FALLBACK.md) (retry, fallback and idempotency rules),
[AI_EVALS.md](AI_EVALS.md) (how model quality is measured).

---

## The one rule

**The model proposes. The tool layer validates and commits. Postgres is the source of truth.**

No model in this system has a database handle, writes SQL, calls a tool directly, or sees a
row id it could echo back as a resolved reference. A model does exactly two things:

| Stage | What the model does | What it returns |
|---|---|---|
| **Interpret** | Reads the user's sentence | A typed `Extraction` — a list of intents, each with an inference level |
| **Respond** | Reads plain-data facts about what was already committed | One short reply string |

Everything between those two — resolving who "Barkha" is, turning "by 6" into a timestamp,
detecting a duplicate, validating and committing a write — is deterministic TypeScript.

---

## The turn pipeline

```
POST /api/turn  (apps/web/app/api/turn/route.ts)
  │  requestId = crypto.randomUUID()        one id for the whole turn
  │  router    = buildAIRouter(process.env)  built per request; no key caching
  ▼
runTurn  (apps/api/src/assistant/orchestrator.ts)
  │
  ├─ 0. persist the user message            before any model call
  │
  ├─ 1. INTERPRET   RoutedExtractor ─► AIModelRouter ─► Claude │ Gemini │ Qwen
  │                 output validated by isExtraction() whichever provider answered
  │
  ├─ 2. RESOLVE     deterministic, read-only: people, commitments, time phrases,
  │                 duplicates, conflicts. Ambiguity becomes a QUESTION, not a guess.
  │
  ├─ 3. MUTATE      executeTurn: validate every tool call, then commit all writes
  │                 and their action_log rows in ONE transaction (undoable per turn)
  │
  ├─ 4. RESPOND     RoutedResponder ─► AIModelRouter ─► providers ─► template
  │                 never throws; the write is already durable
  │
  └─ 5. persist the assistant message with its trace
```

The router plugs into stages 1 and 4 **only**, behind the `Extractor` and `Responder`
interfaces that `runTurn` already depended on. `runTurn` has no knowledge that more than one
provider exists. That was a design constraint, not an accident: the orchestrator is the most
heavily tested file in the project, and a provider layer that needed to edit it would have
leaked past its own boundary.

---

## Components

| Component | File | Responsibility |
|---|---|---|
| Provider contract | `apps/api/src/ai/provider.ts` | `AIProvider { name, modelFor(stage), interpret(), respond(), health() }` |
| Claude | `apps/api/src/ai/claude.ts` | Wraps `AnthropicExtractor` (Sonnet) and `HaikuResponder` (Haiku) |
| Gemini | `apps/api/src/ai/gemini.ts`, `gemini-schema.ts` | `@google/genai`, schema converted to Gemini's dialect |
| Qwen | `apps/api/src/ai/qwen.ts` | Plain `fetch` to Ollama's `/api/chat` |
| Failure taxonomy | `apps/api/src/ai/errors.ts` | `FAILURE_POLICY` table, `ProviderError`, `classifyProviderError` |
| Router | `apps/api/src/ai/router.ts` | Priority, timeout, retry, fallback, logging; `RoutedExtractor`, `RoutedResponder` |
| Configuration | `apps/api/src/ai/config.ts` | Environment → typed config → router. Server-only |
| Shared contracts | `packages/shared/src/assistant-contract.ts`, `respond-contract.ts`, `ai-provider.ts` | Provider-neutral types |
| Deterministic reply | `apps/api/src/assistant/respond.ts` → `templateReply()` | The answer when every model fails |
| Risk policy | `apps/api/src/tools/risk.ts` | Risk level per tool (enforcement: see below) |

### The dependency boundary

`apps/api/src/ai/` imports only `@ourglass/shared` and the Interpret/Respond contracts in
`apps/api/src/assistant/extract.ts` and `respond.ts`. It has **no import path** to
`@ourglass/db` or to the tool layer. This was checked against the knowledge graph and by
direct search after stage 9 — a provider cannot write state, because it cannot reach anything
that does.

The direction is one-way: `ai` depends on `assistant`, never the reverse. That is why router
failures are translated into the orchestrator's existing `ExtractionError` contract inside
`RoutedExtractor` rather than taught to `runTurn` (see [AI_FALLBACK.md](AI_FALLBACK.md)).

---

## The provider-neutral contract

Every provider must return the same `Extraction` shape defined in
`packages/shared/src/assistant-contract.ts`. Provider-specific JSON never leaves the adapter.

- **`isExtraction()` is the authority**, for every provider. Claude's strict tool schema,
  Gemini's `responseSchema` and Ollama's `format` all *help* a model produce the right shape;
  none of them is trusted to guarantee it. Gemini's schema dialect cannot even express
  `additionalProperties: false`, so for Gemini the validator is the only thing between a stray
  field and the planner.
- **Time is never computed by a model.** An intent carries the verbatim phrase ("by 6", "next
  Friday"); `chrono-node` resolves it deterministically from the user's timezone.
- **Inference levels are data, not confidence scores.** `CONFIRMED` / `INFERRED` /
  `UNCERTAIN`. An `UNCERTAIN` intent is never silently promoted; it becomes a question.
- **`RespondInput` is plain data** — formatted strings and closed enums, no row objects, no
  UUIDs — so Respond cannot leak or invent an identifier.

---

## Observability

### Per-attempt log line

The route passes an `onLog` callback; every provider attempt emits one structured line:

```json
{ "event": "ai_request", "requestId": "…", "turnId": null, "stage": "interpret",
  "provider": "claude", "model": "claude-sonnet-5", "attempt": 1, "latencyMs": 812,
  "ok": true, "fallbackUsed": false }
```

Failed attempts add `errorCategory`. The line carries **no key and no utterance** — the
utterance already lives in `messages` with its own provenance and retention.

### Persisted trace

`messages.trace` on the assistant message records, per stage: `model`, `latencyMs`,
`stopReason`, token `usage`, `provider`, `fallbackUsed`, and `correlationId`.

- **`correlationId`** is ours — the per-turn `requestId` from the route, shared by Interpret
  and Respond, so a failed turn reads as one story.
- **`requestId`** in the trace is the **vendor's** id, kept untouched: it is the only handle
  for a support conversation with the provider.

A failed Interpret still writes a trace (`{ stage, failed: true, reason, stopReason }`); the
failed turn is the one you most need to debug.

### Known observability gaps

- `turnId` in the log line is currently always `null` — the router is not told the turn id.
  Correlate log lines to a turn by `requestId` = the trace's `correlationId`.
- A degraded Respond logs `errorCategory: "unknown"`; the precise reason (`timeout`,
  `sdk_error`, `too_long`, …) is in the persisted trace's `fallbackReason`.

---

## Risk policy

`apps/api/src/tools/risk.ts` classifies every registered tool as one of `READ`,
`REVERSIBLE_WRITE`, `IMPORTANT_STATE_CHANGE`, `EXTERNAL_ACTION`, `HIGH_IMPACT_ACTION`. The
level lives in a table keyed by tool name — never on the tool, never from the model — so
neither can under-declare it. `assertRiskTableCovers` fails a test if a tool is registered
without a classification.

**It is classification, not yet enforcement.** There is no confirmation mechanism until the
§35 permission model (master plan stage 12). A risk check that can only throw enforces nothing
but name-presence, so enforcement was deliberately left out of the executor; see the header of
`risk.ts` for the full reasoning. Today every registered tool is `REVERSIBLE_WRITE` or
`IMPORTANT_STATE_CHANGE` — nothing external exists to confirm.

---

## Security properties

| Property | How it holds |
|---|---|
| Keys never reach the browser | `config.ts` is imported only from Route Handlers, which never ship to the client |
| Keys never reach logs | The router never holds a key, so its log lines cannot carry one; `describeProviders()` returns names and flags only (asserted in `config.test.ts`) |
| No model-authored SQL, shell, filesystem or HTTP | Models have no tools beyond the extraction schema; the AI layer cannot import the DB |
| Provider output cannot bypass validation | `isExtraction()` gates every provider; tools re-validate every input |
| No provider-shopping past a refusal | `refused` is terminal (see [AI_FALLBACK.md](AI_FALLBACK.md)) |
| Committed writes are never replayed | Respond runs after commit and never throws |
| Retrieved and ingested content is data | A requirement on ingestion (master plan stage 13), which is **not built yet** — nothing is ingested today |

---

## Limitations, stated plainly

- **Gemini and Qwen are unverified against a live endpoint.** No `GEMINI_API_KEY` and no
  Ollama on the build machine; both are tested with injected fakes only.
- **Claude's model ids are verified to exist** (`pnpm check:models`, 2026-09-17), but
  **extraction quality has never been measured live** — `pnpm test:live` has not been run.
- **No provider comparison numbers exist.** `pnpm eval:ai` is built and has not been run.
- **The router bounds the wait, not the work.** `Promise.race` cannot cancel an in-flight SDK
  call; the turn stops waiting, the request may finish in the background.
- **Worst-case latency is long** with defaults; see [AI_FALLBACK.md](AI_FALLBACK.md#latency).
