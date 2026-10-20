/**
 * The backup providers — Groq, Cerebras and OpenRouter — through ONE adapter.
 *
 * ================================ READ THIS ================================
 * All three speak the OpenAI chat-completions dialect, so they differ only in
 * base URL, key and default model. One class with three configurations, not
 * three copies: the first defect found in one would otherwise be fixed in one.
 *
 * WHY THEY EXIST. Gemini's free tier allows `gemini-3.5-flash` 20 requests a
 * day per project (measured 2026-10-19), and when Gemini is out the app cannot
 * understand a single sentence. These are the next free options, tried in
 * order after Gemini. Each is free with a sign-up key; limits and model lists
 * change often, so the model is configurable per provider.
 *
 * STRUCTURED OUTPUT, the Qwen way. The schema is in the PROMPT (a model that
 * ignores response_format still sees it) AND requested as `json_schema`. A
 * provider/model that rejects json_schema with a 400 is retried once in plain
 * `json_object` mode. Whatever comes back must pass `isExtraction` — the same
 * authority as every other provider — so a looser mode cannot loosen the
 * contract.
 *
 * PLAIN `fetch`: no SDK, the same reasoning as qwen.ts, and it runs unchanged
 * in the Supabase Edge Function.
 * ===========================================================================
 */
import type {
  AIProviderName,
  ExtractionResult,
  ProviderFailureCategory,
  ProviderHealth,
  RespondInput,
} from "@ourglass/shared";
import { DOCUMENT_READING_SCHEMA, isExtraction, parseReading } from "@ourglass/shared";
import { ExtractionError } from "../assistant/extract.js";
import {
  MAX_REPLY_CHARS,
  MAX_RESPOND_TOKENS,
  RESPOND_SYSTEM_PROMPT,
  RESPOND_TIMEOUT_MS,
  renderFacts,
  templateReply,
  unfitReply,
  type RespondFallbackReason,
  type RespondResult,
  type RespondTrace,
} from "../assistant/respond.js";
import { ProviderError, classifyProviderError } from "./errors.js";
import { interpretMessage, type AIProvider, type InterpretInput, type ReadInput, type ReadResult } from "./provider.js";
import { QWEN_EXTRACTION_PROMPT, QWEN_EXTRACTION_SCHEMA, type FetchLike } from "./qwen.js";
import { READ_SYSTEM_PROMPT, readTextMessage } from "./read-prompt.js";

export type OpenAICompatName = Extract<AIProviderName, "groq" | "cerebras" | "openrouter">;

/** Where each backup lives and what it runs by default. Verify before relying on a model: catalogs churn. */
export const OPENAI_COMPAT_DEFAULTS: Readonly<Record<OpenAICompatName, { baseUrl: string; model: string }>> = {
  // Verified against GET /models with a real key, 2026-10-20: Llama 3.3 70B is
  // gone from Groq (model_not_found); gpt-oss-120b is the strongest chat model.
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" },
  cerebras: { baseUrl: "https://api.cerebras.ai/v1", model: "gpt-oss-120b" },
  // A FIXED model, not the `openrouter/free` auto-router: that picked a slow
  // model which timed out at 20 s on the first live call (2026-10-20). Of the
  // five free models supporting structured outputs that day, all reason; this
  // is the largest.
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "nvidia/nemotron-3-super-120b-a12b:free" },
};

/** The OpenAI chat-completions response, only the fields read. */
interface ChatCompletion {
  readonly choices?: readonly {
    readonly message?: { readonly content?: string | null };
    readonly finish_reason?: string | null;
  }[];
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

export interface OpenAICompatOptions {
  readonly name: OpenAICompatName;
  readonly apiKey: string;
  readonly model?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly interpretTimeoutMs?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly readTimeoutMs?: number | undefined;
  /** Injected in tests so nothing reaches the network. */
  readonly fetchImpl?: FetchLike | undefined;
}

/**
 * Reasoning models (gpt-oss) spend hidden tokens from the SAME max_tokens as
 * the answer — the failure Gemini Flash showed on Respond (thinking ate the
 * budget, the reply hit MAX_TOKENS). Ask for low effort and leave room.
 */
function reasoningParams(name: OpenAICompatName, model: string): Record<string, unknown> {
  // OpenRouter normalises reasoning control into one `reasoning` object for
  // every model behind it; `exclude` keeps the thinking out of the reply.
  if (name === "openrouter") return { reasoning: { effort: "low", exclude: true } };
  return isReasoningModel(name, model) ? { reasoning_effort: "low" } : {};
}
function isReasoningModel(name: OpenAICompatName, model: string): boolean {
  // Every free OpenRouter model with structured outputs reasoned (2026-10-20).
  return name === "openrouter" || /gpt-oss|qwen3|nemotron|deepseek-r/i.test(model);
}

export class OpenAICompatProvider implements AIProvider {
  readonly name: OpenAICompatName;
  /** Text models: an image is read by Claude or Gemini (the router skips these). */
  readonly readsImages = false;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly interpretTimeoutMs: number;
  private readonly timeoutMs: number;
  private readonly readTimeoutMs: number;
  private readonly fetchImpl: FetchLike;

