# AI providers

The three model providers, how each is configured, how to run the local one, and what to do
when one misbehaves. Architecture context: [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md). Failure
rules: [AI_FALLBACK.md](AI_FALLBACK.md).

---

## Status — read this first

"Built" and "verified" are different claims, and this table keeps them apart.

| Provider | Transport | Interpret model | Respond model | Verified against the live service? |
|---|---|---|---|---|
| **Claude** (primary) | `@anthropic-ai/sdk` 0.124.0 | `claude-sonnet-5` | `claude-haiku-4-5-20251001` | **Model ids: yes** — `pnpm check:models` passed on 2026-09-17. **Extraction quality: no** — `pnpm test:live` has never run. |
| **Gemini** (second) | `@google/genai` 2.22.0 | `gemini-3.5-flash` | `gemini-3.5-flash` | **Both stages: yes** — a real extraction AND a real reply on 2026-09-18. **Quality: not measured** (`pnpm eval:ai` has not run). |
| **Qwen** (local) | `fetch` → Ollama `/api/chat` | `qwen3:8b` | same model | **Yes, and the only provider whose quality is measured** — 2026-09-22, Ollama 0.34.2 on an RTX 3050 Laptop (4 GB). Three defects found on first contact and fixed (thinking, schema, field order). Interpret median 30s, p90 46s; Respond ~3s. All 99 fixtures: 34 full matches, 81 intent kinds right, ~54 carrying wrong-write risk — see [`AI_EVALS.md`](AI_EVALS.md). Well below what these prompts are written for; use it offline or without a key, not for real data |

Every provider's adapter is unit-tested with an injected fake client: request shape,
normalisation into the shared `Extraction`, failure mapping, and the never-throws Respond
guarantee. Those tests say the adapter is correct **given** the vendor behaves as documented.
They say nothing about whether it does.

> **Why model ids get their own check, and why it CALLS the model.** Two failures taught this:
>
> 1. The Respond model was `claude-haiku-5` until 2026-09-17 — a model that has never existed.
>    Nothing failed loudly: Respond never throws, so every live 404 degraded to the template
>    reply, which is correct and concise and looks like the product working.
> 2. The Gemini default was `gemini-2.5-flash` until 2026-09-18. `models.list` returns it to
>    this day, and a new key calling it gets `404 "no longer available to new users"`. A
>    membership check passed while the provider was unusable.
>
> So `pnpm check:models` (free) sends a real one-token request per model. Listed and callable
> are different facts, and only the second one matters.

**Owner constraint: Claude is Sonnet and Haiku only. Never Opus.** Recorded in
`docs/DECISIONS.md`, asserted in `claude.test.ts` and `check:models`. The provider layer must
not become a way around it — an override env var pointing at an Opus id would be a violation,
not a configuration choice.

---

## Configuration

All variables are server-side only. Copy `.env.example` to `.env` (gitignored). An unset
provider variable is a **choice**, not an error: that provider is skipped. Only when *no*
provider is configured does `/api/turn` fail — with a 500 that names the missing variables.

