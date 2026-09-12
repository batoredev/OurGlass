/**
 * update_commitment — spec §22 ("Arun still hasn't sent the schema" updates
 * the EXISTING commitment rather than creating a second one).
 * docs/PHASE-3-DESIGN.md §1.4.
 *
 * Three constraints, all load-bearing:
 *   1. Cannot set `completed`/`completed_late` — those come only from
 *      complete_commitment, the ONE place lateness is derived (§2).
 *   2. Only fields actually PRESENT are updated, and inversePatch captures
 *      only those same fields' prior values — never the whole row.
 *   3. Same self-join capture as complete_commitment; restoreCommitmentFields
 *      builds its SET list from a closed allowlist, never from an
 *      interpolated key read back out of inversePatch (JSONB from the DB is
 *      untrusted input per .claude/rules/security.md).
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { commitments } from "@ourglass/db";
import type { CommitmentFieldPatch, CommitmentStatus } from "@ourglass/db";

export interface UpdateCommitmentRawInput {
  readonly commitment_id?: unknown;
  readonly status?: unknown; // a commitment_status value, EXCLUDING the two completed ones
  readonly expected_at?: unknown; // ISO string or null
  readonly object_text?: unknown; // raw content field — never resolved
}

export interface UpdateCommitmentInput {
  readonly commitmentId: string;
  readonly patch: CommitmentFieldPatch;
}

export interface UpdateCommitmentOutput {
  readonly id: string;
  readonly status: string;
  readonly expectedAt: string | null;
  readonly objectText: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Statuses `update_commitment` may set. Excludes the two completed values (constraint 1). */
const NON_COMPLETING_STATUSES: readonly CommitmentStatus[] = [
  "pending",
  "in_progress",
  "waiting",
  "waiting_on_someone",
  "cancelled",
  "blocked",
  "superseded",
];

function isNonCompletingStatus(value: unknown): value is CommitmentStatus {
  return (
    typeof value === "string" &&
    (NON_COMPLETING_STATUSES as readonly string[]).includes(value)
  );
}

async function validate(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<UpdateCommitmentInput, ToolError[]>> {
  const errors: ToolError[] = [];
  const input = (raw ?? {}) as UpdateCommitmentRawInput;

  if (!isUuid(input.commitment_id)) {
    errors.push({
      field: "commitment_id",
      code: "invalid_uuid",
      message: "commitment_id must be a resolved commitment UUID, not a description",
    });
  }

  const hasStatus = input.status !== undefined;
  const hasExpectedAt = input.expected_at !== undefined;
  const hasObjectText = input.object_text !== undefined;

  if (!hasStatus && !hasExpectedAt && !hasObjectText) {
    errors.push({
      field: "commitment_id",
      code: "no_fields_to_update",
      message: "update_commitment requires at least one of status, expected_at, object_text",
    });
  }

  if (hasStatus) {
    if (input.status === "completed" || input.status === "completed_late") {
      errors.push({
        field: "status",
        code: "use_complete_commitment",
        message: "Use complete_commitment to mark a commitment done — it derives lateness",
      });
    } else if (!isNonCompletingStatus(input.status)) {
      errors.push({
        field: "status",
        code: "invalid_status",
        message: `status must be one of: ${NON_COMPLETING_STATUSES.join(", ")}`,
      });
    }
  }

  if (hasExpectedAt && input.expected_at !== null && typeof input.expected_at !== "string") {
    errors.push({
      field: "expected_at",
      code: "invalid_expected_at",
      message: "expected_at must be an ISO-8601 timestamp string, or null",
    });
  } else if (
    hasExpectedAt &&
    typeof input.expected_at === "string" &&
    Number.isNaN(Date.parse(input.expected_at))
  ) {
    errors.push({
      field: "expected_at",
      code: "invalid_expected_at",
      message: "expected_at must parse as an ISO-8601 timestamp",
    });
  }

  if (hasObjectText && (typeof input.object_text !== "string" || input.object_text.trim().length === 0)) {
    errors.push({
      field: "object_text",
      code: "missing_object_text",
      message: "object_text must be a non-empty string when present",
    });
  }

  // Stop before any DB access on shape errors.
  if (errors.length > 0) return err(errors);

  const commitmentId = input.commitment_id as string;

  const row = await commitments.getById(ctx.tx, commitmentId);
  if (!row || row.t_invalid !== null) {
    return err([
      {
        field: "commitment_id",
        code: "unknown_commitment",
        message: `No current commitment exists with id ${commitmentId}`,
      },
    ]);
  }

  if (commitments.isTerminalStatus(row.status)) {
    return err([
      {
        field: "commitment_id",
        code: "already_completed",
        message: `This commitment is already ${row.status} and cannot be updated`,
      },
    ]);
  }

  const patch: CommitmentFieldPatch = {};
  if (hasStatus) patch.status = input.status as CommitmentStatus;
  if (hasExpectedAt) patch.expectedAt = (input.expected_at as string | null) ?? null;
  if (hasObjectText) patch.objectText = (input.object_text as string).trim();

  return ok({ commitmentId, patch });
}

async function commit(
  input: UpdateCommitmentInput,
  ctx: ToolContext,
): Promise<{ output: UpdateCommitmentOutput; mutations: readonly LoggedMutation[] }> {
  const result = await commitments.updateCommitment(ctx.tx, input.commitmentId, input.patch);

  const mutation: LoggedMutation = {
    targetTable: "commitments",
    targetId: result.commitment.id,
    forwardPatch: { fields: input.patch },
    // `{ fields: ... }` is the OTHER discriminating shape create-commitment.ts's
    // shared "commitments" inverse handler dispatches on (§1.3) — distinct from
    // complete_commitment's `{ status, completedAt }` shape and create's `{ id }`.
    inversePatch: { fields: result.previousFields },
    invertibility: "full",
  };

  return {
    output: {
      id: result.commitment.id,
      status: result.commitment.status,
      expectedAt: result.commitment.expected_at === null ? null : result.commitment.expected_at.toISOString(),
      objectText: result.commitment.object_text,
    },
    mutations: [mutation],
  };
}

export const updateCommitmentTool: ToolDefinition<UpdateCommitmentInput, UpdateCommitmentOutput> = {
  name: "update_commitment",
  description:
    "Update an existing commitment's status, expected_at, or object_text. " +
    "commitment_id must be a resolved commitment UUID. Cannot set status to " +
    "completed/completed_late — use complete_commitment for that.",
  validate,
  commit,
};
