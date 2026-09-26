/**
 * Claude — the primary provider.
 *
 * A WRAPPER, not a reimplementation. `AnthropicExtractor` and `HaikuResponder`
 * already hold every hard-won detail: the forced tool call, the stop_reason
 * checks that run BEFORE payload validation, the 3-second respond timeout, the
 * never-throws template fallback. Rewriting any of that to fit a new interface
 * would be discarding tested behaviour for symmetry.
 *
 * ⚠ SONNET AND HAIKU ONLY, NEVER OPUS. Owner decision (docs/DECISIONS.md).
 * The models come from `@ourglass/shared` so they cannot drift, and the
 * provider layer must not become a way around the constraint.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  AIProviderName,
  AIStage,
  ExtractionResult,
  ProviderHealth,
  ProviderFailureCategory,
  RespondInput,
} from "@ourglass/shared";
import { DOCUMENT_READING_SCHEMA, EXTRACTION_MODEL, RESPOND_MODEL, parseReading } from "@ourglass/shared";
import { AnthropicExtractor } from "../assistant/extract.js";
import { HaikuResponder, templateReply, type RespondResult } from "../assistant/respond.js";
import { ProviderError, classifyProviderError } from "./errors.js";
import type { AIProvider, InterpretInput, ReadInput, ReadResult } from "./provider.js";
import { READ_IMAGE_MESSAGE, READ_SYSTEM_PROMPT, readTextMessage } from "./read-prompt.js";

const READING_TOOL_NAME = "record_reading";
/** A reading is small by construction (READING_LIMITS); this bounds a runaway one. */
export const READ_MAX_TOKENS = 1_500;

const READING_TOOL = {
  name: READING_TOOL_NAME,
  description: "Record the description of the file. This is the only thing to do with it.",
  input_schema: DOCUMENT_READING_SCHEMA as unknown as Anthropic.Tool.InputSchema,
};

type MessagesClient = Pick<Anthropic, "messages">;

export interface ClaudeProviderOptions {
  readonly apiKey: string;
  readonly interpretModel?: string | undefined;
  readonly respondModel?: string | undefined;
  /** The Respond stage's budget. See AIConfig.respondTimeoutMs. */
  readonly respondTimeoutMs?: number | undefined;
  /** Injected in tests so no network call is made. */
  readonly extractor?: Pick<AnthropicExtractor, "extract">;
  readonly responder?: Pick<HaikuResponder, "respondWithTrace">;
  /** Injected in tests: the Read stage's SDK client. */
  readonly readClient?: MessagesClient;
}

export class ClaudeProvider implements AIProvider {
  readonly name: AIProviderName = "claude";
  readonly readsImages = true;

  private readonly apiKey: string;
  private readonly injectedExtractor: Pick<AnthropicExtractor, "extract"> | undefined;
  private readonly injectedResponder: Pick<HaikuResponder, "respondWithTrace"> | undefined;
  private builtExtractor: Pick<AnthropicExtractor, "extract"> | undefined;
  private builtResponder: Pick<HaikuResponder, "respondWithTrace"> | undefined;
  private readClient: MessagesClient | undefined;
  private readonly interpretModel: string;
  private readonly respondModel: string;
  private readonly respondTimeoutMs: number | undefined;

  private lastFailureAt: string | null = null;
  private lastFailureCategory: ProviderFailureCategory | null = null;

  constructor(options: ClaudeProviderOptions) {
    this.apiKey = options.apiKey;
    this.interpretModel = options.interpretModel ?? EXTRACTION_MODEL;
    this.respondModel = options.respondModel ?? RESPOND_MODEL;
    this.respondTimeoutMs = options.respondTimeoutMs;
    this.injectedExtractor = options.extractor;
    this.injectedResponder = options.responder;
    this.readClient = options.readClient;

    // NOTHING IS CONSTRUCTED HERE, and the first version got this wrong.
    //
    // AnthropicExtractor's own constructor throws on an empty key, so building
    // eagerly made `new ClaudeProvider({ apiKey: "" })` throw -- and
    // buildAIRouter constructs EVERY provider in the order before asking any of
    // them whether they are configured. A deployment with only a Gemini key
    // therefore crashed while building Claude, before Gemini was ever reached.
    //
    // The Stage 1 test meant to cover this injected an extractor, which
    // bypasses construction entirely, so it passed while proving nothing.
    // An unconfigured provider must be SKIPPABLE, which means constructible.
  }

  modelFor(stage: AIStage): string {
    // Read uses the Interpret model: misreading a poster's date is the
    // failure that matters there, so it gets the stronger of the two.
    return stage === "respond" ? this.respondModel : this.interpretModel;
  }

