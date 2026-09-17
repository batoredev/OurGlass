/**
 * The embedding backfill — the second half of write-then-embed
 * (docs/PHASE-4-DESIGN.md §2.2).
 *
 * ================================ READ THIS ================================
 * `remember` stores a memory with a NULL embedding ON PURPOSE. Embedding is a
 * network hop to a third party, and requiring it on the write path would let
 * a slow Voyage block the user from recording anything. A NULL-embedding
 * memory is invisible to semantic search and fully visible to everything
 * else: degraded, not lost.
 *
 * Until this file existed, NOTHING EVER FILLED THE NULL. `listUnembedded` and
 * `setEmbedding` were written, documented as "the backfill path", and never
 * called — so semantic recall had no data to recall from.
 *
 * THE ONE RULE: NO TRANSACTION IS OPEN DURING THE HTTP CALL.
 *
 *     read batch    (short transaction, closed)
 *     embed         (network, no transaction)
 *     write vectors (short transaction)
 *
 * Holding a transaction across an external call is the classic way to exhaust
 * a connection pool when a vendor slows down (§2.2, "Rejected").
 * ===========================================================================
 */
import { memories } from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";
import { EmbeddingError, type EmbeddingFailureReason, type EmbeddingResult } from "./voyage.js";

/** Storage-side embedding. `VoyageClient` satisfies it; tests inject a fake. */
export interface DocumentEmbedder {
  embedDocuments(texts: readonly string[]): Promise<EmbeddingResult>;
}

/** Search-side embedding — a DIFFERENT input type (see voyage.ts header). */
export interface QueryEmbedder {
  embedQuery(text: string): Promise<EmbeddingResult>;
}

export interface BackfillDeps {
  readonly db: {
    withTransaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
  };
  readonly embedder: DocumentEmbedder;
  /** Rows per pass. Bounded so one pass is one request and a backlog drains over ticks. */
  readonly batchSize?: number;
}

export interface BackfillResult {
  /** Memories that received an embedding this pass. */
  readonly embedded: number;
  /** Why the provider call failed, or null. A failure writes nothing and retries next pass. */
  readonly failure: EmbeddingFailureReason | null;
}

const DEFAULT_BATCH_SIZE = 50;

/**
 * One pass. Never throws on a PROVIDER failure — the next tick retries, and the
 * rows stay NULL, which is exactly the degraded-but-correct state they were
 * already in. A database error still throws: that is not the vendor's fault,
 * and swallowing it would hide a broken deployment.
 */
export async function backfillMemoryEmbeddings(deps: BackfillDeps): Promise<BackfillResult> {
  const batch = await deps.db.withTransaction((tx) =>
    memories.listUnembedded(tx, deps.batchSize ?? DEFAULT_BATCH_SIZE),
  );
  if (batch.length === 0) return { embedded: 0, failure: null };

  let result: EmbeddingResult;
  try {
    // `embedDocuments`, never `embedQuery`: these are stored for retrieval,
    // and the two input types prepend different instructions.
    result = await deps.embedder.embedDocuments(batch.map((memory) => memory.body));
  } catch (error: unknown) {
    if (error instanceof EmbeddingError) return { embedded: 0, failure: error.reason };
    throw error;
  }

  // The client already rejects a count mismatch (`bad_response`); this write
  // relies on that, rather than re-declaring the check here.
  await deps.db.withTransaction(async (tx) => {
    for (const [index, memory] of batch.entries()) {
      await memories.setEmbedding(tx, memory.id, result.embeddings[index]!);
    }
  });

  return { embedded: batch.length, failure: null };
}
