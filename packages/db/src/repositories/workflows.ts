/**
 * workflows — conditional rules (spec §25), FLATTENED to a fixed depth.
 *
 * "If Arun hasn't sent the schema by Friday, remind me."
 *
 * One condition, one deadline, one action. NOT an AST and not a JSONB predicate
 * tree: docs/DECISIONS.md #2 records that recursive schemas are unsupported by
 * Anthropic structured outputs under the strict subset, and a shape the model
 * cannot emit is a shape we must not store. Compound conditions ("if X and Y") are
 * out of scope for Phase 3 and are rejected at tool validation with a clean
 * ToolError — never silently half-stored.
 *
 * EVALUATION HAPPENS AT `evaluate_at`, AGAINST LIVE STATE, NEVER CONTINUOUSLY.
 * "by Friday" is a statement about Friday, not about Wednesday. Continuous
 * evaluation fires on Wednesday when Arun simply has not gotten to it yet — spec
 * §26's nagging, and out of scope besides (§7.2).
 */
import type { Queryable } from "../client.js";
import { TERMINAL_STATUSES } from "./commitments.js";
import type { CommitmentStatus } from "./commitments.js";

export type WorkflowConditionKind =
  | "commitment_not_completed"
  | "commitment_not_updated";

export type WorkflowActionKind = "remind" | "ask";

