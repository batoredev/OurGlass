/**
 * Gemini — the second provider.
 *
 * ================================ READ THIS ================================
 * ⚠ UNVERIFIED AGAINST A LIVE ENDPOINT. There is no `GEMINI_API_KEY` in the
 * environment this was built in, so every test here injects a fake client.
 * The SDK surface was read from `@google/genai` 2.22.0's own type
 * declarations rather than recalled, but the MODEL NAMES are defaults that
 * nobody has confirmed exist — they are configurable for exactly that reason.
 *
 * Stated here rather than only in a report, because the next person to touch
 * this file deserves to know which parts are checked and which are not.
 * ===========================================================================
 *
 * It produces the SAME `Extraction` Claude does. Provider-specific JSON stops
 * at this file: nothing downstream can tell which model answered, which is
 * what makes the fallback chain meaningful rather than a source of three
 * slightly different behaviours.
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
  type RespondFallbackReason,
  type RespondResult,
  type RespondTrace,
} from "../assistant/respond.js";
import { ProviderError, classifyProviderError } from "./errors.js";
import { toGeminiSchema } from "./gemini-schema.js";
import type { AIProvider, InterpretInput } from "./provider.js";

/**
 * The slice of `@google/genai` this provider uses.
 *
 * Structural, not the SDK's own type. Two reasons, and the second is the real
 * one: a fake is trivial to write against it (no key, no network, no SDK in
 * the unit tests), and the coupling to a vendor's class hierarchy stays at
 * exactly one file — the same reasoning that made `classifyProviderError`
 * duck-typed rather than `instanceof`-based.
 */
export interface GeminiLikeClient {
  readonly models: {
    generateContent(params: {
      model: string;
      contents: string;
      config?: Record<string, unknown>;
    }): Promise<GeminiLikeResponse>;
  };
}

export interface GeminiLikeResponse {
  readonly text?: string | undefined;
  readonly candidates?: readonly { readonly finishReason?: string | undefined }[] | undefined;
  readonly usageMetadata?:
    | {
        readonly promptTokenCount?: number | undefined;
        readonly candidatesTokenCount?: number | undefined;
      }
    | undefined;
}

/**
 * ⚠ UNVERIFIED DEFAULTS. Both stages default to Flash deliberately: it is one
 * name to be wrong about instead of two, and the cheaper tier is the safer
 * default for a fallback provider. Point interpret at a stronger model with
 * `GEMINI_INTERPRET_MODEL` once a key exists to confirm it against.
 */
export const GEMINI_DEFAULT_INTERPRET_MODEL = "gemini-2.5-flash";
export const GEMINI_DEFAULT_RESPOND_MODEL = "gemini-2.5-flash";

/**
 * `finishReason` -> our failure taxonomy.
 *
 * The safety family collapses to `refused`, which the router treats as
 * TERMINAL — a safety decision is not something to shop around for. Gemini's
 * safety vocabulary is much wider than Anthropic's single `refusal`, which is
 * why this is a table rather than two ifs.
 */
const REFUSAL_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "IMAGE_RECITATION",
]);

export interface GeminiProviderOptions {
  readonly apiKey: string;
  readonly interpretModel?: string | undefined;
  readonly respondModel?: string | undefined;
  readonly timeoutMs?: number | undefined;
  /** Injected in tests so no key and no network are needed. */
  readonly client?: GeminiLikeClient | undefined;
}

export class GeminiProvider implements AIProvider {
  readonly name: AIProviderName = "gemini";

  private readonly apiKey: string;
  private readonly interpretModel: string;
  private readonly respondModel: string;
  private readonly timeoutMs: number;
  private readonly injected: GeminiLikeClient | undefined;
  private client: GeminiLikeClient | undefined;

  private lastFailureAt: string | null = null;
  private lastFailureCategory: ProviderFailureCategory | null = null;

  constructor(options: GeminiProviderOptions) {
    this.apiKey = options.apiKey;
    this.interpretModel = options.interpretModel ?? GEMINI_DEFAULT_INTERPRET_MODEL;
    this.respondModel = options.respondModel ?? GEMINI_DEFAULT_RESPOND_MODEL;
    this.timeoutMs = options.timeoutMs ?? RESPOND_TIMEOUT_MS;
    this.injected = options.client;
  }

  modelFor(stage: "interpret" | "respond"): string {
    return stage === "interpret" ? this.interpretModel : this.respondModel;
  }

  /**
   * LAZY, and deliberately so. Constructing the SDK eagerly would make an
   * unconfigured Gemini throw at startup, when the correct behaviour is for
   * the router to skip it and carry on with Claude.
   */
  private async clientOrThrow(): Promise<GeminiLikeClient> {
    if (this.injected) return this.injected;
    if (this.client) return this.client;
    if (!this.apiKey) {
      throw new ProviderError("gemini", "auth", "GEMINI_API_KEY is not set");
    }
    const { GoogleGenAI } = await import("@google/genai");
    this.client = new GoogleGenAI({ apiKey: this.apiKey }) as unknown as GeminiLikeClient;
    return this.client;
  }

