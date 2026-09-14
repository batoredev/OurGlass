/**
 * entity_types, entity_type_fields, entity_records — the dynamic entity
 * registry's READ and WRITE layer (docs/PHASE-5-DESIGN.md §1, §2).
 *
 * Resolving findings F12 and F13, which together were the whole gap:
 *
 *   F12 — `define_entity_type` could create a TYPE and NOTHING in the repo
 *         could create a RECORD of it. `entity_records` appeared in exactly
 *         one place: a reserved-names list inside that same tool. So "track
 *         my gym sessions" succeeded and the user then had nowhere to put a
 *         session.
 *   F13 — nothing could READ the registry either. define-entity-type.ts
 *         issued its own raw validation SQL and exposed no read, so the
 *         frontend could not fetch what it was supposed to render.
 *
 * `EntityTypeWithFields` below is THE shape the frontend renders from. The
 * user's explicit requirement — a type the LLM invents must display without a
 * code change — is satisfied by that shape being complete enough to render
 * generically, and by `field_kind` being a closed enum so there is always a
 * renderer for whatever arrives.
 */
import type { Queryable } from "../client.js";

/**
 * Mirrors the `field_kind` Postgres enum (migration 006). CLOSED, and that is
 * load-bearing rather than conservative: the LLM invents TYPES freely and
 * never KINDS, so the frontend can guarantee a renderer for every field it
 * will ever receive. An open kind space would let a type arrive that the UI
 * cannot display — the exact failure the dynamic-entity requirement rules out.
 */
export type FieldKind = "text" | "number" | "bool" | "date" | "enum" | "person_ref";

export interface EnumOption {
  readonly value: string;
  readonly label: string;
}

export interface EntityTypeField {
  id: string;
  entity_type_id: string;
  /** snake_case; the JSONB key inside `entity_records.payload`. */
  field_key: string;
  field_kind: FieldKind;
  /** Human text: "Duration (minutes)". */
  label: string;
  required: boolean;
  /** Render order. See listTypes — JSONB has no key order without this. */
  ordinal: number;
  enum_options: readonly EnumOption[] | null;
}

export interface EntityType {
  id: string;
  type_key: string;
  display_name: string;
  current_version: number;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

/** A type and its fields — the single shape the frontend renders from. */
export interface EntityTypeWithFields extends EntityType {
  readonly fields: readonly EntityTypeField[];
}

export interface EntityRecord {
  id: string;
  entity_type_id: string;
  /**
   * The `entity_types.current_version` in force WHEN THIS ROW WAS WRITTEN.
   *
   * Stamped at write time and never re-resolved at read time (§1.3). Without
   * it the renderer cannot tell "this record predates an added field" (normal)
   * from "this record is missing a required value" (a bug) — and conflating
   * those produces either false alarms or hidden corruption.
   */
  schema_version: number;
  payload: Record<string, unknown>;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

// ---------------------------------------------------------------------------
// Reads (F13)
// ---------------------------------------------------------------------------

interface TypeRow extends EntityType {
  fields: readonly EntityTypeField[] | null;
}

/**
 * The whole registry, each type carrying its fields IN ORDINAL ORDER.
 *
 * ⚠ THE `ORDER BY ordinal` IS NOT COSMETIC. Migration 006's own comment says
 * it: JSONB has no key order, so without the stored ordinal there is no
 * deterministic render order and the UI reshuffles its columns between
 * requests. A table whose columns move is one users stop trusting.
 *
 * One query with a lateral aggregate rather than N+1: the registry is read on
 * every page load of every dynamic type, and a per-type follow-up query would
 * make that cost scale with how many types the user has invented.
 */
export async function listTypes(tx: Queryable): Promise<EntityTypeWithFields[]> {
  const { rows } = await tx.query<TypeRow>(
    `SELECT t.*, f.fields
       FROM entity_types_current t
       LEFT JOIN LATERAL (
         SELECT json_agg(
                  json_build_object(
                    'id', ef.id,
                    'entity_type_id', ef.entity_type_id,
                    'field_key', ef.field_key,
                    'field_kind', ef.field_kind,
                    'label', ef.label,
                    'required', ef.required,
                    'ordinal', ef.ordinal,
                    'enum_options', ef.enum_options
                  ) ORDER BY ef.ordinal
                ) AS fields
           FROM entity_type_fields ef
          WHERE ef.entity_type_id = t.id
       ) f ON TRUE
      ORDER BY t.display_name`,
  );
  // A type with no fields yet is legal — json_agg over zero rows is NULL, not
  // an empty array, and returning null here would make every consumer guard.
  return rows.map((row) => ({ ...row, fields: row.fields ?? [] }));
}

export async function getTypeByKey(
  tx: Queryable,
  typeKey: string,
): Promise<EntityTypeWithFields | null> {
  const all = await listTypes(tx);
  return all.find((type) => type.type_key === typeKey) ?? null;
}

/** Records of one type, newest first. */
export async function listRecords(
  tx: Queryable,
  typeKey: string,
  limit = 100,
): Promise<EntityRecord[]> {
  const { rows } = await tx.query<EntityRecord>(
    `SELECT r.* FROM entity_records_current r
       JOIN entity_types_current t ON t.id = r.entity_type_id
      WHERE t.type_key = $1
      ORDER BY r.t_created DESC
      LIMIT $2`,
    [typeKey, limit],
  );
  return rows;
}

export async function getRecordById(tx: Queryable, id: string): Promise<EntityRecord | null> {
  const { rows } = await tx.query<EntityRecord>(`SELECT * FROM entity_records WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Writes (F12)
// ---------------------------------------------------------------------------

export interface CreateEntityRecordInput {
  id?: string | null;
  entityTypeId: string;
  /** Stamped by the caller from `entity_types.current_version` (§1.3). */
  schemaVersion: number;
  payload: Record<string, unknown>;
}

/**
 * Write one record.
 *
 * THE PAYLOAD IS NOT VALIDATED HERE. Validation is dynamic — the legal shape
 * of a `gym_session` is not known until `entity_type_fields` is read — so it
 * lives in the tool's `validate`, which is a FUNCTION precisely so it can do
 * that (PHASE-1-DESIGN §4.1). A repository that half-validated would split the
 * rules across two layers, and the half that ran second would win silently.
 */
export async function createRecord(
  tx: Queryable,
  input: CreateEntityRecordInput,
): Promise<EntityRecord> {
  const { rows } = await tx.query<EntityRecord>(
    `INSERT INTO entity_records (id, entity_type_id, schema_version, payload)
     VALUES (COALESCE($4::uuid, gen_random_uuid()), $1::uuid, $2, $3::jsonb)
     RETURNING *`,
    [input.entityTypeId, input.schemaVersion, JSON.stringify(input.payload), input.id ?? null],
  );
  return rows[0]!;
}

/** INVALIDATE, NEVER DELETE. Idempotent on an already-invalid row. */
export async function invalidateRecord(tx: Queryable, id: string, at?: Date): Promise<void> {
  await tx.query(
    `UPDATE entity_records SET t_invalid = COALESCE($2::timestamptz, t_invalid, now())
      WHERE id = $1`,
    [id, at ?? null],
  );
}

/** The inverse. Takes the prior value with NO DEFAULT. */
export async function revalidateRecord(
  tx: Queryable,
  id: string,
  previousInvalidAt: Date | null,
): Promise<void> {
  await tx.query(`UPDATE entity_records SET t_invalid = $2::timestamptz WHERE id = $1`, [
    id,
    previousInvalidAt,
  ]);
}
