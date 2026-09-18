/**
 * Provider failure classification — the table the router routes on.
 *
 * ================================ READ THIS ================================
 * THE HARD PART OF FALLBACK IS NOT FALLING BACK. It is refusing to.
 *
 * A provider that returns *"Which Karthik do you mean?"* has not failed. That
 * is the product working: spec §27 says never guess when guessing can cause a
 * meaningful mistake, and the entire three-band resolution design exists to
 * produce exactly that question. Falling back to another provider because the
 * first one asked would be SHOPPING FOR A MODEL WILLING TO GUESS.
 *
 * So a clarification never reaches this file at all — it is a successful
 * result, not an error. What reaches here is transport failures and outputs
 * that could not be parsed, and even among those, three categories are
 * deliberately NOT fallbackable because another provider would fail
 * identically.
 * ===========================================================================
 */
import type { AIProviderName, ProviderFailureCategory } from "@ourglass/shared";
import { ExtractionError } from "../assistant/extract.js";

export interface FailurePolicy {
  /** Retry the SAME provider once. */
  readonly retryable: boolean;
  /** Move on to the NEXT provider. */
  readonly fallbackable: boolean;
  /** Why, in one line. Read this before changing a row. */
  readonly rationale: string;
}

/**
 * The policy, as data.
 *
 * `satisfies` rather than a bare annotation so adding a category to
 * `PROVIDER_FAILURE_CATEGORIES` fails the build here until it has a policy —
 * the same exhaustiveness trick that caught a missing `field_kind` renderer.
 */
export const FAILURE_POLICY = {
  timeout: {
    retryable: true,
    fallbackable: true,
    rationale: "Transient. One retry is cheap; a second provider is cheaper than a hung turn.",
  },
  network: {
    retryable: true,
    fallbackable: true,
    rationale: "Transient connectivity.",
  },
  unavailable: {
    retryable: false,
    fallbackable: true,
    rationale: "The service is down. Retrying the same endpoint only adds latency.",
  },
  auth: {
    retryable: false,
    fallbackable: true,
    rationale: "A wrong key stays wrong. Retry is pure latency; another provider may be configured.",
  },
  rate_limit: {
    retryable: true,
    fallbackable: true,
    rationale: "Backoff may clear it; another provider certainly will.",
  },
  server_error: {
    retryable: true,
    fallbackable: true,
    rationale: "5xx is the provider's fault and often transient.",
  },
  bad_request: {
    retryable: false,
    fallbackable: false,
    rationale:
      "A 4xx we caused — a malformed schema or an oversized field. Every provider rejects it, so falling back turns one clear error into three.",
  },
  malformed_output: {
    retryable: true,
    fallbackable: true,
    rationale: "Sampling variance. Retry once, then let a different model try.",
  },
  schema_invalid: {
    retryable: true,
    fallbackable: true,
    rationale: "Same as malformed: the model answered, the answer did not fit the contract.",
  },
  refused: {
    retryable: false,
    fallbackable: false,
    rationale:
      "A safety decision, not a fault. Trying the next provider is provider-shopping past it, which is not a behaviour this system should have.",
  },
  truncated: {
    retryable: false,
    fallbackable: false,
    rationale:
      "OUR max_tokens was too small for this utterance. Identical everywhere, so falling back wastes two more calls to fail the same way.",
  },
  context_window: {
    retryable: false,
    fallbackable: false,
    rationale: "The input is too large. A different provider does not make it smaller.",
  },
  unknown: {
    retryable: false,
    fallbackable: true,
    rationale:
      "Unclassified. Do not hammer the same provider, but do let the next one try rather than failing the turn on something we did not recognise.",
  },
} as const satisfies Record<ProviderFailureCategory, FailurePolicy>;

/** A provider call that failed, carrying everything the router needs to decide. */
export class ProviderError extends Error {
  readonly provider: AIProviderName;
  readonly category: ProviderFailureCategory;
  readonly retryable: boolean;
  readonly fallbackable: boolean;
  readonly status: number | null;

  constructor(
    provider: AIProviderName,
    category: ProviderFailureCategory,
    message: string,
    options: { readonly status?: number | null; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProviderError";
    this.provider = provider;
    this.category = category;
    this.status = options.status ?? null;
    const policy = FAILURE_POLICY[category];
    this.retryable = policy.retryable;
    this.fallbackable = policy.fallbackable;
  }
}

/**
 * A payment problem, in the words the providers actually use.
 *
 * Matched against the error MESSAGE, not a status alone, because the status
 * for "no credit" is provider-specific: Anthropic returns 400, others 402 or
 * 429. Kept narrow on purpose — a pattern that also caught "invalid request"
 * would make every malformed call fall back and triple the cost of a bug.
 */
const BILLING_FAILURE =
  /credit balance|insufficient (?:credit|funds|quota|balance)|billing|payment required|exceeded your current quota|quota exceeded/i;

/** HTTP status -> category. Shared by every provider, so the table lives once. */
function categoryForStatus(status: number): ProviderFailureCategory {
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status === 404) return "unavailable";
  if (status >= 500) return "server_error";
  if (status >= 400) return "bad_request";
  return "unknown";
}

/** `ExtractionFailureReason` -> category. The model answered; the answer was unusable. */
function categoryForExtractionError(error: ExtractionError): ProviderFailureCategory {
  switch (error.reason) {
    case "refused":
      return "refused";
    case "truncated":
      return "truncated";
    case "context_window_exceeded":
      return "context_window";
    case "no_tool_call":
      return "malformed_output";
    case "invalid_payload":
      return "schema_invalid";
    case "provider_error":
      return "unavailable";
    default:
      return "unknown";
  }
}

function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function readName(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : "";
}

function readCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

/**
 * Turn anything a provider threw into a routable `ProviderError`.
 *
 * DELIBERATELY DUCK-TYPED rather than keyed on SDK error classes. Three SDKs
 * with three class hierarchies would mean three classifiers drifting apart,
 * and `instanceof` across a bundler boundary is its own quiet failure. Status
 * codes, error names and `code` strings are what all three actually expose.
 */
export function classifyProviderError(provider: AIProviderName, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  if (error instanceof ExtractionError) {
    return new ProviderError(provider, categoryForExtractionError(error), error.message, {
      cause: error,
    });
  }

  const status = readStatus(error);
  if (status !== null) {
    // A 4xx ABOUT MONEY IS NOT A 4xx ABOUT THE REQUEST.
    //
    // `bad_request` is terminal because a malformed request fails identically
    // everywhere — but "your credit balance is too low" is the one 400 that a
    // DIFFERENT provider would happily serve. Classifying it terminal turns
    // the exact moment fallback exists for into a dead end. Seen live:
    // Anthropic answers 400 invalid_request_error for an exhausted balance.
    if (status === 402 || (status === 400 && BILLING_FAILURE.test(messageOf(error)))) {
      return new ProviderError(provider, "unavailable", messageOf(error), {
        status,
        cause: error,
      });
    }
    return new ProviderError(provider, categoryForStatus(status), messageOf(error), {
      status,
      cause: error,
    });
  }

  const name = readName(error);
  if (name === "AbortError" || name === "TimeoutError") {
    return new ProviderError(provider, "timeout", messageOf(error), { cause: error });
  }

  const code = readCode(error);
  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN" ||
    name === "TypeError" // `fetch` reports a dead host as a bare TypeError
  ) {
    return new ProviderError(provider, "network", messageOf(error), { cause: error });
  }

  return new ProviderError(provider, "unknown", messageOf(error), { cause: error });
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown provider error";
}
