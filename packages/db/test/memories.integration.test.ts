/**
 * `memories` and hybrid retrieval — docs/PHASE-4-DESIGN.md §2 and §3, against
 * a real Postgres 17 + pgvector with migrations applied.
 *
 * ================================ READ THIS ================================
 * THE CENTRAL TEST OF THIS FILE IS THE FILTERED-RECALL ONE, and it needs ~200
 * rows to mean anything.
 *
 * pgvector applies a WHERE filter AFTER scanning the HNSW index. At the
 * default `ef_search` of 40, a filter matching ~10% of rows therefore returns
 * about FOUR of them — successfully, with no error, and indistinguishable from
 * "there is genuinely nothing here". Every retrieval in this product is
 * filtered, so the default configuration silently breaks semantic search.
 *
 * A three-row fixture CANNOT catch that: with so few rows the index scan
 * returns everything regardless, so the test passes with `iterative_scan`
 * removed and proves nothing. That is why this file seeds 200.
 *
 * Embeddings here are SYNTHETIC, not from Voyage: deterministic unit vectors
 * whose cosine ordering is known by construction. That keeps the suite free,
 * offline and exact — what is under test is the QUERY (the index, the filter,
 * the setting, the fusion), never the embedding model's judgement.
 * ===========================================================================
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, memories, truncateAll, withTransaction } from "../src/index.js";

const DATABASE_URL = process.env["DATABASE_URL"];

// A skipped suite and a passing suite look identical in a CI summary line, and
// this file holds the ONLY test of the iterative_scan requirement.
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error(
    "DATABASE_URL is unset in CI — the memories/retrieval suite would otherwise " +
      "silently skip instead of running.",
  );
}

const suite = DATABASE_URL ? describe : describe.skip;

const DIMENSIONS = 1024;

/**
 * A unit vector pointing mostly along axis `axis`, with a small deterministic
 * tail so no two are identical. Cosine distance between two such vectors grows
 * with |axis difference|, which makes the expected ordering knowable without
 * calling a model.
 */
function syntheticVector(axis: number): number[] {
  const v = new Array<number>(DIMENSIONS).fill(0);
  v[axis % DIMENSIONS] = 1;
  v[(axis + 1) % DIMENSIONS] = 0.1;
  return v;
}

