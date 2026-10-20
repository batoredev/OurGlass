-- 014 — Thoughts (a priority board) and the Google Calendar connection.
--
-- ADDITIVE ONLY: two new tables and one nullable column; nothing existing is
-- altered, so code rolled back past this migration keeps working (RUNBOOK).

-- ---------------------------------------------------------------------------
-- thoughts — ideas and goals the user wants to act on, by priority.
-- ---------------------------------------------------------------------------
-- Written ONLY through tools (create_thought, move_thought, remove_thought), so
-- every change is validated, lands in action_log, and is undoable. A move
-- updates `priority` in place and records the old one as its inverse — the
-- same shape as updateCommitment. A removal INVALIDATES the row, never deletes.
CREATE TYPE thought_priority AS ENUM ('high', 'mid', 'low');

CREATE TABLE thoughts (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body     text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 500),
  priority thought_priority NOT NULL
);
SELECT add_bitemporal_columns('thoughts');

CREATE INDEX thoughts_current_idx ON thoughts(priority, t_created) WHERE t_invalid IS NULL;

CREATE VIEW thoughts_current AS SELECT * FROM thoughts WHERE t_invalid IS NULL;

-- ---------------------------------------------------------------------------
-- google_accounts — the one connected Google account (single-user product).
-- ---------------------------------------------------------------------------
-- The refresh token is ENCRYPTED (AES-GCM, key derived from the OAuth client
-- secret — apps/api/src/integrations/google-calendar.ts). A database dump
-- alone cannot reach the user's calendar. Not bitemporal: a credential has no
-- history worth keeping, and disconnecting deletes it.
CREATE TABLE google_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text,
  refresh_token_enc   text NOT NULL,
  scope               text NOT NULL,
  connected_at        timestamptz NOT NULL DEFAULT now()
);
-- One account: connecting again replaces it.
CREATE UNIQUE INDEX google_accounts_single ON google_accounts ((true));

-- ---------------------------------------------------------------------------
-- events.google_event_id — the Google Calendar copy of an internal event.
-- ---------------------------------------------------------------------------
ALTER TABLE events ADD COLUMN google_event_id text;

-- A view's `SELECT *` is expanded when the view is CREATED, so events_current
-- (migration 004) would silently never show the new column. Recreated, same
-- definition — appending a column is what CREATE OR REPLACE VIEW allows.
CREATE OR REPLACE VIEW events_current AS SELECT * FROM events WHERE t_invalid IS NULL;
