/**
 * The embedding backfill against a real database — PHASE-4-DESIGN §2.2.
 *
 * The embedder is FAKED (no Voyage call, no cost); Postgres, pgvector and the
 * repository are real. What is under test is the write-then-embed contract:
 * NULL rows get filled, a provider failure writes nothing and says why, and a
 * filled row becomes reachable by semantic search — which, before this job
 * existed, no memory ever was.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, memories, truncateAll, withTransaction } from "@ourglass/db";
import { backfillMemoryEmbeddings, type BackfillDeps, type DocumentEmbedder } from "./backfill.js";
import { EMBEDDING_DIMENSIONS, EmbeddingError, type EmbeddingResult } from "./voyage.js";

const DATABASE_URL = process.env["DATABASE_URL"];

if (!DATABASE_URL && process.env["CI"]) {
  throw new Error(
    "DATABASE_URL is unset in CI — the embedding backfill suite would otherwise " +
      "silently skip instead of running.",
  );
}

const suite = DATABASE_URL ? describe : describe.skip;

/** A unit vector along axis `k`: distinct per memory, trivially nearest to itself. */
function unit(k: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === k ? 1 : 0));
}

function result(embeddings: number[][]): EmbeddingResult {
  return {
    embeddings,
    trace: { model: "fake", latencyMs: 0, inputCount: embeddings.length, totalTokens: null },
  };
}

suite("memory embedding backfill (integration)", () => {
  let pool: pg.Pool;
  let db: BackfillDeps["db"];

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
    db = { withTransaction: (fn) => withTransaction(pool, fn) };
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  async function remember(body: string) {
    return withTransaction(pool, (tx) =>
      memories.createMemory(tx, { kind: "fact", body, inferenceLevel: "CONFIRMED" }),
    );
  }

  it("fills every NULL embedding, and the rows become semantically searchable", async () => {
    const arun = await remember("Arun handles the backend");
    await remember("Barkha prefers WhatsApp over email");

    const seen: string[][] = [];
    const embedder: DocumentEmbedder = {
      async embedDocuments(texts) {
        seen.push([...texts]);
        return result(texts.map((_, index) => unit(index)));
      },
    };

    const outcome = await backfillMemoryEmbeddings({ db, embedder });

    expect(outcome).toEqual({ embedded: 2, failure: null });
    // ONE request for the batch, oldest first — not one per row.
    expect(seen).toEqual([["Arun handles the backend", "Barkha prefers WhatsApp over email"]]);
    expect(await withTransaction(pool, (tx) => memories.listUnembedded(tx))).toEqual([]);

    // The point of the job: a query near Arun's vector now finds Arun's memory.
    const found = await withTransaction(pool, (tx) => memories.searchSemantic(tx, unit(0), {}, 1));
    expect(found.map((memory) => memory.id)).toEqual([arun.id]);
  });

  it("makes no request at all when nothing is waiting", async () => {
    let calls = 0;
    const embedder: DocumentEmbedder = {
      async embedDocuments() {
        calls += 1;
        return result([]);
      },
    };

    expect(await backfillMemoryEmbeddings({ db, embedder })).toEqual({ embedded: 0, failure: null });
    expect(calls).toBe(0);
  });

  it("on a provider failure writes NOTHING, reports why, and leaves the rows for next pass", async () => {
    await remember("Arun handles the backend");
    const embedder: DocumentEmbedder = {
      async embedDocuments() {
        throw new EmbeddingError("rate_limited", "slow down", 429);
      },
    };

    const outcome = await backfillMemoryEmbeddings({ db, embedder });

    expect(outcome).toEqual({ embedded: 0, failure: "rate_limited" });
    // Still NULL: degraded, not lost, and retried on the next tick.
    expect(await withTransaction(pool, (tx) => memories.listUnembedded(tx))).toHaveLength(1);
  });

  it("drains a backlog over passes, bounded per pass", async () => {
    await remember("one");
    await remember("two");
    await remember("three");
    const embedder: DocumentEmbedder = {
      async embedDocuments(texts) {
        return result(texts.map((_, index) => unit(index)));
      },
    };

    expect((await backfillMemoryEmbeddings({ db, embedder, batchSize: 2 })).embedded).toBe(2);
    expect((await backfillMemoryEmbeddings({ db, embedder, batchSize: 2 })).embedded).toBe(1);
    expect((await backfillMemoryEmbeddings({ db, embedder, batchSize: 2 })).embedded).toBe(0);
  });

  it("never embeds an invalidated memory", async () => {
    const forgotten = await remember("Arun works on backend");
    await withTransaction(pool, (tx) => memories.invalidateMemory(tx, forgotten.id));
    const embedder: DocumentEmbedder = {
      async embedDocuments(texts) {
        return result(texts.map((_, index) => unit(index)));
      },
    };

    // Reads memories_current: a forgotten fact is not worth paying to embed.
    expect(await backfillMemoryEmbeddings({ db, embedder })).toEqual({ embedded: 0, failure: null });
  });
});