suite("memories (integration)", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  // -------------------------------------------------------------------------
  // §2 — the table, provenance, and the nullable embedding
  // -------------------------------------------------------------------------

  it("stores a fact with §16 provenance and an inference level", async () => {
    const memory = await withTransaction(pool, (tx) =>
      memories.createMemory(tx, {
        kind: "fact",
        body: "Arun handles Batore backend",
        inferenceLevel: "CONFIRMED",
      }),
    );
    expect(memory.kind).toBe("fact");
    expect(memory.inference_level).toBe("CONFIRMED");
    // Not embedded yet, and that is a supported state, not a half-written row.
    expect(memory.embedding).toBeNull();
  });

  it("accepts a memory with NO embedding — the write path must not need Voyage", async () => {
    // §2.2. If embedding were required, the provider being down would stop the
    // user recording anything: an availability failure in the core product
    // caused by an optional enhancement.
    const memory = await withTransaction(pool, (tx) =>
      memories.createMemory(tx, {
        kind: "preference",
        body: "I prefer morning meetings",
        inferenceLevel: "CONFIRMED",
      }),
    );
    const pending = await withTransaction(pool, (tx) => memories.listUnembedded(tx));
    expect(pending.map((m) => m.id)).toContain(memory.id);
  });

  it("setEmbedding captures the PRE-update value", async () => {
    // The self-join pattern: `RETURNING *` on an UPDATE is post-update state,
    // which cannot supply an inverse (Phase 1 build finding #4).
    const memory = await withTransaction(pool, (tx) =>
      memories.createMemory(tx, {
        kind: "fact",
        body: "Karthik handles CRM",
        inferenceLevel: "CONFIRMED",
      }),
    );
    const result = await withTransaction(pool, (tx) =>
      memories.setEmbedding(tx, memory.id, syntheticVector(5)),
    );
    expect(result.previousEmbedding).toBeNull();
    expect(result.memory.embedding).not.toBeNull();

    // And it leaves the backfill queue.
    const pending = await withTransaction(pool, (tx) => memories.listUnembedded(tx));
    expect(pending.map((m) => m.id)).not.toContain(memory.id);
  });

  it("rejects a subject_id with no subject_kind", async () => {
    // Either alone is a row that LOOKS targeted and is not: an id with no kind
    // cannot be resolved to a table, and a kind with no id names nothing.
    await expect(
      withTransaction(pool, (tx) =>
        tx.query(
          `INSERT INTO memories (kind, body, inference_level, subject_id)
           VALUES ('fact', 'orphan subject', 'CONFIRMED', gen_random_uuid())`,
        ),
      ),
    ).rejects.toThrow(/memories_subject_complete/);
  });

  it("invalidates rather than deletes, and revalidate restores", async () => {
    // §28's "Forget that Arun works on backend" is a statement about what is
    // CURRENTLY true, not a demand to destroy the audit trail.
    const memory = await withTransaction(pool, (tx) =>
      memories.createMemory(tx, {
        kind: "fact",
        body: "Arun works on backend",
        inferenceLevel: "CONFIRMED",
      }),
    );
    await withTransaction(pool, (tx) => memories.invalidateMemory(tx, memory.id));

    const current = await withTransaction(pool, (tx) =>
      tx.query(`SELECT 1 FROM memories_current WHERE id = $1`, [memory.id]),
    );
    expect(current.rows).toHaveLength(0);

    // The row is still THERE — invalidated, not deleted.
    const raw = await withTransaction(pool, (tx) => memories.getById(tx, memory.id));
    expect(raw).not.toBeNull();

    await withTransaction(pool, (tx) => memories.revalidateMemory(tx, memory.id, null));
    const back = await withTransaction(pool, (tx) =>
      tx.query(`SELECT 1 FROM memories_current WHERE id = $1`, [memory.id]),
    );
    expect(back.rows).toHaveLength(1);
  });

  it("invalidate is idempotent — a second call does not move t_invalid", async () => {
    const memory = await withTransaction(pool, (tx) =>
      memories.createMemory(tx, { kind: "fact", body: "x", inferenceLevel: "CONFIRMED" }),
    );
    await withTransaction(pool, (tx) => memories.invalidateMemory(tx, memory.id));
    const first = await withTransaction(pool, (tx) => memories.getById(tx, memory.id));
    await withTransaction(pool, (tx) => memories.invalidateMemory(tx, memory.id));
    const second = await withTransaction(pool, (tx) => memories.getById(tx, memory.id));
    expect(second!.t_invalid!.toISOString()).toBe(first!.t_invalid!.toISOString());
  });

  // -------------------------------------------------------------------------
  // §3 — retrieval, and the setting the whole phase depends on
  // -------------------------------------------------------------------------

  describe("filtered semantic recall (the iterative_scan requirement)", () => {
    // 200 rows, of which 20 (10%) carry the subject we filter on — the exact
    // selectivity pgvector's README uses in its warning.
    const TOTAL = 200;
    const SUBJECT_ID = "11111111-1111-1111-1111-111111111111";

    beforeEach(async () => {
      await withTransaction(pool, async (tx) => {
        for (let i = 0; i < TOTAL; i += 1) {
          const isTarget = i % 10 === 0; // 20 of 200
          await memories.createMemory(tx, {
            kind: "fact",
            body: isTarget ? `Arun note number ${i}` : `unrelated note number ${i}`,
            inferenceLevel: "CONFIRMED",
            embedding: syntheticVector(i),
            ...(isTarget ? { subjectKind: "person" as const, subjectId: SUBJECT_ID } : {}),
          });
        }
      });
    });

    it("returns the FULL filtered set, not the ~4 rows the default would give", async () => {
      // ⚠ THE TEST THE PHASE TURNS ON.
      //
      // Without `SET LOCAL hnsw.iterative_scan`, pgvector scans the index for
      // ef_search (40) candidates and only THEN applies `subject_id = $1`.
      // With 10% selectivity that leaves ~4 rows — returned successfully, so
      // nothing anywhere reports a problem.
      //
      // Verified by mutation: removing the SET LOCAL from searchSemantic must
      // make this go red. If it does not, the fixture is too small and this
      // test is decorative.
      const found = await withTransaction(pool, (tx) =>
        memories.searchSemantic(
          tx,
          syntheticVector(0),
          { subjectKind: "person", subjectId: SUBJECT_ID },
          20,
        ),
      );

      expect(found).toHaveLength(20);
      expect(found.every((m) => m.subject_id === SUBJECT_ID)).toBe(true);
    });

    it("orders by cosine distance — nearest first", async () => {
      const found = await withTransaction(pool, (tx) =>
        memories.searchSemantic(tx, syntheticVector(0), {}, 5),
      );
      // syntheticVector(0) is its own nearest neighbour by construction.
      expect(found[0]!.body).toContain("number 0");
    });

    it("never returns rows with a NULL embedding", async () => {
      await withTransaction(pool, (tx) =>
        memories.createMemory(tx, {
          kind: "fact",
          body: "unembedded Arun note",
          inferenceLevel: "CONFIRMED",
          subjectKind: "person",
          subjectId: SUBJECT_ID,
        }),
      );
      const found = await withTransaction(pool, (tx) =>
        memories.searchSemantic(
          tx,
          syntheticVector(0),
          { subjectId: SUBJECT_ID, subjectKind: "person" },
          50,
        ),
      );
      expect(found.some((m) => m.body === "unembedded Arun note")).toBe(false);
      // Still 20 — the unembedded row is invisible HERE and visible to
      // structured queries. Degraded, not lost.
      expect(found).toHaveLength(20);
    });
  });

  describe("lexical and hybrid", () => {
    beforeEach(async () => {
      await withTransaction(pool, async (tx) => {
        await memories.createMemory(tx, {
          kind: "fact",
          body: "Karthik from Hult runs the CRM rollout",
          inferenceLevel: "CONFIRMED",
          embedding: syntheticVector(300),
        });
        await memories.createMemory(tx, {
          kind: "fact",
          body: "the customer database migration is owned by the platform team",
          inferenceLevel: "INFERRED",
          embedding: syntheticVector(301),
        });
        await memories.createMemory(tx, {
          kind: "preference",
          body: "I prefer morning meetings",
          inferenceLevel: "CONFIRMED",
          embedding: syntheticVector(900),
        });
      });
    });

    it("finds a rare proper noun lexically — the embedding blind spot", async () => {
      // Embeddings are notoriously weak on rare proper nouns; this is the case
      // that justifies paying for a second query.
      const found = await withTransaction(pool, (tx) => memories.searchLexical(tx, "Karthik Hult"));
      expect(found).toHaveLength(1);
      expect(found[0]!.body).toContain("Karthik");
    });

    it("tolerates punctuation a person would actually type", async () => {
      // websearch_to_tsquery, not to_tsquery: the latter raises a syntax error
      // on an apostrophe, turning a normal question into a 500.
      await expect(
        withTransaction(pool, (tx) => memories.searchLexical(tx, "what's Karthik's role?")),
      ).resolves.toBeDefined();
    });

    it("ranks a memory found by BOTH halves above one found by either alone", async () => {
      // The property that makes hybrid worth its cost. RRF sums reciprocal
      // ranks, so two contributions beat one regardless of the two halves'
      // incomparable native scores.
      const results = await withTransaction(pool, (tx) =>
        memories.searchHybrid(tx, "Karthik Hult CRM", syntheticVector(300), {}, 10),
      );
      expect(results.length).toBeGreaterThan(0);
      const top = results[0]!;
      expect(top.matchedSemantic && top.matchedLexical).toBe(true);
      expect(top.memory.body).toContain("Karthik");
    });

    it("degrades to lexical-only when there is no query embedding", async () => {
      // Voyage unavailable. The search still works; it just loses paraphrase
      // matching, and the caller can SEE that via matchedSemantic.
      const results = await withTransaction(pool, (tx) =>
        memories.searchHybrid(tx, "Karthik Hult", null, {}, 10),
      );
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.matchedSemantic === false)).toBe(true);
    });

    it("applies the filter to BOTH halves", async () => {
      const results = await withTransaction(pool, (tx) =>
        memories.searchHybrid(tx, "morning meetings Karthik", syntheticVector(900), {
          kind: "preference",
        }),
      );
      expect(results.every((r) => r.memory.kind === "preference")).toBe(true);
    });

    it("excludes invalidated memories from every retrieval path", async () => {
      const all = await withTransaction(pool, (tx) => memories.searchLexical(tx, "Karthik"));
      await withTransaction(pool, (tx) => memories.invalidateMemory(tx, all[0]!.id));

      const lexical = await withTransaction(pool, (tx) => memories.searchLexical(tx, "Karthik"));
      const hybrid = await withTransaction(pool, (tx) =>
        memories.searchHybrid(tx, "Karthik", syntheticVector(300), {}, 10),
      );
      expect(lexical).toHaveLength(0);
      expect(hybrid.some((r) => r.memory.id === all[0]!.id)).toBe(false);
    });
  });

  describe("subject lookup (§28)", () => {
    it("returns everything known about one subject", async () => {
      // An INDEXED LOOKUP, not a similarity search (§5). A vector search can
      // miss a row this returns, and for an inspection query a miss is a fact
      // silently vanishing from the surface the user uses to catch mistakes.
      const subjectId = "22222222-2222-2222-2222-222222222222";
      await withTransaction(pool, async (tx) => {
        await memories.createMemory(tx, {
          kind: "fact",
          body: "Arun handles backend",
          inferenceLevel: "CONFIRMED",
          subjectKind: "person",
          subjectId,
        });
        await memories.createMemory(tx, {
          kind: "fact",
          body: "Arun is on the Batore team",
          inferenceLevel: "INFERRED",
          subjectKind: "person",
          subjectId,
        });
        await memories.createMemory(tx, {
          kind: "fact",
          body: "unrelated to Arun",
          inferenceLevel: "CONFIRMED",
        });
      });

      const found = await withTransaction(pool, (tx) =>
        memories.listBySubject(tx, "person", subjectId),
      );
      expect(found).toHaveLength(2);
      expect(found.every((m) => m.subject_id === subjectId)).toBe(true);
    });
  });
});
