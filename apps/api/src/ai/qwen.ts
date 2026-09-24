/**
 * Qwen via Ollama — the third provider, and the local/private one.
 *
 * ================================ READ THIS ================================
 * VERIFIED AGAINST A LIVE OLLAMA since 2026-09-21 (0.34.2, qwen3:8b), and the
 * first contact found three defects no fake-`fetch` test could: thinking left
 * on (NO_THINKING), a schema the model never saw (QWEN_EXTRACTION_PROMPT), and
 * a field order the grammar could not recover from (QWEN_FIELD_ORDER). The
 * unit tests below still inject `fetch`, so they pin the REQUEST; whether the
 * model answers well is measured by `pnpm eval:ai` — see docs/AI_PROVIDERS.md.
 *
 * PLAIN `fetch`, NOT THE `ollama` NPM PACKAGE. Two reasons:
 *   - No new dependency for two HTTP calls.
 *   - Cloudflare Workers have `fetch` and not Node's http stack, so this is
 *     the form that works in both places. (A Worker cannot reach localhost,
 *     so in production Qwen is only useful pointed at a reachable host — see
 *     OLLAMA_BASE_URL.)
 * ===========================================================================
 */
import type {
  AIProviderName,
  ExtractionResult,
  ProviderFailureCategory,
  ProviderHealth,
  RespondInput,
} from "@ourglass/shared";
import { EXTRACTION_INPUT_SCHEMA, EXTRACTION_SYSTEM_PROMPT, isExtraction } from "@ourglass/shared";
import { ExtractionError } from "../assistant/extract.js";
import {
  MAX_REPLY_CHARS,
  MAX_RESPOND_TOKENS,
  RESPOND_SYSTEM_PROMPT,
  RESPOND_TIMEOUT_MS,
  renderFacts,
  templateReply,
  ungroundedClaim,
  type RespondFallbackReason,
  type RespondResult,
  type RespondTrace,
} from "../assistant/respond.js";
import { ProviderError, classifyProviderError } from "./errors.js";
import type { AIProvider, InterpretInput } from "./provider.js";

/** Ollama's `/api/chat` response, as documented. Only the fields we read. */
export interface OllamaChatResponse {
  readonly message?: { readonly content?: string | undefined } | undefined;
  /** "stop" when complete, "length" when it hit num_predict. */
  readonly done_reason?: string | undefined;
  readonly prompt_eval_count?: number | undefined;
  readonly eval_count?: number | undefined;
}

export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434";

/**
 * ⚠ UNVERIFIED DEFAULT, and chosen for HARDWARE rather than quality.
 *
 * An 8B model runs on an ordinary laptop; a 32B does not. Defaulting to
 * something most machines cannot load would make the local provider fail for
 * the people most likely to want it. Override with `OLLAMA_MODEL`.
 */
export const OLLAMA_DEFAULT_MODEL = "qwen3:8b";

/**
 * Interpret's own abort budget — deliberately NOT Respond's 3 seconds.
 *
 * Until 2026-09-17 both stages shared `timeoutMs`, which defaults to
 * RESPOND_TIMEOUT_MS. Extraction sends a long system prompt and allows 1,200
 * output tokens; a local 8B model cannot do that in 3 seconds, so every Qwen
 * interpretation aborted and the fallback it exists to provide never worked.
 * Matches the router's default wait; `buildAIRouter` passes
 * AI_REQUEST_TIMEOUT_MS so the abort and the router's wait agree.
 */
export const QWEN_DEFAULT_INTERPRET_TIMEOUT_MS = 20_000;

