-- 002 — users, and the three mergeable entity tables (people, organizations,
-- projects) with their two read shapes.
--
-- PHASE-1-DESIGN §2.2 and §2.3.

-- ---------------------------------------------------------------------------
-- users (§2.2)
-- ---------------------------------------------------------------------------
-- Single row in Phase 1. It exists for `timezone`: chrono-node's signature is
-- (text, instant, timezone), so Phase 2 must read a timezone from somewhere, and
-- reading it from a defaulted column costs what reading a constant costs.
-- Single-timezone in behaviour, multi-timezone in schema.
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  timezone     text NOT NULL DEFAULT 'Asia/Kolkata'  -- IANA name
);
SELECT add_bitemporal_columns('users');

-- ---------------------------------------------------------------------------
-- organizations (§2.3 — same shape as people)
-- ---------------------------------------------------------------------------
-- Declared before `people` because people.organization_id references it.
CREATE TABLE organizations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  merged_into_id uuid REFERENCES organizations(id),
  notes          text
);
SELECT add_bitemporal_columns('organizations');

-- Partial: only merged rows are ever looked up by this column, and merged rows are
-- the rare minority. resolve_merged() walks the chain one id at a time via this.
CREATE INDEX organizations_merged_into_idx ON organizations(merged_into_id)
  WHERE merged_into_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- people (§2.3)
-- ---------------------------------------------------------------------------
CREATE TABLE people (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    text NOT NULL,
  organization_id uuid REFERENCES organizations(id),
  merged_into_id  uuid REFERENCES people(id),  -- set by merge_person; loser -> winner
  notes           text
);
SELECT add_bitemporal_columns('people');
CREATE INDEX people_merged_into_idx ON people(merged_into_id)
  WHERE merged_into_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- projects (§2.3 — same shape)
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  merged_into_id uuid REFERENCES projects(id),
  notes          text
);
SELECT add_bitemporal_columns('projects');
CREATE INDEX projects_merged_into_idx ON projects(merged_into_id)
  WHERE merged_into_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- READ SHAPE 1 — LIST / ENUMERATE.
-- ---------------------------------------------------------------------------
-- "Show me the people." Merged-away rows are ABSENT, which is correct: the People
-- list must show ONE row after a merge, not two.
--
-- These views FILTER. They DO NOT RESOLVE. A dereference-by-id written against one
-- of them returns zero rows for a merged UUID and renders a blank cell — which is
-- precisely the dangling-reference outcome merged_into_id exists to prevent.
-- Two earlier drafts of this decision got exactly this wrong (DECISIONS.md #3).
CREATE VIEW people_current        AS SELECT * FROM people        WHERE t_invalid IS NULL;
CREATE VIEW organizations_current AS SELECT * FROM organizations WHERE t_invalid IS NULL;
CREATE VIEW projects_current      AS SELECT * FROM projects      WHERE t_invalid IS NULL;
CREATE VIEW users_current         AS SELECT * FROM users         WHERE t_invalid IS NULL;

-- ---------------------------------------------------------------------------
-- READ SHAPE 2 — DEREFERENCE BY ID.
-- ---------------------------------------------------------------------------
-- "Who is this UUID?" Follows merged_into_id TRANSITIVELY to the survivor.
-- Never returns a merged-away row for a UUID that still exists.
--
-- Thin wrappers over the one shared resolve_merged(tbl, uuid) in migration 001 —
-- three near-identical plpgsql walks would be three places to get the cycle guard
-- wrong (§2.3 implementation note). resolve_merged returns the surviving uuid;
-- these do the row lookup and return the table's row type.
--
-- CONTRACT, stated precisely because these have no caller until Phase 5:
--   * A merged UUID returns the SURVIVOR's row.
--   * An id that never existed returns a NULL COMPOSITE — resolve_merged returns
--     NULL, the predicate `id = NULL` is NULL, the SELECT matches zero rows, and a
--     SQL function declared RETURNS people yields NULL rather than a row of NULLs.
--     These are different values: `SELECT resolve_person(x) IS NULL` is true, while
--     `SELECT * FROM resolve_person(x)` in FROM-position expands to ONE all-NULL row.
--     Do not write a caller that relies on row COUNT to detect a missing id.
--   * Callers should go through packages/db/src/repositories/, which normalises both
--     shapes to `null` so no caller has to remember which one it is looking at.
--
-- Phase 1 SHIPS these and a test; nothing calls them until Phase 5's person_ref.
-- The test is the only thing keeping them correct across four phases — see the
-- comment on that test before weakening or skipping it.
CREATE FUNCTION resolve_person(start_id uuid) RETURNS people AS $$
  SELECT * FROM people WHERE id = resolve_merged('people'::regclass, start_id);
$$ LANGUAGE sql STABLE;

CREATE FUNCTION resolve_organization(start_id uuid) RETURNS organizations AS $$
  SELECT * FROM organizations WHERE id = resolve_merged('organizations'::regclass, start_id);
$$ LANGUAGE sql STABLE;

CREATE FUNCTION resolve_project(start_id uuid) RETURNS projects AS $$
  SELECT * FROM projects WHERE id = resolve_merged('projects'::regclass, start_id);
$$ LANGUAGE sql STABLE;
