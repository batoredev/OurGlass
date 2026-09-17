# AI fallback, retry and idempotency

When a model call fails, what happens — and, just as deliberately, what does not.

Source of truth: `apps/api/src/ai/errors.ts` (the policy table), `apps/api/src/ai/router.ts`
(the algorithm), `apps/api/src/assistant/orchestrator.ts` (where a turn commits). If this
document and those files disagree, the files win and this document has a bug.

---

## The principle

**Fallback is for failures of the provider. It is never for the user being unclear.**

A reply of *"Which Karthik do you mean?"* is the product working. Spec §27 says never guess
when guessing can cause a meaningful mistake, and the resolution design exists to produce
exactly that question. Falling back to another model because the first one asked would be
shopping for a model willing to guess.

That distinction is structural, not a convention. A clarification is a **successful**
extraction — an intent marked `UNCERTAIN`, or a resolution that finds two people — and never
reaches the router's failure path at all.

| Situation | Where it is handled | Does another provider get called? |
|---|---|---|
| Timeout, network error, outage, 5xx, rate limit | Router | **Yes** |
| Bad or missing API key (`auth`) | Router | **Yes** — without retrying the same provider |
| Unparseable output, or output that fails `isExtraction()` | Router | **Yes** — after one retry of the same provider |
| Legitimate ambiguity, `UNCERTAIN` intent, two matching people | Resolve → a question to the user | **No** |
| Low confidence | Inference levels → a question | **No** |
| Tool validation failure | Mutate → rolled back, surfaced as a question | **No** |
| Business-rule rejection (conflict, duplicate) | Resolve / Mutate → a question | **No** |
| Authorization failure | Tool layer | **No** |
| Refusal (safety decision) | Router — terminal | **No** |
| Output truncated at our token cap | Router — terminal | **No** |
| Input larger than the context window | Router — terminal | **No** |
| Request we malformed (other 4xx) | Router — terminal | **No** |

---

## The failure policy

Every provider error is classified into one category by `classifyProviderError` — duck-typed
on HTTP `status`, error `name` and `code`, never on SDK classes, so three SDKs share one table.

| Category | From | Retry same provider | Fall back | Why |
|---|---|:-:|:-:|---|
| `timeout` | router timer, `AbortError`, HTTP 408 | ✓ | ✓ | Transient |
| `network` | `ECONNREFUSED`, `ENOTFOUND`, `ECONNRESET`, `EAI_AGAIN`, fetch `TypeError` | ✓ | ✓ | Transient connectivity |
| `unavailable` | HTTP 404 | ✗ | ✓ | Retrying a missing endpoint only adds latency |
| `auth` | HTTP 401, 403; missing key | ✗ | ✓ | A wrong key stays wrong; another provider may be configured |
| `rate_limit` | HTTP 429 | ✓ | ✓ | Backoff may clear it; another provider certainly will |
| `server_error` | HTTP 5xx | ✓ | ✓ | The provider's fault, often transient |
| `malformed_output` | no tool call / not JSON | ✓ | ✓ | Sampling variance |
| `schema_invalid` | fails `isExtraction()` | ✓ | ✓ | Same as malformed |
| `unknown` | anything unrecognised | ✗ | ✓ | Don't hammer it; let the next one try |
| `bad_request` | other HTTP 4xx | ✗ | ✗ | **Terminal.** Every provider would reject it |
| `refused` | Claude refusal, Gemini `SAFETY` and similar | ✗ | ✗ | **Terminal.** Not a fault; never provider-shop past it |
| `truncated` | `max_tokens`, `MAX_TOKENS`, `done_reason: length` | ✗ | ✗ | **Terminal.** Our cap; identical everywhere |
| `context_window` | input too large | ✗ | ✗ | **Terminal.** Another provider does not make it smaller |

The table is a `satisfies Record<ProviderFailureCategory, FailurePolicy>`: adding a category
without a policy fails the build.

---

## Interpret: the algorithm

```
chain = configured providers, in AI_INTERPRET_ORDER (else AI_PROVIDER_ORDER)
        → only the first, if AI_ENABLE_FALLBACK=false
        (unconfigured providers are skipped, not counted as failures)

for each provider in chain:
    for attempt in 1 .. (1 + AI_MAX_RETRIES):
        wait at most AI_REQUEST_TIMEOUT_MS for provider.interpret()
        success           → return it                    (fallbackUsed = not the first provider)
        terminal failure  → stop everything; throw it
        retryable, budget → sleep min(250·2^(attempt-1), 2000) ms + 0–99 ms jitter; retry
        fallbackable      → next provider
throw AllProvidersFailedError(trail of every attempt)
```

**One provider per request on the happy path.** Claude answers, the router stops. Nothing
fans out to all providers; that is the eval runner's job, through a different entry point.

**The timeout bounds the wait, not the work.** `Promise.race` cannot cancel an SDK call in
flight. The turn stops waiting; the abandoned request may still complete and be billed.
Qwen passes an abort signal matching the router's timeout; Claude and Gemini rely on the
race.

### What the user sees when Interpret fails

`runTurn` recovers only from `ExtractionError`, so `RoutedExtractor` translates the router's
errors into that contract (`toExtractionError` in `router.ts`). The turn then writes a trace,
commits **nothing**, and returns a templated reply — no Respond model is called to explain a
model failure.