/**
 * THINKING OFF — measured against a real Ollama, the first time this adapter
 * met one (2026-09-21, Ollama 0.34.2, qwen3:4b, RTX 3050 Laptop).
 *
 * Qwen3 is a hybrid reasoning model and Ollama leaves thinking ON when `think`
 * is not sent. Thinking tokens come out of the same `num_predict` budget as
 * the answer, so on the real Interpret request:
 *
 *   think omitted   224s cold / 114s warm   done=length   out=1200   content ""
 *   think: false    ~10s                    done=stop     out=110    valid JSON
 *
 * Every turn would have spent all 1,200 tokens reasoning, written nothing, and
 * failed as `truncated` — two minutes at a time. The provider could never
 * have worked as shipped, and nothing could have said so: every test injected
 * a fake `fetch`. The same defect class as Gemini 3.5 Flash's reply budget.
 *
 * Neither stage wants deliberation: Interpret fills a fixed schema at
 * temperature 0; Respond writes one sentence about work already committed.
 */
const NO_THINKING = { think: false } as const;

/**
 * THE SCHEMA, SHOWN TO THE MODEL — not only enforced on it.
 *
 * Claude receives the extraction schema as a tool definition and Gemini as a
 * response schema: both models READ the field names and their structure.
 * Ollama's `format` only CONSTRAINS decoding — the model never sees it, so it
 * can emit only the keys it can guess. Measured on the first live run: across
 * twenty labelled utterances on qwen3:4b and qwen3:8b, `owner` and `recipient`
 * were filled ZERO times, because the system prompt never names them — while
 * the optional fields it does describe (memoryBody, eventTitle, ...) came
 * through. With the schema appended, both were filled in every case, and
 * qwen3:8b went from 4/10 to 6/10 on the same set.
 *
 * Appended here rather than to EXTRACTION_SYSTEM_PROMPT: Claude and Gemini
 * already see the schema, and the shared prompt is what the eval harness
 * measures for all three.
 */
/**
 * WHAT EACH INTENT KIND MEANS — the shared prompt names the seven kinds and
 * never defines them.
 *
 * Claude and Gemini infer "completion_update" from the word. An 8B local model
 * does not, and the full eval (99 labelled utterances, 2026-09-22) showed the
 * confusions were systematic, not noise:
 *
 *   action -> execution            13   reminders declined as "external"
 *   completion_update -> information 9  "X gave me Y" filed as a NEW commitment
 *   information -> execution        5   "I owe Hult the deck" declined
 *   context -> information          5
 *
 * The first is a feature silently missing (no reminder is ever created on
 * Qwen); the second is a wrong write (a duplicate instead of a completion).
 *
 * The examples below deliberately use names and objects that appear NOWHERE in
 * packages/evals/src/fixtures.ts, so this prompt cannot leak the answers the
 * eval checks and inflate its own score.
 */
