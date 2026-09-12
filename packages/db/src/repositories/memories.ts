/**
 * memories — semantic memory and hybrid retrieval (docs/PHASE-4-DESIGN.md §2, §3).
 *
 * Two things live here that are easy to get subtly wrong, so both are stated
 * before any code:
 *
 * 1. `hnsw.iterative_scan` MUST be set on any filtered vector query. pgvector
 *    applies filters AFTER the index scan, so at the default `ef_search` of 40
 *    a filter matching 10% of rows returns FOUR ROWS ON AVERAGE — successfully,
 *    with no error, and indistinguishable from "there is nothing here". Every
 *    query in this product is filtered. `searchSemantic` sets it; nothing else
 *    should issue a raw vector query without doing the same.
 *
 * 2. Retrieval is HYBRID, fused by Reciprocal Rank Fusion, because cosine
 *    distance and `ts_rank_cd` are on incomparable scales. See `searchHybrid`.
 */
import type { Queryable } from "../client.js";

export type MemoryKind = "fact" | "preference" | "pattern";

/**
 * Mirrors the `inference_level` Postgres enum (migration 001), declared here
 * rather than imported from `@ourglass/shared` — the same convention as
 * `CommitmentStatus`. These string unions describe what the DATABASE stores;
 * the shared package's identically-named type describes what the model emits.
 * They agree today and are allowed to diverge, which is why neither imports
 * the other.
 */
export type InferenceLevel = "CONFIRMED" | "INFERRED" | "UNCERTAIN";

/** Mirrors migration 010's CHECK. Polymorphic, so no FK is possible. */
export type MemorySubjectKind = "person" | "organization" | "project";

