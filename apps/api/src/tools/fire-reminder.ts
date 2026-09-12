/**
 * fire_reminder — the poller's one tool (docs/PHASE-3-DESIGN.md §6.3).
 *
 * WHY A TOOL AT ALL, when the poller could just UPDATE the row: because
 * firing is a mutation, and PHASE-1-DESIGN.md §4.2's invariant is that every
 * mutation goes through the tool layer so it lands in `action_log` with an
 * inverse. A reminder that fired with no ledger entry would be invisible to
 * the Activity surface (§29) and unexplainable after the fact — "why did it
 * message me at 5?" would have no answer in the data.
 *
 * INVERTIBILITY IS 'full' EVEN THOUGH UNDO WILL NEVER REACH IT. `undoTurn`
 * filters `actor_kind = 'user_turn'` and the poller calls
 * `executeTurn(calls, deps, "scheduled_job")`, so a scheduled turn returns
 * zero rows and throws `TurnNotFoundError` — the user cannot undo a clock
 * tick (§6.3, PHASE-1-DESIGN §2.7 invariant 4). Declaring `'none'` here
 * would be the easy lie: firing IS reversible (`unfireReminder` resets
 * `fired_at` to the captured prior value), and a false `'none'` would poison
 * any future admin-level replay. Declare what is true; let the actor_kind
 * filter do the access control.
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { reminders } from "@ourglass/db";

export interface FireReminderRawInput {
  readonly reminder_id?: unknown;
  readonly fired_at?: unknown;
}

export interface FireReminderInput {
  readonly reminderId: string;
  readonly firedAt: string;
  readonly firedAtDate: Date;
}

export interface FireReminderOutput {
  readonly id: string;
  readonly body: string;
  readonly commitmentId: string | null;
  readonly firedAt: string;
}

/** fire_reminder's inverse shape — reset `fired_at` to the captured prior value. */
export interface FireReminderInversePatch {
  readonly firedAt: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

async function validate(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<FireReminderInput, ToolError[]>> {
  const errors: ToolError[] = [];
  const input = (raw ?? {}) as FireReminderRawInput;

  if (!isUuid(input.reminder_id)) {
    errors.push({
      field: "reminder_id",
      code: "invalid_uuid",
      message: "reminder_id must be a resolved reminder UUID.",
    });
  }

  // The clock is a PARAMETER here exactly as it is in the poller (§6.4). A
  // tool that called `new Date()` internally would make the whole firing path
  // untestable without sleeping, which is the trap §6.4 exists to name.
  let firedAtDate: Date | null = null;
  if (typeof input.fired_at !== "string" || Number.isNaN(Date.parse(input.fired_at))) {
    errors.push({
      field: "fired_at",
      code: "invalid_fired_at",
      message: "fired_at must be an ISO-8601 timestamp supplied by the poller's clock.",
    });
  } else {
    firedAtDate = new Date(input.fired_at);
  }

  if (errors.length > 0) return err(errors);

  // Existence is checked in validate, not commit: the executor validates every
  // call in a turn before committing any of them, so a bad id in a batch
  // rolls the whole batch back having written nothing.
  const reminder = await reminders.getById(ctx.tx, input.reminder_id as string);
  if (!reminder) {
    return err([{ field: "reminder_id", code: "unknown_reminder", message: "No such reminder." }]);
  }
  if (reminder.t_invalid !== null) {
    // A cancelled or undone reminder must stay silent. `claimDueReminders`
    // already filters these out, so reaching here means the row was
    // invalidated between the claim and the call — rare, and still wrong to
    // fire.
    return err([
      { field: "reminder_id", code: "reminder_cancelled", message: "This reminder was cancelled." },
    ]);
  }

  return ok({
    reminderId: input.reminder_id as string,
    firedAt: (input.fired_at as string),
    firedAtDate: firedAtDate!,
  });
}

async function commit(
  input: FireReminderInput,
  ctx: ToolContext,
): Promise<{ output: FireReminderOutput; mutations: readonly LoggedMutation[] }> {
  const before = await reminders.getById(ctx.tx, input.reminderId);
  if (!before) throw new Error(`reminder ${input.reminderId} vanished between validate and commit`);

  // markFired returns the ids it ACTUALLY transitioned, so a lost race is
  // distinguishable from a win rather than assumed (§6.2). Its redundant
  // `AND fired_at IS NULL` is what makes a double-fire impossible.
  const transitioned = await reminders.markFired(ctx.tx, [input.reminderId], input.firedAtDate);
  if (transitioned.length === 0) {
    // Another instance claimed it first. Not an error condition worth
    // throwing over — at-least-once delivery collapsing to effectively-once
    // is the DESIGNED behaviour — but it must not be logged as a mutation
    // this turn performed, because it did not perform one.
    throw new Error(`reminder ${input.reminderId} was already fired`);
  }

  const mutation: LoggedMutation = {
    targetTable: "reminders",
    targetId: input.reminderId,
    forwardPatch: { firedAt: input.firedAt },
    // Captured PRE-update by reading the row before markFired ran. Same
    // reason as completeCommitment's self-join: `RETURNING *` on an UPDATE is
    // post-update state (Phase 1 build finding #4), so it cannot supply an
    // inverse.
    inversePatch: {
      firedAt: before.fired_at === null ? null : before.fired_at.toISOString(),
    } satisfies FireReminderInversePatch,
    invertibility: "full",
  };

  return {
    output: {
      id: before.id,
      body: before.body,
      commitmentId: before.commitment_id,
      firedAt: input.firedAt,
    },
    mutations: [mutation],
  };
}

export const fireReminderTool: ToolDefinition<FireReminderInput, FireReminderOutput> = {
  name: "fire_reminder",
  description:
    "Mark a reminder as fired. Called only by the reminder poller, never from a " +
    "conversational turn. fired_at comes from the poller's injected clock.",
  validate,
  commit,
};

// The `reminders` inverse handler is NOT registered here.
//
// `registerInverseHandler` throws on a duplicate table key, and
// create-reminder.ts already owns the `reminders` registration. This tool
// contributes the `{ firedAt }` branch of that shared handler rather than a
// second registration — see create-reminder.ts's handler comment, and
// create-commitment.ts §1.3 for the recorded reasoning behind one handler per
// TABLE dispatching on patch shape.