  async interpret(input: InterpretInput): Promise<ExtractionResult> {
    if (input.utterance.trim().length === 0) {
      throw new ProviderError("gemini", "bad_request", "Cannot interpret an empty utterance");
    }
    const started = performance.now();
    try {
      const client = await this.clientOrThrow();
      const response = await client.models.generateContent({
        model: this.interpretModel,
        contents: input.utterance,
        config: {
          systemInstruction: EXTRACTION_SYSTEM_PROMPT,
          // Schema-constrained JSON rather than a tool call. Gemini supports
          // function calling too, but this stage wants ONE object back, and
          // responseSchema says that directly instead of via a forced call.
          responseMimeType: "application/json",
          responseSchema: toGeminiSchema(EXTRACTION_INPUT_SCHEMA),
          maxOutputTokens: 1_200,
          // Deterministic-leaning: this is extraction, not composition.
          temperature: 0,
        },
      });

      const finishReason = response.candidates?.[0]?.finishReason;
      this.assertUsableFinish(finishReason, input.utterance);

      const text = response.text?.trim() ?? "";
      if (text.length === 0) {
        throw new ExtractionError("no_tool_call", "Gemini returned no JSON payload", {
          utterance: input.utterance,
          stopReason: finishReason ?? null,
        });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        // Malformed JSON is a SAMPLING failure, not a contract failure — worth
        // one retry before moving on, which is what `malformed_output` buys.
        throw new ExtractionError("no_tool_call", "Gemini returned text that is not JSON", {
          utterance: input.utterance,
          stopReason: finishReason ?? null,
          rawPayload: text.slice(0, 500),
        });
      }

      // THE AUTHORITY. Gemini cannot express `additionalProperties: false`, so
      // this is the only thing standing between a stray field and the planner.
      if (!isExtraction(payload)) {
        throw new ExtractionError(
          "invalid_payload",
          "Gemini returned a payload that does not match the shared contract",
          { utterance: input.utterance, stopReason: finishReason ?? null, rawPayload: payload },
        );
      }

      return {
        extraction: payload,
        trace: {
          model: this.interpretModel,
          latencyMs: performance.now() - started,
          stopReason: finishReason ?? null,
          usage: {
            inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          },
        },
      };
    } catch (error: unknown) {
      const classified = classifyProviderError(this.name, error);
      this.lastFailureAt = new Date().toISOString();
      this.lastFailureCategory = classified.category;
      throw classified;
    }
  }

  /** Maps a finish reason onto the same taxonomy Claude's stop_reason uses. */
  private assertUsableFinish(finishReason: string | undefined, utterance: string): void {
    if (finishReason === undefined || finishReason === "STOP") return;

    const fail = (reason: "truncated" | "refused" | "no_tool_call", message: string): never => {
      throw new ExtractionError(reason, message, { utterance, stopReason: finishReason });
    };

    if (finishReason === "MAX_TOKENS") {
      // Same reasoning as the Anthropic path: a truncated payload can still
      // parse, with only SOME of the intents — and a one-intent extraction is
      // valid for a one-intent utterance, so the payload cannot reveal it.
      fail("truncated", "Gemini truncated the interpretation; intents may be missing");
    }
    if (REFUSAL_REASONS.has(finishReason)) {
      fail("refused", `Gemini declined to interpret this utterance (${finishReason})`);
    }
    fail("no_tool_call", `Gemini stopped for an unusable reason (${finishReason})`);
  }

  /**
   * NEVER THROWS — the contract every provider's respond path shares, because
   * the mutation has already committed by the time this runs.
   *
   * The degradation rules are the SAME CONSTANTS the Anthropic responder uses,
   * imported rather than restated. Two providers with two definitions of "too
   * long" would be the two-declarations-of-one-fact shape this project keeps
   * finding at the bottom of its bugs.
   */
  async respond(input: RespondInput): Promise<RespondResult> {
    const started = performance.now();
    const fallback = (
      reason: RespondFallbackReason,
      extra?: Partial<RespondTrace>,
    ): RespondResult => ({
      reply: templateReply(input),
      degraded: true,
      trace: {
        model: this.respondModel,
        latencyMs: performance.now() - started,
        degraded: true,
        fallbackReason: reason,
        ...extra,
      },
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: GeminiLikeResponse;
    try {
      const client = await this.clientOrThrow();
      response = await client.models.generateContent({
        model: this.respondModel,
        contents: renderFacts(input),
        config: {
          systemInstruction: RESPOND_SYSTEM_PROMPT,
          maxOutputTokens: MAX_RESPOND_TOKENS,
          abortSignal: controller.signal,
          // NO TOOLS, and no `tools` key at all — not an empty allowlist a
          // config change could widen. This stage holds no DB handle, so even
          // a fabricated call would have nothing to execute against.
        },
      });
    } catch {
      // ONE attempt, no retry, for every error class. A retry loop on a paid
      // endpoint is the most expensive failure available, it doubles latency
      // on a stage the user is already waiting through, and the template is
      // right there and always correct.
      return fallback(controller.signal.aborted ? "timeout" : "sdk_error");
    } finally {
      clearTimeout(timer);
    }

    const finishReason = response.candidates?.[0]?.finishReason ?? null;
    const common: Partial<RespondTrace> = {
      stopReason: finishReason,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };

    if (finishReason !== null && REFUSAL_REASONS.has(finishReason)) {
      return fallback("refusal", common);
    }
    if (finishReason === "MAX_TOKENS") return fallback("max_tokens", common);

    const text = response.text?.trim() ?? "";
    if (text.length === 0) return fallback("empty_text", common);
    if (text.length > MAX_REPLY_CHARS) return fallback("too_long", common);

    return {
      reply: text,
      degraded: false,
      trace: {
        model: this.respondModel,
        latencyMs: performance.now() - started,
        degraded: false,
        ...common,
      },
    };
  }

  health(): ProviderHealth {
    return {
      provider: this.name,
      // An injected client counts as configured: that is what makes a fake
      // usable in a router test without also faking a key.
      configured: Boolean(this.apiKey) || this.injected !== undefined,
      lastFailureAt: this.lastFailureAt,
      lastFailureCategory: this.lastFailureCategory,
    };
  }
}
