/**
 * create_commitment — the first tool (docs/PHASE-1-DESIGN.md §4.3).
 *
 * Proves the whole pattern: both FK directions (owner_id/recipient_id,
 * spec §7's differentiator), the resolved-UUID input contract including
 * unknown-person rejection (§3), the transaction, the action_log
 * round-trip, and undo.
 *
 * Validation is hand-written rather than closing over a Zod schema. This
 * repo has no `zod` dependency yet, and CLAUDE.md's "no new framework
 * without a concrete requirement" applies: three tools with a handful of
 * fields each do not justify adding one. The ToolDefinition.validate
 * FUNCTION contract (§4.1) is satisfied either way — hand-written checks
 * are just as much "a function", and this file's define_entity_type
 * sibling still needs to query the DB inside validate() regardless of
 * whether static tools use Zod or plain checks.
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { commitments, people } from "@ourglass/db";
import type { CommitmentFieldPatch, CommitmentStatus } from "@ourglass/db";
import { registerInverseHandler } from "./inverses.js";

export interface CreateCommitmentRawInput {
  readonly owner_id?: unknown;
  readonly recipient_id?: unknown;
  readonly object_text?: unknown;
  readonly expected_at?: unknown;
  readonly project_id?: unknown;
  /**
   * OPTIONAL client-generated UUID (docs/PHASE-3-DESIGN.md §3.3). The
   * orchestrator mints this with `randomUUID()` when a same-turn call
   * (create_reminder.commitment_id, complete_commitment.commitment_id, ...)
   * needs to reference the commitment THIS call creates, before Postgres has
   * generated one — executeTurn passes call.input through verbatim with no
   * placeholder substitution, so the id must exist before validate() runs.
   * Omit it and packages/db's column DEFAULT fires exactly as before.
   */
  readonly id?: unknown;
}

export interface CreateCommitmentInput {
  readonly id: string | null;
  readonly ownerId: string;
  readonly recipientId: string | null;
  readonly objectText: string;
  readonly expectedAt: string | null;
  readonly projectId: string | null;
}

