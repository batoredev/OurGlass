/**
 * remember, forget_memory, and correct_relationship — spec §16, §17, §28
 * (docs/PHASE-4-DESIGN.md §4).
 *
 * All three live in one file because two of them share the `memories` table
 * and therefore share its inverse handler — `registerInverseHandler` throws on
 * a duplicate table key, so splitting them and registering twice is a startup
 * crash. That collision was hit for real with `reminders` in Phase 3.
 *
 * WHAT THESE TOOLS DO NOT DO: compute embeddings. `remember` writes the row
 * and leaves `embedding` NULL (PHASE-4-DESIGN §2.2). Embedding is a network
 * hop to a third party, and holding a Postgres transaction open across one is
 * how a vendor slowdown exhausts the connection pool. The backfill path picks
 * it up — `WHERE embedding IS NULL` is exactly that query.
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { memories, relationships } from "@ourglass/db";
import type { MemoryKind, MemorySubjectKind, RelationshipObjectKind } from "@ourglass/db";
import { registerInverseHandler } from "./inverses.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

const MEMORY_KINDS: readonly MemoryKind[] = ["fact", "preference", "pattern"];
const SUBJECT_KINDS: readonly MemorySubjectKind[] = ["person", "organization", "project"];
const INFERENCE_LEVELS = ["CONFIRMED", "INFERRED", "UNCERTAIN"] as const;
type InferenceLevel = (typeof INFERENCE_LEVELS)[number];

// ---------------------------------------------------------------------------
// remember
// ---------------------------------------------------------------------------

export interface RememberRawInput {
  readonly kind?: unknown;
  readonly body?: unknown;
  readonly inference_level?: unknown;
  readonly subject_kind?: unknown;
  readonly subject_id?: unknown;
  readonly source_message_id?: unknown;
}

export interface RememberInput {
  readonly kind: MemoryKind;
  readonly body: string;
  readonly inferenceLevel: InferenceLevel;
  readonly subjectKind: MemorySubjectKind | null;
  readonly subjectId: string | null;
  readonly sourceMessageId: string | null;
}

export interface RememberOutput {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly body: string;
}

/** remember's inverse shape: nothing to restore, just invalidate. */
export interface RememberInversePatch {
  readonly id: string;
}

async function validateRemember(raw: unknown): Promise<Result<RememberInput, ToolError[]>> {
  const errors: ToolError[] = [];
  const input = (raw ?? {}) as RememberRawInput;

  if (!MEMORY_KINDS.includes(input.kind as MemoryKind)) {
    errors.push({
      field: "kind",
      code: "invalid_memory_kind",
      // The enum is closed BECAUSE of spec §13: a `pattern` must be countable
      // from rows ("you've postponed this three times"), never an inferred
      // motive. A `trait` or `insight` kind would make profiling storable.
      message: `kind must be one of: ${MEMORY_KINDS.join(", ")}.`,
    });
  }
  if (typeof input.body !== "string" || input.body.trim() === "") {
    errors.push({ field: "body", code: "missing_body", message: "body must say what to remember." });
  }
  if (!INFERENCE_LEVELS.includes(input.inference_level as InferenceLevel)) {
    errors.push({
      field: "inference_level",
      code: "invalid_inference_level",
      message: `inference_level must be one of: ${INFERENCE_LEVELS.join(", ")}.`,
    });
  }

  // Both or neither (migration 010's CHECK). Enforced here too so the user
  // gets a sentence rather than a constraint-violation stack.
  const hasKind = input.subject_kind !== undefined && input.subject_kind !== null;
  const hasId = input.subject_id !== undefined && input.subject_id !== null;
  if (hasKind !== hasId) {
    errors.push({
      field: "subject_id",
      code: "incomplete_subject",
      message: "subject_kind and subject_id must be given together, or both omitted.",
    });
  }
  if (hasKind && !SUBJECT_KINDS.includes(input.subject_kind as MemorySubjectKind)) {
    errors.push({
      field: "subject_kind",
      code: "invalid_subject_kind",
      message: `subject_kind must be one of: ${SUBJECT_KINDS.join(", ")}.`,
    });
  }
  if (hasId && !isUuid(input.subject_id)) {
    errors.push({
      field: "subject_id",
      code: "invalid_uuid",
      message: "subject_id must be a resolved entity UUID.",
    });
  }
  if (
    input.source_message_id !== undefined &&
    input.source_message_id !== null &&
    !isUuid(input.source_message_id)
  ) {
    errors.push({
      field: "source_message_id",
      code: "invalid_uuid",
      message: "source_message_id must be a message UUID, or omitted.",
    });
  }

  if (errors.length > 0) return err(errors);

  return ok({
    kind: input.kind as MemoryKind,
    body: (input.body as string).trim(),
    inferenceLevel: input.inference_level as InferenceLevel,
    subjectKind: hasKind ? (input.subject_kind as MemorySubjectKind) : null,
    subjectId: hasId ? (input.subject_id as string) : null,
    sourceMessageId: isUuid(input.source_message_id) ? input.source_message_id : null,
  });
}

