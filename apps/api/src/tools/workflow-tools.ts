/**
 * create_workflow and evaluate_workflow — conditional rules, spec §25
 * (docs/PHASE-3-DESIGN.md §7).
 *
 * "If Arun hasn't sent the schema by Friday, remind me."
 *
 * BOTH TOOLS LIVE IN ONE FILE because they share a table and therefore share
 * an inverse handler — `registerInverseHandler` throws on a duplicate table
 * key, so splitting them across two modules and registering twice is a
 * startup crash. That collision was hit for real with `reminders` this phase;
 * see create-reminder.ts's handler comment.
 *
 * FIXED DEPTH, ONE LEVEL: exactly one condition, one deadline, one action.
 * Not an AST, not a JSONB predicate tree — DECISIONS.md #2 records that
 * recursive schemas are unsupported by Anthropic structured outputs under the
 * strict subset, and a shape the model cannot emit is a shape we must not
 * store. Compound conditions ("if X and Y") are rejected here with a clean
 * ToolError rather than silently half-stored.
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { commitments, workflows } from "@ourglass/db";
import type { WorkflowActionKind, WorkflowConditionKind } from "@ourglass/db";
import { registerInverseHandler } from "./inverses.js";

const CONDITION_KINDS: readonly WorkflowConditionKind[] = [
  "commitment_not_completed",
  "commitment_not_updated",
];
const ACTION_KINDS: readonly WorkflowActionKind[] = ["remind", "ask"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ---------------------------------------------------------------------------
// create_workflow
// ---------------------------------------------------------------------------

export interface CreateWorkflowRawInput {
  readonly condition_kind?: unknown;
  readonly subject_commitment_id?: unknown;
  readonly evaluate_at?: unknown;
  readonly action_kind?: unknown;
  readonly action_body?: unknown;
  readonly source_phrase?: unknown;
}

export interface CreateWorkflowInput {
  readonly conditionKind: WorkflowConditionKind;
  readonly subjectCommitmentId: string;
  readonly evaluateAt: string;
  readonly actionKind: WorkflowActionKind;
  readonly actionBody: string;
  readonly sourcePhrase: string | null;
}

export interface CreateWorkflowOutput {
  readonly id: string;
  readonly conditionKind: WorkflowConditionKind;
  readonly subjectCommitmentId: string;
  readonly evaluateAt: string;
}

/** create_workflow's inverse shape: nothing to restore, just invalidate. */
export interface CreateWorkflowInversePatch {
  readonly id: string;
}

