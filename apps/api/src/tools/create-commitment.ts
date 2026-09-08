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
import { registerInverseHandler } from "./inverses.js";

export interface CreateCommitmentRawInput {
  readonly owner_id?: unknown;
  readonly recipient_id?: unknown;
  readonly object_text?: unknown;
  readonly expected_at?: unknown;
  readonly project_id?: unknown;
}

export interface CreateCommitmentInput {
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

registerInverseHandler("commitments", async (tx, targetId) => {
  if (!targetId) return;
  // commitments.invalidateCommitment (packages/db) now preserves an
  // already-set t_invalid when called with no explicit timestamp
  // (`COALESCE($2, t_invalid, now())`, fixed by schema2 after review found
  // it previously overwrote unconditionally — see git history for
  // create-commitment.ts if this comment predates the fix in your checkout).
  // Undo calls it with no timestamp, so re-invalidating an already-invalid
  // commitment (e.g. a second undoTurn reaching this handler before the
  // duplicate-marker insert rejects it) is a no-op rather than a silent
  // overwrite of a legitimate earlier t_invalid (§2.1). No call-site guard
  // needed here — a stopgap guard was removed once the repository fix
  // landed, since it could not have replicated the explicit-timestamp
  // override behaviour the fixed function now provides.
  await commitments.invalidateCommitment(tx, targetId);
});
