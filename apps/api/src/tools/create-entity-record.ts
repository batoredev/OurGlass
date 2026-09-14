/**
 * create_entity_record — the other half of dynamic entities
 * (docs/PHASE-5-DESIGN.md §1), resolving finding F12.
 *
 * Before this, `define_entity_type` could create a TYPE and nothing in the
 * repo could create a RECORD of it. "Track my gym sessions" succeeded, the
 * type existed, and the user had nowhere to put a session — the centre of the
 * dynamic-entity requirement, missing.
 *
 * ┌─ THIS IS THE TOOL THE CONTRACT WAS DESIGNED FOR ───────────────────────┐
 * │ PHASE-1-DESIGN §4.1 made `validate` a FUNCTION rather than a static    │
 * │ schema object with exactly this in mind: the legal shape of a          │
 * │ `gym_session` payload is unknowable until `entity_type_fields` is read │
 * │ at call time. Every other tool closes over a fixed shape; this one     │
 * │ queries for its own schema. It is the first to exercise that choice.   │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { entityRecords, people } from "@ourglass/db";
import type { EntityTypeField, EntityTypeWithFields } from "@ourglass/db";
import { registerInverseHandler } from "./inverses.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export interface CreateEntityRecordRawInput {
  readonly type_key?: unknown;
  readonly payload?: unknown;
}

export interface CreateEntityRecordToolInput {
  readonly entityTypeId: string;
  readonly typeKey: string;
  readonly schemaVersion: number;
  readonly payload: Record<string, unknown>;
}

export interface CreateEntityRecordOutput {
  readonly id: string;
  readonly typeKey: string;
  readonly schemaVersion: number;
}

/** create_entity_record's inverse shape: nothing to restore, just invalidate. */
export interface CreateEntityRecordInversePatch {
  readonly id: string;
}

/**
 * Check one value against one field's kind.
 *
 * Returns an error message or null. Each rejection below exists because the
 * accepted-looking alternative is WORSE than a failure:
 *
 *   number   — NaN and Infinity both satisfy `typeof x === "number"` and
 *              neither survives a JSONB round-trip as anything useful.
 *   bool     — the STRINGS "true"/"false" are what a model emits when it is
 *              being helpful; storing them makes every later `=== true` false.
 *   date     — stored as an ISO STRING, not a Date. JSONB has no date type, so
 *              a Date silently becomes a string anyway; being explicit means
 *              the read path never has to guess which it got.
 *   enum     — exact match against enum_options. A near-miss renders as a
 *              blank cell, because the renderer looks the value up by key.
 */
async function checkValue(
  field: EntityTypeField,
  value: unknown,
  ctx: ToolContext,
): Promise<string | null> {
  switch (field.field_kind) {
    case "text":
      return typeof value === "string" ? null : "must be text";

    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "must be a finite number";

    case "bool":
      return typeof value === "boolean" ? null : "must be true or false, not a string";

    case "date":
      return typeof value === "string" && !Number.isNaN(Date.parse(value))
        ? null
        : "must be an ISO-8601 date string";

    case "enum": {
      const options = field.enum_options ?? [];
      return options.some((option) => option.value === value)
        ? null
        : `must be one of: ${options.map((option) => option.value).join(", ")}`;
    }

    case "person_ref": {
      if (!isUuid(value)) return "must be a resolved person UUID";
      // CHECKED AGAINST THE DATABASE, not merely shape-checked. A dynamic type
      // that can store a dangling reference is one whose records render as
      // blanks later — the same rule create_commitment applies to owner.
      const person = await people.resolvePerson(ctx.tx, value);
      return person ? null : "names no known person";
    }

    default: {
      // A seventh field_kind added to the Postgres enum without a branch here
      // is a compile error, not a value that silently validates.
      const exhaustive: never = field.field_kind;
      throw new Error(`unhandled field_kind: ${String(exhaustive)}`);
    }
  }
}

