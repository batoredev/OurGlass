/**
 * define_entity_type — the proof-of-pattern dynamic tool (docs/PHASE-1-DESIGN.md
 * §2.8, §4.1). This is the tool that makes "validate is a FUNCTION" load-bearing:
 * its valid inputs — which field_kinds exist — are a closed six-value enum
 * enforced HERE, in application code, at validation time, rather than only by
 * the Postgres `field_kind` enum type. Rejecting unsupported kinds before any
 * write is what makes "a new entity type requires zero frontend code changes"
 * an enforced guarantee instead of a hopeful one (§2.8's own framing).
 *
 * Scope, deliberately narrow per the mission: only define_entity_type. NOT
 * add_entity_field (Phase 5) and NOT the full registry — one tool proving the
 * pattern is Phase 1's job.
 *
 * Caps enforced here (§2.8): 32 fields per type, 64 types. Reserved type_keys
 * cannot shadow the nine core tables.
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { registerInverseHandler } from "./inverses.js";

// The closed six. Any change here MUST be a deliberate engineering decision
// (§2.8: "The LLM can invent entity types freely; it cannot invent field
// kinds") — this is not a config value, it mirrors the Postgres `field_kind`
// enum in packages/db/migrations/006_entity_registry.sql exactly.
export const SUPPORTED_FIELD_KINDS = [
  "text",
  "number",
  "bool",
  "date",
  "enum",
  "person_ref",
] as const;
export type FieldKind = (typeof SUPPORTED_FIELD_KINDS)[number];

function isFieldKind(value: unknown): value is FieldKind {
  return typeof value === "string" && (SUPPORTED_FIELD_KINDS as readonly string[]).includes(value);
}

const MAX_FIELDS_PER_TYPE = 32;
const MAX_TYPES = 64;

// The nine core tables (§1 "In scope") plus the registry's own tables —
// type_key must not shadow any of these, since entity_types is a parallel
// system to the fixed schema, not a way to redefine it.
const RESERVED_TYPE_KEYS = new Set([
  "commitments",
  "people",
  "organizations",
  "projects",
  "events",
  "reminders",
  "relationships",
  "messages",
  "action_log",
  "users",
  "entity_types",
  "entity_type_fields",
  "entity_records",
]);

const TYPE_KEY_RE = /^[a-z][a-z0-9_]*$/;

export interface RawFieldDef {
  readonly field_key?: unknown;
  readonly field_kind?: unknown;
  readonly label?: unknown;
  readonly required?: unknown;
  readonly enum_options?: unknown;
}

export interface DefineEntityTypeRawInput {
  readonly type_key?: unknown;
  readonly display_name?: unknown;
  readonly fields?: unknown;
}

export interface FieldDefInput {
  readonly fieldKey: string;
  readonly fieldKind: FieldKind;
  readonly label: string;
  readonly required: boolean;
  readonly enumOptions: readonly { value: string; label: string }[] | null;
}

export interface DefineEntityTypeInput {
  readonly typeKey: string;
  readonly displayName: string;
  readonly fields: readonly FieldDefInput[];
}

export interface DefineEntityTypeOutput {
  readonly id: string;
  readonly typeKey: string;
  readonly fieldCount: number;
}

async function validate(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<DefineEntityTypeInput, ToolError[]>> {
  const errors: ToolError[] = [];
  const input = (raw ?? {}) as DefineEntityTypeRawInput;

  if (typeof input.type_key !== "string" || !TYPE_KEY_RE.test(input.type_key)) {
    errors.push({
      field: "type_key",
      code: "invalid_type_key",
      message: "type_key must be snake_case (e.g. 'gym_session')",
    });
  } else if (RESERVED_TYPE_KEYS.has(input.type_key)) {
    errors.push({
      field: "type_key",
      code: "reserved_type_key",
      message: `type_key "${input.type_key}" is reserved by a core table and cannot be used`,
    });
  }

  if (typeof input.display_name !== "string" || input.display_name.trim().length === 0) {
    errors.push({
      field: "display_name",
      code: "missing_display_name",
      message: "display_name is required and must be a non-empty string",
    });
  }

  if (!Array.isArray(input.fields) || input.fields.length === 0) {
    errors.push({
      field: "fields",
      code: "missing_fields",
      message: "fields must be a non-empty array",
    });
    // Nothing further to validate about individual fields.
    return err(errors);
  }

  if (input.fields.length > MAX_FIELDS_PER_TYPE) {
    errors.push({
      field: "fields",
      code: "too_many_fields",
      message: `A type may have at most ${MAX_FIELDS_PER_TYPE} fields (got ${input.fields.length})`,
    });
  }

  const fields: FieldDefInput[] = [];
  const seenKeys = new Set<string>();

  for (const [i, rawField] of (input.fields as unknown[]).entries()) {
    const f = (rawField ?? {}) as RawFieldDef;
    const prefix = `fields[${i}]`;

    if (typeof f.field_key !== "string" || !TYPE_KEY_RE.test(f.field_key)) {
      errors.push({
        field: `${prefix}.field_key`,
        code: "invalid_field_key",
        message: `${prefix}.field_key must be snake_case`,
      });
      continue;
    }

    if (seenKeys.has(f.field_key)) {
      errors.push({
        field: `${prefix}.field_key`,
        code: "duplicate_field_key",
        message: `field_key "${f.field_key}" is used more than once`,
      });
      continue;
    }
    seenKeys.add(f.field_key);

    // THE ENFORCEMENT POINT (§2.8): reject an unknown field_kind here, at
    // validation time, with a clean ToolError naming the six supported
    // kinds — not stored-then-fails-at-Phase-5-render-time.
    if (!isFieldKind(f.field_kind)) {
      errors.push({
        field: `${prefix}.field_kind`,
        code: "unsupported_field_kind",
        message: `unsupported field kind '${String(f.field_kind)}'; supported: ${SUPPORTED_FIELD_KINDS.join(", ")}`,
      });
      continue;
    }

    if (typeof f.label !== "string" || f.label.trim().length === 0) {
      errors.push({
        field: `${prefix}.label`,
        code: "missing_label",
        message: `${prefix}.label is required and must be a non-empty string`,
      });
      continue;
    }

    let enumOptions: { value: string; label: string }[] | null = null;
    if (f.field_kind === "enum") {
      if (
        !Array.isArray(f.enum_options) ||
        f.enum_options.length === 0 ||
        !f.enum_options.every(
          (o): o is { value: string; label: string } =>
            typeof o === "object" &&
            o !== null &&
            typeof (o as { value?: unknown }).value === "string" &&
            typeof (o as { label?: unknown }).label === "string",
        )
      ) {
        errors.push({
          field: `${prefix}.enum_options`,
          code: "missing_enum_options",
          message: `${prefix}.enum_options is required for field_kind 'enum' and must be [{value,label}]`,
        });
        continue;
      }
      enumOptions = f.enum_options;
    }

    fields.push({
      fieldKey: f.field_key,
      fieldKind: f.field_kind,
      label: f.label,
      required: f.required === true,
      enumOptions,
    });
  }

  if (errors.length > 0) return err(errors);

  // Cap on total registered types — a dynamic tool querying the DB inside
  // its own validate(), exactly the load-bearing property §4.1 describes.
  const { rows: countRows } = await ctx.tx.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM entity_types_current`,
  );
  const currentTypeCount = Number(countRows[0]?.count ?? "0");
  if (currentTypeCount >= MAX_TYPES) {
    return err([
      {
        field: "type_key",
        code: "too_many_types",
        message: `At most ${MAX_TYPES} entity types are allowed (already have ${currentTypeCount})`,
      },
    ]);
  }

  // type_key must be globally unique (entity_types.type_key UNIQUE).
  const { rows: existingRows } = await ctx.tx.query<{ id: string }>(
    `SELECT id FROM entity_types WHERE type_key = $1`,
    [input.type_key],
  );
  if (existingRows.length > 0) {
    return err([
      {
        field: "type_key",
        code: "duplicate_type_key",
        message: `An entity type with type_key "${String(input.type_key)}" already exists`,
      },
    ]);
  }

  return ok({
    typeKey: input.type_key as string,
    displayName: (input.display_name as string).trim(),
    fields,
  });
}

interface EntityTypeRow {
  [key: string]: unknown;
  id: string;
  type_key: string;
  display_name: string;
  current_version: number;
}

async function commit(
  input: DefineEntityTypeInput,
  ctx: ToolContext,
): Promise<{ output: DefineEntityTypeOutput; mutations: readonly LoggedMutation[] }> {
  const { rows: typeRows } = await ctx.tx.query<EntityTypeRow>(
    `INSERT INTO entity_types (type_key, display_name) VALUES ($1, $2) RETURNING *`,
    [input.typeKey, input.displayName],
  );
  const entityType = typeRows[0]!;

  const fieldIds: string[] = [];
  for (const [ordinal, field] of input.fields.entries()) {
    const { rows } = await ctx.tx.query<{ id: string }>(
      `INSERT INTO entity_type_fields
         (entity_type_id, field_key, field_kind, label, required, ordinal, enum_options)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        entityType.id,
        field.fieldKey,
        field.fieldKind,
        field.label,
        field.required,
        ordinal,
        field.enumOptions ? JSON.stringify(field.enumOptions) : null,
      ],
    );
    fieldIds.push(rows[0]!.id);
  }

  const mutations: LoggedMutation[] = [
    {
      targetTable: "entity_types",
      targetId: entityType.id,
      forwardPatch: {
        typeKey: entityType.type_key,
        displayName: entityType.display_name,
        fieldCount: input.fields.length,
      },
      // Inverse must remove both the type row and its field rows — carried
      // together so undo (applyInverseForTable) can invalidate all of it in
      // one pass. entity_type_fields has no bitemporal columns (schema2:
      // "NO bitemporal columns on this one"), and it's a child row deleted
      // via ON DELETE CASCADE when its parent is truly removed — but per
      // invalidate-never-delete, undo of a CREATE invalidates the parent
      // entity_types row instead of deleting anything.
      inversePatch: { id: entityType.id, fieldIds },
      invertibility: "full",
    },
  ];

  return {
    output: { id: entityType.id, typeKey: entityType.type_key, fieldCount: input.fields.length },
    mutations,
  };
}

export const defineEntityTypeTool: ToolDefinition<DefineEntityTypeInput, DefineEntityTypeOutput> = {
  name: "define_entity_type",
  description:
    "Define a new dynamic entity type (schema-evolution proof-of-pattern). " +
    `field_kind must be one of: ${SUPPORTED_FIELD_KINDS.join(", ")}.`,
  validate,
  commit,
};

registerInverseHandler("entity_types", async (tx, targetId) => {
  if (!targetId) return;
  // Invalidate-never-delete: mark the entity_types row invalid. Its field
  // rows have no bitemporal columns and aren't independently invalidated —
  // entity_type_fields is loaded only via its (now-invalid) parent, so it
  // becomes unreachable through entity_types_current without needing its
  // own tombstone. Nothing reads entity_type_fields directly for a type
  // that no longer appears in entity_types_current.
  await tx.query(`UPDATE entity_types SET t_invalid = COALESCE(t_invalid, now()) WHERE id = $1`, [
    targetId,
  ]);
});
