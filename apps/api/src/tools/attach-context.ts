/**
 * attach_context — spec §20's context attachment, resolving finding F4
 * (docs/PHASE-3-DESIGN.md §10 task 9, and F4's "concrete shape").
 *
 * "She had a family emergency."
 *
 * That sentence had nowhere to land before this: migration 003 gives
 * `commitments` no `notes` column, while `people`, `organizations` and
 * `projects` all have one in 002. F4's resolution is a TABLE, not a column —
 * a column would be overwritten by the second piece of context and would
 * carry no provenance, and PHASES.md puts "context attachment (§20) as a note
 * with message provenance" explicitly in scope. One commitment accumulates
 * many notes over its life; that is a one-to-many.
 *
 * PROVENANCE IS THE POINT, not decoration. §20 says the assistant must not
 * make judgmental statements about a late completion, and that is only
 * auditable if you can recover WHICH message the context came from.
 * `source_message_id` is the same pattern `relationships.source_message_id`
 * established in migration 004.
 *
 * THE BODY IS A RAW CONTENT FIELD (§3). It is stored verbatim and never
 * resolved into entity references — "she" stays "she". Resolving it would
 * mean guessing, and a wrong guess here silently rewrites what the user said
 * about a person.
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { commitmentNotes, commitments } from "@ourglass/db";
import { registerInverseHandler } from "./inverses.js";

export interface AttachContextRawInput {
  readonly commitment_id?: unknown;
  readonly body?: unknown;
  readonly source_message_id?: unknown;
}

export interface AttachContextInput {
  readonly commitmentId: string;
  readonly body: string;
  readonly sourceMessageId: string | null;
}

export interface AttachContextOutput {
  readonly id: string;
  readonly commitmentId: string;
  readonly body: string;
}

/** attach_context's inverse shape: nothing to restore, just invalidate. */
export interface AttachContextInversePatch {
  readonly id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

async function validate(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<AttachContextInput, ToolError[]>> {
  const errors: ToolError[] = [];
  const input = (raw ?? {}) as AttachContextRawInput;

  if (!isUuid(input.commitment_id)) {
    errors.push({
      field: "commitment_id",
      code: "invalid_uuid",
      message: "commitment_id must be a resolved commitment UUID.",
    });
  }
  if (typeof input.body !== "string" || input.body.trim() === "") {
    errors.push({
      field: "body",
      code: "missing_body",
      message: "body must be the context to attach, in the user's own words.",
    });
  }
  // Nullable by design: a note may arrive from a non-conversational path (a
  // future import, a scheduled job) with no message to point at. But if one
  // IS supplied it must be a real id, not a fabricated one — provenance that
  // cannot be followed is worse than none, because it looks trustworthy.
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

  // Existence checked in validate, not commit — the executor validates every
  // call in a turn before committing any, so a bad id rolls the whole turn
  // back having written nothing.
  const commitment = await commitments.getById(ctx.tx, input.commitment_id as string);
  if (!commitment) {
    return err([
      { field: "commitment_id", code: "unknown_commitment", message: "No such commitment." },
    ]);
  }

  return ok({
    commitmentId: input.commitment_id as string,
    body: (input.body as string).trim(),
    sourceMessageId: isUuid(input.source_message_id) ? input.source_message_id : null,
  });
}

async function commit(
  input: AttachContextInput,
  ctx: ToolContext,
): Promise<{ output: AttachContextOutput; mutations: readonly LoggedMutation[] }> {
  const note = await commitmentNotes.createNote(ctx.tx, {
    commitmentId: input.commitmentId,
    body: input.body,
    sourceMessageId: input.sourceMessageId,
  });

  const mutation: LoggedMutation = {
    targetTable: "commitment_notes",
    targetId: note.id,
    forwardPatch: {
      commitmentId: note.commitment_id,
      body: note.body,
      sourceMessageId: note.source_message_id,
    },
    inversePatch: { id: note.id } satisfies AttachContextInversePatch,
    invertibility: "full",
  };

  return {
    output: { id: note.id, commitmentId: note.commitment_id, body: note.body },
    mutations: [mutation],
  };
}

export const attachContextTool: ToolDefinition<AttachContextInput, AttachContextOutput> = {
  name: "attach_context",
  description:
    "Attach context to a commitment — why it slipped, what happened around it. " +
    "'She had a family emergency.' body is stored VERBATIM and is never resolved " +
    "into entity references. source_message_id records which message it came from.",
  validate,
  commit,
};

// ---------------------------------------------------------------------------
// The `commitment_notes` inverse handler. One tool writes this table today, so
// there is one shape — but the dispatch is written the same way as
// `commitments`, `reminders` and `workflows` (a shape check with a loud throw
// on anything unrecognised) rather than as an unconditional invalidate. A
// handler that ignores its patch silently reverses the wrong thing the day a
// second tool touches the table.
// ---------------------------------------------------------------------------
registerInverseHandler("commitment_notes", async (tx, targetId, inversePatch) => {
  if (!targetId) return;
  if (inversePatch === null || typeof inversePatch !== "object") {
    throw new Error(
      `Unrecognized commitment_notes inverse_patch for target ${targetId}: ${JSON.stringify(inversePatch)}`,
    );
  }
  const patch: object = inversePatch;

  if ("id" in patch) {
    // INVALIDATE, NEVER DELETE. Idempotent on an already-invalid row, so a
    // second undo reaching here is a no-op rather than an overwrite of a
    // legitimate earlier t_invalid.
    await commitmentNotes.invalidateNote(tx, targetId);
    return;
  }

  throw new Error(
    `Unrecognized commitment_notes inverse_patch shape for target ${targetId}: ${JSON.stringify(inversePatch)}`,
  );
});
