-- 004 — messages, events, reminders, relationships (PHASE-1-DESIGN §2.5, §2.6).
--
-- `messages` is declared first because relationships.source_message_id references it.

-- ---------------------------------------------------------------------------
-- messages — conversation turns, and the provenance target for relationships (§16)
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id uuid,               -- ties a message to its action_log turn; NULL for
                              -- messages that produced no mutation
  role    text NOT NULL,      -- 'user' | 'assistant'
  body    text NOT NULL       -- raw content field, never resolved (§3)
);
SELECT add_bitemporal_columns('messages');
CREATE INDEX messages_turn_idx ON messages(turn_id) WHERE turn_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
CREATE TABLE events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,   -- raw content field
  starts_at  timestamptz,
  ends_at    timestamptz,
  location   text,
  project_id uuid REFERENCES projects(id),
  notes      text
);
SELECT add_bitemporal_columns('events');
CREATE INDEX events_starts_idx ON events(starts_at) WHERE t_invalid IS NULL;

CREATE VIEW messages_current AS SELECT * FROM messages WHERE t_invalid IS NULL;
CREATE VIEW events_current   AS SELECT * FROM events   WHERE t_invalid IS NULL;

-- ---------------------------------------------------------------------------
-- reminders (§2.6)
-- ---------------------------------------------------------------------------
CREATE TABLE reminders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id uuid REFERENCES commitments(id),
  body          text NOT NULL,
  -- NULLable so the Phase 2 three-tier split (DECISIONS.md #3) has somewhere to
  -- live: tier 1 deterministic time has a fire_at; tiers 2 (relational) and 3
  -- (event trigger) have none until another entity resolves.
  fire_at       timestamptz,
  fired_at      timestamptz,   -- NULL = not yet fired
  -- The verbatim phrase ("next Friday"). The LLM must NOT compute timestamps
  -- (DECISIONS.md #4) — it extracts the phrase and chrono-node resolves it
  -- deterministically. Keeping the phrase makes resolution auditable and re-runnable.
  source_phrase text
);
SELECT add_bitemporal_columns('reminders');

-- Serves the Phase 3 poller's "find due reminders" query directly: the predicate is
-- exactly the poller's WHERE clause, so the index covers the hot path and stays the
-- size of the un-fired backlog rather than of all history.
CREATE INDEX reminders_pending_idx ON reminders(fire_at)
  WHERE fired_at IS NULL AND t_invalid IS NULL;
CREATE INDEX reminders_commitment_idx ON reminders(commitment_id) WHERE t_invalid IS NULL;

CREATE VIEW reminders_current AS SELECT * FROM reminders WHERE t_invalid IS NULL;

-- ---------------------------------------------------------------------------
-- relationships (§2.5) — spec §15/§16/§17
-- ---------------------------------------------------------------------------
-- An ENUM, not a float (DECISIONS.md #1). Anthropic structured outputs support no
-- minimum/maximum, so spec §37's `confidence: 0.97` is not schema-enforceable;
-- spec §12's own enum is the better design and is already in the spec.
CREATE TYPE inference_level AS ENUM ('CONFIRMED','INFERRED','UNCERTAIN');

CREATE TABLE relationships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id        uuid NOT NULL REFERENCES people(id),
  rel_type          text NOT NULL,   -- 'works_on', 'handles', 'works_with'
  object_kind       text NOT NULL,   -- 'person' | 'organization' | 'project'
  object_id         uuid NOT NULL,   -- polymorphic by object_kind; no FK possible
  inference_level   inference_level NOT NULL,
  source_message_id uuid REFERENCES messages(id),  -- provenance, §16
  CONSTRAINT relationships_object_kind_known
    CHECK (object_kind IN ('person','organization','project'))
);
SELECT add_bitemporal_columns('relationships');

-- Both directions of traversal are read paths ("what does Arun work on", "who works
-- on backend"), so both sides are indexed.
CREATE INDEX relationships_subject_idx ON relationships(subject_id) WHERE t_invalid IS NULL;
CREATE INDEX relationships_object_idx  ON relationships(object_kind, object_id)
  WHERE t_invalid IS NULL;

-- Correction (§17) sets the OLD edge's t_invalid to the NEW edge's t_valid and KEEPS
-- the row. "Arun handles backend" -> "No, Karthik handles it now" produces two rows,
-- one current. History preserved; contradictions do not accumulate forever.
CREATE VIEW relationships_current AS SELECT * FROM relationships WHERE t_invalid IS NULL;
