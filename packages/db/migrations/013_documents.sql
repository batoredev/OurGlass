-- 013 — documents and document_links: Phase 6 ingestion (docs/PHASE-6-DESIGN.md §7).
--
-- ADDITIVE ONLY. Two new tables, one new enum, two views; nothing existing is
-- altered, so code rolled back past this migration keeps working (RUNBOOK).
--
-- THE BYTES ARE NOT HERE. They live in Supabase Storage (owner decision,
-- 2026-09-24); `storage_key` names the object. `bytea` would have put every
-- 10 MB PDF through every backup and every `SELECT *`.

CREATE TYPE document_kind AS ENUM ('pdf', 'docx', 'xlsx', 'text', 'image');

CREATE TABLE documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The object's key in the storage bucket: <yyyy>/<mm>/<uuid>.<ext>. Never
  -- derived from the uploaded filename, which is attacker-controlled.
  storage_key       text NOT NULL UNIQUE,
  -- As uploaded. DISPLAY ONLY: never a path, never sent to a model.
  filename          text NOT NULL,
  -- Sniffed from the bytes, not the name or the client's declared type.
  kind              document_kind NOT NULL,
  content_type      text NOT NULL,
  byte_size         integer NOT NULL CHECK (byte_size > 0),
  -- Hex. §23 for files: the same bytes twice are one document, not two.
  sha256            text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- What the local extractor produced, bounded (PHASE-6-DESIGN §5). NULL for
  -- an image, which is read as pixels.
  extracted_text    text,
  text_truncated    boolean NOT NULL DEFAULT false,
  -- The Read stage's DocumentReading. NULL when no model could read it — the
  -- document is still saved, and `read_failure` says why.
  reading           jsonb,
  read_failure      text,
  -- Model, latency, token counts: cost per ingest, queryable rather than guessed.
  trace             jsonb,
  -- The user message that carried the file (§16 provenance).
  source_message_id uuid REFERENCES messages(id)
);
SELECT add_bitemporal_columns('documents');

-- Duplicate detection reads current rows by hash, and nothing else does.
CREATE INDEX documents_sha256_current_idx ON documents(sha256) WHERE t_invalid IS NULL;

CREATE VIEW documents_current AS SELECT * FROM documents WHERE t_invalid IS NULL;

-- ---------------------------------------------------------------------------
-- document_links — "this brief belongs to Hult" (§33)
-- ---------------------------------------------------------------------------
-- Polymorphic target, like relationships.object_id: no FK is possible across
-- three tables, so the kind is constrained and the id is checked by the tool
-- that writes it (link_document validates the row exists and is current).
CREATE TABLE document_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES documents(id),
  target_kind     text NOT NULL,
  target_id       uuid NOT NULL,
  -- CONFIRMED: the user named it with the upload. INFERRED: only the document
  -- mentions it. Same enum and same meaning as relationships (§16).
  inference_level inference_level NOT NULL,
  CONSTRAINT document_links_target_kind_known
    CHECK (target_kind IN ('person', 'organization', 'project'))
);
SELECT add_bitemporal_columns('document_links');

CREATE INDEX document_links_document_idx ON document_links(document_id) WHERE t_invalid IS NULL;
CREATE INDEX document_links_target_idx ON document_links(target_kind, target_id) WHERE t_invalid IS NULL;

-- One current link per (document, target): re-linking the same pair is a no-op
-- the tool reports, not a second row.
CREATE UNIQUE INDEX document_links_current_pair_key
  ON document_links(document_id, target_kind, target_id)
  WHERE t_invalid IS NULL;

CREATE VIEW document_links_current AS SELECT * FROM document_links WHERE t_invalid IS NULL;