const INTENT_KIND_GUIDE = `What each intent kind means. Choose the kind by what the user is DOING, then fill EVERY field the sentence gives you:
- information: a STATEMENT that someone OWES something to someone — a commitment. A QUESTION about anything tracked ("what does Meera owe me?", "what's on hold?", "what's overdue?") is inspection, never information, and never sets newStatus. Keeping track of ONE thing ("keep track of the passport renewal") is information about that thing, not a new kind of thing to track. Fill owner (who owes it), recipient (who it is owed to), objectText, and time if one is said. "Meera owes me the logo files by Monday" -> owner Meera, recipient me, objectText "the logo files", time "by Monday".
- completion_update: something owed has now been DONE or delivered. Fill owner (who did it), recipient, objectText, and time if one is said. "Meera sent me the logo files" -> owner Meera, recipient me, objectText "the logo files". Never a new commitment.
- action: something to do INSIDE this assistant — a reminder ("remind me to…"), a meeting to schedule (eventTitle), a conditional rule, or a new KIND of thing to track. A reminder, or scheduling a meeting with someone ("schedule a call with Dev"), is action; anything on the user's CALENDAR ("create a calendar event", "put the dentist on my calendar") is execution. A new kind of thing to track has fields (entityTypeDefinition): "track my recipes with a name and a cuisine". Adding ONE item to a kind already tracked is entityRecord, never a new definition: "add dal makhani to my recipes" -> entityRecord. A reminder fills reminderBody and time, plus relatedEntity when it names a person or organization: "Remind me on Friday to call Dev" -> {"kind":"action","reminderBody":"call Dev","time":{"kind":"deterministic","sourcePhrase":"on Friday"},"relatedEntity":{"name":"Dev","kind":"person","inferenceLevel":"CONFIRMED"}}. Use eventTitle ONLY when the user asks to schedule a meeting, and condition ONLY for "if … by …" rules, never for a plain reminder. In a rule, relatedEntity is the person who owes the thing and condition.subjectText is the THING being waited for, never the person: "If Dev hasn't sent the floor plan by the 15th, remind me" -> relatedEntity Dev, condition {"subjectText":"the floor plan","deadlinePhrase":"by the 15th","action":"remind","actionBody":"Dev hasn't sent the floor plan"}.
- time.kind: deterministic for a clock or calendar time ("at 5", "tomorrow", "by Friday"); relational when tied to another scheduled thing ("after the meeting", "before the call"); event_trigger only when it waits on someone doing something ("when Dev replies").
- execution: ONLY a request to act OUTSIDE this assistant — send an email, anything on the user's calendar, share a Drive file. Still fill recipient and objectText if the sentence names them.
- context: background that is not itself a commitment — a reason or delay (fill objectText with what it is about), a durable fact to remember (memoryBody), or a correction (correctionTarget).
- inspection: the user asks to SEE what is tracked. "what am I waiting on", "what does Meera owe me" -> owner Meera, recipient me.
- question: anything else the user asks.`;

/**
 * THE FIELD ORDER IS PART OF THE PROMPT — for a grammar-constrained model.
 *
 * Ollama compiles `format` into a grammar that emits properties in SCHEMA
 * ORDER, and the model cannot go back. The shared schema lists `time` before
 * `reminderBody`, `condition` and `eventTitle`, so by the time Qwen has written
 * that it is a reminder, the `time` slot is already behind it. Measured on the
 * eval (2026-09-22): every reminder with a time came back without one — the
 * phrase went into `condition.deadlinePhrase`, the last time-shaped slot still
 * ahead, or into nothing. Two prompt rewrites, one with a verbatim JSON
 * example, changed none of the six. And it is a WRONG WRITE, not a missed
 * field: the planner checks `condition` first and `eventTitle` second, so
 * "remind me tonight to…" created a conditional rule and "remind me tomorrow
 * to…" a calendar event.
 *
 * So Qwen gets the same schema with the fields that say WHAT the intent is
 * first, and every slot that depends on that decision after. Qwen only:
 * property order means nothing to validation, and Claude and Gemini are
 * measured on the shared order.
 */
const QWEN_FIELD_ORDER = [
  "kind",
  "inferenceLevel",
  "sourceText",
  // Who and what stay EARLY, where the shared order has them. Moved behind the
  // six fields below, Qwen skipped them: "what does Zoya owe me?" came back as
  // an inspection with no owner and no recipient, and listed EVERY open
  // commitment as Zoya's (seen live, 2026-09-22). A grammar that offers six
  // optional keys in a row makes closing the object look like the next step.
  "owner",
  "recipient",
  "objectText",
  // What the intent IS — decided before `time`.
  "reminderBody",
  "eventTitle",
  "memoryBody",
  "correctionTarget",
  "entityTypeDefinition",
  "entityRecord",
  "time",
  "relatedEntity",
  "newStatus",
  // Last, so a plain reminder has already put its time in `time`.
  "condition",
] as const;

