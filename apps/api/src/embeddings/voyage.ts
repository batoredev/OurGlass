/**
 * The Voyage AI embedding client (docs/PHASE-4-DESIGN.md §1).
 *
 * WHY VOYAGE: Anthropic ships no embeddings API and names Voyage as its
 * recommended provider. Every current Voyage model defaults to 1024
 * dimensions, which is what `commitments.object_embedding vector(1024)` has
 * declared since migration 003 — see F8: that dimension was committed before
 * any provider was chosen, so it is correct by luck rather than derivation.
 * Changing either side now costs an ALTER TABLE on a populated column.
 *
 * WHY `fetch` AND NOT AN SDK: this is one POST to one endpoint. Adding a
 * dependency for it is the "no new framework without a concrete requirement"
 * case CLAUDE.md §1 rules out, and Node 24 has fetch built in.
 *
 * ┌─ THE ASYMMETRY THIS FILE EXISTS TO ENFORCE ────────────────────────────┐
 * │ Voyage's `input_type` prepends a DIFFERENT instruction per value:      │
 * │   "document" -> "Represent the document for retrieval: "               │
 * │   "query"    -> "Represent the query for retrieving supporting docs: " │
 * │ Using one for both is a SILENT quality regression — nothing errors,    │
 * │ nothing fails typecheck, and recall drops by an amount no test here    │
 * │ would notice. Hence two named methods and no defaulted parameter.      │
 * └────────────────────────────────────────────────────────────────────────┘
 */

/**
 * The model and its dimension, together, because they are not independent.
 * `EMBEDDING_DIMENSIONS` must equal the `vector(N)` in the migrations; a
 * mismatch is a runtime Postgres error on every insert, not a typecheck
 * failure, so it is asserted in a test rather than trusted.
 */
export const EMBEDDING_MODEL = "voyage-3.5" as const;
export const EMBEDDING_DIMENSIONS = 1024 as const;

const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/embeddings";

/** Voyage accepts at most 1000 inputs per request (documented limit). */
const MAX_BATCH = 1000;

/** Voyage's two retrieval-tuned prompt prefixes. Never defaulted — see header. */
type InputType = "document" | "query";

/**
 * Why a call failed, as a discriminable value rather than a message — the
 * same taxonomy shape as Phase 2's ExtractionError, and for the same reason:
 * a caller deciding whether to degrade or retry cannot parse prose.
 */
export type EmbeddingFailureReason =
  | "no_api_key"
  | "rate_limited"
  | "timeout"
  | "bad_response"
  | "http_error";

export class EmbeddingError extends Error {
  readonly reason: EmbeddingFailureReason;
  readonly status: number | null;

  constructor(reason: EmbeddingFailureReason, message: string, status: number | null = null) {
    super(message);
    this.name = "EmbeddingError";
    this.reason = reason;
    this.status = status;
  }
}

export interface EmbeddingTrace {
  readonly model: string;
  readonly latencyMs: number;
  readonly inputCount: number;
  /** Voyage reports only a single total; there is no input/output split. */
  readonly totalTokens: number | null;
}

export interface EmbeddingResult {
  readonly embeddings: readonly (readonly number[])[];
  readonly trace: EmbeddingTrace;
}