async function validate(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<CreateEntityRecordToolInput, ToolError[]>> {
  const input = (raw ?? {}) as CreateEntityRecordRawInput;

  if (typeof input.type_key !== "string" || input.type_key.trim() === "") {
    return err([
      { field: "type_key", code: "missing_type_key", message: "type_key must name a defined type." },
    ]);
  }
  if (input.payload === null || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    return err([
      { field: "payload", code: "invalid_payload", message: "payload must be an object." },
    ]);
  }

  // THE DYNAMIC PART: the schema is read at call time, not closed over.
  const type: EntityTypeWithFields | null = await entityRecords.getTypeByKey(
    ctx.tx,
    input.type_key,
  );
  if (!type) {
    return err([
      {
        field: "type_key",
        code: "unknown_entity_type",
        message: `No entity type "${input.type_key}". Define it first.`,
      },
    ]);
  }

  const payload = input.payload as Record<string, unknown>;
  const errors: ToolError[] = [];
  const byKey = new Map(type.fields.map((field) => [field.field_key, field]));

  // REJECT UNKNOWN KEYS. This is what stops `payload` becoming an untyped
  // bag: a typo'd `durationn` must fail loudly, not persist silently and then
  // vanish from every render because no field definition names it.
  for (const key of Object.keys(payload)) {
    if (!byKey.has(key)) {
      errors.push({
        field: key,
        code: "unknown_field",
        message: `"${key}" is not a field of ${type.display_name}.`,
      });
    }
  }

  for (const field of type.fields) {
    const present = Object.prototype.hasOwnProperty.call(payload, field.field_key);
    const value = payload[field.field_key];

    if (!present || value === null || value === undefined) {
      if (field.required) {
        errors.push({
          field: field.field_key,
          code: "missing_required_field",
          message: `${field.label} is required.`,
        });
      }
      continue;
    }

    const problem = await checkValue(field, value, ctx);
    if (problem) {
      errors.push({
        field: field.field_key,
        code: "invalid_field_value",
        message: `${field.label} ${problem}.`,
      });
    }
  }

  if (errors.length > 0) return err(errors);

  return ok({
    entityTypeId: type.id,
    typeKey: type.type_key,
    // Stamped from the type's CURRENT version (§1.3), so the renderer can
    // later tell "predates an added field" from "missing a required value".
    schemaVersion: type.current_version,
    payload,
  });
}

async function commit(
  input: CreateEntityRecordToolInput,
  ctx: ToolContext,
): Promise<{ output: CreateEntityRecordOutput; mutations: readonly LoggedMutation[] }> {
  const record = await entityRecords.createRecord(ctx.tx, {
    entityTypeId: input.entityTypeId,
    schemaVersion: input.schemaVersion,
    payload: input.payload,
  });

  return {
    output: { id: record.id, typeKey: input.typeKey, schemaVersion: record.schema_version },
    mutations: [
      {
        targetTable: "entity_records",
        targetId: record.id,
        forwardPatch: { typeKey: input.typeKey, payload: record.payload },
        inversePatch: { id: record.id } satisfies CreateEntityRecordInversePatch,
        invertibility: "full",
      },
    ],
  };
}

export const createEntityRecordTool: ToolDefinition<
  CreateEntityRecordToolInput,
  CreateEntityRecordOutput
> = {
  name: "create_entity_record",
  description:
    "Record one instance of a user-defined entity type — a gym session, a book, an " +
    "expense. type_key must name an existing type; payload keys must match that type's " +
    "fields exactly. Unknown keys are rejected rather than stored.",
  validate,
  commit,
};

/**
 * The `entity_records` inverse handler — one shape today, written as an
 * explicit check with a loud throw rather than an unconditional invalidate,
 * matching every other handler in this directory.
 */
registerInverseHandler("entity_records", async (tx, targetId, inversePatch) => {
  if (!targetId) return;
  if (inversePatch === null || typeof inversePatch !== "object") {
    throw new Error(
      `Unrecognized entity_records inverse_patch for target ${targetId}: ${JSON.stringify(inversePatch)}`,
    );
  }
  if ("id" in (inversePatch as object)) {
    await entityRecords.invalidateRecord(tx, targetId);
    return;
  }
  throw new Error(
    `Unrecognized entity_records inverse_patch shape for target ${targetId}: ${JSON.stringify(inversePatch)}`,
  );
});