export interface CreateCommitmentOutput {
  readonly id: string;
  readonly ownerId: string;
  readonly recipientId: string | null;
  readonly status: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

async function validate(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<CreateCommitmentInput, ToolError[]>> {
  const errors: ToolError[] = [];
  const input = (raw ?? {}) as CreateCommitmentRawInput;

  if (!isUuid(input.owner_id)) {
    errors.push({
      field: "owner_id",
      code: "invalid_uuid",
      message: "owner_id must be a resolved UUID (a person's id), not a name",
    });
  }

  if (input.recipient_id !== undefined && input.recipient_id !== null && !isUuid(input.recipient_id)) {
    errors.push({
      field: "recipient_id",
      code: "invalid_uuid",
      message: "recipient_id must be a resolved UUID (a person's id), not a name",
    });
  }

  if (typeof input.object_text !== "string" || input.object_text.trim().length === 0) {
    errors.push({
      field: "object_text",
      code: "missing_object_text",
      message: "object_text is required and must be a non-empty string",
    });
  }

  if (
    input.expected_at !== undefined &&
    input.expected_at !== null &&
    typeof input.expected_at !== "string"
  ) {
    errors.push({
      field: "expected_at",
      code: "invalid_expected_at",
      message: "expected_at must be an ISO-8601 timestamp string, or omitted",
    });
  }

  if (input.project_id !== undefined && input.project_id !== null && !isUuid(input.project_id)) {
    errors.push({
      field: "project_id",
      code: "invalid_uuid",
      message: "project_id must be a resolved UUID, not a name",
    });
  }

  if (input.id !== undefined && input.id !== null && !isUuid(input.id)) {
    errors.push({
      field: "id",
      code: "invalid_uuid",
      message: "id, when supplied, must be a well-formed UUID (client-generated for same-turn references)",
    });
  }

  // Stop here on shape errors before touching the DB at all.
  if (errors.length > 0) return err(errors);

  const ownerId = input.owner_id as string;
  const recipientId = (input.recipient_id as string | null | undefined) ?? null;

  // §3: "create_commitment naming an unknown person FAILS. It does not
  // create the person." Existence is checked via resolvePersonId, which
  // also normalises a merged-away id to its survivor — a validate() call
  // should not reject a commitment naming a person who has since been
  // merged into someone else; that id still resolves to someone real.
  const resolvedOwnerId = await people.resolvePersonId(ctx.tx, ownerId);
  if (resolvedOwnerId === null) {
    errors.push({
      field: "owner_id",
      code: "unknown_person",
      message: `No person exists with id ${ownerId}`,
    });
  }

  let resolvedRecipientId: string | null = null;
  if (recipientId !== null) {
    resolvedRecipientId = await people.resolvePersonId(ctx.tx, recipientId);
    if (resolvedRecipientId === null) {
      errors.push({
        field: "recipient_id",
        code: "unknown_person",
        message: `No person exists with id ${recipientId}`,
      });
    }
  }

  if (errors.length > 0) return err(errors);

  // The `owner_is_not_recipient` CHECK constraint (packages/db migration 003)
  // would raise SQLSTATE 23514 if we let this reach the INSERT. Reject it
  // cleanly here instead of letting a constraint violation surface as an
  // unhandled 500 — per schema2's explicit flag on this constraint.
  if (resolvedOwnerId === resolvedRecipientId && resolvedRecipientId !== null) {
    return err([
      {
        field: "recipient_id",
        code: "owner_is_not_recipient",
        message: "A commitment's owner and recipient must be different people",
      },
    ]);
  }

  return ok({
    id: (input.id as string | null | undefined) ?? null,
    ownerId: resolvedOwnerId!,
    recipientId: resolvedRecipientId,
    objectText: (input.object_text as string).trim(),
    expectedAt: (input.expected_at as string | null | undefined) ?? null,
    projectId: (input.project_id as string | null | undefined) ?? null,
  });
}

async function commit(
  input: CreateCommitmentInput,
  ctx: ToolContext,
): Promise<{ output: CreateCommitmentOutput; mutations: readonly LoggedMutation[] }> {
  const row = await commitments.createCommitment(ctx.tx, {
    id: input.id,
    ownerId: input.ownerId,
    recipientId: input.recipientId,
    objectText: input.objectText,
    expectedAt: input.expectedAt,
    projectId: input.projectId,
  });

  const mutation: LoggedMutation = {
    targetTable: "commitments",
    targetId: row.id,
    forwardPatch: {
      ownerId: row.owner_id,
      recipientId: row.recipient_id,
      objectText: row.object_text,
      expectedAt: row.expected_at,
      projectId: row.project_id,
      status: row.status,
    },
    // Invalidate-never-delete: the inverse of a create is an invalidate.
    inversePatch: { id: row.id },
    invertibility: "full",
  };

  return {
    output: {
      id: row.id,
      ownerId: row.owner_id,
      recipientId: row.recipient_id,
      status: row.status,
    },
    mutations: [mutation],
  };
}

export const createCommitmentTool: ToolDefinition<CreateCommitmentInput, CreateCommitmentOutput> = {
  name: "create_commitment",
  description:
    "Record a commitment: owner_id owes recipient_id something (object_text), " +
    "optionally by expected_at. owner_id and recipient_id must be resolved person UUIDs.",
  validate,
  commit,
};

// ---------------------------------------------------------------------------
// The "commitments" inverse handler — shape-based dispatch (§1.3).
//
// registerInverseHandler is keyed by TABLE NAME and throws on a second
// registration for the same key (apps/api/src/tools/inverses.ts). Three
// different tools now mutate `commitments` — create_commitment (this file),
// complete_commitment, and update_commitment — each with a genuinely
// different inverse operation (invalidate / restore two columns / restore an
// arbitrary field subset). A naive second `registerInverseHandler("commitments",
// ...)` in either of those files would throw at MODULE LOAD — the registry
// index imports every tool module, so this is a startup crash, not a test
// failure.
//
// Decision (§1.3): ONE registration, here (this file owns the table's
// handler), branching on the SHAPE of inversePatch:
//   - `{ id }`                    -> a create's inverse: invalidate.
//   - `{ status, completedAt }`   -> complete_commitment's inverse: uncomplete.
//   - `{ fields }`                -> update_commitment's inverse: restore fields.
//
// Rejected: re-keying registerInverseHandler by (targetTable, toolName).
// Cleaner on paper, but undoTurn reads target_table out of action_log and
// calls applyInverseForTable(tx, entry.targetTable, ...) — tool_name is
// SELECTed but never passed (executor.ts). Re-keying would touch Phase-1-
// owned, CI-verified executor/dispatcher/SELECT code for a Phase 3 tool, and
// it would couple undo to tool NAMES: renaming a tool later would silently
// orphan historical action_log rows whose tool_name no longer resolves to
// any handler, with no error until someone tries to undo one. Table + patch
// shape is stable across renames; tool name is not.
//
// The cost, paid explicitly per §1.3: this is POSITIONAL DISCIPLINE, not
// type safety enforced by the compiler at the call site. What the compiler
// DOES enforce: `CommitmentsInversePatch` below is a discriminated union of
// the three known shapes, and this handler's `if`/`else if`/`else` chain is
// exhaustive over it — adding a fourth shape without a matching branch here
// is a type error at the `satisfies` check below, not a silent no-op at
// runtime. Each branch's discriminating key is asserted directly by a unit
// test (create-commitment.inverse-dispatch.test.ts).
// ---------------------------------------------------------------------------

/** create_commitment's own inverse shape: nothing to restore, just invalidate. */
export interface CreateInversePatch {
  readonly id: string;
}

/** complete_commitment's inverse shape (complete-commitment.ts's commit()). */
export interface CompleteInversePatch {
  readonly status: CommitmentStatus;
  readonly completedAt: string | null;
}

/** update_commitment's inverse shape (update-commitment.ts's commit()). */
export interface UpdateInversePatch {
  readonly fields: CommitmentFieldPatch;
}

export type CommitmentsInversePatch = CreateInversePatch | CompleteInversePatch | UpdateInversePatch;

// These take `object`, not `Record<string, unknown>`. A type predicate
// `x is T` requires T to be assignable to the parameter's type, and an
// interface with only `readonly` members has no index signature, so
// CompleteInversePatch is NOT assignable to Record<string, unknown> —
// TS2677. `object` is the widest type that every candidate shape does
// satisfy, and `in` narrowing works on it, so nothing is weakened: the
// predicates still return a member of the discriminated union, which is
// what makes the exhaustiveness check below compiler-enforced.
function isCompleteInversePatch(patch: object): patch is CompleteInversePatch {
  return "status" in patch;
}

function isUpdateInversePatch(patch: object): patch is UpdateInversePatch {
  return "fields" in patch;
}

function isCreateInversePatch(patch: object): patch is CreateInversePatch {
  return "id" in patch && !("status" in patch) && !("fields" in patch);
}

/**
 * Never called at runtime — a compile-time exhaustiveness check. If a fourth
 * shape is ever added to `CommitmentsInversePatch` without a matching branch
 * in `classifyCommitmentsInverse`, TypeScript narrows `patch` to something
 * other than `never` here and this file fails to compile. This is what makes
 * the shape dispatch "positional discipline, not type safety" (§1.3) into an
 * actual compiler-checked property rather than just a comment promising one.
 */
function assertNeverInversePatch(patch: never): never {
  throw new Error(`Unhandled commitments inverse_patch shape: ${JSON.stringify(patch)}`);
}

/**
 * Classifies a raw inverse_patch (JSONB read back from action_log — untrusted
 * input per .claude/rules/security.md) into one of the three known shapes.
 * Exported so the dispatch itself is unit-testable per branch without going
 * through the full executor/undo path (§1.3's "each branch's discriminating
 * key is asserted by a unit test").
 */
export function classifyCommitmentsInverse(inversePatch: unknown): CommitmentsInversePatch | null {
  if (inversePatch === null || typeof inversePatch !== "object") return null;
  const patch: object = inversePatch;
  if (isCompleteInversePatch(patch)) return patch;
  if (isUpdateInversePatch(patch)) return patch;
  if (isCreateInversePatch(patch)) return patch;
  return null;
}

registerInverseHandler("commitments", async (tx, targetId, inversePatch) => {
  if (!targetId) return;

  const patch = classifyCommitmentsInverse(inversePatch);
  if (patch === null) {
    throw new Error(
      `Unrecognized commitments inverse_patch shape for target ${targetId}: ${JSON.stringify(inversePatch)}`,
    );
  }

  if ("status" in patch) {
    // complete_commitment's inverse. BOTH prior values are required with no
    // defaults (docs/PHASE-3-DESIGN.md §1.1) — a default would restore
    // "never completed, pending", which is right only for undoing a FIRST
    // completion, not a re-completion after an earlier undo.
    await commitments.uncompleteCommitment(
      tx,
      targetId,
      patch.status,
      patch.completedAt === null ? null : new Date(patch.completedAt),
    );
    return;
  }

  if ("fields" in patch) {
    // update_commitment's inverse. restoreCommitmentFields validates every
    // key against a closed allowlist before it can reach SQL — `fields` is
    // JSONB read back from action_log.inverse_patch, i.e. untrusted input
    // per .claude/rules/security.md, never string-interpolated directly.
    await commitments.restoreCommitmentFields(tx, targetId, patch.fields as Record<string, unknown>);
    return;
  }

  if ("id" in patch) {
    // create_commitment's inverse: `{ id }`, nothing to restore — invalidate.
    //
    // commitments.invalidateCommitment preserves an already-set t_invalid
    // when called with no explicit timestamp (`COALESCE($2, t_invalid,
    // now())`, fixed after review found it previously overwrote
    // unconditionally — see git history for create-commitment.ts if this
    // comment predates the fix in your checkout). Undo calls it with no
    // timestamp, so re-invalidating an already-invalid commitment (e.g. a
    // second undoTurn reaching this handler before the duplicate-marker
    // insert rejects it) is a no-op rather than a silent overwrite of a
    // legitimate earlier t_invalid (§2.1).
    await commitments.invalidateCommitment(tx, targetId);
    return;
  }

  assertNeverInversePatch(patch);
});