async function commitRemember(
  input: RememberInput,
  ctx: ToolContext,
): Promise<{ output: RememberOutput; mutations: readonly LoggedMutation[] }> {
  const memory = await memories.createMemory(ctx.tx, {
    kind: input.kind,
    body: input.body,
    inferenceLevel: input.inferenceLevel,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    sourceMessageId: input.sourceMessageId,
    // NO EMBEDDING. See this file's header: it is deliberately deferred to the
    // backfill so a third-party outage cannot block a write.
  });

  return {
    output: { id: memory.id, kind: memory.kind, body: memory.body },
    mutations: [
      {
        targetTable: "memories",
        targetId: memory.id,
        forwardPatch: { kind: memory.kind, body: memory.body, subjectId: memory.subject_id },
        inversePatch: { id: memory.id } satisfies RememberInversePatch,
        invertibility: "full",
      },
    ],
  };
}

export const rememberTool: ToolDefinition<RememberInput, RememberOutput> = {
  name: "remember",
  description:
    "Store a durable fact, preference, or observed pattern. A 'pattern' must be an " +
    "OBSERVABLE COUNT ('postponed this three times'), never an inferred motive. " +
    "subject_kind and subject_id link it to a person, organization, or project.",
  validate: validateRemember,
  commit: commitRemember,
};

// ---------------------------------------------------------------------------
// forget_memory — §28's "Forget that Arun works on backend"
// ---------------------------------------------------------------------------

export interface ForgetMemoryInput {
  readonly memoryId: string;
}

export interface ForgetMemoryOutput {
  readonly id: string;
  readonly body: string;
}

/** forget_memory's inverse shape — restore the captured prior t_invalid. */
export interface ForgetMemoryInversePatch {
  readonly invalidAt: string | null;
}

