/**
 * The AI model router: provider priority, bounded retry, fallback.
 *
 * ================================ READ THIS ================================
 * IT OWNS NO BUSINESS LOGIC. No entity resolution, no database, no tools, no
 * knowledge of what a commitment is. It picks a provider, bounds the wait,
 * decides whether a failure is worth retrying or worth moving on from, and
 * hands the result back unchanged.
 *
 * THE HARD PART IS REFUSING TO FALL BACK. A clarifying question is a SUCCESS
 * — it never reaches the failure path at all. Of the failures that do, four
 * categories are terminal (see errors.ts). Everything else walks the chain.
 *
 * ONE PROVIDER PER REQUEST IN THE HAPPY PATH (§27). Claude answers, the router
 * stops. Nothing here ever fans out to all three; that is the eval runner's
 * job, and it is a different entry point on purpose.
 * ===========================================================================
 */
import type {
  AIProviderName,
  AIRequestLog,
  AIStage,
  ExtractionResult,
  ProviderHealth,
  RespondInput,
} from "@ourglass/shared";
import type { Extractor } from "../assistant/extract.js";
import { templateReply, type RespondResult } from "../assistant/respond.js";
import { ProviderError, classifyProviderError } from "./errors.js";
import type { AIProvider } from "./provider.js";

/**
 * Respond-stage degradations worth trying another provider for.
 *
 * `respondWithTrace` never throws, so the Respond stage signals failure with
 * `degraded` plus a reason rather than an exception — and not every reason is
 * a provider problem:
 *
 *   refusal    - a safety decision. Shopping past it is not a behaviour we want.
 *   too_long   - the model was verbose. The template is already correct and
 *                concise; a second call for prose is not worth it.
 *   max_tokens - OUR cap, identical at the next provider.
 */
const RESPOND_FALLBACK_REASONS = new Set(["sdk_error", "timeout", "empty_text"]);

export interface RouterOptions {
  /** Priority order. The first configured provider is tried first. */
  readonly providers: readonly AIProvider[];
  /** Per-stage overrides (§29): Interpret and Respond need not agree. */
  readonly stageOrder?: Partial<Record<AIStage, readonly AIProviderName[]>> | undefined;
  readonly timeoutMs?: number | undefined;
  /** Retries of the SAME provider, after the first attempt. Default 1. */
  readonly maxRetries?: number | undefined;
  readonly enableFallback?: boolean | undefined;
  readonly onLog?: ((record: AIRequestLog) => void) | undefined;
  /** Injected so tests never actually wait. */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Injected so backoff jitter is deterministic under test. */
  readonly random?: (() => number) | undefined;
}

export interface RoutedInterpretation extends ExtractionResult {
  readonly provider: AIProviderName;
  readonly fallbackUsed: boolean;
}

export interface RoutedReply extends RespondResult {
  readonly provider: AIProviderName | null;
  readonly fallbackUsed: boolean;
}

/** Every provider failed. Carries the whole trail, not just the last one. */
export class AllProvidersFailedError extends Error {
  readonly stage: AIStage;
  readonly failures: readonly ProviderError[];

