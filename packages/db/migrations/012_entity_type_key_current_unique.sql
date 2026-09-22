-- 012 — a type_key is unique among CURRENT types, not across all of history.
--
-- 006 declared `type_key text NOT NULL UNIQUE`. Undo of define_entity_type
-- invalidates the row (invalidate-never-delete) rather than deleting it, so the
-- invalidated row kept its key — and the key could never be used again. Found
-- by the live end-to-end test (2026-09-22): "track my reading", then undo, then
-- "track my reading" answered "An entity type with type_key "reading" already
-- exists" for a type the registry no longer shows.
--
-- The fix is the one every other bitemporal table's uniqueness already implies:
-- uniqueness over the rows that are current. History keeps every version.
--
-- NON-DESTRUCTIVE: no row is changed or removed. Plain DROP CONSTRAINT, not
-- IF EXISTS — a wrong name must fail loudly rather than leave the bug in place.
ALTER TABLE entity_types DROP CONSTRAINT entity_types_type_key_key;

CREATE UNIQUE INDEX entity_types_type_key_current_key
  ON entity_types (type_key)
  WHERE t_invalid IS NULL;
