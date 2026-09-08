-- 006 — the dynamic entity registry (PHASE-1-DESIGN §2.8).
--
-- PROVENANCE: dynamic entity types appear in ZERO of the 38 spec sections (verified
-- twice by grep of docs/SPEC.md and docs/SPEC-raw.txt). This is an owner addition,
-- confirmed by the user as wanted-as-designed (DECISIONS.md, correction note).
--
-- entity_types stores a CLOSED DISCRIMINATOR, never arbitrary JSON Schema. Raw JSON
-- Schema is open-ended (allOf/oneOf/$ref/pattern) and a generic renderer cannot
-- render an open set — it grows a special case per construct, which IS the "no
-- frontend code change" violation. JSON Schema is what we GENERATE from this
-- registry to hand the model as a tool input schema; it is not what we STORE.

-- SIX VALUES, CLOSED. The LLM can invent entity TYPES freely; it cannot invent field
-- KINDS. A new entity type requires zero frontend code changes, always. A new field
-- kind requires a frontend code change, and always will.
-- define_entity_type must reject an unknown kind at VALIDATION time with a clean
-- ToolError, not store it and fail at Phase 5 render time.
CREATE TYPE field_kind AS ENUM ('text','number','bool','date','enum','person_ref');

CREATE TABLE entity_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key        text NOT NULL UNIQUE,   -- snake_case, e.g. 'gym_session'
  display_name    text NOT NULL,
  current_version integer NOT NULL DEFAULT 1
);
SELECT add_bitemporal_columns('entity_types');

CREATE TABLE entity_type_fields (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type_id uuid NOT NULL REFERENCES entity_types(id) ON DELETE CASCADE,
  field_key      text NOT NULL,   -- snake_case; the JSONB key in entity_records.payload
  field_kind     field_kind NOT NULL,
  label          text NOT NULL,   -- human text: "Duration (minutes)"
  required       boolean NOT NULL DEFAULT false,
  -- JSONB has no key order. Without a stored ordinal there is no deterministic render
  -- order, so Phase 5 sorts arbitrarily or hardcodes per type.
  ordinal        integer NOT NULL,
  enum_options   jsonb,           -- [{value,label}] iff field_kind='enum'
  UNIQUE (entity_type_id, field_key),
  CONSTRAINT enum_options_present
    CHECK (field_kind <> 'enum' OR enum_options IS NOT NULL)
);

-- DEFERRABLE INITIALLY DEFERRED because reordering fields swaps two ordinals inside
-- one transaction, and a non-deferrable constraint rejects the intermediate state.
-- Users reorder fields. Do not "simplify" this to a plain unique index.
CREATE UNIQUE INDEX entity_type_fields_ordinal_idx
  ON entity_type_fields(entity_type_id, ordinal) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE entity_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type_id uuid NOT NULL REFERENCES entity_types(id),
  -- Present from row zero. If entity_records lacks it and Phase 5 needs it, that is a
  -- migration over live user data. One integer now.
  schema_version integer NOT NULL,
  payload        jsonb NOT NULL
);
SELECT add_bitemporal_columns('entity_records');
CREATE INDEX entity_records_type_idx ON entity_records(entity_type_id) WHERE t_invalid IS NULL;

CREATE VIEW entity_types_current   AS SELECT * FROM entity_types   WHERE t_invalid IS NULL;
CREATE VIEW entity_records_current AS SELECT * FROM entity_records WHERE t_invalid IS NULL;

-- ENFORCED IN `validate`, NOT HERE (PHASE-1-DESIGN §2.8) — stated so nobody adds a
-- CHECK constraint later believing it is missing:
--   * Caps: 32 fields per type, 64 types. Phase 5 needs a fixture AT the cap.
--   * Reserved type_keys cannot shadow the nine core tables.
--   * add_entity_field is NON-BREAKING: optional fields only. Adding a REQUIRED field
--     to a populated type is rejected — it would make existing rows retroactively
--     invalid. Absent keys are legal and render as an em-dash. No backfill.
--   * Validation rejects only keys not in the schema, and values of the wrong kind
--     for keys that ARE present. It runs against the type's current_version.
-- These are cross-row and cross-table policies; a CHECK constraint cannot express
-- them, and a trigger would put user-facing error text in the database.