| Variable | Default | Meaning |
|---|---|---|
| `AI_PROVIDER_ORDER` | `claude,gemini` (+`qwen` if `OLLAMA_BASE_URL` is set) | Priority order. Unknown names are dropped, duplicates removed; an empty result falls back to the default |
| `AI_INTERPRET_ORDER` | = `AI_PROVIDER_ORDER` | Per-stage override for Interpret |
| `AI_RESPOND_ORDER` | = `AI_PROVIDER_ORDER` | Per-stage override for Respond (e.g. local Qwen for privacy) |
| `AI_REQUEST_TIMEOUT_MS` | `20000` (bounds 1000–120000) | How long the router waits for one attempt. Out-of-range or non-numeric values fall back to the default, never to 0 |
| `AI_RESPOND_TIMEOUT_MS` | `3000` (bounds 500–120000) | The **Respond stage's** budget, independent of the above. Short by design — the write has already committed. **Raise it for a Gemini- or Qwen-primary deployment**; see the measurement below |
| `AI_MAX_RETRIES` | `1` (bounds 0–5) | Retries of the **same** provider after its first attempt, for retryable failures only |
| `AI_ENABLE_FALLBACK` | `true` | Only `false` (any case) disables it; then only the first configured provider is used |
| `ANTHROPIC_API_KEY` | — | Enables Claude |
| `ANTHROPIC_INTERPRET_MODEL` | `claude-sonnet-5` | Must remain a Sonnet |
| `ANTHROPIC_RESPONSE_MODEL` | `claude-haiku-4-5-20251001` | Must remain a Haiku |
| `GEMINI_API_KEY` | — | Enables Gemini |
| `GEMINI_INTERPRET_MODEL` / `GEMINI_RESPONSE_MODEL` | `gemini-3.5-flash` | Verified callable 2026-09-18 |
| `OLLAMA_BASE_URL` | — (provider default `http://localhost:11434`) | **Setting it is the opt-in** that adds Qwen to the default order |
| `OLLAMA_MODEL` | `qwen3:8b` | One model serves both stages |

Configuration is read per request, so a rotated key takes effect without a redeploy.
`describeProviders(env)` reports which providers an environment would use — names and
`configured` flags only, never a key.

### Why Qwen is opt-in

Ollama has no key, so "configured" can only mean "has a base URL" — and the provider has a
default one. Left in the default order, every deployment without Ollama would pay a
connection failure on every fallback. Setting `OLLAMA_BASE_URL` is the explicit signal.
Naming `qwen` in `AI_PROVIDER_ORDER` also includes it.

---

## Claude

- **Interpret:** `AnthropicExtractor` (`apps/api/src/assistant/extract.ts`). One Messages API
  call with a **forced, strict tool call** (`tool_choice` = the extraction tool,
  `disable_parallel_tool_use`), `max_tokens` 1,200. `stop_reason` is checked **before** the
  payload: a `max_tokens` truncation can still parse, with only some intents.
- **Respond:** `HaikuResponder` (`apps/api/src/assistant/respond.ts`). No tools, `max_tokens`
  200, its own 3-second budget, reply capped at 600 characters. Any failure degrades to
  `templateReply()`.
- **Lazy construction:** without a key, `ClaudeProvider` reports `configured: false` and
  constructs no client, so a Gemini-only or Ollama-only deployment starts cleanly.

## Gemini

- **Interpret:** `generateContent` with `responseMimeType: "application/json"` and a
  `responseSchema`, temperature 0, `maxOutputTokens` 1,200.
- **Schema dialect:** `toGeminiSchema()` (`gemini-schema.ts`) converts the shared JSON Schema:
  uppercase type names, `type: STRING` added alongside `enum`, unsupported keywords dropped.
  **Gemini cannot express `additionalProperties: false`**, so `isExtraction()` is the only
  barrier against extra fields.
- **Finish reasons:** `MAX_TOKENS` → `truncated`; `SAFETY`, `RECITATION`, `BLOCKLIST`,
  `PROHIBITED_CONTENT`, `SPII` and the `IMAGE_*` variants → `refused`. Both are terminal.
- **Respond:** same system prompt and fact rendering as Haiku, same caps, same 3-second budget,
  same template fallback.
- **Thinking is OFF on both stages** — `thinkingConfig: { thinkingBudget: 0 }`. Gemini 3.x
  Flash reasons before answering and those tokens come out of the SAME budget as the output.
  A live turn spent the whole 200-token reply allowance on 64 thinking tokens, emitted four,
  finished `MAX_TOKENS`, and degraded to the template. Neither stage wants deliberation:
  Interpret fills a fixed schema at temperature 0, Respond writes one sentence about work
  already committed. (`thinkingLevel` is **not** a valid field — the API rejects it with 400.)
