-- 005 — action_log, the undo substrate (PHASE-1-DESIGN §2.7).
-- This table is why Phase 1 exists. Every mutation, its inverse, grouped by turn.

-- 'undo' is an actor_kind so undo entries are excluded from the normal undo path
-- for free (undo traverses only 'user_turn'). 'scheduled_job' covers the Phase 3
-- reminder firing that sets fired_at — it belongs in history but must never be
-- undoable, because the user cannot "undo" a clock tick.
CREATE TYPE actor_kind AS ENUM ('user_turn','system_derived','scheduled_job','undo');

-- 'full' for every Phase 1 tool. 'none' arrives in Phase 6/7 where an action has
-- genuinely no inverse (an email is sent). It exists now so the schema can say so
-- later without a migration.
CREATE TYPE invertibility AS ENUM ('full','lossy','none');

CREATE TABLE action_log (
  id             bigserial PRIMARY KEY,
  -- THE GRAIN IS A CONVERSATIONAL TURN, NOT A ROW MUTATION. One utterance emits
  -- multiple parallel tool calls (DECISIONS.md #8): "Barkha needs to give me the
  -- article by 6. Remind me at 5 to ask her." is one turn producing a commitment AND
  -- a reminder. When the user says "undo that", "that" is the turn. Without turn_id,
  -- undo either reverses half the turn or Phase 3 infers grouping by timestamp
  -- proximity — a heuristic over user data that will be wrong at the worst moment.
  turn_id        uuid NOT NULL,
  seq            integer NOT NULL,   -- order within the turn
  tool_name      text NOT NULL,
  actor_kind     actor_kind NOT NULL,
  invertibility  invertibility NOT NULL,
  target_table   text NOT NULL,
  target_id      uuid,
  forward_patch  jsonb NOT NULL,     -- what was applied
  inverse_patch  jsonb NOT NULL,     -- how to reverse it
  undoes_turn_id uuid,               -- set when THIS entry is an undo
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (turn_id, seq)
);

-- Undo reads all entries for one turn ordered by seq DESC, so this is the index for
-- the only query shape this table has.
CREATE INDEX action_log_turn_idx ON action_log(turn_id);

-- DOUBLE-UNDO IS A DATABASE CONSTRAINT, NOT A CHECK-THEN-ACT RACE.
-- Do not drop this index and re-implement the check in application code: people
-- genuinely say "undo that" twice when the first reply was ambiguous, and the
-- second attempt must get "that is already undone" rather than a second reversal.
-- Partial because only undo entries carry undoes_turn_id; ordinary entries are NULL
-- and NULLs would not conflict anyway, but the partial index says so explicitly and
-- stays the size of the undo history.
CREATE UNIQUE INDEX action_log_undo_once_idx ON action_log(undoes_turn_id)
  WHERE undoes_turn_id IS NOT NULL;

-- NOTE for the tool layer (§2.7, four enforced properties):
--   1. Undo is transactional at turn grain — ALL inverses for a turn_id apply in ONE
--      transaction, in DESCENDING seq (a commitment must not be reversed before the
--      reminder referencing it; FK ordering). Any failure rolls the whole undo back.
--   2. Undo is append-only — it writes NEW rows with undoes_turn_id set. Original
--      rows are never mutated or deleted. Redo becomes possible for free.
--   3. Double-undo is impossible — the index above.
--   4. Undo traverses only actor_kind = 'user_turn'.
--
-- action_log has NO bitemporal columns on purpose: it is an append-only ledger with
-- its own created_at, not a fact whose truth in the world can be invalidated.
