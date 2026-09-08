-- 001 — extensions and the shared bitemporal helper.
--
-- This migration is the SINGLE mechanism that creates the `vector` extension.
-- The previously-explicit `CREATE EXTENSION` step in .github/workflows/ci.yml is
-- deleted in the same commit as this file (docs/DECISIONS.md #8, PHASE-1-DESIGN §5):
-- deleting it earlier turns CI red with nothing replacing it; deleting it later
-- leaves a window where two mechanisms create the extension.
--
-- Forward-only. There are no down migrations for raw SQL under node-pg-migrate;
-- `pnpm db:reset` is the rollback model for a greenfield repo with no production
-- data (PHASE-1-DESIGN §5, accepted caveat).

CREATE EXTENSION IF NOT EXISTS vector;

-- gen_random_uuid() is in core Postgres from 13 onward, so pgcrypto is NOT needed.
-- Stated explicitly because the reflex is to add it.

-- Shared bitemporal helper (PHASE-1-DESIGN §2.1). Every table in this schema calls
-- it, and Phase 3/4/6 tables (workflows, memories, documents, permissions) call the
-- same function so they cannot drift.
--
--   t_valid   when the fact became true in the world
--   t_invalid when it stopped being true in the world (NULL = still true)
--   t_created when we recorded it
--   t_expired when we superseded the record (NULL = current)
--
-- Every instant column in this schema is timestamptz. Never a naive timestamp.
-- Invalidate, never delete: no tool issues DELETE. This is what makes memory
-- correction and undo work.
CREATE OR REPLACE FUNCTION add_bitemporal_columns(tbl regclass) RETURNS void AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s
    ADD COLUMN t_valid   timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN t_invalid timestamptz,
    ADD COLUMN t_created timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN t_expired timestamptz', tbl);
END; $$ LANGUAGE plpgsql;

-- Shared merge resolver (PHASE-1-DESIGN §2.3, DECISIONS.md #3).
--
-- RETURN TYPE DECISION (resolving the inconsistency the design flagged in §2.3):
-- `resolve_merged` returns **uuid** — the surviving id, or the input id when the row
-- was never merged. The three typed wrappers (resolve_person / resolve_organization /
-- resolve_project) do the row lookup afterwards and return the table's row type.
-- One place owns the capped walk; the wrappers own only the row fetch.
--
-- Semantics:
--   * NULL input           -> NULL
--   * id that never existed -> NULL (the caller distinguishes "gone" from "merged")
--   * never-merged id       -> itself
--   * merged id             -> the survivor, followed TRANSITIVELY
--   * cycle / chain > 16    -> RAISE. Merges are undoable and redoable, which is
--                             exactly how a cycle gets created by accident.
--                             Failing loudly beats looping forever.
--
-- STABLE, not IMMUTABLE: the answer changes when a merge is recorded.
CREATE OR REPLACE FUNCTION resolve_merged(tbl regclass, start_id uuid) RETURNS uuid AS $$
DECLARE
  cur_id  uuid := start_id;
  next_id uuid;
  hops    integer := 0;
  found   boolean;
BEGIN
  IF start_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Does the starting row exist at all? A UUID naming nothing resolves to NULL
  -- rather than to itself, so a caller cannot mistake a bogus id for a live one.
  -- Only the FIRST hop needs this check. Later hops are safe because merged_into_id
  -- carries a self-referencing FOREIGN KEY on every mergeable table, so a non-NULL
  -- merged_into_id is guaranteed to name an existing row — that FK, not this
  -- pre-check, is what makes the walk below sound. (EXECUTE ... INTO would silently
  -- take the first row of a multi-row result, but `id` is the primary key.)
  EXECUTE format('SELECT true, merged_into_id FROM %s WHERE id = $1', tbl)
    INTO found, next_id USING cur_id;
  IF NOT COALESCE(found, false) THEN
    RETURN NULL;
  END IF;

  WHILE next_id IS NOT NULL LOOP
    hops := hops + 1;
    IF hops > 16 THEN
      -- A raw 5-char SQLSTATE, not a condition NAME: an unrecognised condition name
      -- makes CREATE FUNCTION itself fail, and this migration must apply on any
      -- Postgres 17 without depending on the spelling of a built-in condition.
      -- 'P0001' is raise_exception, the default for RAISE EXCEPTION.
      RAISE EXCEPTION
        'merge cycle or chain too deep in % from %', tbl::text, start_id
        USING ERRCODE = 'P0001';
    END IF;
    cur_id := next_id;
    EXECUTE format('SELECT merged_into_id FROM %s WHERE id = $1', tbl)
      INTO next_id USING cur_id;
  END LOOP;

  RETURN cur_id;
END; $$ LANGUAGE plpgsql STABLE;