- **The SDK is imported lazily**, only when a key exists.
- **It cannot meet the default Respond budget.** Measured 2026-09-18, six calls:
  10.0s, 10.3s, 11.3s, 11.8s, 18.8s — none under the 3-second default, which was calibrated
  for Haiku. A Gemini-primary deployment that leaves `AI_RESPOND_TIMEOUT_MS` alone gets the
  deterministic template on **every** turn, with `degraded: true` permanently on, which is
  indistinguishable from a real outage. Set it to ~15000, or accept template replies
  knowingly.

## Qwen via Ollama

- **Interpret:** `POST {OLLAMA_BASE_URL}/api/chat`, `stream: false`, the shared extraction
  schema passed **as `format`** (Ollama accepts it as-is, `additionalProperties` included),
  temperature 0, `num_predict` 1,200. `done_reason: "length"` → `truncated`.
- **Timeouts:** Interpret aborts after `AI_REQUEST_TIMEOUT_MS` (default 20s); Respond after 3s.
  Until 2026-09-17 Interpret shared Respond's 3 seconds and every local extraction aborted.
- **Respond:** no `format`, no tools, temperature 0.3, `num_predict` 200.
- **Plain `fetch`, no dependency.** It works under Workers too — but see the deployment note.

### Running Qwen locally

Unverified end to end on the build machine (no Ollama was installed there). The commands are
Ollama's documented CLI and HTTP API.

1. **Install Ollama** from <https://ollama.com/download>. The desktop installers start the
   background server; otherwise run `ollama serve`.
2. **Pull the model** (several GB on disk):
   ```sh
   ollama pull qwen3:8b
   ```
   On a machine with less memory, `qwen3:4b` is smaller; set `OLLAMA_MODEL` to match.
3. **Check the server** and that the model is listed under `models`:
   ```sh
   curl http://localhost:11434/api/tags
   ```
4. **Opt in** in `.env`:
   ```sh
   OLLAMA_BASE_URL=http://localhost:11434
   OLLAMA_MODEL=qwen3:8b
   ```
5. **Choose its role.** As a last-resort fallback, nothing else is needed. To keep reply text
   on the machine, set `AI_RESPOND_ORDER=qwen,claude`. To make it primary everywhere,
   `AI_PROVIDER_ORDER=qwen,claude,gemini`.
6. **Allow for CPU speed.** A local 8B model can need well over 20 seconds to extract. Raise
   `AI_REQUEST_TIMEOUT_MS` (up to 120000) if Interpret times out; Qwen's own abort follows it.

**Three defects found the first time this adapter met a real Ollama (2026-09-22), all fixed:**

1. **Thinking consumed the whole budget.** Ollama leaves Qwen3's thinking on unless `think` is
   sent. On the real Interpret request it spent all 1,200 tokens reasoning, wrote nothing, and
   took 114–224 seconds — every turn would have failed as `truncated`. The adapter now sends
   `think: false` on both stages: ~10s, valid JSON.
2. **The model could not see the schema.** Ollama's `format` constrains decoding, but the model
   never reads it — unlike Claude (tool definition) and Gemini (response schema). Across twenty
   labelled utterances `owner` and `recipient` were filled **zero** times. The adapter now
   appends the schema to the system prompt; both are filled every time.
3. **The field order decided the answer.** Ollama compiles `format` into a grammar that emits
   properties in schema order and cannot go back, and the shared schema lists `time` before
   `reminderBody`. So by the time the model had written that an utterance was a reminder, the
   `time` slot was behind it: the phrase went into `condition` instead — which the planner checks
   first — and **every timed reminder became a conditional rule or a calendar event**. Not a
   missed field: a wrong write. Two prompt rewrites, one with a verbatim JSON example, changed
   none of the six affected fixtures; reordering the schema for Qwen fixed all six. Claude and
   Gemini keep the shared order, which they read rather than decode. See `QWEN_FIELD_ORDER`.

