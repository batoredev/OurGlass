/**
 * Ticking Today's checklist.
 *
 * set_checklist_mark — the user's tick on a MEETING or REMINDER (migration
 * 015). A commitment's tick is complete_commitment instead; the route
 * (apps/edge/app/api/today/check) picks which.
 *
 * Driven from the Today page, like the Thoughts board: validated, logged in
 * action_log, undoable. A new mark replaces the current one (invalidate +
 * insert), and the inverse puts the previous one back.
 */
import type { DatabaseTransaction, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { checklistMarks, events, reminders } from "@ourglass/db";
import { registerInverseHandler } from "./inverses.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MarkInput {
  readonly kind: checklistMarks.ChecklistMarkKind;
  readonly id: string;
  readonly done: boolean;
  /** What the item reads as with no mark: a meeting once begun, a reminder once fired. */
  readonly automatic: boolean;
}

interface MarkInverse {
  /** The mark this call inserted, or null when it only cleared one. */
  readonly inserted: string | null;
  readonly previous: string | null;
}

export const setChecklistMarkTool: ToolDefinition<MarkInput, { done: boolean }> = {
  name: "set_checklist_mark",
  description: "Tick or untick a meeting or reminder on Today's checklist.",
  async validate(raw: unknown, ctx: ToolContext): Promise<Result<MarkInput, ToolError[]>> {
    const input = (raw ?? {}) as { kind?: unknown; id?: unknown; done?: unknown };
    const errors: ToolError[] = [];
    if (input.kind !== "meeting" && input.kind !== "reminder") {
      errors.push({ field: "kind", code: "invalid_kind", message: "kind must be meeting or reminder." });
    }
    if (typeof input.id !== "string" || !UUID_RE.test(input.id)) {
      errors.push({ field: "id", code: "invalid_uuid", message: "id must be the item's UUID." });
    }
    if (typeof input.done !== "boolean") {
      errors.push({ field: "done", code: "invalid_done", message: "done must be true or false." });
    }
    if (errors.length > 0) return err(errors);
    let automatic: boolean | null = null;
    if (input.kind === "meeting") {
      const row = await events.getById(ctx.tx, input.id as string);
      if (row && row.t_invalid === null && row.starts_at) automatic = row.starts_at.getTime() <= Date.now();
    } else {
      const row = await reminders.getById(ctx.tx, input.id as string);
      if (row && row.t_invalid === null) automatic = row.fired_at !== null;
    }
    if (automatic === null) return err([{ field: "id", code: "unknown_item", message: "That item no longer exists." }]);
    return ok({ kind: input.kind as MarkInput["kind"], id: input.id as string, done: input.done as boolean, automatic });
  },
  async commit(input: MarkInput, ctx: ToolContext) {
    const previous = await checklistMarks.getCurrent(ctx.tx, input.kind, input.id);
    if (previous) await checklistMarks.invalidate(ctx.tx, previous.id);
    // A tick that AGREES with the automatic reading clears the mark instead of
    // storing one. Otherwise "tick a future meeting, then untick it" would
    // leave a stored "not done" that keeps the meeting on the to-do list
    // forever, even after it has happened.
    const row =
      input.done === input.automatic
        ? null
        : await checklistMarks.insert(ctx.tx, { kind: input.kind, itemId: input.id, done: input.done });
    return {
      output: { done: input.done },
      mutations: [
        {
          targetTable: "checklist_marks",
          targetId: row?.id ?? previous?.id ?? null,
          forwardPatch: { kind: input.kind, itemId: input.id, done: input.done },
          inversePatch: { inserted: row?.id ?? null, previous: previous?.id ?? null } satisfies MarkInverse,
          invertibility: "full" as const,
        },
      ],
    };
  },
};

registerInverseHandler("checklist_marks", async (tx, _targetId, inversePatch) => {
  const patch = inversePatch as Partial<MarkInverse> | null;
  if (!patch || !("inserted" in patch) || !("previous" in patch)) {
    throw new Error(`Unrecognized checklist_marks inverse_patch: ${JSON.stringify(inversePatch)}`);
  }
  if (typeof patch.inserted === "string") await checklistMarks.invalidate(tx, patch.inserted);
  if (typeof patch.previous === "string") await checklistMarks.revalidate(tx, patch.previous);
});

/**
 * The turn that completed a commitment, if unticking may simply undo it.
 *
 * "sole" only when that turn did nothing else: a completion said in the chat
 * may share its turn with a reminder or a new commitment, and undoing the
 * turn would silently take those back too. Such a completion is reported
 * "shared" and the page explains instead of unticking.
 */
export async function completionTurn(
  tx: DatabaseTransaction,
  commitmentId: string,
): Promise<{ readonly turnId: string; readonly sole: boolean } | null> {
  const { rows } = await tx.query<{ turn_id: string; entries: string; undone: boolean }>(
    `SELECT l.turn_id,
            (SELECT count(*) FROM action_log a WHERE a.turn_id = l.turn_id) AS entries,
            EXISTS (SELECT 1 FROM action_log u WHERE u.undoes_turn_id = l.turn_id) AS undone
       FROM action_log l
      WHERE l.tool_name = 'complete_commitment' AND l.target_id = $1 AND l.actor_kind = 'user_turn'
      ORDER BY l.id DESC
      LIMIT 1`,
    [commitmentId],
  );
  const row = rows[0];
  if (!row || row.undone) return null;
  return { turnId: row.turn_id, sole: Number(row.entries) === 1 };
}
