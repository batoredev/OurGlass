/**
 * add_entity_field — one new field on a type the user already tracks (§36).
 *
 * "Add a rating to my reading tracker" had no path at all. The planner could
 * only DEFINE a type, and re-defining an existing key failed with "already
 * exists", so a tracker could never grow — the half of "the user creates new
 * structure by talking" that was named in PHASE-1-DESIGN §2.8, deferred to
 * Phase 5, and never built.
 *
 * ┌─ NON-BREAKING BY CONSTRUCTION ─────────────────────────────────────────┐
 * │ Migration 006's rule: a field added to a type that already has records  │
 * │ must be OPTIONAL. A required one would make every existing row          │
 * │ retroactively invalid, and there is no backfill. The planner always     │
 * │ sends required:false; this validation refuses a required field on a     │
 * │ populated type anyway, so the rule does not depend on the caller.       │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * UNDO removes the field DEFINITION and never any data. `entity_type_fields`
 * has no bitemporal columns (006: it is schema, loaded only through its type),
 * so the faithful inverse of this insert is deleting that one row. Values
 * already written under the key stay in `entity_records.payload`, invisible
 * because nothing renders a key the schema does not name — and visible again
 * if the field is re-added. It must NOT reuse the `entity_types` handler:
 * that one invalidates the WHOLE type, and undoing "add a rating" would have
 * deleted the reading tracker.
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import {
  MAX_FIELDS_PER_TYPE,
  TYPE_KEY_RE,
  validateFieldDef,
  type FieldDefInput,
} from "./define-entity-type.js";
import { registerInverseHandler } from "./inverses.js";

export interface AddEntityFieldRawInput {
  readonly type_key?: unknown;
  readonly field?: unknown;
}

export interface AddEntityFieldInput {
  readonly entityTypeId: string;
  readonly typeKey: string;
  readonly field: FieldDefInput;
}

export interface AddEntityFieldOutput {
  readonly fieldId: string;
  readonly typeKey: string;
  readonly fieldKey: string;
}

interface InversePatch {
  readonly fieldId: string;
  readonly entityTypeId: string;
}

async function validate(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<AddEntityFieldInput, ToolError[]>> {
  const input = (raw ?? {}) as AddEntityFieldRawInput;

  if (typeof input.type_key !== "string" || !TYPE_KEY_RE.test(input.type_key)) {
    return err([
      { field: "type_key", code: "invalid_type_key", message: "type_key must be snake_case (e.g. 'gym_session')" },
    ]);
  }

  const checked = validateFieldDef(input.field, "field");
  if (!checked.ok) return err([checked.errors]);
  const field = checked.value;

  const { rows: types } = await ctx.tx.query<{ id: string }>(
    `SELECT id FROM entity_types_current WHERE type_key = $1`,
    [input.type_key],
  );
  const entityTypeId = types[0]?.id;
  if (!entityTypeId) {
    return err([
      {
        field: "type_key",
        code: "unknown_type",
        message: `No tracked type "${input.type_key}" — define it before adding fields`,
      },
    ]);
  }

  const { rows: existing } = await ctx.tx.query<{ field_key: string }>(
    `SELECT field_key FROM entity_type_fields WHERE entity_type_id = $1`,
    [entityTypeId],
  );
  if (existing.some((row) => row.field_key === field.fieldKey)) {
    return err([
      {
        field: "field.field_key",
        code: "duplicate_field_key",
        message: `"${input.type_key}" already has a field "${field.fieldKey}"`,
      },
    ]);
  }
  if (existing.length >= MAX_FIELDS_PER_TYPE) {
    return err([
      {
        field: "field",
        code: "too_many_fields",
        message: `A type may have at most ${MAX_FIELDS_PER_TYPE} fields`,
      },
    ]);
  }

  if (field.required) {
    const { rows } = await ctx.tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM entity_records_current WHERE entity_type_id = $1`,
      [entityTypeId],
    );
    if ((rows[0]?.n ?? 0) > 0) {
      return err([
        {
          field: "field.required",
          code: "required_field_on_populated_type",
          message:
            "A field added to a type that already has records must be optional — " +
            "a required one would make every existing record invalid",
        },
      ]);
    }
  }

  return ok({ entityTypeId, typeKey: input.type_key, field });
}

async function commit(
  input: AddEntityFieldInput,
  ctx: ToolContext,
): Promise<{ output: AddEntityFieldOutput; mutations: readonly LoggedMutation[] }> {
  // Appended after the last field, so render order keeps what the user saw.
  const { rows: ordinals } = await ctx.tx.query<{ next: number }>(
    `SELECT COALESCE(max(ordinal) + 1, 0)::int AS next FROM entity_type_fields WHERE entity_type_id = $1`,
    [input.entityTypeId],
  );
  const { field } = input;
  const { rows } = await ctx.tx.query<{ id: string }>(
    `INSERT INTO entity_type_fields
       (entity_type_id, field_key, field_kind, label, required, ordinal, enum_options)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.entityTypeId,
      field.fieldKey,
      field.fieldKind,
      field.label,
      field.required,
      ordinals[0]?.next ?? 0,
      field.enumOptions ? JSON.stringify(field.enumOptions) : null,
    ],
  );
  const fieldId = rows[0]!.id;

  // The schema changed, so the version moves. Records written from now on
  // carry the new number (create_entity_record stamps it).
  await ctx.tx.query(`UPDATE entity_types SET current_version = current_version + 1 WHERE id = $1`, [
    input.entityTypeId,
  ]);

  const inversePatch: InversePatch = { fieldId, entityTypeId: input.entityTypeId };
  return {
    output: { fieldId, typeKey: input.typeKey, fieldKey: field.fieldKey },
    mutations: [
      {
        targetTable: "entity_type_fields",
        targetId: fieldId,
        forwardPatch: { typeKey: input.typeKey, fieldKey: field.fieldKey, fieldKind: field.fieldKind },
        inversePatch,
        invertibility: "full",
      },
    ],
  };
}

export const addEntityFieldTool: ToolDefinition<AddEntityFieldInput, AddEntityFieldOutput> = {
  name: "add_entity_field",
  description:
    "Add one field to a type the user already tracks. Non-breaking: a field added to a type " +
    "that has records must be optional.",
  validate,
  commit,
};

registerInverseHandler("entity_type_fields", async (tx, targetId, inversePatch) => {
  if (!targetId) return;
  // Deleting is the faithful inverse here, and removes no data — see the
  // header. The version still moves FORWARD: it counts schema changes, and
  // an undo is one; rewinding it could collide with a later change.
  await tx.query(`DELETE FROM entity_type_fields WHERE id = $1`, [targetId]);
  const typeId = (inversePatch as Partial<InversePatch> | null)?.entityTypeId;
  if (typeId) {
    await tx.query(`UPDATE entity_types SET current_version = current_version + 1 WHERE id = $1`, [typeId]);
  }
});