function inGrammarOrder(schema: typeof EXTRACTION_INPUT_SCHEMA): Record<string, unknown> {
  const intent = schema.properties.intents.items;
  const fields: Record<string, unknown> = intent.properties;
  const ordered: Record<string, unknown> = {};
  // Unlisted fields are appended, never dropped: `additionalProperties: false`
  // would make a field missing here one Qwen could never emit.
  for (const key of [...QWEN_FIELD_ORDER, ...Object.keys(fields)]) {
    if (key in fields && !(key in ordered)) ordered[key] = fields[key];
  }
  return {
    ...schema,
    properties: { intents: { ...schema.properties.intents, items: { ...intent, properties: ordered } } },
  };
}

export const QWEN_EXTRACTION_SCHEMA = inGrammarOrder(EXTRACTION_INPUT_SCHEMA);

const QWEN_EXTRACTION_PROMPT =
  `${EXTRACTION_SYSTEM_PROMPT}\n\n${INTENT_KIND_GUIDE}\n\n` +
  `Respond with JSON that matches this JSON Schema exactly:\n${JSON.stringify(QWEN_EXTRACTION_SCHEMA)}`;

export interface QwenProviderOptions {
  readonly baseUrl?: string | undefined;
  readonly model?: string | undefined;
  /** Respond-stage budget. Short on purpose: the template is always ready. */
  readonly timeoutMs?: number | undefined;
  readonly interpretTimeoutMs?: number | undefined;
  /** Injected in tests so nothing reaches the network. */
  readonly fetchImpl?: FetchLike | undefined;
}

export class QwenProvider implements AIProvider {
  readonly name: AIProviderName = "qwen";

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly interpretTimeoutMs: number;
  private readonly fetchImpl: FetchLike;

  private lastFailureAt: string | null = null;
  private lastFailureCategory: ProviderFailureCategory | null = null;

  constructor(options: QwenProviderOptions = {}) {
    // Trailing slash stripped once, here, rather than at both call sites.
    this.baseUrl = (options.baseUrl ?? OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = options.model ?? OLLAMA_DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? RESPOND_TIMEOUT_MS;
    this.interpretTimeoutMs = options.interpretTimeoutMs ?? QWEN_DEFAULT_INTERPRET_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  modelFor(): string {
    // ONE model for both stages, unlike Claude and Gemini. Ollama serves
    // whatever is pulled, and asking a local deployment to hold two models
    // doubles the disk and RAM cost for a fallback that may never fire.
    return this.model;
  }

  private async chat(
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<OllamaChatResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      // Carry the STATUS so classifyProviderError maps it the same way it maps
      // an SDK error — one table for all three providers.
      throw Object.assign(new Error(`Ollama responded ${response.status}`), {
        status: response.status,
      });
    }
    return (await response.json()) as OllamaChatResponse;
  }

  async interpret(input: InterpretInput): Promise<ExtractionResult> {
    if (input.utterance.trim().length === 0) {
      throw new ProviderError("qwen", "bad_request", "Cannot interpret an empty utterance");
    }

    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.interpretTimeoutMs);

    try {
      const response = await this.chat(
        {
          model: this.model,
          messages: [
            { role: "system", content: QWEN_EXTRACTION_PROMPT },
            { role: "user", content: input.utterance },
          ],
          stream: false,
          ...NO_THINKING,
          // Ollama takes a JSON SCHEMA here, not the string "json". Passing
          // the schema is what makes the output structured rather than merely
          // JSON-shaped — and unlike Gemini, Ollama accepts our schema as-is,
          // `additionalProperties` included. Reordered — see QWEN_FIELD_ORDER.
          format: QWEN_EXTRACTION_SCHEMA,
          options: { temperature: 0, num_predict: 1_200 },
        },
        controller.signal,
      );

      if (response.done_reason === "length") {
        // Same reasoning as the other two: a truncated payload can still parse
        // with only SOME intents, and a one-intent extraction is valid for a
        // one-intent utterance — so the payload cannot reveal the loss.
        throw new ExtractionError("truncated", "Qwen truncated the interpretation", {
          utterance: input.utterance,
          stopReason: response.done_reason,
        });
      }

      const text = response.message?.content?.trim() ?? "";
      if (text.length === 0) {
        throw new ExtractionError("no_tool_call", "Qwen returned an empty message", {
          utterance: input.utterance,
          stopReason: response.done_reason ?? null,
        });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new ExtractionError("no_tool_call", "Qwen returned text that is not JSON", {
          utterance: input.utterance,
          stopReason: response.done_reason ?? null,
          rawPayload: text.slice(0, 500),
        });
      }

      // The same authority as everywhere else. A local model is the MOST
      // likely of the three to drift from the schema, which makes this the
      // least optional of the three validations.
      if (!isExtraction(payload)) {
        throw new ExtractionError(
          "invalid_payload",
          "Qwen returned a payload that does not match the shared contract",
          {
            utterance: input.utterance,
            stopReason: response.done_reason ?? null,
            rawPayload: payload,
          },
        );
      }

      return {
        extraction: payload,
        trace: {
          model: this.model,
          latencyMs: performance.now() - started,
          stopReason: response.done_reason ?? null,
          usage: {
            inputTokens: response.prompt_eval_count ?? 0,
            outputTokens: response.eval_count ?? 0,
          },
        },
      };
    } catch (error: unknown) {
      const classified = classifyProviderError(this.name, error);
      this.lastFailureAt = new Date().toISOString();
      this.lastFailureCategory = classified.category;
      throw classified;
    } finally {
      clearTimeout(timer);
    }
  }

