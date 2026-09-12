/**
 * complete_commitment — the first task of Phase 3 (docs/PHASE-3-DESIGN.md §1,
 * resolving finding F1). Nothing else in the phase can be demonstrated until
 * this exists: `completed_at` and the `completed_late` status were unreachable
 * from any code path before this file.
 *
 * Lateness is derived HERE, in the tool layer, from two `timestamptz` columns
 * — never from model output, and never inside packages/db (§2). This is the
 * ONLY place that decides `completed` vs `completed_late`.
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { commitments } from "@ourglass/db";
import type { CommitmentStatus } from "@ourglass/db";

export interface CompleteCommitmentRawInput {
  readonly commitment_id?: unknown; // resolved UUID (§3 input contract)
  readonly completed_at?: unknown; // ISO-8601 string, resolved by chrono — NEVER by the model
}

/**
 * What `validate` hands to `commit`. Carries the resolved `expectedAt` and a
 * parsed `Date` alongside the raw fields, same convention as
 * create-commitment.ts's `CreateCommitmentInput` (validate resolves once,
 * commit never re-derives what validate already computed).
 */
export interface CompleteCommitmentInput {
  readonly commitmentId: string;
  readonly completedAt: string;
  readonly expectedAt: Date | null;
  readonly completedAtDate: Date;
}

export interface CompleteCommitmentOutput {
  readonly id: string;
  readonly status: "completed" | "completed_late";
  readonly completedAt: string;
  readonly expectedAt: string | null;
  /** null when expected_at IS NULL — there is no deadline to be late against (§2). */
  readonly latenessMs: number | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isIsoDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

/**
 * Lateness, derived from two `Date`s and nothing else (§2.1).
 *
 * Pure: no `now()`, no timezone, no DB. `expected_at`/`completed_at` are both
 * `timestamptz` — absolute instants — so the difference is zone- and
 * DST-independent by construction. `expectedAt === null` means there was no
 * deadline to be late against: `completed`, `latenessMs: null` (NOT zero —
 * zero would claim "on time to the millisecond", which we cannot claim).
 * Strictly `> 0`: exactly-on-time is `completed`, not `completed_late`.
 */
export function deriveCompletion(
  expectedAt: Date | null,
  completedAt: Date,
): { status: "completed" | "completed_late"; latenessMs: number | null } {
  if (expectedAt === null) return { status: "completed", latenessMs: null };
  const latenessMs = completedAt.getTime() - expectedAt.getTime();
  return latenessMs > 0
    ? { status: "completed_late", latenessMs }
    : { status: "completed", latenessMs };
}

async function validate(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<CompleteCommitmentInput, ToolError[]>> {
  const errors: ToolError[] = [];
  const input = (raw ?? {}) as CompleteCommitmentRawInput;

  if (!isUuid(input.commitment_id)) {
    errors.push({
      field: "commitment_id",
      code: "invalid_uuid",
      message: "commitment_id must be a resolved commitment UUID, not a description",
    });
  }

  if (typeof input.completed_at !== "string" || input.completed_at.trim().length === 0) {
    errors.push({
      field: "completed_at",
      code: "invalid_completed_at",
      message: "completed_at is required and must be an ISO-8601 timestamp string",
    });
  } else if (!isIsoDate(input.completed_at)) {
    errors.push({
      field: "completed_at",
      code: "invalid_completed_at",
      message: "completed_at must parse as an ISO-8601 timestamp",
    });
  }

  // Stop before any DB access on shape errors.
  if (errors.length > 0) return err(errors);

  const commitmentId = input.commitment_id as string;
  const completedAtDate = new Date(input.completed_at as string);

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
    // Already-completed (or cancelled/superseded) is a validation REJECTION,
    // not an idempotent no-op (§1.2). Silently overwriting completed_at would
    // destroy the recorded moment the commitment actually completed — the
    // same class of bug as invalidateCommitment overwriting t_invalid.
    return err([
      {
        field: "commitment_id",
        code: "already_completed",
        message:
          row.completed_at !== null
            ? `This commitment is already ${row.status} (completed at ${row.completed_at.toISOString()})`
            : `This commitment is already ${row.status}`,
      },
    ]);
  }

  return ok({
    commitmentId,
    completedAt: (input.completed_at as string),
    expectedAt: row.expected_at,
    completedAtDate,
  });
}

async function commit(
  input: CompleteCommitmentInput,
  ctx: ToolContext,
): Promise<{ output: CompleteCommitmentOutput; mutations: readonly LoggedMutation[] }> {
  const { status, latenessMs } = deriveCompletion(input.expectedAt, input.completedAtDate);

  const result = await commitments.completeCommitment(ctx.tx, input.commitmentId, {
    status,
    completedAt: input.completedAtDate,
  });

  const mutation: LoggedMutation = {
    targetTable: "commitments",
    targetId: result.commitment.id,
    forwardPatch: {
      status: result.commitment.status,
      completedAt: result.commitment.completed_at,
      expectedAt: result.commitment.expected_at,
      latenessMs,
    },
    // Captured PRE-update — see commitments.completeCommitment's own doc.
    // This shape (`{ status, completedAt }`) is what create-commitment.ts's
    // shared "commitments" inverse handler dispatches on (§1.3).
    inversePatch: {
      status: result.previousStatus,
      completedAt: result.previousCompletedAt === null ? null : result.previousCompletedAt.toISOString(),
    },
    invertibility: "full",
  };

  return {
    output: {
      id: result.commitment.id,
      status: status,
      completedAt: result.commitment.completed_at!.toISOString(),
      expectedAt: result.commitment.expected_at === null ? null : result.commitment.expected_at.toISOString(),
      latenessMs,
    },
    mutations: [mutation],
  };
}

export const completeCommitmentTool: ToolDefinition<CompleteCommitmentInput, CompleteCommitmentOutput> = {
  name: "complete_commitment",
  description:
    "Mark a commitment complete. commitment_id must be a resolved commitment UUID. " +
    "completed_at must be a resolved ISO-8601 timestamp (never computed by the model). " +
    "Lateness against the commitment's expected_at is derived automatically.",
  validate,
  commit,
};

// Re-exported so update-commitment.ts's discriminated-union comment and its
// unit test can reference the exact shape without re-declaring it.
export type CompleteCommitmentInversePatch = {
  readonly status: CommitmentStatus;
  readonly completedAt: string | null;
};