**Model choice on a 4 GB GPU, measured on the same ten labelled cases:** `qwen3:4b` 4/10,
~18s; `qwen3:8b` 6/10, ~34s. The 4B confuses intent kinds (a commitment read as an action);
the 8B gets the headline cases right. A wrong write is worse than a slow one, so 8B.

**Local-only configuration** (what `.env` holds for Ollama alone):

```sh
AI_PROVIDER_ORDER=qwen          # skip Claude and Gemini entirely
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b
AI_REQUEST_TIMEOUT_MS=120000    # Interpret measured 18–60s warm, plus model load
AI_RESPOND_TIMEOUT_MS=60000
AI_MAX_RETRIES=0                # a retry doubles a minute-long wait
```

**Deployment note.** A Cloudflare Worker cannot reach `localhost`. In production,
`OLLAMA_BASE_URL` must be a host the Worker can resolve — and an Ollama server exposed to the
internet needs authentication in front of it; Ollama itself has none.

---

## Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| `/api/turn` returns 500 "No AI provider is configured" | No key and no `OLLAMA_BASE_URL` | Set at least one provider variable |
| Every reply has the fixed template shape ("Noted: … — …", "Reminder set for …") | Respond is degrading | The `ai_request` log line now carries `fallbackReason` per attempt. `timeout` on Gemini or Qwen means `AI_RESPOND_TIMEOUT_MS` is too low for that model; run `pnpm check:models` for a bad model id |
| "I couldn't process that just now — nothing was saved" | Every Interpret provider failed | `ai_request` log lines for that `requestId`: the `errorCategory` of each attempt |
| "I can't help with that one." | A refusal — terminal by design, never retried elsewhere | Trace `reason: "refused"` |
| "That got cut off" | Extraction hit its 1,200-token cap — terminal | Split the message; if frequent, the cap needs raising |
| Log shows `claude` `auth` on every turn | Key missing, wrong or revoked | Rotate the key; `auth` is never retried, it falls straight through |
| Qwen always `timeout` | Model too slow for `AI_REQUEST_TIMEOUT_MS`, or thinking mode | Raise the timeout; try a smaller model |
| Qwen always `network` | Ollama not running, or wrong URL | `curl $OLLAMA_BASE_URL/api/tags` |
| Qwen `unavailable` (HTTP 404) | Model probably not pulled | `ollama list`; `ollama pull $OLLAMA_MODEL` |
| Gemini replies always template, trace says `max_tokens` with ~4 output tokens | Thinking is eating the reply budget | `thinkingConfig: { thinkingBudget: 0 }` must be in BOTH `config` blocks in `gemini.ts` |
| Gemini `schema_invalid` often | Output shape drifting from the contract | Run `pnpm eval:ai` with Gemini configured and read its failures |
| Turns slow but succeeding | Fallback firing on every turn | `fallbackUsed: true` in the trace; fix the primary |

---

## Adding a provider

1. Add the name to `AI_PROVIDER_NAMES` in `packages/shared/src/ai-provider.ts`.
2. Implement `AIProvider` in `apps/api/src/ai/<name>.ts`:
   - `interpret` **throws** `ProviderError` via `classifyProviderError`; validate with
     `isExtraction()` and never return provider-specific JSON.
   - `respond` **never throws**; degrade to `templateReply()` with a `fallbackReason`.
   - Construct clients lazily; report `configured: false` rather than throwing without
     credentials.
   - Map the vendor's stop/finish reasons onto `truncated` and `refused` explicitly.
   - Give Interpret its own timeout — never Respond's.
3. Add a `case` to `buildProvider` in `config.ts` (the `switch` is exhaustive) and its variables
   to `loadAIConfig`, `.env.example` and the table above.
4. Test with an injected fake client: request shape, contract normalisation, each failure
   category, never-throws Respond, lazy construction without credentials.
5. Add it to `packages/evals/src/provider-comparison.ai-eval.ts`.
6. Mark it **unverified** in the status table until it has answered a real request.
