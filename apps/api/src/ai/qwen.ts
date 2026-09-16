/**
 * Qwen via Ollama — the third provider, and the local/private one.
 *
 * ================================ READ THIS ================================
 * ⚠ UNVERIFIED AGAINST A LIVE ENDPOINT. Ollama is not installed on the
 * machine this was built on and nothing is serving on :11434, so every test
 * injects a fake `fetch`. What is verified is the ADAPTER — request shape,
 * normalisation, the failure taxonomy, the never-throws respond guarantee.
 * What is NOT verified is that a real Ollama answers the way its documented
 * contract says, or that any particular Qwen tag is pulled.
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

export interface QwenProviderOptions {
  readonly baseUrl?: string | undefined;
  readonly model?: string | undefined;
  readonly timeoutMs?: number | undefined;
  /** Injected in tests so nothing reaches the network. */
  readonly fetchImpl?: FetchLike | undefined;
}

export class QwenProvider implements AIProvider {
  readonly name: AIProviderName = "qwen";

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  private lastFailureAt: string | null = null;
  private lastFailureCategory: ProviderFailureCategory | null = null;

  constructor(options: QwenProviderOptions = {}) {
    // Trailing slash stripped once, here, rather than at both call sites.
    this.baseUrl = (options.baseUrl ?? OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = options.model ?? OLLAMA_DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? RESPOND_TIMEOUT_MS;
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
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.chat(
        {
          model: this.model,
          messages: [
            { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
            { role: "user", content: input.utterance },
          ],
          stream: false,
          // Ollama takes a JSON SCHEMA here, not the string "json". Passing
          // the schema is what makes the output structured rather than merely
          // JSON-shaped — and unlike Gemini, Ollama accepts our schema as-is,
          // `additionalProperties` included.
          format: EXTRACTION_INPUT_SCHEMA,
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
