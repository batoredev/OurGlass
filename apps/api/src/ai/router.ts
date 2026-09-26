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
import { ExtractionError, type Extractor } from "../assistant/extract.js";
import { templateReply, type RespondResult } from "../assistant/respond.js";
import { ProviderError, classifyProviderError } from "./errors.js";
import type { AIProvider, ReadInput, ReadResult } from "./provider.js";

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
 *   ungrounded - the model claimed a state change no fact mentions. The
 *                template states exactly the facts; that IS the fix.
 *   echoed_heading - the model read an internal heading out as prose. Same
 *                reasoning: the template is already the right reply.
 *   max_tokens - OUR cap, identical at the next provider.
 */
const RESPOND_FALLBACK_REASONS = new Set(["sdk_error", "timeout", "empty_text"]);

export interface RouterOptions {
  /** Priority order. The first configured provider is tried first. */
  readonly providers: readonly AIProvider[];
  /** Per-stage overrides (§29): Interpret and Respond need not agree. */
  readonly stageOrder?: Partial<Record<AIStage, readonly AIProviderName[]>> | undefined;
  readonly timeoutMs?: number | undefined;
  /** The Read stage's wait (Phase 6): a 10k-token document is not a sentence. */
  readonly readTimeoutMs?: number | undefined;
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

export interface RoutedReading extends ReadResult {
  readonly provider: AIProviderName;
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
const DEFAULT_READ_TIMEOUT_MS = 60_000;

export class AIModelRouter {
  private readonly providers: readonly AIProvider[];
  private readonly stageOrder: Partial<Record<AIStage, readonly AIProviderName[]>>;
  private readonly timeoutMs: number;
  private readonly readTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly enableFallback: boolean;
  private readonly onLog: (record: AIRequestLog) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: RouterOptions) {
    this.providers = options.providers;
    this.stageOrder = options.stageOrder ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.readTimeoutMs = options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
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
  private chainFor(stage: AIStage, capable: (provider: AIProvider) => boolean = () => true): readonly AIProvider[] {
    // Read falls back to Interpret's order: a deployment that routed Interpret
    // away from a provider did so for a reason that applies to reading too.
    const names = this.stageOrder[stage] ?? (stage === "read" ? this.stageOrder.interpret : undefined);
    const ordered =
      names === undefined
        ? this.providers
        : names
            .map((name) => this.providers.find((provider) => provider.name === name))
            .filter((provider): provider is AIProvider => provider !== undefined);

    // Capability BEFORE the no-fallback slice: with fallback off, a text-only
    // first provider must not swallow an image that the second could read.
    const configured = ordered.filter((provider) => provider.health().configured && capable(provider));
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
  private async withTimeout<T>(
    provider: AIProviderName,
    work: Promise<T>,
    timeoutMs: number = this.timeoutMs,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new ProviderError(provider, "timeout", `Provider timed out after ${timeoutMs}ms`));
      }, timeoutMs);
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
    input: { readonly utterance: string; readonly requestId?: string; readonly context?: string },
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
            provider.interpret({
              utterance: input.utterance,
              requestId,
              ...(input.context ? { context: input.context } : {}),
            }),
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
   * The Read stage (Phase 6): describe one uploaded file.
   *
   * THROWS, like interpret — the ingest pipeline catches it and saves the file
   * unread, saying so. Only providers that CAN read this input are tried: an
   * image skips a text-only model instead of failing on it. The log records
   * carry no content, same as every other stage.
   */
  async read(input: ReadInput, context: { readonly turnId?: string | null } = {}): Promise<RoutedReading> {
    const chain = this.chainFor(
      "read",
      (provider) => typeof provider.read === "function" && (input.kind === "text" || provider.readsImages === true),
    );
    const failures: ProviderError[] = [];
    const requestId = input.requestId ?? correlationId();

    for (const [index, provider] of chain.entries()) {
      for (let attempt = 1; attempt <= this.maxRetries + 1; attempt += 1) {
        const started = Date.now();
        const record = (ok: boolean, failure?: ProviderError) =>
          this.log({
            requestId,
            turnId: context.turnId ?? null,
            stage: "read",
            provider: provider.name,
            model: provider.modelFor("read"),
            attempt,
            latencyMs: Date.now() - started,
            ok,
            fallbackUsed: index > 0,
            ...(failure ? { errorCategory: failure.category } : {}),
          });
        try {
          const result = await this.withTimeout(provider.name, provider.read!(input), this.readTimeoutMs);
          record(true);
          return { ...result, provider: provider.name, fallbackUsed: index > 0 };
        } catch (error: unknown) {
          const failure = classifyProviderError(provider.name, error);
          failures.push(failure);
          record(false, failure);
          // Same policy as interpret: a refusal of THIS file is the same
          // refusal everywhere; a transport failure is worth another provider.
          if (!failure.fallbackable && !failure.retryable) throw new AllProvidersFailedError("read", failures);
          if (failure.retryable && attempt <= this.maxRetries) {
            await this.sleep(this.backoffMs(attempt));
            continue;
          }
          if (!failure.fallbackable) throw new AllProvidersFailedError("read", failures);
          break;
        }
      }
    }

    throw new AllProvidersFailedError("read", failures);
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
        // THE REASON THE STAGE COMPUTED, not a constant.
        //
        // This line used to write `errorCategory: "unknown"` for every
        // degraded reply, which is a value nothing had derived: a 3-second
        // timeout, a safety refusal and an exhausted token budget were
        // indistinguishable in the one field operators are told to read. The
        // reason was sitting in `result.trace` the whole time.
        ...(result.degraded && reason !== undefined ? { fallbackReason: reason } : {}),
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
  /**
   * `requestId` is carried by the ADAPTER, not passed through `extract`.
   *
   * `Extractor.extract` takes a bare string, and widening it to thread a
   * correlation id would mean editing `runTurn` -- the one thing this whole
   * layer was built to avoid. The route constructs these per request, so one
   * instance IS one turn, and an id held here correlates every attempt of both
   * stages without the orchestrator knowing the router exists.
   */
  constructor(
    private readonly router: AIModelRouter,
    private readonly requestId?: string,
  ) {}

  async extract(utterance: string, context?: string): Promise<ExtractionResult> {
    let routed: RoutedInterpretation;
    try {
      routed = await this.router.interpret({
        utterance,
        ...(this.requestId === undefined ? {} : { requestId: this.requestId }),
        ...(context ? { context } : {}),
      });
    } catch (error: unknown) {
      throw toExtractionError(utterance, error);
    }
    return {
      extraction: routed.extraction,
      trace: {
        ...routed.trace,
        provider: routed.provider,
        fallbackUsed: routed.fallbackUsed,
        ...(this.requestId === undefined ? {} : { correlationId: this.requestId }),
      },
    };
  }
}

/**
 * Router failure -> the `ExtractionError` contract `runTurn` already handles.
 *
 * ================================ WHY THIS EXISTS ==========================
 * `runTurn` degrades gracefully ONLY on `ExtractionError`: a templated reply,
 * a persisted trace, a normal return. Everything else it rethrows. Before the
 * router, the Anthropic extractor threw exactly that type. After stage 5 the
 * router threw `ProviderError` and `AllProvidersFailedError` instead, so a
 * refusal, a bad key or an outage became a raw 500 — with the user's message
 * already persisted and no reply or trace beside it.
 *
 * Translated HERE, not in `runTurn`: the AI layer depends on the assistant,
 * never the reverse, and the orchestrator must not learn the router exists.
 * ===========================================================================
 */
function toExtractionError(utterance: string, error: unknown): unknown {
  if (error instanceof ExtractionError) return error;

  const failure =
    error instanceof AllProvidersFailedError
      ? error.failures.at(-1)
      : error instanceof ProviderError
        ? error
        : null;

  // Not a provider failure at all: a programming error. Disguising it as a
  // polite reply would hide the bug, so it propagates untouched.
  if (failure === null) return error;

  // The model answered and the answer was unusable (refusal, truncation, bad
  // shape): the provider's own ExtractionError is the most precise account,
  // stop reason and raw payload included.
  if (failure?.cause instanceof ExtractionError) return failure.cause;

  const message = error instanceof Error ? error.message : "AI provider failure";
  switch (failure?.category) {
    case "refused":
      return new ExtractionError("refused", message, { utterance, stopReason: null });
    case "truncated":
      return new ExtractionError("truncated", message, { utterance, stopReason: null });
    case "context_window":
      return new ExtractionError("context_window_exceeded", message, { utterance, stopReason: null });
    default:
      return new ExtractionError("provider_error", message, { utterance, stopReason: null });
  }
}

/** The router behind the `Responder` interface, including `respondWithTrace`. */
export class RoutedResponder {
  constructor(
    private readonly router: AIModelRouter,
    private readonly requestId?: string,
  ) {}

  private context(): { requestId?: string } {
    return this.requestId === undefined ? {} : { requestId: this.requestId };
  }

  async respond(input: RespondInput): Promise<{ reply: string; degraded: boolean }> {
    const { reply, degraded } = await this.router.respond(input, this.context());
    return { reply, degraded };
  }

  async respondWithTrace(input: RespondInput): Promise<RespondResult> {
    const routed = await this.router.respond(input, this.context());
    return {
      reply: routed.reply,
      degraded: routed.degraded,
      trace: {
        ...routed.trace,
        provider: routed.provider,
        fallbackUsed: routed.fallbackUsed,
        ...(this.requestId === undefined ? {} : { correlationId: this.requestId }),
      },
    };
  }
}