  private lastFailureAt: string | null = null;
  private lastFailureCategory: ProviderFailureCategory | null = null;

  constructor(options: OpenAICompatOptions) {
    const defaults = OPENAI_COMPAT_DEFAULTS[options.name];
    this.name = options.name;
    this.apiKey = options.apiKey;
    this.model = options.model ?? defaults.model;
    this.baseUrl = (options.baseUrl ?? defaults.baseUrl).replace(/\/+$/, "");
    this.interpretTimeoutMs = options.interpretTimeoutMs ?? 20_000;
    this.timeoutMs = options.timeoutMs ?? RESPOND_TIMEOUT_MS;
    this.readTimeoutMs = options.readTimeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  modelFor(): string {
    return this.model;
  }

  private async complete(body: Record<string, unknown>, signal: AbortSignal): Promise<ChatCompletion> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
    };
    // OpenRouter attributes traffic by these; harmless elsewhere, so only sent there.
    if (this.name === "openrouter") headers["x-title"] = "OurGlass";
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: this.model, ...reasoningParams(this.name, this.model), ...body }),
      signal,
    });
    if (!response.ok) {
      // Carry the STATUS so classifyProviderError maps it like every other
      // provider's — one table for all of them. The body (no key in it) helps
      // tell a quota from a bad model id in the log.
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw Object.assign(new Error(`${this.name} responded ${response.status}: ${detail}`), {
        status: response.status,
      });
    }
    return (await response.json()) as ChatCompletion;
  }

  /** json_schema first; on a 400, once more as json_object (see header). */
  private async completeJson(
    messages: readonly { role: string; content: string }[],
    schemaName: string,
    schema: unknown,
    maxTokens: number,
    signal: AbortSignal,
  ): Promise<ChatCompletion> {
    const base = { messages, temperature: 0, max_tokens: maxTokens };
    try {
      return await this.complete(
        { ...base, response_format: { type: "json_schema", json_schema: { name: schemaName, schema, strict: false } } },
        signal,
      );
    } catch (error: unknown) {
      if ((error as { status?: unknown }).status !== 400) throw error;
      return this.complete({ ...base, response_format: { type: "json_object" } }, signal);
    }
  }

  async interpret(input: InterpretInput): Promise<ExtractionResult> {
    if (input.utterance.trim().length === 0) {
      throw new ProviderError(this.name, "bad_request", "Cannot interpret an empty utterance");
    }
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.interpretTimeoutMs);
    try {
      const response = await this.completeJson(
        [
          { role: "system", content: QWEN_EXTRACTION_PROMPT },
          { role: "user", content: interpretMessage(input) },
        ],
        "extract_intents",
        QWEN_EXTRACTION_SCHEMA,
        isReasoningModel(this.name, this.model) ? 4_000 : 1_200,
        controller.signal,
      );
      const choice = response.choices?.[0];
      const stopReason = choice?.finish_reason ?? null;
      if (stopReason === "length") {
        throw new ExtractionError("truncated", `${this.name} truncated the interpretation`, {
          utterance: input.utterance,
          stopReason,
        });
      }
      const text = choice?.message?.content?.trim() ?? "";
      let payload: unknown;
      try {
        payload = JSON.parse(stripFence(text));
      } catch {
        throw new ExtractionError("no_tool_call", `${this.name} returned text that is not JSON`, {
          utterance: input.utterance,
          stopReason,
          rawPayload: text.slice(0, 500),
        });
      }
      if (!isExtraction(payload)) {
        throw new ExtractionError("invalid_payload", `${this.name} returned a payload that does not match the shared contract`, {
          utterance: input.utterance,
          stopReason,
          rawPayload: payload,
        });
      }
      return {
        extraction: payload,
        trace: {
          model: this.model,
          latencyMs: performance.now() - started,
          stopReason,
          usage: {
            inputTokens: response.usage?.prompt_tokens ?? 0,
            outputTokens: response.usage?.completion_tokens ?? 0,
          },
        },
      };
    } catch (error: unknown) {
      throw this.recordFailure(error);
    } finally {
      clearTimeout(timer);
    }
  }

  /** NEVER THROWS — the shared contract of every provider's respond path. */
  async respond(input: RespondInput): Promise<RespondResult> {
    const started = performance.now();
    const fallback = (reason: RespondFallbackReason, extra?: Partial<RespondTrace>): RespondResult => ({
      reply: templateReply(input),
      degraded: true,
      trace: { model: this.model, latencyMs: performance.now() - started, degraded: true, fallbackReason: reason, ...extra },
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: ChatCompletion;
    try {
      response = await this.complete(
        {
          messages: [
            { role: "system", content: RESPOND_SYSTEM_PROMPT },
            { role: "user", content: renderFacts(input) },
          ],
          temperature: 0.3,
          // NO response_format and NO tools: this stage wants one short
          // sentence of prose, and an absent tool list cannot be widened.
          max_tokens: isReasoningModel(this.name, this.model) ? 1_000 : MAX_RESPOND_TOKENS,
        },
        controller.signal,
      );
    } catch {
      return fallback(controller.signal.aborted ? "timeout" : "sdk_error");
    } finally {
      clearTimeout(timer);
    }
    const choice = response.choices?.[0];
    const common: Partial<RespondTrace> = {
      stopReason: choice?.finish_reason ?? null,
      usage: { inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 },
    };
    if (choice?.finish_reason === "length") return fallback("max_tokens", common);
    const text = choice?.message?.content?.trim() ?? "";
    if (text.length === 0) return fallback("empty_text", common);
    if (text.length > MAX_REPLY_CHARS) return fallback("too_long", common);
    const unfit = unfitReply(text, input);
    if (unfit) return fallback(unfit, common);
    return {
      reply: text,
      degraded: false,
      trace: { model: this.model, latencyMs: performance.now() - started, degraded: false, ...common },
    };
  }

  /** Describe one uploaded TEXT file. THROWS a ProviderError. */
  async read(input: ReadInput): Promise<ReadResult> {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.readTimeoutMs);
    try {
      if (input.kind !== "text") {
        throw new ProviderError(this.name, "unavailable", `${this.name} reads text, not images`);
      }
      const response = await this.completeJson(
        [
          { role: "system", content: `${READ_SYSTEM_PROMPT}\n\nRespond with JSON matching this JSON Schema:\n${JSON.stringify(DOCUMENT_READING_SCHEMA)}` },
          { role: "user", content: readTextMessage(input.text) },
        ],
        "document_reading",
        DOCUMENT_READING_SCHEMA,
        isReasoningModel(this.name, this.model) ? 4_000 : 1_500,
        controller.signal,
      );
      const choice = response.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new ProviderError(this.name, "truncated", "Reading was truncated");
      }
      let payload: unknown;
      try {
        payload = JSON.parse(stripFence(choice?.message?.content?.trim() ?? ""));
      } catch {
        throw new ProviderError(this.name, "malformed_output", `${this.name} returned text that is not JSON`);
      }
      const reading = parseReading(payload);
      if (reading === null) {
        throw new ProviderError(this.name, "schema_invalid", `${this.name}'s reading did not match the contract`);
      }
      return {
        reading,
        trace: {
          model: this.model,
          latencyMs: performance.now() - started,
          stopReason: choice?.finish_reason ?? null,
          inputTokens: response.usage?.prompt_tokens ?? null,
          outputTokens: response.usage?.completion_tokens ?? null,
        },
      };
    } catch (error: unknown) {
      throw this.recordFailure(error);
    } finally {
      clearTimeout(timer);
    }
  }

  health(): ProviderHealth {
    return {
      provider: this.name,
      configured: this.apiKey.length > 0,
      lastFailureAt: this.lastFailureAt,
      lastFailureCategory: this.lastFailureCategory,
    };
  }

  private recordFailure(error: unknown): ProviderError {
    const classified = classifyProviderError(this.name, error);
    this.lastFailureAt = new Date().toISOString();
    this.lastFailureCategory = classified.category;
    return classified;
  }
}

/** Some models wrap JSON in a ``` fence even in JSON mode; the contract check still decides. */
function stripFence(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return fenced ? fenced[1]! : text;
}
