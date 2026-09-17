/**
 * Typed AI configuration — the one place environment variables become a router.
 *
 * ================================ READ THIS ================================
 * SERVER-ONLY. Nothing here may be imported by a client component: it reads
 * API keys, and anything reachable from the browser bundle leaks them. What
 * protects this is that `apps/web` only imports it from Route Handlers, which
 * never ship to the client.
 *
 * TWO RULES SHAPE EVERYTHING BELOW:
 *
 * 1. AN UNCONFIGURED PROVIDER IS SKIPPED, NOT AN ERROR. A deployment with only
 *    an Anthropic key has chosen one provider. Throwing on a missing
 *    GEMINI_API_KEY would turn a deliberate choice into a startup crash.
 *
 * 2. NO PROVIDER AT ALL *IS* AN ERROR, and it must be named at the boundary
 *    rather than discovered as a generic 500 after the user types a sentence.
 * ===========================================================================
 */
import {
  AI_PROVIDER_NAMES,
  isAIProviderName,
  type AIProviderName,
  type AIStage,
} from "@ourglass/shared";
import { ClaudeProvider } from "./claude.js";
import { GeminiProvider } from "./gemini.js";
import { QwenProvider } from "./qwen.js";
import type { AIProvider } from "./provider.js";
import { AIModelRouter, type RouterOptions } from "./router.js";

/** The environment slice this module reads. Injected in tests; never global. */
export type AIEnv = Readonly<Record<string, string | undefined>>;

export interface AIConfig {
  readonly order: readonly AIProviderName[];
  readonly stageOrder: Partial<Record<AIStage, readonly AIProviderName[]>>;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableFallback: boolean;
  readonly anthropic: {
    readonly apiKey: string;
    readonly interpretModel: string | undefined;
    readonly respondModel: string | undefined;
  };
  readonly gemini: {
    readonly apiKey: string;
    readonly interpretModel: string | undefined;
    readonly respondModel: string | undefined;
  };
  readonly ollama: {
    /** Null when OLLAMA_BASE_URL was not set — see `loadAIConfig`. */
    readonly baseUrl: string | null;
    readonly model: string | undefined;
  };
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 1;

function readInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  // A typo must not silently become 0 retries or a 0ms timeout — both change
  // behaviour drastically while still looking like configuration.
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function readBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim().toLowerCase() !== "false";
}

/**
 * Parse a provider order, dropping names that are not providers.
 *
 * DROPPED, not thrown on: a typo in `AI_PROVIDER_ORDER` should degrade to the
 * providers that ARE recognised rather than take the process down. An empty
 * result falls back to the declared default.
 */
export function parseOrder(
  raw: string | undefined,
  fallback: readonly AIProviderName[],
): readonly AIProviderName[] {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = raw
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(isAIProviderName);
  // De-duplicated: "claude,claude,gemini" is a config mistake, and trying the
  // same provider twice in a row is exactly what the retry budget is for.
  const unique = [...new Set(parsed)];
  return unique.length > 0 ? unique : fallback;
}

