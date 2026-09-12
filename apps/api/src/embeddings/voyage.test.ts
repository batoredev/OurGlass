/**
 * Voyage client tests — no network, no key, no cost. `fetchImpl` is injected.
 *
 * The property most of these defend is not "does it work" but "does it refuse
 * to write a plausible-looking wrong answer". A mis-ordered or short response
 * still contains 1024 valid floats per row, so nothing downstream — not the
 * INSERT, not a typecheck, not a retrieval — can tell that an embedding
 * landed on the wrong entity. The only symptom is worse recall, forever.
 * That is why the response parser is strict and why it is tested harder than
 * the happy path.
 */
import { describe, expect, it, vi } from "vitest";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EmbeddingError,
  VoyageClient,
  toVectorLiteral,
} from "./voyage.js";

/** A deterministic 1024-float vector, distinguishable by its seed. */
function vector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (seed + i) / 10_000);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientWith(fetchImpl: typeof fetch, timeoutMs?: number): VoyageClient {
  return new VoyageClient({
    apiKey: "test-key-never-sent-anywhere",
    fetchImpl,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

describe("VoyageClient — the request", () => {
  it("sends input_type 'document' when storing and 'query' when searching", async () => {
    // THE CENTRAL TEST OF THIS FILE.
    //
    // Voyage prepends a different instruction per input_type. Using one for
    // both is a silent recall regression: the response is still 1024 valid
    // floats, so nothing fails. This asserts the two paths actually differ.
    const seen: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      return jsonResponse({
        data: [{ embedding: vector(1), index: 0 }],
        usage: { total_tokens: 5 },
      });
    }) as unknown as typeof fetch;

    const client = clientWith(fetchImpl);
    await client.embedDocuments(["the article"]);
    await client.embedQuery("the article");

    expect((seen[0] as { input_type: string }).input_type).toBe("document");
    expect((seen[1] as { input_type: string }).input_type).toBe("query");
    // Same text, different request. If these ever match, the asymmetry is gone.
    expect(seen[0]).not.toEqual(seen[1]);
  });

  it("sends the pinned model and the texts verbatim", async () => {
    let body: { model?: string; input?: string[] } = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse({
        data: [
          { embedding: vector(1), index: 0 },
          { embedding: vector(2), index: 1 },
        ],
      });
    }) as unknown as typeof fetch;

    await clientWith(fetchImpl).embedDocuments(["one", "two"]);
    expect(body.model).toBe(EMBEDDING_MODEL);
    expect(body.input).toEqual(["one", "two"]);
  });

  it("batches: two texts are ONE request, not two", async () => {
    // Cost is a design constraint (.claude/rules/ai-systems.md). A multi-intent
    // turn creating two commitments must not double the embedding spend.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [
          { embedding: vector(1), index: 0 },
          { embedding: vector(2), index: 1 },
        ],
      }),
    ) as unknown as typeof fetch;

    await clientWith(fetchImpl).embedDocuments(["one", "two"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("makes NO request for an empty batch", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await clientWith(fetchImpl).embedDocuments([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.embeddings).toEqual([]);
  });

  it("refuses a batch over the documented 1000-input limit before spending a call", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      clientWith(fetchImpl).embedDocuments(Array.from({ length: 1001 }, () => "x")),
    ).rejects.toThrow(/at most 1000/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires an API key at construction, not at first call", () => {
    expect(() => new VoyageClient({ apiKey: "" })).toThrow(EmbeddingError);
  });
});

