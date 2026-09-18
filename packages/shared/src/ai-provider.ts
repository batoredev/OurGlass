/**
 * Provider-neutral AI contracts.
 *
 * ================================ READ THIS ================================
 * TYPES AND CONSTANTS ONLY. No SDK import belongs in this file, ever.
 *
 * `@ourglass/shared` is imported by `apps/web`, including client components.
 * An Anthropic/Gemini/Ollama import here would pull a provider SDK — and
 * anything it reads from the environment — into a browser bundle. The
 * providers themselves live in `apps/api/src/ai/`, which is server-only.
 *
 * What lives here is the vocabulary both sides need: which providers exist,
 * which stages they serve, and how a failure is categorised.
 * ===========================================================================
 */

/**
 * ORDER IS THE DEFAULT PRIORITY: Claude, then Gemini, then Qwen.
 *
 * Declared once. `AI_PROVIDER_ORDER` overrides it at runtime, and nothing
 * else in the codebase may hardcode a sequence — a second copy of this list
 * is the two-declarations-of-one-fact shape behind nearly every defect this
 * project has recorded.
 */
export const AI_PROVIDER_NAMES = ["claude", "gemini", "qwen"] as const;

export type AIProviderName = (typeof AI_PROVIDER_NAMES)[number];

export function isAIProviderName(value: unknown): value is AIProviderName {
  return typeof value === "string" && (AI_PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * The two stages a provider serves.
 *
 * Deliberately NOT the four stages of the pipeline. Resolve and Mutate are
 * fully deterministic and never see a model — that is the §37 boundary, and
 * naming them here would suggest a provider could be plugged into them.
 */
export const AI_STAGES = ["interpret", "respond"] as const;

export type AIStage = (typeof AI_STAGES)[number];

/**
 * Why a provider call failed, at a granularity the ROUTER can act on.
 *
 * Distinct from `ExtractionFailureReason`, which describes what came back
 * from a model that answered. These categories include the transport-level
 * events a single-provider design never had to tell apart — a 429 and a 401
 * are both "it did not work", and only one of them is worth retrying.
 */
export const PROVIDER_FAILURE_CATEGORIES = [
  "timeout",
  "network",
  "unavailable",
  "auth",
  "rate_limit",
  "server_error",
  "bad_request",
  "malformed_output",
  "schema_invalid",
  "refused",
  "truncated",
  "context_window",
  "unknown",
] as const;

export type ProviderFailureCategory = (typeof PROVIDER_FAILURE_CATEGORIES)[number];

/**
 * Provider reachability, as cheaply as it can honestly be established.
 *
 * §28: never spend a model call to answer this. `configured` means the
 * provider has what it needs to be tried at all (a key, a base URL); it is
 * NOT a claim that the remote service is up.
 */
export interface ProviderHealth {
  readonly provider: AIProviderName;
  readonly configured: boolean;
  /** ISO-8601. Null when the provider has never been called. */
  readonly lastFailureAt: string | null;
  readonly lastFailureCategory: ProviderFailureCategory | null;
  readonly detail?: string;
}

/**
 * Why the Respond stage fell back to the deterministic template.
 *
 * Declared HERE, beside `AIRequestLog`, because the log is the only place
 * anyone reads it from outside the Respond stage. `respond.ts` re-exports it
 * so its own callers are unaffected. A second hand-written copy is exactly
 * the drift `EXTRACTION_MODEL` already taught this codebase to avoid.
 */
export type RespondFallbackReason =
  | "sdk_error"
  | "timeout"
  | "refusal"
  | "max_tokens"
  | "empty_text"
  | "too_long";

/**
 * One AI request, as it is logged (§21).
 *
 * NEVER carries a key, and never carries the user's utterance: the message
 * body is already persisted in `messages` with its own provenance, and
 * duplicating it into a log line puts personal content somewhere with a
 * different retention story.
 */
export interface AIRequestLog {
  readonly requestId: string;
  readonly turnId: string | null;
  readonly stage: AIStage;
  readonly provider: AIProviderName;
  readonly model: string;
  readonly attempt: number;
  readonly latencyMs: number;
  readonly ok: boolean;
  readonly fallbackUsed: boolean;
  readonly errorCategory?: ProviderFailureCategory;
  /**
   * Set when Respond RETURNED a degraded reply rather than throwing.
   *
   * These are different events and the log used to flatten them: every
   * degraded reply was written down as `errorCategory: "unknown"`, a value no
   * code had computed. A 3-second timeout, a safety refusal and an exhausted
   * token budget all looked identical, so the one field an operator is told
   * to read said nothing. The reason is now recorded as the stage computed it.
   */
  readonly fallbackReason?: RespondFallbackReason;
}
