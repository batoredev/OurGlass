-- 010 — semantic memory (docs/PHASE-4-DESIGN.md §2), resolving finding F10.
--
-- `memories` was deliberately cut from Phase 1 (migration 003's own comment:
-- "This is not the `memories` table, which stays cut until Phase 4"). This is
-- Phase 4; it lands now, together with BOTH halves of hybrid retrieval — the
-- HNSW vector index and the GIN lexical index — because a retrieval layer with
-- one half is not a smaller version of the design, it is a different one.
--
-- Forward-only; `pnpm db:reset` is the rollback model.

-- ---------------------------------------------------------------------------
-- memory_kind — a CLOSED enum, and `pattern` is the load-bearing value
-- ---------------------------------------------------------------------------
-- Spec §13 is explicit: "avoid amateur psychological profiling. Do not make
-- unsupported claims like 'You procrastinate because you fear failure.'
-- Instead use observable facts: 'You've postponed this three times.'"
--
-- A `pattern` memory must therefore be COUNTABLE FROM ROWS. There is
-- deliberately no `trait`, `insight`, or `observation` value: the closed enum
-- is what enforces §13, because a kind that cannot be derived from rows cannot
-- be stored at all. Adding one later is a spec decision, not a schema tweak.
CREATE TYPE memory_kind AS ENUM (
  'fact',        -- "Arun handles Batore backend"
  'preference',  -- "I prefer morning meetings"
  'pattern'      -- "You've postponed this three times" — OBSERVED, never inferred motive
);

CREATE TABLE memories (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              memory_kind NOT NULL,
  -- A RAW CONTENT FIELD (spec §3): stored verbatim, never resolved into entity
  -- references. "She had a family emergency" keeps "she". Resolving it would
  -- mean guessing, and a wrong guess silently rewrites what the user said.
  body              text NOT NULL,

  -- NULLABLE ON PURPOSE, and this is a design decision rather than laziness
  -- (§2.2). Embedding is a network hop to a third party. If it were required,
  -- Voyage being down would stop the user recording anything — an availability
  -- failure in the core product caused by an optional enhancement. A memory
  -- with a NULL embedding is invisible to semantic search and fully visible to
  -- structured queries: degraded, not lost. `WHERE embedding IS NULL` is
  -- exactly the backfill query.
  --
  -- vector(1024) matches EMBEDDING_DIMENSIONS in apps/api/src/embeddings/
  -- voyage.ts and the `object_embedding` column migration 003 already declares.
  -- Those are three declarations of ONE fact; a mismatch is a runtime INSERT
  -- error, not a typecheck failure.
  embedding         vector(1024),

  -- Provenance (§16). The spec's own example — "Fact: Arun handles Batore
  -- backend. Source: Conversation from September 7 2026. Confidence:
  -- Confirmed." — has every one of its parts as a column here, which is what
  -- makes §17 correction auditable rather than merely possible.
  source_message_id uuid REFERENCES messages(id),
  inference_level   inference_level NOT NULL,

  -- Optional subject, so "what do you know about Arun?" (§28) is an INDEXED
  -- LOOKUP rather than a similarity search over everything. See §5: a vector
  -- search can MISS a row a WHERE clause returns, and for an inspection query
  -- a miss is a fact silently vanishing from the surface the user relies on to
  -- catch mistakes.
  --
  -- Polymorphic by kind with no FK possible — the same shape and the same
  -- trade-off as `relationships.object_id` in migration 004.
  subject_kind      text,
  subject_id        uuid,
  CONSTRAINT memories_subject_kind_known
    CHECK (subject_kind IS NULL OR subject_kind IN ('person','organization','project')),
  -- Both or neither. A subject_id with no kind cannot be resolved to a table,
  -- and a kind with no id names nothing — either alone is a row that looks
  -- targeted and is not.
  CONSTRAINT memories_subject_complete
    CHECK ((subject_kind IS NULL) = (subject_id IS NULL))
);
SELECT add_bitemporal_columns('memories');

-- ---------------------------------------------------------------------------
-- The lexical half of hybrid retrieval (§3)
-- ---------------------------------------------------------------------------
-- A GENERATED column, not a trigger. It cannot drift from `body`, and there is
-- no trigger for a future second write path to forget. STORED because the GIN
-- index needs it materialised.
ALTER TABLE memories ADD COLUMN body_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', body)) STORED;

CREATE INDEX memories_tsv_idx ON memories USING gin (body_tsv) WHERE t_invalid IS NULL;

-- ---------------------------------------------------------------------------
-- The semantic half — and the setting without which it silently returns almost
-- nothing
-- ---------------------------------------------------------------------------
CREATE INDEX memories_embedding_idx ON memories
  USING hnsw (embedding vector_cosine_ops)
  WHERE t_invalid IS NULL;

-- ⚠ READ THIS BEFORE TOUCHING ANY VECTOR QUERY.
--
-- Verified from pgvector's own README, not recalled: "With approximate
-- indexes, filtering is applied AFTER the index is scanned. If a condition
-- matches 10% of rows, with HNSW and the default hnsw.ef_search of 40, only 4
-- rows will match on average."
--
-- EVERY retrieval in this product is filtered — by subject, by validity, by
-- owner. So the DEFAULT configuration returns almost nothing, and it returns it
-- SUCCESSFULLY: no error, and an empty result indistinguishable from "there is
-- genuinely nothing here". That is the same shape as the Phase 3 concurrency
-- bug — a plausible-looking empty read — and it is why the retrieval layer sets
--
--     SET LOCAL hnsw.iterative_scan = 'relaxed_order';
--
-- per transaction, and why an integration test asserts recall with ~200 rows
-- and a 10%-selective filter. A three-row fixture CANNOT reproduce this: with
-- so few rows the index scan returns everything regardless, so the test would
-- pass with the setting removed and prove nothing.
--
-- It is not set here. A GUC in a migration is not durable — it applies to the
-- migration's own session and nothing else — so putting it here would look like
-- configuration while doing nothing. It belongs in the query path.
--
-- 'relaxed_order' over 'strict_order': relaxed gives better recall, and the
-- ordering slack costs nothing because hybrid results are re-ranked by
-- Reciprocal Rank Fusion (§3.1) before anyone sees them.

-- The subject lookup (§28, §5). Partial for the same reason as every other
-- index here: invalid rows are never read.
CREATE INDEX memories_subject_idx ON memories(subject_kind, subject_id)
  WHERE t_invalid IS NULL;

CREATE VIEW memories_current AS SELECT * FROM memories WHERE t_invalid IS NULL;

-- ---------------------------------------------------------------------------
-- NOT DONE HERE, stated so nobody adds it later believing it was forgotten:
--
--   * No index on `commitments.object_embedding`. That column has existed
--     since migration 003 and is still NULL on every row (F7 — nothing has
--     ever written to it). An HNSW index over an all-NULL column is pure cost.
--     It lands with the code that populates it, not before.
--   * No `NOT NULL` on `embedding`, ever. See §2.2 above.
--   * No uniqueness on `body`. Two identical memories from different messages
--     are two real observations with different provenance; collapsing them
--     would lose the §16 audit trail and silently drop the second source.
-- ---------------------------------------------------------------------------