describe("VoyageClient — the response is untrusted input", () => {
  it("places embeddings by the returned index, not arrival order", async () => {
    // THE SILENT-CORRUPTION TEST. If the parser assumed arrival order, a
    // response that comes back [index 1, index 0] would attach each embedding
    // to the WRONG text. Both vectors are valid; nothing downstream could
    // detect it. Only retrieval quality would suffer, invisibly.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [
          { embedding: vector(999), index: 1 },
          { embedding: vector(111), index: 0 },
        ],
      }),
    ) as unknown as typeof fetch;

    const result = await clientWith(fetchImpl).embedDocuments(["first", "second"]);
    expect(result.embeddings[0]![0]).toBeCloseTo(111 / 10_000);
    expect(result.embeddings[1]![0]).toBeCloseTo(999 / 10_000);
  });

  it("rejects a response with fewer embeddings than inputs", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ embedding: vector(1), index: 0 }] }),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).embedDocuments(["a", "b"])).rejects.toThrow(
      /returned 1 embeddings for 2 inputs/,
    );
  });

  it("rejects a wrong dimension, naming the schema's expectation", async () => {
    // Without this the failure surfaces as a Postgres INSERT error naming
    // neither the model nor the call site — a 1536-dim model swapped in by
    // config would be a confusing production incident instead of a clear one.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ embedding: new Array(1536).fill(0.1), index: 0 }] }),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).embedDocuments(["a"])).rejects.toThrow(
      /1536 dimensions; the schema declares vector\(1024\)/,
    );
  });

  it("rejects duplicate and out-of-range indices", async () => {
    const dup = vi.fn(async () =>
      jsonResponse({
        data: [
          { embedding: vector(1), index: 0 },
          { embedding: vector(2), index: 0 },
        ],
      }),
    ) as unknown as typeof fetch;
    await expect(clientWith(dup).embedDocuments(["a", "b"])).rejects.toThrow(/duplicate index/);

    const oor = vi.fn(async () =>
      jsonResponse({ data: [{ embedding: vector(1), index: 7 }] }),
    ) as unknown as typeof fetch;
    await expect(clientWith(oor).embedDocuments(["a"])).rejects.toThrow(/out-of-range index/);
  });

  it("rejects a non-numeric embedding and a missing data array", async () => {
    const bad = vi.fn(async () =>
      jsonResponse({ data: [{ embedding: ["not", "numbers"], index: 0 }] }),
    ) as unknown as typeof fetch;
    await expect(clientWith(bad).embedDocuments(["a"])).rejects.toThrow(/not numeric/);

    const none = vi.fn(async () =>
      jsonResponse({ usage: { total_tokens: 1 } }),
    ) as unknown as typeof fetch;
    await expect(clientWith(none).embedDocuments(["a"])).rejects.toThrow(/no `data` array/);
  });
});

describe("VoyageClient — failure taxonomy", () => {
  it("distinguishes rate limiting from other HTTP errors", async () => {
    // A caller may sensibly back off on 429 and must not on a 400. That is
    // only possible if the reason is a value, not prose — the same argument
    // Phase 2 made for ExtractionError.
    const rate = vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(clientWith(rate).embedDocuments(["a"])).rejects.toMatchObject({
      reason: "rate_limited",
      status: 429,
    });

    const server = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(clientWith(server).embedDocuments(["a"])).rejects.toMatchObject({
      reason: "http_error",
      status: 500,
    });
  });

  it("NEVER retries — one call attempt per invocation, even on 429", async () => {
    // .claude/rules/wat.md §3: a retry loop on a paid endpoint is the most
    // expensive failure mode available to an agent. Retry policy belongs to
    // the caller, which knows whether the work is worth repeating.
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).embedDocuments(["a"])).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a timeout as a timeout, not a generic failure", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    }) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl, 50).embedDocuments(["a"])).rejects.toMatchObject({
      reason: "timeout",
    });
  });

  it("reports a non-JSON body as bad_response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<html>gateway</html>", { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).embedDocuments(["a"])).rejects.toMatchObject({
      reason: "bad_response",
    });
  });
});

describe("toVectorLiteral", () => {
  it("produces pgvector's bracket syntax", () => {
    expect(toVectorLiteral([1, 2.5, -3])).toBe("[1,2.5,-3]");
  });

  it("round-trips a full-width vector", () => {
    const literal = toVectorLiteral(vector(1));
    expect(literal.startsWith("[")).toBe(true);
    expect(literal.endsWith("]")).toBe(true);
    expect((JSON.parse(literal) as number[]).length).toBe(EMBEDDING_DIMENSIONS);
  });
});

describe("the dimension constant", () => {
  it("matches what the migrations declare", () => {
    // EMBEDDING_DIMENSIONS and `vector(N)` in migration 003 are two
    // declarations of one fact. A mismatch is a runtime INSERT error, not a
    // typecheck failure, so it is pinned here. If this ever changes, both the
    // constant and every existing vector column must change together.
    expect(EMBEDDING_DIMENSIONS).toBe(1024);
  });
});