  /** NEVER THROWS — the shared contract of every provider's respond path. */
  async respond(input: RespondInput): Promise<RespondResult> {
    const started = performance.now();
    const fallback = (
      reason: RespondFallbackReason,
      extra?: Partial<RespondTrace>,
    ): RespondResult => ({
      reply: templateReply(input),
      degraded: true,
      trace: {
        model: this.model,
        latencyMs: performance.now() - started,
        degraded: true,
        fallbackReason: reason,
        ...extra,
      },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: OllamaChatResponse;
    try {
      response = await this.chat(
        {
          model: this.model,
          messages: [
            { role: "system", content: RESPOND_SYSTEM_PROMPT },
            { role: "user", content: renderFacts(input) },
          ],
          stream: false,
          ...NO_THINKING,
          // NO `format` here: this stage wants prose, and a schema would turn
          // the reply into JSON. NO `tools` either — absent, not an empty
          // allowlist a config change could widen.
          options: { temperature: 0.3, num_predict: MAX_RESPOND_TOKENS },
        },
        controller.signal,
      );
    } catch {
      // One attempt, no retry — the template is right there and always correct.
      return fallback(controller.signal.aborted ? "timeout" : "sdk_error");
    } finally {
      clearTimeout(timer);
    }

    const common: Partial<RespondTrace> = {
      stopReason: response.done_reason ?? null,
      usage: {
        inputTokens: response.prompt_eval_count ?? 0,
        outputTokens: response.eval_count ?? 0,
      },
    };

    if (response.done_reason === "length") return fallback("max_tokens", common);

    const text = response.message?.content?.trim() ?? "";
    if (text.length === 0) return fallback("empty_text", common);
    if (text.length > MAX_REPLY_CHARS) return fallback("too_long", common);
    if (ungroundedClaim(text, input)) return fallback("ungrounded", common);

    return {
      reply: text,
      degraded: false,
      trace: {
        model: this.model,
        latencyMs: performance.now() - started,
        degraded: false,
        ...common,
      },
    };
  }

  health(): ProviderHealth {
    return {
      provider: this.name,
      // A base URL is all Ollama needs — there is no key. This says "worth
      // trying", not "a model is pulled and the daemon is up"; §28 forbids
      // spending a model call to find that out, and a dead daemon surfaces as
      // a `network` failure on the first real attempt.
      configured: this.baseUrl.length > 0,
      lastFailureAt: this.lastFailureAt,
      lastFailureCategory: this.lastFailureCategory,
    };
  }
}