  constructor(stage: AIStage, failures: readonly ProviderError[]) {
    const trail = failures.map((f) => `${f.provider}:${f.category}`).join(" -> ");
    super(`No AI provider could ${stage}. Tried: ${trail || "(none configured)"}`);
    this.name = "AllProvidersFailedError";
    this.stage = stage;
    this.failures = failures;
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class AIModelRouter {
  private readonly providers: readonly AIProvider[];
  private readonly stageOrder: Partial<Record<AIStage, readonly AIProviderName[]>>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly enableFallback: boolean;
  private readonly onLog: (record: AIRequestLog) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: RouterOptions) {
    this.providers = options.providers;
    this.stageOrder = options.stageOrder ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? 1;
    this.enableFallback = options.enableFallback ?? true;
    this.onLog = options.onLog ?? (() => undefined);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  /**
   * Providers to try for a stage, in order.
   *
   * UNCONFIGURED PROVIDERS ARE SKIPPED, not failed. An unset GEMINI_API_KEY is
   * a deployment choosing two providers, not an error — and counting it as a
   * failure would make the trail in AllProvidersFailedError lie about what was
   * actually attempted.
   */
  private chainFor(stage: AIStage): readonly AIProvider[] {
    const names = this.stageOrder[stage];
    const ordered =
      names === undefined
        ? this.providers
        : names
            .map((name) => this.providers.find((provider) => provider.name === name))
            .filter((provider): provider is AIProvider => provider !== undefined);

    const configured = ordered.filter((provider) => provider.health().configured);
    return this.enableFallback ? configured : configured.slice(0, 1);
  }

  /**
   * Bound the WAIT, not the request.
   *
   * `Promise.race` cannot cancel work already in flight — the provider SDKs
   * own that, and two of the three have their own internal timeouts. What this
   * guarantees is that the TURN does not hang, which is the property that
   * matters: a hung Interpret leaves the user with nothing, and a hung Respond
   * makes an already-committed mutation look like a failure and invites the
   * user to say it again.
   */
  private async withTimeout<T>(provider: AIProviderName, work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new ProviderError(provider, "timeout", `Provider timed out after ${this.timeoutMs}ms`),
        );
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** Exponential backoff with jitter. Bounded, and never before the first try. */
  private backoffMs(attempt: number): number {
    const base = 250 * 2 ** (attempt - 1);
    return Math.min(base, 2_000) + Math.floor(this.random() * 100);
  }

  async interpret(
    input: { readonly utterance: string; readonly requestId?: string },
    context: { readonly turnId?: string | null } = {},
  ): Promise<RoutedInterpretation> {
    const chain = this.chainFor("interpret");
    const failures: ProviderError[] = [];
    const requestId = input.requestId ?? correlationId();

    for (const [index, provider] of chain.entries()) {
      for (let attempt = 1; attempt <= this.maxRetries + 1; attempt += 1) {
        const started = Date.now();
        try {
          const result = await this.withTimeout(
            provider.name,
            provider.interpret({ utterance: input.utterance, requestId }),
          );
          this.log({
            requestId,
            turnId: context.turnId ?? null,
            stage: "interpret",
            provider: provider.name,
            model: provider.modelFor("interpret"),
            attempt,
            latencyMs: Date.now() - started,
            ok: true,
            fallbackUsed: index > 0,
          });
          return { ...result, provider: provider.name, fallbackUsed: index > 0 };
        } catch (error: unknown) {
          const failure = classifyProviderError(provider.name, error);
          failures.push(failure);
          this.log({
            requestId,
            turnId: context.turnId ?? null,
            stage: "interpret",
            provider: provider.name,
            model: provider.modelFor("interpret"),
            attempt,
            latencyMs: Date.now() - started,
            ok: false,
            fallbackUsed: index > 0,
            errorCategory: failure.category,
          });

          // TERMINAL. A refusal, a truncation, an oversized input or a request
          // we malformed fails the same way everywhere; walking the chain
          // turns one clear error into three and delays the honest answer.
          if (!failure.fallbackable && !failure.retryable) throw failure;

          const canRetry = failure.retryable && attempt <= this.maxRetries;
          if (canRetry) {
            await this.sleep(this.backoffMs(attempt));
            continue;
          }
          if (!failure.fallbackable) throw failure;
          break; // next provider
        }
      }
    }

    throw new AllProvidersFailedError("interpret", failures);
  }

  /**
   * NEVER THROWS. The mutation has already committed by the time this runs;
   * throwing here would turn a durable write into an apparent failure and
   * invite the user to repeat themselves — which is how a duplicate is born.
   *
   * When every provider degrades, the deterministic template answers. That is
   * not a last-resort bolt-on: `templateReply` is pure, synchronous and
   * separately unit-tested precisely because it is the thing that must work
   * when nothing else does.
   */
  async respond(
    input: RespondInput,
    context: { readonly turnId?: string | null; readonly requestId?: string } = {},
  ): Promise<RoutedReply> {
    const chain = this.chainFor("respond");
    const requestId = context.requestId ?? correlationId();
    let lastDegraded: RoutedReply | null = null;

    for (const [index, provider] of chain.entries()) {
      const started = Date.now();
      let result: RespondResult;
      try {
        result = await this.withTimeout(provider.name, provider.respond(input));
      } catch (error: unknown) {
        // respondWithTrace is documented never to throw, so reaching here
        // means the router's own timeout fired, or that guarantee broke.
        const failure = classifyProviderError(provider.name, error);
        this.log({
          requestId,
          turnId: context.turnId ?? null,
          stage: "respond",
          provider: provider.name,
          model: provider.modelFor("respond"),
          attempt: 1,
          latencyMs: Date.now() - started,
          ok: false,
          fallbackUsed: index > 0,
          errorCategory: failure.category,
        });
        continue;
      }

      const reason = result.trace.fallbackReason;
      const worthAnotherProvider =
        result.degraded && reason !== undefined && RESPOND_FALLBACK_REASONS.has(reason);

      this.log({
        requestId,
        turnId: context.turnId ?? null,
        stage: "respond",
        provider: provider.name,
        model: provider.modelFor("respond"),
        attempt: 1,
        latencyMs: Date.now() - started,
        ok: !result.degraded,
        fallbackUsed: index > 0,
        ...(result.degraded ? { errorCategory: "unknown" as const } : {}),
      });

      if (!result.degraded) {
        return { ...result, provider: provider.name, fallbackUsed: index > 0 };
      }

      lastDegraded = { ...result, provider: provider.name, fallbackUsed: index > 0 };
      if (!worthAnotherProvider) return lastDegraded;
    }

    if (lastDegraded) return lastDegraded;

    // Nothing configured, or every provider threw. The template is the answer.
    return {
      reply: templateReply(input),
      degraded: true,
      trace: { model: "template", latencyMs: 0, degraded: true, fallbackReason: "sdk_error" },
      provider: null,
      fallbackUsed: chain.length > 0,
    };
  }

  health(): readonly ProviderHealth[] {
    return this.providers.map((provider) => provider.health());
  }

  private log(record: AIRequestLog): void {
    // A logger that throws must never take down a turn that has committed.
    try {
      this.onLog(record);
    } catch {
      /* deliberately swallowed */
    }
  }
}

/** A correlation id. Not a security token — readability over entropy. */
function correlationId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * The router behind the `Extractor` interface `runTurn` already depends on.
 *
 * This adapter is why the orchestrator needs no edit: it is the most heavily
 * tested file in the project, and a provider layer that required changing it
 * would have leaked past its own boundary.
 */
export class RoutedExtractor implements Extractor {
  constructor(private readonly router: AIModelRouter) {}

  async extract(utterance: string): Promise<ExtractionResult> {
    const routed = await this.router.interpret({ utterance });
    return { extraction: routed.extraction, trace: routed.trace };
  }
}

/** The router behind the `Responder` interface, including `respondWithTrace`. */
export class RoutedResponder {
  constructor(private readonly router: AIModelRouter) {}

  async respond(input: RespondInput): Promise<{ reply: string; degraded: boolean }> {
    const { reply, degraded } = await this.router.respond(input);
    return { reply, degraded };
  }

  async respondWithTrace(input: RespondInput): Promise<RespondResult> {
    const routed = await this.router.respond(input);
    return { reply: routed.reply, degraded: routed.degraded, trace: routed.trace };
  }
}