  /**
   * Describe one uploaded file (PHASE-6-DESIGN §4). A forced tool call whose
   * input schema IS the reading, then `parseReading` — the same two-step as
   * Interpret's forced call then `isExtraction`.
   */
  async read(input: ReadInput): Promise<ReadResult> {
    const started = performance.now();
    try {
      if (!this.readClient) {
        if (!this.apiKey) throw new ProviderError("claude", "auth", "ANTHROPIC_API_KEY is not set");
        this.readClient = new Anthropic({ apiKey: this.apiKey });
      }
      const content: Anthropic.MessageParam["content"] =
        input.kind === "text"
          ? readTextMessage(input.text)
          : [
              { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.base64 } },
              { type: "text", text: READ_IMAGE_MESSAGE },
            ];
      const response = await this.readClient.messages.create({
        model: this.interpretModel,
        max_tokens: READ_MAX_TOKENS,
        system: READ_SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
        tools: [READING_TOOL],
        tool_choice: { type: "tool", name: READING_TOOL_NAME, disable_parallel_tool_use: true },
      });

      // Stop reason BEFORE payload, as in extract.ts: a truncated tool call
      // can still parse, with half the dates missing.
      const stopReason = response.stop_reason ?? null;
      if (stopReason === "max_tokens") throw new ProviderError("claude", "truncated", "Reading was truncated");
      if (stopReason === "refusal") throw new ProviderError("claude", "refused", "The model declined to read the file");
      if (stopReason === "model_context_window_exceeded") {
        throw new ProviderError("claude", "context_window", "The file exceeded the context window");
      }
      const block = response.content.find(
        (item): item is Anthropic.ToolUseBlock => item.type === "tool_use" && item.name === READING_TOOL_NAME,
      );
      const reading = parseReading(block?.input);
      if (reading === null) {
        throw new ProviderError("claude", "schema_invalid", "The model's reading did not match the contract");
      }
      return {
        reading,
        trace: {
          model: response.model,
          latencyMs: performance.now() - started,
          stopReason,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error: unknown) {
      const classified = classifyProviderError(this.name, error);
      this.lastFailureAt = new Date().toISOString();
      this.lastFailureCategory = classified.category;
      throw classified;
    }
  }

  /** Built on first use, never at construction. See the constructor. */
  private extractorOrThrow(): Pick<AnthropicExtractor, "extract"> {
    if (this.injectedExtractor) return this.injectedExtractor;
    if (this.builtExtractor) return this.builtExtractor;
    if (!this.apiKey) {
      throw new ProviderError("claude", "auth", "ANTHROPIC_API_KEY is not set");
    }
    this.builtExtractor = new AnthropicExtractor({
      apiKey: this.apiKey,
      model: this.interpretModel as never,
    });
    return this.builtExtractor;
  }

  private responderOrThrow(): Pick<HaikuResponder, "respondWithTrace"> {
    if (this.injectedResponder) return this.injectedResponder;
    if (this.builtResponder) return this.builtResponder;
    if (!this.apiKey) {
      throw new ProviderError("claude", "auth", "ANTHROPIC_API_KEY is not set");
    }
    this.builtResponder = new HaikuResponder({
      apiKey: this.apiKey,
      model: this.respondModel as never,
      ...(this.respondTimeoutMs === undefined ? {} : { timeoutMs: this.respondTimeoutMs }),
    });
    return this.builtResponder;
  }

  async interpret(input: InterpretInput): Promise<ExtractionResult> {
    try {
      return await this.extractorOrThrow().extract(input.utterance, input.context);
    } catch (error: unknown) {
      const classified = classifyProviderError(this.name, error);
      this.lastFailureAt = new Date().toISOString();
      this.lastFailureCategory = classified.category;
      throw classified;
    }
  }

  async respond(input: RespondInput): Promise<RespondResult> {
    // respondWithTrace itself never throws. The only throw reachable here is an
    // unconfigured key from responderOrThrow, and even that must degrade rather
    // than propagate: by the time Respond runs the mutation is already durable,
    // and an exception would turn a committed write into an apparent failure
    // and invite the user to repeat themselves.
    let responder: Pick<HaikuResponder, "respondWithTrace">;
    try {
      responder = this.responderOrThrow();
    } catch {
      return {
        reply: templateReply(input),
        degraded: true,
        trace: {
          model: this.respondModel,
          latencyMs: 0,
          degraded: true,
          fallbackReason: "sdk_error",
        },
      };
    }
    return responder.respondWithTrace(input);
  }

  health(): ProviderHealth {
    return {
      provider: this.name,
      configured: Boolean(this.apiKey) || this.injectedExtractor !== undefined,
      lastFailureAt: this.lastFailureAt,
      lastFailureCategory: this.lastFailureCategory,
    };
  }
}