export function loadAIConfig(env: AIEnv): AIConfig {
  const ollamaBaseUrl = env["OLLAMA_BASE_URL"]?.trim() ?? "";

  /**
   * ⚠ QWEN IS OMITTED FROM THE DEFAULT ORDER UNLESS OLLAMA_BASE_URL IS SET.
   *
   * `QwenProvider.health()` reports `configured` from a base URL alone,
   * because Ollama has no key — and the base URL has a default. Left alone,
   * that would put Qwen permanently in every chain, so a deployment with no
   * Ollama would pay a connection timeout on every single fallback before
   * failing.
   *
   * Setting OLLAMA_BASE_URL is the explicit opt-in. `AI_PROVIDER_ORDER` can
   * still name qwen regardless — an operator who asks for it by name gets it.
   */
  const defaultOrder =
    ollamaBaseUrl !== ""
      ? AI_PROVIDER_NAMES
      : AI_PROVIDER_NAMES.filter((name) => name !== "qwen");

  const order = parseOrder(env["AI_PROVIDER_ORDER"], defaultOrder);

  // §29: the stages need not agree. Interpret wants the strongest model;
  // Respond wants the fastest, and may prefer a local one for privacy.
  const stageOrder: Partial<Record<AIStage, readonly AIProviderName[]>> = {};
  const interpretOrder = env["AI_INTERPRET_ORDER"];
  const respondOrder = env["AI_RESPOND_ORDER"];
  if (interpretOrder !== undefined && interpretOrder.trim() !== "") {
    stageOrder.interpret = parseOrder(interpretOrder, order);
  }
  if (respondOrder !== undefined && respondOrder.trim() !== "") {
    stageOrder.respond = parseOrder(respondOrder, order);
  }

  return {
    order,
    stageOrder,
    timeoutMs: readInt(env["AI_REQUEST_TIMEOUT_MS"], DEFAULT_TIMEOUT_MS, 1_000, 120_000),
    maxRetries: readInt(env["AI_MAX_RETRIES"], DEFAULT_MAX_RETRIES, 0, 5),
    enableFallback: readBool(env["AI_ENABLE_FALLBACK"], true),
    anthropic: {
      apiKey: env["ANTHROPIC_API_KEY"]?.trim() ?? "",
      interpretModel: env["ANTHROPIC_INTERPRET_MODEL"]?.trim() || undefined,
      respondModel: env["ANTHROPIC_RESPONSE_MODEL"]?.trim() || undefined,
    },
    gemini: {
      apiKey: env["GEMINI_API_KEY"]?.trim() ?? "",
      interpretModel: env["GEMINI_INTERPRET_MODEL"]?.trim() || undefined,
      respondModel: env["GEMINI_RESPONSE_MODEL"]?.trim() || undefined,
    },
    ollama: {
      baseUrl: ollamaBaseUrl !== "" ? ollamaBaseUrl : null,
      model: env["OLLAMA_MODEL"]?.trim() || undefined,
    },
  };
}

/** Build one provider instance. Never throws — an unusable one reports unconfigured. */
function buildProvider(name: AIProviderName, config: AIConfig): AIProvider {
  switch (name) {
    case "claude":
      return new ClaudeProvider({
        apiKey: config.anthropic.apiKey,
        interpretModel: config.anthropic.interpretModel,
        respondModel: config.anthropic.respondModel,
      });
    case "gemini":
      return new GeminiProvider({
        apiKey: config.gemini.apiKey,
        interpretModel: config.gemini.interpretModel,
        respondModel: config.gemini.respondModel,
      });
    case "qwen":
      return new QwenProvider({
        baseUrl: config.ollama.baseUrl ?? undefined,
        model: config.ollama.model,
        // The provider's own abort must not fire before the router stops
        // waiting — otherwise AI_REQUEST_TIMEOUT_MS is a setting that cannot
        // lengthen anything.
        interpretTimeoutMs: config.timeoutMs,
      });
  }
}

/** Raised when the environment configures no usable provider at all. */
export class NoProviderConfiguredError extends Error {
  constructor() {
    super(
      "No AI provider is configured. Set ANTHROPIC_API_KEY, or GEMINI_API_KEY, " +
        "or OLLAMA_BASE_URL (with Ollama running).",
    );
    this.name = "NoProviderConfiguredError";
  }
}

export interface BuildRouterOptions {
  readonly onLog?: RouterOptions["onLog"];
}

/**
 * The factory the application calls. One router, built from the environment.
 *
 * THROWS `NoProviderConfiguredError` when nothing is usable — named at the
 * boundary, because the alternative is a generic 500 after the user has
 * already typed a sentence.
 */
export function buildAIRouter(env: AIEnv, options: BuildRouterOptions = {}): AIModelRouter {
  const config = loadAIConfig(env);
  const providers = config.order.map((name) => buildProvider(name, config));

  if (!providers.some((provider) => provider.health().configured)) {
    throw new NoProviderConfiguredError();
  }

  return new AIModelRouter({
    providers,
    stageOrder: config.stageOrder,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    enableFallback: config.enableFallback,
    onLog: options.onLog,
  });
}

/**
 * Which providers a given environment would actually use.
 *
 * For `/api/health`, and for diagnosing "why did it not use Gemini". Returns
 * NAMES AND FLAGS ONLY — never a key, never a fragment of one.
 */
export function describeProviders(
  env: AIEnv,
): readonly { readonly provider: AIProviderName; readonly configured: boolean }[] {
  const config = loadAIConfig(env);
  return config.order.map((name) => ({
    provider: name,
    configured: buildProvider(name, config).health().configured,
  }));
}