export interface Workflow {
  id: string;
  condition_kind: WorkflowConditionKind;
  subject_commitment_id: string;
  evaluate_at: Date;
  action_kind: WorkflowActionKind;
  action_body: string;
  source_phrase: string | null;
  /** IDEMPOTENCY KEY. NULL = not yet evaluated. */
  evaluated_at: Date | null;
  /** NULL until evaluated; then: did the condition actually hold? */
  fired: boolean | null;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

export interface CreateWorkflowInput {
  id?: string | null;
  conditionKind: WorkflowConditionKind;
  subjectCommitmentId: string;
  /** Resolved by chrono-node. The model NEVER computes a timestamp (#4). */
  evaluateAt: Date | string;
  actionKind: WorkflowActionKind;
  actionBody: string;
  sourcePhrase?: string | null;
}

export async function createWorkflow(
  tx: Queryable,
  input: CreateWorkflowInput,
): Promise<Workflow> {
  const { rows } = await tx.query<Workflow>(
    `INSERT INTO workflows
       (id, condition_kind, subject_commitment_id, evaluate_at,
        action_kind, action_body, source_phrase)
     VALUES (COALESCE($7::uuid, gen_random_uuid()),
             $1::workflow_condition_kind, $2::uuid, $3::timestamptz,
             $4::workflow_action_kind, $5, $6)
     RETURNING *`,
    [
      input.conditionKind,
      input.subjectCommitmentId,
      input.evaluateAt,
      input.actionKind,
      input.actionBody,
      input.sourcePhrase ?? null,
      input.id ?? null,
    ],
  );
  return rows[0]!;
}

export async function getById(
  tx: Queryable,
  id: string,
): Promise<Workflow | null> {
  const { rows } = await tx.query<Workflow>(
    `SELECT * FROM workflows WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export interface DueWorkflow {
  id: string;
  condition_kind: WorkflowConditionKind;
  subject_commitment_id: string;
  evaluate_at: Date;
  action_kind: WorkflowActionKind;
  action_body: string;
}

/**
 * Claim the due workflows for one poller pass. MUST RUN INSIDE A TRANSACTION.
 *
 * Same shape and same reasoning as `reminders.claimDueReminders`: the clock is a
 * parameter (never `now()`), `FOR UPDATE SKIP LOCKED` so instances do not collide,
 * and a bounded `LIMIT` so a backlog after downtime is not read in one unbounded
 * transaction. Matches `workflows_pending_idx` (migration 008) exactly.
 */
export async function claimDueWorkflows(
  tx: Queryable,
  asOf: Date,
  limit = 100,
): Promise<DueWorkflow[]> {
  const { rows } = await tx.query<DueWorkflow>(
    `SELECT id, condition_kind, subject_commitment_id, evaluate_at,
            action_kind, action_body
       FROM workflows
      WHERE evaluated_at IS NULL
        AND t_invalid IS NULL
        AND evaluate_at <= $1::timestamptz
      ORDER BY evaluate_at
      LIMIT $2
        FOR UPDATE SKIP LOCKED`,
    [asOf, limit],
  );
  return rows;
}

/**
 * Does the condition hold, RIGHT NOW, for this workflow's subject?
 *
 * THIS IS §7.3, THE CORRECTNESS REQUIREMENT OF THE WHOLE SECTION. Reading live
 * state at `evaluate_at` is what makes early completion silence the rule: if Arun
 * sent the schema on Wednesday, then on Friday the status is `completed` and the
 * condition is FALSE, so nothing is emitted and the user is never reminded about
 * something that already happened.
 *
 * ZERO ROWS MEANS DO NOT FIRE. If the subject commitment was invalidated (undo, or
 * a §17 correction) it is absent from `commitments_current`. Treating that as
 * "the condition holds because it isn't completed" would fire a reminder about a
 * commitment that no longer exists — the most confusing possible output. Getting
 * this branch backwards is the single easiest mistake in this file.
 */
export async function evaluateCondition(
  tx: Queryable,
  conditionKind: WorkflowConditionKind,
  subjectCommitmentId: string,
): Promise<boolean> {
  const { rows } = await tx.query<{ status: CommitmentStatus }>(
    `SELECT status FROM commitments_current WHERE id = $1`,
    [subjectCommitmentId],
  );
  const row = rows[0];
  // Absent subject -> do not fire. See the paragraph above before changing this.
  if (!row) return false;
  switch (conditionKind) {
    case "commitment_not_completed":
    case "commitment_not_updated":
      // Interim: both kinds are the same check with different wording (migration
      // 008's comment). Split them the moment they genuinely diverge — a switch
      // with two identical arms is honest about that; a single `if` would hide it.
      return !(TERMINAL_STATUSES as readonly CommitmentStatus[]).includes(
        row.status,
      );
    default: {
      // Exhaustiveness: a third condition kind added to the enum without a branch
      // here is a compile error, not a silent `false` that never fires.
      const exhaustive: never = conditionKind;
      throw new Error(`unhandled workflow condition kind: ${String(exhaustive)}`);
    }
  }
}

/**
 * Record that a workflow was evaluated, and whether its condition held.
 *
 * `evaluated_at` IS THE IDEMPOTENCY KEY, exactly as `fired_at` is for reminders.
 * Runs in the same transaction as the claim, so a crash before COMMIT leaves it
 * NULL and the workflow is re-claimed on the next pass (§6.5's argument verbatim).
 *
 * A workflow that was evaluated and correctly DECLINED still gets `evaluated_at`
 * set, with `fired = false`. That distinction is what makes §28's "why didn't you
 * remind me?" answerable in Phase 4: the log says *evaluated on Friday, condition
 * did not hold* rather than saying nothing at all.
 *
 * The redundant `AND evaluated_at IS NULL` mirrors `markFired`: it costs nothing
 * and makes a double-evaluation impossible even without the row lock. Returns the
 * ids actually transitioned so a caller can distinguish a real claim from a lost
 * race.
 */
export async function markEvaluated(
  tx: Queryable,
  ids: readonly string[],
  evaluatedAt: Date,
  fired: boolean,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE workflows SET evaluated_at = $2::timestamptz, fired = $3
      WHERE id = ANY($1::uuid[]) AND evaluated_at IS NULL
      RETURNING id`,
    [[...ids], evaluatedAt, fired],
  );
  return rows.map((r) => r.id);
}

/**
 * The inverse of evaluation — resets both columns to their captured prior values.
 * No defaults, for the same reason as `uncompleteCommitment`.
 */
export async function unevaluateWorkflow(
  tx: Queryable,
  id: string,
  previousEvaluatedAt: Date | null,
  previousFired: boolean | null,
): Promise<void> {
  await tx.query(
    `UPDATE workflows SET evaluated_at = $2::timestamptz, fired = $3 WHERE id = $1`,
    [id, previousEvaluatedAt, previousFired],
  );
}

export async function listBySubject(
  tx: Queryable,
  subjectCommitmentId: string,
): Promise<Workflow[]> {
  const { rows } = await tx.query<Workflow>(
    `SELECT * FROM workflows_current
      WHERE subject_commitment_id = $1 ORDER BY evaluate_at`,
    [subjectCommitmentId],
  );
  return rows;
}

/**
 * INVALIDATE, NEVER DELETE — the inverse of `createWorkflow`. An invalidated
 * workflow is invisible to `claimDueWorkflows`, which is what makes an undone
 * rule stay silent (§7.3, path 2).
 */
export async function invalidateWorkflow(
  tx: Queryable,
  id: string,
  at?: Date,
): Promise<void> {
  await tx.query(
    `UPDATE workflows
        SET t_invalid = COALESCE($2::timestamptz, t_invalid, now())
      WHERE id = $1`,
    [id, at ?? null],
  );
}

/** Un-invalidate — used by undo-of-an-undo. */
export async function revalidateWorkflow(
  tx: Queryable,
  id: string,
): Promise<void> {
  await tx.query(`UPDATE workflows SET t_invalid = NULL WHERE id = $1`, [id]);
}
