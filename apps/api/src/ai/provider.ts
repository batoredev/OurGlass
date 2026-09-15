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
  ExtractionResult,
  ProviderHealth,
  RespondInput,
} from "@ourglass/shared";
import type { RespondResult } from "../assistant/respond.js";

export interface InterpretInput {
  readonly utterance: string;
  /** Correlates every log line and trace for one turn (§21). */
  readonly requestId?: string;
}

export interface AIProvider {
  readonly name: AIProviderName;

  /** Which model this provider would use for a stage, for logs and evals. */
  modelFor(stage: "interpret" | "respond"): string;

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

  /** Cheap and non-networked (§28). Never spends a model call. */
  health(): ProviderHealth;
}
