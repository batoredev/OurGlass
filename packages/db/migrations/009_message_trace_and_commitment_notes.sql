-- 009 — trace persistence on `messages` (PHASE-3-DESIGN §8), and `commitment_notes`
-- (finding F4, §20 context attachment).
--
-- Two concerns in one migration because both are small ALTER/CREATE pairs landing
-- in the same phase by the same owner. Splitting them would add a file whose only
-- content is one CREATE TABLE.
--
-- Forward-only; `pnpm db:reset` is the rollback model.

-- ---------------------------------------------------------------------------
-- Trace (§8)
-- ---------------------------------------------------------------------------
-- Phase 2's extractor already captures model, latency, stop reason and token
-- counts including cache accounting, and PHASE-2-DESIGN deliberately persisted
-- NONE of it, assigning that here.
--
-- .claude/rules/ai-systems.md: "an LLM failure with no trace is unfixable" — a
-- 200 OK can still be a wrong answer, so ordinary APM does not cover this.
-- DECISIONS.md open question 4 (per-message cost budget) CANNOT be answered
-- without the token counts, and spec §22 means every message triggers extraction.
ALTER TABLE messages
  ADD COLUMN trace    jsonb,     -- ExtractionTrace + respond trace; NULL for user messages
  -- true iff the deterministic template fallback produced this reply (§5.2).
  -- Surfaced, never swallowed: without it a Haiku outage is indistinguishable
  -- from normal operation forever.
  ADD COLUMN degraded boolean;

-- An expression index on the ONE field we will actually filter by. Partial because
-- user messages carry no trace and are the majority of rows.
CREATE INDEX messages_trace_model_idx ON messages ((trace->>'model'))
  WHERE trace IS NOT NULL;

-- NOTE: `messages_current` was created in migration 004 as `SELECT *`. Postgres
-- expands `*` at CREATE VIEW time into a fixed column list, so the view does NOT
-- pick up these two new columns. It is REPLACED below rather than left stale —
-- a view silently missing the columns a phase just added is precisely the
-- "column exists with no code path reaching it" shape that DECISIONS.md Phase 1
-- finding #8 warns about, and it would be invisible to typecheck and lint.
--
-- DROP + CREATE rather than CREATE OR REPLACE. Replacement would technically work
-- HERE (these two columns do append to the end of the list), but it works only by
-- accident of ordering, and the identical rebuild in migration 007 had to be
-- DROP + CREATE because `person_id` did NOT land at the end. One form for this
-- operation across the repo, so nobody has to work out which case they are in.
-- Nothing references `messages_current` today — verified by grep.
DROP VIEW messages_current;
CREATE VIEW messages_current AS SELECT * FROM messages WHERE t_invalid IS NULL;

-- NOT PERSISTED, deliberately (§8.2): the raw model completion object, and the
-- extracted `Extraction` payload itself. The utterance (already stored in
-- messages.body) plus this trace is enough to re-run and compare; storing the
-- intermediate interpretation doubles per-turn storage to preserve a value that is
-- reproducible from data we already keep. ExtractionError.rawPayload already
-- carries it in-process for the failure path, where it matters.
--
-- REJECTED: a separate `traces` table with an FK to messages. Normalised, and what
--   a metrics pipeline would eventually want. But it is a second table with exactly
--   one consumer, a 1:1 relationship, and no query joining it to anything else.
--   Revisit when something aggregates across traces without touching messages.
-- REJECTED: structured columns (model text, input_tokens int, ...). Interpret's
--   trace and Respond's trace have different shapes and a third stage will have a
--   fourth. JSONB plus one expression index is the honest fit.
-- REJECTED: putting the trace in action_log.forward_patch. action_log is an
--   append-only ledger of MUTATIONS; a turn that mutates nothing has no row there
--   at all — so the traces most worth reading would be the ones never written.

-- ---------------------------------------------------------------------------
-- commitment_notes (finding F4, spec §20)
-- ---------------------------------------------------------------------------
-- "She had a family emergency" had nowhere to land: migration 003 gives
-- `commitments` no `notes` column, while `people`, `organizations` and `projects`
-- all have one in 002, and there was no commitment_notes table.
--
-- A TABLE, NOT A `notes text` COLUMN ON `commitments`. A column would be
-- OVERWRITTEN by the second piece of context and would carry NO PROVENANCE.
-- PHASES.md puts "context attachment (§20) as a note with message provenance"
-- explicitly in scope, and relationships.source_message_id (migration 004) is the
-- established pattern for provenance. One commitment accumulates many notes over
-- its life; that is a one-to-many, so it is a table.
CREATE TABLE commitment_notes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id     uuid NOT NULL REFERENCES commitments(id),
  body              text NOT NULL,   -- raw content field (§3), never resolved
  -- Provenance: WHICH message said this. §20's "do not make judgmental statements"
  -- is only auditable if the source is recoverable. Nullable because a note may
  -- arrive from a non-conversational path (a future import, a scheduled job).
  source_message_id uuid REFERENCES messages(id)
);
SELECT add_bitemporal_columns('commitment_notes');

-- The only read shape this table has: "the notes on this commitment", newest
-- first. Partial on t_invalid for the same reason as every other index here.
CREATE INDEX commitment_notes_commitment_idx
  ON commitment_notes(commitment_id, t_created DESC)
  WHERE t_invalid IS NULL;

CREATE VIEW commitment_notes_current AS
  SELECT * FROM commitment_notes WHERE t_invalid IS NULL;