| Router outcome | `ExtractionError.reason` | Reply |
|---|---|---|
| Provider's own refusal | `refused` | "I can't help with that one." |
| Truncation | `truncated` | "That got cut off — can you say it more briefly?" |
| Input too large | `context_window_exceeded` | "That was too long for me to read — can you shorten it?" |
| Every provider down, bad keys, 400 | `provider_error` | "I couldn't process that just now — nothing was saved. Try again in a moment." |
| Malformed/invalid output after retries | `no_tool_call` / `invalid_payload` | "Something went wrong interpreting that — nothing was saved." |

When the provider threw an `ExtractionError` of its own (refusal, truncation, bad shape), that
original error is passed through intact, stop reason and raw payload included.

> **This translation was missing from stage 5 until 2026-09-17.** Router errors are not
> `ExtractionError`, so `runTurn` rethrew them and the route returned **500** with the user's
> message persisted and no reply beside it. Unit tests of the router and of `runTurn` both
> passed, because each injected the error type its own side expected. The integration test
> *"degrades, not 500s, when EVERY provider behind the router is down"* now drives the real
> router through the real orchestrator.

---

## Respond: never throws

By the time Respond runs, the mutation is **already committed**. Throwing would turn a durable
write into an apparent failure and invite the user to repeat themselves — which is how a
duplicate is born. So every layer degrades instead:

1. Each provider's `respond()` never throws. On any failure it returns the deterministic
   `templateReply()` with `degraded: true` and a `fallbackReason`.
2. The router tries the **next** provider only for reasons a different provider could fix:
   `sdk_error`, `timeout`, `empty_text`. It does **not** for `refusal` (a safety decision),
   `too_long` (the template is already correct and concise), or `max_tokens` (our cap). One
   attempt per provider, no retries — the template is always ready.
3. If every provider degrades or none is configured, the router returns the template itself.
4. `runTurn` wraps the Respond call too: if a responder throws despite its contract, the
   template answers and the error is logged.

`templateReply()` is pure, synchronous and separately unit-tested, including a totality test
over every committed-fact kind — because it is the thing that must work when nothing else
does.

---

## Idempotency: a committed mutation is never replayed

The guarantee comes from **ordering**, not from deduplication after the fact:

```
persist user message → INTERPRET → RESOLVE (read-only) → MUTATE (one transaction) → RESPOND
                        ▲ may retry / fall back           ▲ runs once            ▲ never throws,
                        nothing written yet                commit or roll back     never re-runs Mutate
```

- **Before Mutate, nothing but the user message exists**, so retrying or falling back during
  Interpret cannot duplicate a write.
- **Mutate runs exactly once per turn.** `executeTurn` validates each tool call before its
  write, inside one transaction. A **validation** failure rolls the whole transaction back —
  no rows, no `action_log` entry — and becomes a question to the user. An **unexpected** error
  during commit (the database itself failing) also rolls everything back, then propagates as a
  server error; nothing is written either way. Nothing re-attempts the mutation.
- **After Mutate, no failure path leads back to it.** Respond failures degrade in place.
- **A turn is the unit of undo.** Every write in a committed turn shares one `turn_id` in
  `action_log`; "undo that" reverses the whole turn.

The router structurally cannot replay a mutation: it has never been given one.

---

## Scenarios, as tests

| | Scenario | Expected | Test |
|---|---|---|---|
| A | Claude unavailable | Gemini answers | `router.test.ts` — "Scenario A — Claude unavailable" |
| B | Claude and Gemini unavailable | Qwen answers | `router.test.ts` — "Scenario B" |
| C | Interpretation fine, mutation fails | Nothing written, no `action_log` row, no replay, surfaced as a question | `orchestrator.integration.test.ts` — "SCENARIO C" |
| D | Mutation committed, Respond fails | One commitment, one `turn_id`, template reply | `orchestrator.integration.test.ts` — "SCENARIO D" |
| E | Ambiguous entity | Ask; never fall back | `router.test.ts` — "Scenario E" |
| F | Malformed output | Retry once, then next provider | `router.test.ts` — "Scenario F" |
| G | Every provider unavailable | Deterministic failure naming the whole trail; Respond still answers from the template | `router.test.ts` — "Scenario G"; end to end: "degrades, not 500s, when EVERY provider behind the router is down" |

C, D and the end-to-end G test run against real Postgres in CI's integration job; the router
tests are unit tests with fake providers and injected sleep and jitter.

---

## Latency

Worst case is dominated by timeouts, and with defaults it is long.

| Configuration | Interpret worst case (every attempt times out) |
|---|---|
| Defaults, Claude + Gemini | 2 providers × 2 attempts × 20 s ≈ **80 s** (+ backoff) |
| Defaults, Claude + Gemini + Qwen | 3 × 2 × 20 s ≈ **120 s** |
| `AI_REQUEST_TIMEOUT_MS=10000`, `AI_MAX_RETRIES=0`, two providers | 2 × 1 × 10 s ≈ **20 s** |

Respond adds at most a few seconds per configured provider (each has its own 3-second budget)
before the template answers. Fast failures — `auth`, `network`, 5xx — cost milliseconds, not
the timeout.

For an interactive deployment, lowering `AI_MAX_RETRIES` to 0 and the timeout to something
near the primary's real p99 is the obvious tuning. It has not been done because no live latency
has been measured to tune against.
