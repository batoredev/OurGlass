/**
 * The provider interface every model implementation satisfies.
 *
 * ================================ READ THIS ================================
 * A PROVIDER CANNOT REACH THE DATABASE, AND THIS INTERFACE IS WHY.
 *
 * Nothing here accepts a pool, a transaction, a `ToolContext`, or a registry.
 * The Interpret stage receives an utterance and returns an interpretation of
 * it; the Respond stage receives facts that have ALREADY COMMITTED and returns
 * prose. Neither can mutate anything, because neither is given anything that
 * could.
 *
 * That is the §37 boundary stated as a type rather than as a rule people are
 * asked to remember — the same reasoning as `HaikuResponderOptions` taking an
 * API key and nothing else.
 * ===========================================================================
 */
import type {
  AIProviderName,
  AIStage,
  DocumentReading,
  ExtractionResult,
  ImageMediaType,
  ProviderHealth,
  RespondInput,
} from "@ourglass/shared";
import type { RespondResult } from "../assistant/respond.js";

/**
 * What the Read stage is given: extracted text, or one image. NEVER the
 * filename — it is as attacker-controlled as the content, and a model that
 * does not need it should not see it (docs/PHASE-6-DESIGN.md §4).
 */
export type ReadInput =
  | { readonly kind: "text"; readonly text: string; readonly requestId?: string }
  | {
      readonly kind: "image";
      readonly mediaType: ImageMediaType;
      /** Base64, no data: prefix. */
      readonly base64: string;
      readonly requestId?: string;
    };

export interface ReadTrace {
  readonly model: string;
  readonly latencyMs: number;
  readonly stopReason: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export interface ReadResult {
  /** Already through `parseReading` — the provider returns nothing else. */
  readonly reading: DocumentReading;
  readonly trace: ReadTrace;
}

export interface InterpretInput {
  readonly utterance: string;
  /** Correlates every log line and trace for one turn (§21). */
  readonly requestId?: string;
  /**
   * What the app already knows that the sentence cannot say — today, the
   * trackers that exist (assistant/tracked-context.ts). Already rendered,
   * built only from validated snake_case keys, so it can carry no
   * instructions. Absent for evals and for a first turn with nothing tracked.
   */
  readonly context?: string;
}

/**
 * The text a model reads for Interpret: the user's words, then any app
 * context, clearly marked as NOT the user's words so it is never quoted back
 * as `sourceText`. One function, so all three providers send the same thing.
 */
export function interpretMessage(input: { readonly utterance: string; readonly context?: string }): string {
  return input.context ? `${input.utterance}\n\n${input.context}` : input.utterance;
}

export interface AIProvider {
  readonly name: AIProviderName;

  /** Which model this provider would use for a stage, for logs and evals. */
  modelFor(stage: AIStage): string;

  /**
   * THROWS on failure, always as a `ProviderError`. The router needs a
   * category to route on, and a thrown error is the only way to distinguish
   * "could not interpret" from "interpreted, and the answer was a question".
   */
  interpret(input: InterpretInput): Promise<ExtractionResult>;

  /**
   * NEVER THROWS. A degraded result carries the deterministic template reply,
   * because the mutation is already durable and the caller has nothing useful
   * to do with an exception at this point. The router reads `degraded` and the
   * trace's `fallbackReason` to decide whether another provider is worth
   * trying.
   */
  respond(input: RespondInput): Promise<RespondResult>;

  /**
   * The Read stage (Phase 6): describe one uploaded file. OPTIONAL — a
   * CAPABILITY, like `readsImages`: a provider without it is skipped for
   * reading rather than failed. All three real providers implement it
   * (provider-capabilities.test.ts), so absence is a test double's choice.
   *
   * THROWS a `ProviderError` on failure, as interpret does. The result has
   * already passed `parseReading`, so it can describe but never direct.
   */
  read?(input: ReadInput): Promise<ReadResult>;

  /** Whether `read` accepts an image. Qwen's text model does not. */
  readonly readsImages?: boolean;

  /** Cheap and non-networked (§28). Never spends a model call. */
  health(): ProviderHealth;
}
