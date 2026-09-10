/**
 * Phase 2 Interpret boundary.
 *
 * Claude receives only the user utterance and returns a forced, schema-checked
 * extraction tool call. It cannot receive DB credentials or tool implementations,
 * and its output still contains names/time phrases rather than write-ready UUIDs or
 * timestamps. Resolve and the Phase 1 validator remain the authority for mutations.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Model, Tool } from "@anthropic-ai/sdk/resources/messages";
import {
  EXTRACTION_INPUT_SCHEMA,
  EXTRACTION_MODEL,
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_TOOL_NAME,
  isExtraction,
  type ExtractionResult,
} from "@ourglass/shared";

export interface Extractor {
  extract(utterance: string): Promise<ExtractionResult>;
}

/**
 * Why an extraction failed, as a discriminable value rather than a message.
 *
 * `ai-systems.md` requires degrading honestly, and these are not the same
 * event: a REFUSAL is the model declining, a TRUNCATION is our max_tokens being
 * too small, and an INVALID payload is a contract violation. Phase 3 must be
 * able to tell a user "that got cut off, say it again more briefly" versus "I
 * can't help with that" — one string would collapse both.
 */
export type ExtractionFailureReason =
  | "truncated"
  | "refused"
  | "context_window_exceeded"
  | "no_tool_call"
  | "invalid_payload";

export class ExtractionError extends Error {
  readonly reason: ExtractionFailureReason;
  /** The utterance and raw payload — an LLM failure with no trace is unfixable. */
  readonly utterance: string;
  readonly stopReason: string | null;
  readonly rawPayload: unknown;

  constructor(
    reason: ExtractionFailureReason,
    message: string,
    context: { utterance: string; stopReason: string | null; rawPayload?: unknown },
  ) {
    super(message);
    this.name = "ExtractionError";
    this.reason = reason;
    this.utterance = context.utterance;
    this.stopReason = context.stopReason;
    this.rawPayload = context.rawPayload;
  }
}

export interface AnthropicExtractorOptions {
  readonly apiKey: string;
  readonly model?: Model;
  readonly client?: Anthropic;
}

export class AnthropicExtractor implements Extractor {
  private readonly client: Anthropic;
  private readonly model: Model;

  constructor(options: AnthropicExtractorOptions) {
    if (!options.apiKey) throw new Error("ANTHROPIC_API_KEY is required for extraction");
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
    // Sonnet by owner decision: this product runs on Sonnet and Haiku only, no
    // Opus (docs/DECISIONS.md, extraction model tier). That trades away Opus's
    // stronger tendency to ASK for a missing parameter rather than infer one,
    // which spec §27 cares about ("never guess when guessing can cause a
    // meaningful mistake") — so isExtraction, validateIntentCompleteness, and
    // the eval harness carry that weight instead. Injectable for a Haiku cost
    // experiment. The literal lives in @ourglass/shared because it previously
    // appeared here AND in the live eval lane and drifted twice in one session;
    // two lanes measuring different models makes every eval number meaningless.
    this.model = options.model ?? EXTRACTION_MODEL;
  }

  async extract(utterance: string): Promise<ExtractionResult> {
    if (utterance.trim().length === 0) throw new Error("Cannot extract an empty utterance");
    const started = performance.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1_200,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: utterance }],
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: EXTRACTION_TOOL_NAME, disable_parallel_tool_use: true },
    });
    const stopReason = response.stop_reason ?? null;
    const block = response.content.find(
      (content): content is Anthropic.ToolUseBlock => content.type === "tool_use" && content.name === EXTRACTION_TOOL_NAME,
    );
    const fail = (reason: ExtractionFailureReason, message: string): never => {
      throw new ExtractionError(reason, message, {
        utterance,
        stopReason,
        rawPayload: block?.input,
      });
    };

    // CHECK stop_reason BEFORE validating the payload.
    //
    // A max_tokens-truncated tool call can still be syntactically complete and
    // still pass isExtraction — with only SOME of the intents. The Phase 2 demo
    // utterance produces two intents (a commitment and a reminder); a truncation
    // that drops the second would otherwise be accepted as a COMPLETE
    // interpretation and the reminder would silently never exist. There is no
    // way to detect that from the payload alone, because a one-intent
    // extraction is perfectly valid for a one-intent utterance.
    if (stopReason === "max_tokens") {
      fail("truncated", "Extraction was truncated by max_tokens; the interpretation may be missing intents");
    }
    if (stopReason === "refusal") {
      fail("refused", "The model refused to interpret this utterance");
    }
    if (stopReason === "model_context_window_exceeded") {
      fail("context_window_exceeded", "The request exceeded the model's context window");
    }
    if (!block) {
      return fail("no_tool_call", `Model returned no ${EXTRACTION_TOOL_NAME} tool call (stop_reason: ${stopReason})`);
    }
    const payload = block.input;
    if (!isExtraction(payload)) {
      return fail("invalid_payload", "Model returned an extraction payload that does not match the shared contract");
    }

    const usage = response.usage;
    return {
      extraction: payload,
      trace: {
        model: response.model,
        latencyMs: performance.now() - started,
        stopReason,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          // Prompt caching is the obvious cost lever here — the system prompt is
          // ~200 tokens resent on every request — and DECISIONS.md open question
          // 4 cannot be answered without measuring these.
          ...(usage.cache_creation_input_tokens != null
            ? { cacheCreationInputTokens: usage.cache_creation_input_tokens }
            : {}),
          ...(usage.cache_read_input_tokens != null
            ? { cacheReadInputTokens: usage.cache_read_input_tokens }
            : {}),
        },
        ...(response._request_id ? { requestId: response._request_id } : {}),
      },
    };
  }
}

export const EXTRACTION_TOOL: Tool = {
  name: EXTRACTION_TOOL_NAME,
  description: "Return the complete, non-mutating interpretation of the user's utterance.",
  strict: true,
  // SDK declares JSON Schema arrays as mutable whereas the shared contract is
  // intentionally readonly. The runtime object is never mutated after startup.
  input_schema: EXTRACTION_INPUT_SCHEMA as unknown as Tool["input_schema"],
};