export interface VoyageClientOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  /** Injectable for tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;

interface VoyageResponse {
  data?: { embedding?: unknown; index?: unknown }[];
  usage?: { total_tokens?: unknown };
}

export class VoyageClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VoyageClientOptions) {
    if (!options.apiKey) {
      throw new EmbeddingError("no_api_key", "VOYAGE_API_KEY is required for embeddings");
    }
    this.apiKey = options.apiKey;
    this.model = options.model ?? EMBEDDING_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Embed texts for STORAGE. Batched: Voyage takes up to 1000 inputs per
   * request, so a multi-intent turn creating two commitments is ONE call.
   */
  async embedDocuments(texts: readonly string[]): Promise<EmbeddingResult> {
    return this.embed(texts, "document");
  }

  /** Embed one text for SEARCH. Different prefix; see the header. */
  async embedQuery(text: string): Promise<EmbeddingResult> {
    return this.embed([text], "query");
  }

  private async embed(texts: readonly string[], inputType: InputType): Promise<EmbeddingResult> {
    if (texts.length === 0) {
      // Not an error, and NOT a request: an empty batch would spend a call to
      // be told nothing. Returning early keeps callers free of the guard.
      return {
        embeddings: [],
        trace: { model: this.model, latencyMs: 0, inputCount: 0, totalTokens: 0 },
      };
    }
    if (texts.length > MAX_BATCH) {
      throw new EmbeddingError(
        "bad_response",
        `Voyage accepts at most ${MAX_BATCH} inputs per request; got ${texts.length}. Chunk before calling.`,
      );
    }

    const started = performance.now();
    // AbortSignal.timeout rather than a manual setTimeout race: it cancels the
    // underlying socket, so a hung vendor does not leak a connection for the
    // lifetime of the process.
    let response: Response;
    try {
      response = await this.fetchImpl(VOYAGE_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ input: texts, model: this.model, input_type: inputType }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new EmbeddingError("timeout", `Voyage did not respond within ${this.timeoutMs}ms`);
      }
      throw new EmbeddingError(
        "http_error",
        `Voyage request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      // 429 is separated because it is the one a caller may sensibly back off
      // on; everything else is a fault to surface. NO RETRY HAPPENS HERE —
      // .claude/rules/wat.md §3: a retry loop on a paid endpoint is the most
      // expensive failure mode available. Retry policy belongs to the caller,
      // which knows whether the work is worth repeating.
      const reason: EmbeddingFailureReason = response.status === 429 ? "rate_limited" : "http_error";
      throw new EmbeddingError(reason, `Voyage returned ${response.status}`, response.status);
    }

    let payload: VoyageResponse;
    try {
      payload = (await response.json()) as VoyageResponse;
    } catch {
      throw new EmbeddingError("bad_response", "Voyage returned a body that is not JSON");
    }

    const embeddings = parseEmbeddings(payload, texts.length);
    const totalTokens =
      typeof payload.usage?.total_tokens === "number" ? payload.usage.total_tokens : null;

    return {
      embeddings,
      trace: {
        model: this.model,
        latencyMs: performance.now() - started,
        inputCount: texts.length,
        totalTokens,
      },
    };
  }
}

/**
 * Validate the response shape rather than trusting it.
 *
 * The vendor response is UNTRUSTED INPUT (.claude/rules/security.md), and the
 * specific failure this guards against is not malice but silence: a truncated
 * or reordered `data` array would otherwise write an embedding onto the WRONG
 * ROW. Nothing downstream could detect that — the vector is 1024 valid floats
 * either way, and the only symptom is worse retrieval.
 *
 * So: the count must match, every dimension must match, and results are placed
 * by the `index` Voyage returns rather than assumed to arrive in order.
 */
function parseEmbeddings(payload: VoyageResponse, expected: number): readonly (readonly number[])[] {
  const data = payload.data;
  if (!Array.isArray(data)) {
    throw new EmbeddingError("bad_response", "Voyage response has no `data` array");
  }
  if (data.length !== expected) {
    throw new EmbeddingError(
      "bad_response",
      `Voyage returned ${data.length} embeddings for ${expected} inputs`,
    );
  }

  const ordered: (number[] | undefined)[] = new Array<number[] | undefined>(expected);
  for (const [position, item] of data.entries()) {
    const index = typeof item.index === "number" ? item.index : position;
    if (!Number.isInteger(index) || index < 0 || index >= expected) {
      throw new EmbeddingError("bad_response", `Voyage returned out-of-range index ${index}`);
    }
    const vector = item.embedding;
    if (!Array.isArray(vector) || !vector.every((value) => typeof value === "number")) {
      throw new EmbeddingError("bad_response", `Voyage embedding at index ${index} is not numeric`);
    }
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      // A dimension mismatch would fail at INSERT with a Postgres error that
      // names neither the model nor the call site. Failing here says which.
      throw new EmbeddingError(
        "bad_response",
        `Voyage returned ${vector.length} dimensions; the schema declares vector(${EMBEDDING_DIMENSIONS})`,
      );
    }
    if (ordered[index] !== undefined) {
      throw new EmbeddingError("bad_response", `Voyage returned duplicate index ${index}`);
    }
    ordered[index] = vector as number[];
  }

  // Belt and braces: every slot filled. Unreachable given the checks above,
  // but the alternative is returning `undefined` typed as `number[]`.
  return ordered.map((vector, index) => {
    if (!vector) throw new EmbeddingError("bad_response", `Voyage omitted index ${index}`);
    return vector;
  });
}

/**
 * Format a vector for pgvector.
 *
 * pgvector's text input is `[1,2,3]` — JSON array syntax, which
 * `JSON.stringify` produces exactly. Kept as one named function so no call
 * site hand-rolls the string and gets the brackets or separators subtly wrong.
 */
export function toVectorLiteral(embedding: readonly number[]): string {
  return JSON.stringify(embedding);
}