async function validateCreate(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<CreateWorkflowInput, ToolError[]>> {
  const errors: ToolError[] = [];
  const input = (raw ?? {}) as CreateWorkflowRawInput;

  if (!CONDITION_KINDS.includes(input.condition_kind as WorkflowConditionKind)) {
    errors.push({
      field: "condition_kind",
      code: "invalid_condition_kind",
      message: `condition_kind must be one of: ${CONDITION_KINDS.join(", ")}. Compound conditions are not supported.`,
    });
  }
  if (!ACTION_KINDS.includes(input.action_kind as WorkflowActionKind)) {
    errors.push({
      field: "action_kind",
      code: "invalid_action_kind",
      message: `action_kind must be one of: ${ACTION_KINDS.join(", ")}.`,
    });
  }
  if (!isUuid(input.subject_commitment_id)) {
    errors.push({
      field: "subject_commitment_id",
      code: "invalid_uuid",
      message: "subject_commitment_id must be a resolved commitment UUID.",
    });
  }
  // The model NEVER computes a timestamp (DECISIONS.md #4) — `evaluate_at` is
  // resolved by chrono-node from the verbatim phrase, which `source_phrase`
  // preserves so the resolution stays auditable.
  if (typeof input.evaluate_at !== "string" || Number.isNaN(Date.parse(input.evaluate_at))) {
    errors.push({
      field: "evaluate_at",
      code: "invalid_evaluate_at",
      message: "evaluate_at must be a resolved ISO-8601 timestamp, never natural language.",
    });
  }
  if (typeof input.action_body !== "string" || input.action_body.trim() === "") {
    errors.push({
      field: "action_body",
      code: "missing_action_body",
      message: "action_body must say what to do when the condition holds.",
    });
  }
  if (
    input.source_phrase !== undefined &&
    input.source_phrase !== null &&
    typeof input.source_phrase !== "string"
  ) {
    errors.push({
      field: "source_phrase",
      code: "invalid_source_phrase",
      message: "source_phrase must be the user's verbatim conditional, or omitted.",
    });
  }

  if (errors.length > 0) return err(errors);

  // Existence checked in validate, not commit: the executor validates every
  // call in a turn before committing any, so a bad subject rolls the whole
  // turn back having written nothing. A workflow pointing at a commitment
  // that does not exist would evaluate to `false` forever and silently never
  // fire — worse than a rejection, because it looks like it worked.
  const subject = await commitments.getById(ctx.tx, input.subject_commitment_id as string);
  if (!subject) {
    return err([
      {
        field: "subject_commitment_id",
        code: "unknown_commitment",
        message: "No such commitment.",
      },
    ]);
  }

  return ok({
    conditionKind: input.condition_kind as WorkflowConditionKind,
    subjectCommitmentId: input.subject_commitment_id as string,
    evaluateAt: input.evaluate_at as string,
    actionKind: input.action_kind as WorkflowActionKind,
    actionBody: (input.action_body as string).trim(),
    sourcePhrase: typeof input.source_phrase === "string" ? input.source_phrase : null,
  });
}

async function commitCreate(
  input: CreateWorkflowInput,
  ctx: ToolContext,
): Promise<{ output: CreateWorkflowOutput; mutations: readonly LoggedMutation[] }> {
  const row = await workflows.createWorkflow(ctx.tx, {
    conditionKind: input.conditionKind,
    subjectCommitmentId: input.subjectCommitmentId,
    evaluateAt: new Date(input.evaluateAt),
    actionKind: input.actionKind,
    actionBody: input.actionBody,
    sourcePhrase: input.sourcePhrase,
  });

  const mutation: LoggedMutation = {
    targetTable: "workflows",
    targetId: row.id,
    forwardPatch: {
      conditionKind: row.condition_kind,
      subjectCommitmentId: row.subject_commitment_id,
      evaluateAt: row.evaluate_at.toISOString(),
      actionKind: row.action_kind,
      actionBody: row.action_body,
    },
    inversePatch: { id: row.id } satisfies CreateWorkflowInversePatch,
    invertibility: "full",
  };

  return {
    output: {
      id: row.id,
      conditionKind: row.condition_kind,
      subjectCommitmentId: row.subject_commitment_id,
      evaluateAt: row.evaluate_at.toISOString(),
    },
    mutations: [mutation],
  };
}

export const createWorkflowTool: ToolDefinition<CreateWorkflowInput, CreateWorkflowOutput> = {
  name: "create_workflow",
  description:
    "Create a conditional rule: one condition about one commitment, one deadline, one " +
    "action. 'If Arun hasn't sent the schema by Friday, remind me.' evaluate_at must be " +
    "a resolved ISO-8601 timestamp; source_phrase preserves the verbatim conditional. " +
    "Compound conditions are not supported and are rejected.",
  validate: validateCreate,
  commit: commitCreate,
};

// ---------------------------------------------------------------------------
// evaluate_workflow — the poller's tool, the §7.3 correctness requirement
// ---------------------------------------------------------------------------

export interface EvaluateWorkflowRawInput {
  readonly workflow_id?: unknown;
  readonly evaluated_at?: unknown;
}

export interface EvaluateWorkflowInput {
  readonly workflowId: string;
  readonly evaluatedAt: string;
  readonly evaluatedAtDate: Date;
}

export interface EvaluateWorkflowOutput {
  readonly id: string;
  /** Did the condition actually hold? */
  readonly fired: boolean;
  readonly actionKind: WorkflowActionKind;
  readonly actionBody: string;
  readonly subjectCommitmentId: string;
}

/** evaluate_workflow's inverse shape — reset both columns to their prior values. */
export interface EvaluateWorkflowInversePatch {
  readonly evaluatedAt: string | null;
  readonly fired: boolean | null;
}

async function validateEvaluate(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<EvaluateWorkflowInput, ToolError[]>> {
  const errors: ToolError[] = [];
  const input = (raw ?? {}) as EvaluateWorkflowRawInput;

  if (!isUuid(input.workflow_id)) {
    errors.push({
      field: "workflow_id",
      code: "invalid_uuid",
      message: "workflow_id must be a resolved workflow UUID.",
    });
  }
  // The clock is a PARAMETER, as everywhere in the poller path (§6.4).
  if (typeof input.evaluated_at !== "string" || Number.isNaN(Date.parse(input.evaluated_at))) {
    errors.push({
      field: "evaluated_at",
      code: "invalid_evaluated_at",
      message: "evaluated_at must be an ISO-8601 timestamp supplied by the poller's clock.",
    });
  }
  if (errors.length > 0) return err(errors);

  const workflow = await workflows.getById(ctx.tx, input.workflow_id as string);
  if (!workflow) {
    return err([{ field: "workflow_id", code: "unknown_workflow", message: "No such workflow." }]);
  }
  if (workflow.t_invalid !== null) {
    // §7.3 path 2: the workflow itself was undone. `claimDueWorkflows` filters
    // these out, so reaching here means it was invalidated between claim and
    // call — rare, and still wrong to evaluate.
    return err([
      { field: "workflow_id", code: "workflow_cancelled", message: "This rule was cancelled." },
    ]);
  }

  return ok({
    workflowId: input.workflow_id as string,
    evaluatedAt: input.evaluated_at as string,
    evaluatedAtDate: new Date(input.evaluated_at as string),
  });
}

async function commitEvaluate(
  input: EvaluateWorkflowInput,
  ctx: ToolContext,
): Promise<{ output: EvaluateWorkflowOutput; mutations: readonly LoggedMutation[] }> {
  const before = await workflows.getById(ctx.tx, input.workflowId);
  if (!before) throw new Error(`workflow ${input.workflowId} vanished between validate and commit`);

  // =====================================================================
  // §7.3, THE CORRECTNESS REQUIREMENT OF THE WHOLE SECTION.
  //
  // The condition is evaluated against LIVE STATE, here, at evaluate_at —
  // not when the rule was created, and never continuously. That is what
  // makes early completion silence the rule: if Arun sent the schema on
  // Wednesday, then on Friday the status is `completed`, the condition is
  // FALSE, and nothing is emitted. The user is never reminded about
  // something that already happened.
  //
  // evaluateCondition also returns false for a subject ABSENT from
  // commitments_current (undone, or corrected away). Do not "simplify" that
  // to "not completed, therefore fire" — it would remind the user about a
  // commitment that no longer exists.
  // =====================================================================
  const held = await workflows.evaluateCondition(
    ctx.tx,
    before.condition_kind,
    before.subject_commitment_id,
  );

  const transitioned = await workflows.markEvaluated(
    ctx.tx,
    [input.workflowId],
    input.evaluatedAtDate,
    held,
  );
  if (transitioned.length === 0) {
    throw new Error(`workflow ${input.workflowId} was already evaluated`);
  }

  const mutation: LoggedMutation = {
    targetTable: "workflows",
    targetId: input.workflowId,
    forwardPatch: { evaluatedAt: input.evaluatedAt, fired: held },
    // Captured PRE-update by reading the row before markEvaluated ran —
    // `RETURNING *` on an UPDATE is post-update state (Phase 1 finding #4).
    inversePatch: {
      evaluatedAt: before.evaluated_at === null ? null : before.evaluated_at.toISOString(),
      fired: before.fired,
    } satisfies EvaluateWorkflowInversePatch,
    invertibility: "full",
  };

  return {
    output: {
      id: before.id,
      fired: held,
      actionKind: before.action_kind,
      actionBody: before.action_body,
      subjectCommitmentId: before.subject_commitment_id,
    },
    mutations: [mutation],
  };
}

export const evaluateWorkflowTool: ToolDefinition<EvaluateWorkflowInput, EvaluateWorkflowOutput> = {
  name: "evaluate_workflow",
  description:
    "Evaluate one conditional rule against live state and record the outcome. Called " +
    "only by the reminder poller at the rule's evaluate_at, never from a conversational " +
    "turn. A rule whose condition did not hold is still marked evaluated, with fired=false.",
  validate: validateEvaluate,
  commit: commitEvaluate,
};

// ---------------------------------------------------------------------------
// The `workflows` inverse handler — ONE registration for the table, branching
// on patch SHAPE, exactly as `commitments` (create-commitment.ts §1.3) and
// `reminders` (create-reminder.ts) do, and for the same recorded reason: undo
// reads `target_table` from action_log and never passes `tool_name`.
//
//   `{ evaluatedAt }` -> evaluate_workflow's inverse: un-evaluate.
//   `{ id }`          -> create_workflow's inverse: invalidate.
// ---------------------------------------------------------------------------
registerInverseHandler("workflows", async (tx, targetId, inversePatch) => {
  if (!targetId) return;
  if (inversePatch === null || typeof inversePatch !== "object") {
    throw new Error(
      `Unrecognized workflows inverse_patch for target ${targetId}: ${JSON.stringify(inversePatch)}`,
    );
  }
  const patch: object = inversePatch;

  if ("evaluatedAt" in patch) {
    // Both prior values applied with NO DEFAULT: defaulting would restore
    // "never evaluated", correct only for undoing a FIRST evaluation and
    // wrong for a re-evaluation after an earlier undo.
    const { evaluatedAt, fired } = patch as EvaluateWorkflowInversePatch;
    await workflows.unevaluateWorkflow(
      tx,
      targetId,
      evaluatedAt === null ? null : new Date(evaluatedAt),
      fired,
    );
    return;
  }

  if ("id" in patch) {
    // create_workflow's inverse: invalidate. Idempotent on an already-invalid
    // row, so a second undo reaching here is a no-op rather than an overwrite
    // of a legitimate earlier t_invalid.
    await workflows.invalidateWorkflow(tx, targetId);
    return;
  }

  throw new Error(
    `Unrecognized workflows inverse_patch shape for target ${targetId}: ${JSON.stringify(inversePatch)}`,
  );
});