export interface Memory {
  id: string;
  kind: MemoryKind;
  /** Raw content field (§3) — stored verbatim, never resolved. */
  body: string;
  /**
   * NULL until embedded, and NULL is a supported steady state (§2.2): a memory
   * with no embedding is invisible to semantic search and fully visible to
   * structured queries. `pg` returns pgvector columns as a string.
   */
  embedding: string | null;
  /** §16 provenance — WHICH message asserted this. */
  source_message_id: string | null;
  inference_level: InferenceLevel;
  subject_kind: MemorySubjectKind | null;
  subject_id: string | null;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

export interface CreateMemoryInput {
  id?: string | null;
  kind: MemoryKind;
  body: string;
  inferenceLevel: InferenceLevel;
  sourceMessageId?: string | null;
  subjectKind?: MemorySubjectKind | null;
  subjectId?: string | null;
  /**
   * Optional at creation ON PURPOSE. The write path must not require a network
   * hop to a third party (§2.2) — Voyage being down must not stop the user
   * recording something. `setEmbedding` fills it in afterwards.
   */
  embedding?: readonly number[] | null;
}

function vectorLiteral(embedding: readonly number[] | null | undefined): string | null {
  // pgvector's text input is `[1,2,3]`, which is exactly JSON array syntax.
  return embedding === null || embedding === undefined ? null : JSON.stringify(embedding);
}

export async function createMemory(tx: Queryable, input: CreateMemoryInput): Promise<Memory> {
  const { rows } = await tx.query<Memory>(
    `INSERT INTO memories
       (id, kind, body, embedding, source_message_id, inference_level, subject_kind, subject_id)
     VALUES (COALESCE($8::uuid, gen_random_uuid()), $1::memory_kind, $2, $3::vector,
             $4::uuid, $5::inference_level, $6, $7::uuid)
     RETURNING *`,
    [
      input.kind,
      input.body,
      vectorLiteral(input.embedding),
      input.sourceMessageId ?? null,
      input.inferenceLevel,
      input.subjectKind ?? null,
      input.subjectId ?? null,
      input.id ?? null,
    ],
  );
  return rows[0]!;
}

export async function getById(tx: Queryable, id: string): Promise<Memory | null> {
  const { rows } = await tx.query<Memory>(`SELECT * FROM memories WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Attach an embedding after the row exists — the second half of §2.2's
 * write-then-embed ordering, and the backfill path for rows written while the
 * provider was unavailable.
 *
 * Returns the previous value so a caller can log an exact inverse, using the
 * same `FROM (SELECT ...) AS old` self-join as `completeCommitment`:
 * `RETURNING *` on an UPDATE is post-update state (Phase 1 build finding #4).
 */
export async function setEmbedding(
  tx: Queryable,
  id: string,
  embedding: readonly number[] | null,
): Promise<{ memory: Memory; previousEmbedding: string | null }> {
  const { rows } = await tx.query<Memory & { prev_embedding: string | null }>(
    `UPDATE memories AS m
        SET embedding = $2::vector
       FROM (SELECT id, embedding FROM memories WHERE id = $1) AS old
      WHERE m.id = old.id
      RETURNING m.*, old.embedding AS prev_embedding`,
    [id, vectorLiteral(embedding)],
  );
  const row = rows[0];
  if (!row) throw new Error(`no memory with id ${id}`);
  const { prev_embedding, ...memory } = row;
  return { memory: memory as Memory, previousEmbedding: prev_embedding };
}

/** Rows still awaiting an embedding — the backfill query (§2.2). */
export async function listUnembedded(tx: Queryable, limit = 100): Promise<Memory[]> {
  const { rows } = await tx.query<Memory>(
    `SELECT * FROM memories_current WHERE embedding IS NULL ORDER BY t_created LIMIT $1`,
    [limit],
  );
  return rows;
}

/**
 * Everything known about one subject — §28's "What do you know about Arun?".
 *
 * AN INDEXED LOOKUP, NOT A SIMILARITY SEARCH, and that is the phase's most
 * important scoping decision (§5). A vector search can MISS a row that this
 * `WHERE` returns, and for an inspection query a miss is a fact silently
 * vanishing from the surface the user relies on to catch mistakes.
 */
export async function listBySubject(
  tx: Queryable,
  subjectKind: MemorySubjectKind,
  subjectId: string,
): Promise<Memory[]> {
  const { rows } = await tx.query<Memory>(
    `SELECT * FROM memories_current
      WHERE subject_kind = $1 AND subject_id = $2
      ORDER BY t_created DESC`,
    [subjectKind, subjectId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export interface SearchFilter {
  readonly subjectKind?: MemorySubjectKind | null;
  readonly subjectId?: string | null;
  readonly kind?: MemoryKind | null;
}

export interface ScoredMemory {
  readonly memory: Memory;
  /** Fused RRF score. Comparable only within one result set. */
  readonly score: number;
  /** Which halves retrieved it — useful in tests and for explaining a result. */
  readonly matchedSemantic: boolean;
  readonly matchedLexical: boolean;
}

interface RankedRow extends Memory {
  rank: string;
}

function whereClause(filter: SearchFilter, from: number): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let n = from;
  if (filter.subjectKind) {
    clauses.push(`subject_kind = $${n++}`);
    params.push(filter.subjectKind);
  }
  if (filter.subjectId) {
    clauses.push(`subject_id = $${n++}::uuid`);
    params.push(filter.subjectId);
  }
  if (filter.kind) {
    clauses.push(`kind = $${n++}::memory_kind`);
    params.push(filter.kind);
  }
  return { sql: clauses.length ? `AND ${clauses.join(" AND ")}` : "", params };
}

/**
 * Semantic half. MUST RUN INSIDE A TRANSACTION — `SET LOCAL` requires one.
 *
 * ⚠ THE `SET LOCAL` BELOW IS LOAD-BEARING, NOT TUNING. Without it, pgvector
 * filters AFTER scanning the index, so a filter matching 10% of rows returns
 * ~4 of the requested 40. The query still succeeds; it just quietly returns
 * almost nothing. `LOCAL` scopes it to this transaction rather than leaking to
 * every other query on a pooled connection.
 */
export async function searchSemantic(
  tx: Queryable,
  queryEmbedding: readonly number[],
  filter: SearchFilter = {},
  limit = 20,
): Promise<Memory[]> {
  await tx.query(`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`);
  const { sql, params } = whereClause(filter, 3);
  const { rows } = await tx.query<Memory>(
    `SELECT * FROM memories_current
      WHERE embedding IS NOT NULL ${sql}
      ORDER BY embedding <=> $1::vector
      LIMIT $2`,
    [vectorLiteral(queryEmbedding), limit, ...params],
  );
  return rows;
}

/** Lexical half — Postgres full-text over the generated `body_tsv` column. */
export async function searchLexical(
  tx: Queryable,
  queryText: string,
  filter: SearchFilter = {},
  limit = 20,
): Promise<Memory[]> {
  const { sql, params } = whereClause(filter, 3);
  const { rows } = await tx.query<RankedRow>(
    // websearch_to_tsquery, not plainto_tsquery: it tolerates the quotes and
    // OR/-negation a person actually types, and never throws on punctuation —
    // to_tsquery would raise a syntax error on an apostrophe.
    `SELECT *, ts_rank_cd(body_tsv, websearch_to_tsquery('english', $1)) AS rank
       FROM memories_current
      WHERE body_tsv @@ websearch_to_tsquery('english', $1) ${sql}
      ORDER BY rank DESC
      LIMIT $2`,
    [queryText, limit, ...params],
  );
  return rows;
}

/** RRF's smoothing constant. The original paper's value; a tunable, not physics. */
export const RRF_K = 60;

/**
 * Hybrid retrieval, fused by Reciprocal Rank Fusion (§3.1).
 *
 *     score(d) = Σ 1 / (k + rank_i(d))
 *
 * WHY RRF AND NOT A WEIGHTED SUM OF THE TWO SCORES: cosine distance is bounded
 * [0,2] and `ts_rank_cd` is unbounded and corpus-dependent, so adding them
 * needs a normalisation constant that is really a tuning parameter nobody will
 * re-tune — and whose correct value drifts as the corpus grows. RRF consumes
 * only RANKS, so it is scale-free by construction and has nothing to drift.
 *
 * A memory found by BOTH halves outranks one found by either alone, which is
 * the property that makes hybrid worth the second query: embeddings are weak
 * on rare proper nouns ("Karthik from Hult") and lexical search is weak on
 * paraphrase. Each covers the other's blind spot.
 *
 * `queryEmbedding` may be null — when the provider is unavailable, this
 * degrades to lexical-only rather than failing. Honest degradation, and the
 * caller can see which halves fired via `matchedSemantic`/`matchedLexical`.
 */
export async function searchHybrid(
  tx: Queryable,
  queryText: string,
  queryEmbedding: readonly number[] | null,
  filter: SearchFilter = {},
  limit = 20,
): Promise<ScoredMemory[]> {
  // Over-fetch each half: fusion only reorders what it is given, so a document
  // ranked 25th semantically and 1st lexically must be present to win.
  const poolSize = Math.max(limit * 3, 30);

  // Sequential, not Promise.all: both halves share one transaction, and `pg`
  // does not multiplex concurrent queries on a single connection.
  const semantic = queryEmbedding
    ? await searchSemantic(tx, queryEmbedding, filter, poolSize)
    : [];
  const lexical = await searchLexical(tx, queryText, filter, poolSize);

  const scores = new Map<string, ScoredMemory>();

  const fuse = (rows: readonly Memory[], half: "semantic" | "lexical"): void => {
    rows.forEach((memory, index) => {
      const contribution = 1 / (RRF_K + index + 1); // rank is 1-based
      const existing = scores.get(memory.id);
      if (existing) {
        scores.set(memory.id, {
          ...existing,
          score: existing.score + contribution,
          matchedSemantic: existing.matchedSemantic || half === "semantic",
          matchedLexical: existing.matchedLexical || half === "lexical",
        });
      } else {
        scores.set(memory.id, {
          memory,
          score: contribution,
          matchedSemantic: half === "semantic",
          matchedLexical: half === "lexical",
        });
      }
    });
  };

  fuse(semantic, "semantic");
  fuse(lexical, "lexical");

  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id))
    .slice(0, limit);
}

/**
 * INVALIDATE, NEVER DELETE — §28's "Forget that Arun works on backend".
 *
 * "Forget" is a statement about what is CURRENTLY TRUE, not a demand to
 * destroy the audit trail. The row leaves `memories_current` and `action_log`
 * can undo it. Idempotent on an already-invalid row, for the same reason as
 * every other invalidate here: `t_invalid` records when the fact stopped being
 * true, so re-invalidating must not move it.
 */
export async function invalidateMemory(tx: Queryable, id: string, at?: Date): Promise<void> {
  await tx.query(
    `UPDATE memories SET t_invalid = COALESCE($2::timestamptz, t_invalid, now()) WHERE id = $1`,
    [id, at ?? null],
  );
}

/** The inverse of forgetting. Takes the prior value with NO DEFAULT. */
export async function revalidateMemory(
  tx: Queryable,
  id: string,
  previousInvalidAt: Date | null,
): Promise<void> {
  await tx.query(`UPDATE memories SET t_invalid = $2::timestamptz WHERE id = $1`, [
    id,
    previousInvalidAt,
  ]);
}