async function validateForget(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<ForgetMemoryInput, ToolError[]>> {
  const input = (raw ?? {}) as { memory_id?: unknown };
  if (!isUuid(input.memory_id)) {
    return err([
      { field: "memory_id", code: "invalid_uuid", message: "memory_id must be a memory UUID." },
    ]);
  }
  const memory = await memories.getById(ctx.tx, input.memory_id);
  if (!memory) {
    return err([{ field: "memory_id", code: "unknown_memory", message: "No such memory." }]);
  }
  return ok({ memoryId: input.memory_id });
}

async function commitForget(
  input: ForgetMemoryInput,
  ctx: ToolContext,
): Promise<{ output: ForgetMemoryOutput; mutations: readonly LoggedMutation[] }> {
  const before = await memories.getById(ctx.tx, input.memoryId);
  if (!before) throw new Error(`memory ${input.memoryId} vanished between validate and commit`);

  await memories.invalidateMemory(ctx.tx, input.memoryId);

  return {
    output: { id: before.id, body: before.body },
    mutations: [
      {
        targetTable: "memories",
        targetId: before.id,
        forwardPatch: { forgotten: true },
        // Captured PRE-update. Defaulting to null on undo would restore "was
        // never forgotten", correct only for undoing a FIRST forget.
        inversePatch: {
          invalidAt: before.t_invalid === null ? null : before.t_invalid.toISOString(),
        } satisfies ForgetMemoryInversePatch,
        invertibility: "full",
      },
    ],
  };
}

export const forgetMemoryTool: ToolDefinition<ForgetMemoryInput, ForgetMemoryOutput> = {
  name: "forget_memory",
  description:
    "Stop treating a memory as current. INVALIDATES, never deletes — 'forget' is a " +
    "statement about what is true now, not a demand to destroy the audit trail, and " +
    "the action is undoable.",
  validate: validateForget,
  commit: commitForget,
};

// ---------------------------------------------------------------------------
// correct_relationship — §17
// ---------------------------------------------------------------------------

export interface CorrectRelationshipInput {
  readonly oldRelationshipId: string;
  readonly subjectId: string;
  readonly relType: string;
  readonly objectKind: RelationshipObjectKind;
  readonly objectId: string;
  readonly inferenceLevel: InferenceLevel;
  readonly validFrom: string | null;
  readonly sourceMessageId: string | null;
}

export interface CorrectRelationshipOutput {
  readonly supersededId: string;
  readonly replacementId: string;
  readonly validFrom: string;
}

/** correct_relationship's inverse shape — reopen one edge, close the other. */
export interface CorrectRelationshipInversePatch {
  readonly supersededId: string;
  readonly replacementId: string;
  readonly previousInvalidAt: string | null;
}

async function validateCorrect(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<CorrectRelationshipInput, ToolError[]>> {
  const errors: ToolError[] = [];
  const input = (raw ?? {}) as Record<string, unknown>;

  if (!isUuid(input["old_relationship_id"])) {
    errors.push({
      field: "old_relationship_id",
      code: "invalid_uuid",
      message: "old_relationship_id must be the UUID of the edge being corrected.",
    });
  }
  if (!isUuid(input["subject_id"])) {
    errors.push({ field: "subject_id", code: "invalid_uuid", message: "subject_id must be a UUID." });
  }
  if (!isUuid(input["object_id"])) {
    errors.push({ field: "object_id", code: "invalid_uuid", message: "object_id must be a UUID." });
  }
  if (typeof input["rel_type"] !== "string" || input["rel_type"].trim() === "") {
    errors.push({
      field: "rel_type",
      code: "missing_rel_type",
      message: "rel_type must name the relationship, e.g. 'handles'.",
    });
  }
  if (!SUBJECT_KINDS.includes(input["object_kind"] as MemorySubjectKind)) {
    errors.push({
      field: "object_kind",
      code: "invalid_object_kind",
      message: `object_kind must be one of: ${SUBJECT_KINDS.join(", ")}.`,
    });
  }
  if (!INFERENCE_LEVELS.includes(input["inference_level"] as InferenceLevel)) {
    errors.push({
      field: "inference_level",
      code: "invalid_inference_level",
      message: `inference_level must be one of: ${INFERENCE_LEVELS.join(", ")}.`,
    });
  }
  // Resolved by chrono, never computed by the model (DECISIONS.md #4). Optional
  // because most corrections are about the present.
  const validFrom = input["valid_from"];
  if (validFrom !== undefined && validFrom !== null) {
    if (typeof validFrom !== "string" || Number.isNaN(Date.parse(validFrom))) {
      errors.push({
        field: "valid_from",
        code: "invalid_valid_from",
        message: "valid_from must be a resolved ISO-8601 timestamp, never natural language.",
      });
    }
  }

  if (errors.length > 0) return err(errors);

  const existing = await relationships.getById(ctx.tx, input["old_relationship_id"] as string);
  if (!existing) {
    return err([
      {
        field: "old_relationship_id",
        code: "unknown_relationship",
        message: "No such relationship to correct.",
      },
    ]);
  }

  return ok({
    oldRelationshipId: input["old_relationship_id"] as string,
    subjectId: input["subject_id"] as string,
    relType: (input["rel_type"] as string).trim(),
    objectKind: input["object_kind"] as RelationshipObjectKind,
    objectId: input["object_id"] as string,
    inferenceLevel: input["inference_level"] as InferenceLevel,
    validFrom: typeof validFrom === "string" ? validFrom : null,
    sourceMessageId: isUuid(input["source_message_id"])
      ? (input["source_message_id"] as string)
      : null,
  });
}

async function commitCorrect(
  input: CorrectRelationshipInput,
  ctx: ToolContext,
): Promise<{ output: CorrectRelationshipOutput; mutations: readonly LoggedMutation[] }> {
  // The supersede does the load-bearing work: it closes the old edge AT THE
  // NEW EDGE'S VALIDITY START, not at now(). See relationships.ts — using
  // now() would invent a fact whenever the correction is about the past.
  const result = await relationships.supersedeRelationship(ctx.tx, input.oldRelationshipId, {
    subjectId: input.subjectId,
    relType: input.relType,
    objectKind: input.objectKind,
    objectId: input.objectId,
    inferenceLevel: input.inferenceLevel,
    sourceMessageId: input.sourceMessageId,
    validFrom: input.validFrom === null ? null : new Date(input.validFrom),
  });

  return {
    output: {
      supersededId: result.superseded.id,
      replacementId: result.replacement.id,
      validFrom: result.replacement.t_valid.toISOString(),
    },
    mutations: [
      {
        targetTable: "relationships",
        targetId: result.superseded.id,
        forwardPatch: {
          supersededBy: result.replacement.id,
          invalidAt: result.superseded.t_invalid?.toISOString() ?? null,
        },
        inversePatch: {
          supersededId: result.superseded.id,
          replacementId: result.replacement.id,
          previousInvalidAt:
            result.previousInvalidAt === null ? null : result.previousInvalidAt.toISOString(),
        } satisfies CorrectRelationshipInversePatch,
        invertibility: "full",
      },
    ],
  };
}

export const correctRelationshipTool: ToolDefinition<
  CorrectRelationshipInput,
  CorrectRelationshipOutput
> = {
  name: "correct_relationship",
  description:
    "Replace a relationship with a corrected one, preserving history. 'No, Karthik " +
    "handles it now.' The old edge is closed at the new one's validity start — never " +
    "deleted, never updated in place. valid_from is a resolved ISO-8601 timestamp.",
  validate: validateCorrect,
  commit: commitCorrect,
};

// ---------------------------------------------------------------------------
// Inverse handlers
// ---------------------------------------------------------------------------

/**
 * `memories` — ONE registration for the table, dispatching on patch SHAPE,
 * the pattern create-commitment.ts §1.3 established and `reminders`,
 * `workflows` and `commitment_notes` all follow.
 *
 *   `{ invalidAt }` -> forget_memory's inverse: restore the prior t_invalid.
 *   `{ id }`        -> remember's inverse: invalidate.
 */
registerInverseHandler("memories", async (tx, targetId, inversePatch) => {
  if (!targetId) return;
  if (inversePatch === null || typeof inversePatch !== "object") {
    throw new Error(
      `Unrecognized memories inverse_patch for target ${targetId}: ${JSON.stringify(inversePatch)}`,
    );
  }
  const patch: object = inversePatch;

  if ("invalidAt" in patch) {
    const { invalidAt } = patch as ForgetMemoryInversePatch;
    await memories.revalidateMemory(tx, targetId, invalidAt === null ? null : new Date(invalidAt));
    return;
  }
  if ("id" in patch) {
    await memories.invalidateMemory(tx, targetId);
    return;
  }
  throw new Error(
    `Unrecognized memories inverse_patch shape for target ${targetId}: ${JSON.stringify(inversePatch)}`,
  );
});

/**
 * `relationships` — one shape today (correct_relationship), written as an
 * explicit check with a loud throw rather than an unconditional action, for
 * the same reason as every other handler here: a handler that ignores its
 * patch silently reverses the wrong thing the day a second tool arrives.
 */
registerInverseHandler("relationships", async (tx, targetId, inversePatch) => {
  if (!targetId) return;
  if (inversePatch === null || typeof inversePatch !== "object") {
    throw new Error(
      `Unrecognized relationships inverse_patch for target ${targetId}: ${JSON.stringify(inversePatch)}`,
    );
  }
  const patch: object = inversePatch;

  if ("supersededId" in patch) {
    const { supersededId, replacementId, previousInvalidAt } =
      patch as CorrectRelationshipInversePatch;
    await relationships.unsupersedeRelationship(
      tx,
      supersededId,
      replacementId,
      previousInvalidAt === null ? null : new Date(previousInvalidAt),
    );
    return;
  }
  throw new Error(
    `Unrecognized relationships inverse_patch shape for target ${targetId}: ${JSON.stringify(inversePatch)}`,
  );
});
