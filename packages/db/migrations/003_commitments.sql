-- 003 — commitments, the primary abstraction (PHASE-1-DESIGN §2.4).
-- Spec §6: the primary abstraction is COMMITMENT, not Task.

-- Nine values, not eleven. `due_soon` and `overdue` are deliberately NOT here —
-- they are computed in commitments_current below (DECISIONS.md #2).
CREATE TYPE commitment_status AS ENUM (
  'pending','in_progress','waiting','waiting_on_someone',
  'completed','completed_late','cancelled','blocked','superseded'
);

CREATE TABLE commitments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- OWNERSHIP DIRECTION IS TWO EXPLICIT FK COLUMNS. Spec §7 calls this "one of the
  -- major differentiating features". "I owe Barkha the article" and "Barkha owes me
  -- the article" differ only in which column holds which id. These must NEVER be
  -- collapsed into a single person_id + direction flag — the direction is
  -- structural and is never inferred at read time.
  owner_id         uuid NOT NULL REFERENCES people(id),  -- who is expected to do it
  recipient_id     uuid REFERENCES people(id),           -- for whom
  object_text      text NOT NULL,                        -- "the article" — raw, never resolved
  -- NULLable, NO INDEX, until Phase 2/4. Adding a pgvector column to a populated
  -- table later means an index build under load; one line now costs nothing.
  -- This is not the `memories` table, which stays cut until Phase 4.
  object_embedding vector(1024),
  expected_at      timestamptz,
  completed_at     timestamptz,
  status           commitment_status NOT NULL DEFAULT 'pending',
  project_id       uuid REFERENCES projects(id),
  CONSTRAINT owner_is_not_recipient CHECK (owner_id <> recipient_id)
);
SELECT add_bitemporal_columns('commitments');

-- Partial on t_invalid IS NULL: every read path filters to current rows, and
-- invalidate-never-delete means the invalid tail grows forever. Indexing only the
-- live rows keeps these the size of the working set rather than of all history.
CREATE INDEX commitments_owner_idx     ON commitments(owner_id)     WHERE t_invalid IS NULL;
CREATE INDEX commitments_recipient_idx ON commitments(recipient_id) WHERE t_invalid IS NULL;
CREATE INDEX commitments_expected_idx  ON commitments(expected_at)  WHERE t_invalid IS NULL;
CREATE INDEX commitments_project_idx   ON commitments(project_id)   WHERE t_invalid IS NULL;

-- due_soon / overdue are PURE FUNCTIONS of (expected_at, now()) and are NOT stored.
-- Storing them means a scheduled job writing status changes; if those writes land in
-- action_log then "undo that" can reverse a clock tick, and if they don't then
-- action_log is no longer complete history and the Activity surface shows changes
-- with no actor. Both branches are wrong (§2.4, DECISIONS.md #2).
--
-- The 2-hour threshold is a PLACEHOLDER, not a decision — product judgement owned by
-- design/ceo (DECISIONS.md open question 6). Eventually `due_soon` should key off the
-- commitment's own reminder rather than a global constant.
CREATE VIEW commitments_current AS
  SELECT c.*,
    CASE
      WHEN c.status <> 'pending' THEN c.status::text
      WHEN c.expected_at IS NULL THEN 'pending'
      WHEN c.expected_at < now() THEN 'overdue'
      WHEN c.expected_at < now() + interval '2 hours' THEN 'due_soon'
      ELSE 'pending'
    END AS display_status
  FROM commitments c WHERE c.t_invalid IS NULL;
