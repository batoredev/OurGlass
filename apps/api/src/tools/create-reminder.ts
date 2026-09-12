/**
 * create_reminder — the second tool. Minimal, per the mission spec: just
 * enough to prove the multi-tool-per-turn undo test (docs/PHASE-1-DESIGN.md
 * §4.3's "undoes a whole turn, not one row") actually exercises TWO
 * different tools, using the design's own demo utterance: "Barkha needs to
 * give me the article by 6. Remind me at 5 to ask her." -> one turn,
 * commitment + reminder.
 *
 * No `reminders` repository exists in packages/db yet (only
 * people/organizations/projects/commitments), so this tool queries
 * `reminders` directly via ctx.tx with parameterised SQL — same pattern
 * the design doc's §5 describes for the tool layer generally ("pg directly
 * with parameterised queries"). If schema2 publishes a reminders repository
 * later, this should be migrated to use it for consistency with
 * create-commitment.ts, but is not blocked on it.
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { reminders } from "@ourglass/db";
import { registerInverseHandler } from "./inverses.js";

export interface CreateReminderRawInput {
  readonly commitment_id?: unknown;
  readonly body?: unknown;
  readonly fire_at?: unknown;
  readonly source_phrase?: unknown;
}

export interface CreateReminderInput {
  readonly commitmentId: string | null;
  readonly body: string;
  readonly fireAt: string | null;
  readonly sourcePhrase: string | null;
}

export interface CreateReminderOutput {
  readonly id: string;
  readonly commitmentId: string | null;
  readonly body: string;
}

interface ReminderRow {
  [key: string]: unknown;
  id: string;
  commitment_id: string | null;
  body: string;
  fire_at: string | null;
  fired_at: string | null;
  source_phrase: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

async function validate(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<CreateReminderInput, ToolError[]>> {
  const errors: ToolError[] = [];
  const input = (raw ?? {}) as CreateReminderRawInput;

  if (typeof input.body !== "string" || input.body.trim().length === 0) {
    errors.push({
      field: "body",
      code: "missing_body",
      message: "body is required and must be a non-empty string",
    });
  }

  if (
    input.commitment_id !== undefined &&
    input.commitment_id !== null &&
    !isUuid(input.commitment_id)
  ) {
    errors.push({
      field: "commitment_id",
      code: "invalid_uuid",
      message: "commitment_id must be a resolved commitment UUID, not a description",
    });
  }

  if (input.fire_at !== undefined && input.fire_at !== null && typeof input.fire_at !== "string") {
    errors.push({
      field: "fire_at",
      code: "invalid_fire_at",
      message: "fire_at must be an ISO-8601 timestamp string, or omitted",
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
      message: "source_phrase must be a string, or omitted",
    });
  }

  if (errors.length > 0) return err(errors);

  const commitmentId = (input.commitment_id as string | null | undefined) ?? null;

  // reminders.commitment_id is a nullable FK (packages/db migration 004): a
  // reminder is not required to reference a commitment, but if one is
  // named, it must exist — same "resolved reference or fail" contract as
  // create_commitment's owner_id/recipient_id (§3).
  if (commitmentId !== null) {
    const { rows } = await ctx.tx.query<{ id: string }>(
      `SELECT id FROM commitments WHERE id = $1 AND t_invalid IS NULL`,
      [commitmentId],
    );
    if (rows.length === 0) {
      errors.push({
        field: "commitment_id",
        code: "unknown_commitment",
        message: `No current commitment exists with id ${commitmentId}`,
      });
    }
  }

  if (errors.length > 0) return err(errors);

  return ok({
    commitmentId,
    body: (input.body as string).trim(),
    fireAt: (input.fire_at as string | null | undefined) ?? null,
    sourcePhrase: (input.source_phrase as string | null | undefined) ?? null,
  });
}

async function commit(
  input: CreateReminderInput,
  ctx: ToolContext,
): Promise<{ output: CreateReminderOutput; mutations: readonly LoggedMutation[] }> {
  const { rows } = await ctx.tx.query<ReminderRow>(
    `INSERT INTO reminders (commitment_id, body, fire_at, source_phrase)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.commitmentId, input.body, input.fireAt, input.sourcePhrase],
  );
  const row = rows[0]!;

  const mutation: LoggedMutation = {
    targetTable: "reminders",
    targetId: row.id,
    forwardPatch: {
      commitmentId: row.commitment_id,
      body: row.body,
      fireAt: row.fire_at,
      sourcePhrase: row.source_phrase,
    },
    inversePatch: { id: row.id },
    invertibility: "full",
  };

  return {
    output: { id: row.id, commitmentId: row.commitment_id, body: row.body },
    mutations: [mutation],
  };
}

export const createReminderTool: ToolDefinition<CreateReminderInput, CreateReminderOutput> = {
  name: "create_reminder",
  description:
    "Create a reminder, optionally tied to a commitment (commitment_id must be a " +
    "resolved commitment UUID). body is the reminder text; source_phrase preserves " +
    "the user's verbatim time phrase ('next Friday') for auditable resolution — the " +
    "tool never computes fire_at itself from natural language.",
  validate,
  commit,
};

// ---------------------------------------------------------------------------
// The `reminders` inverse handler — ONE registration for the whole table.
//
// `registerInverseHandler` THROWS on a duplicate table key, so this is a
// startup crash rather than a test failure if two tools each register one.
// fire_reminder (Phase 3) mutates this same table, so the handler branches on
// the SHAPE of inversePatch, exactly as create-commitment.ts §1.3 does for
// `commitments` and for the same recorded reason: undoTurn reads
// `target_table` out of action_log and never passes `tool_name`, so re-keying
// by tool name would both touch CI-verified Phase 1 executor code and couple
// undo to tool NAMES — renaming a tool later would silently orphan historical
// action_log rows.
//
//   `{ firedAt }` -> fire_reminder's inverse: reset fired_at to the prior value.
//   `{ id }`      -> create_reminder's inverse: invalidate.
//
// An unrecognised shape THROWS. A silent no-op here would report a successful
// undo having reversed nothing, which is worse than a loud failure.
// ---------------------------------------------------------------------------
registerInverseHandler("reminders", async (tx, targetId, inversePatch) => {
  if (!targetId) return;
  if (inversePatch === null || typeof inversePatch !== "object") {
    throw new Error(
      `Unrecognized reminders inverse_patch for target ${targetId}: ${JSON.stringify(inversePatch)}`,
    );
  }
  const patch: object = inversePatch;

  if ("firedAt" in patch) {
    // fire_reminder's inverse. The prior value is applied with NO DEFAULT:
    // defaulting to null would restore "never fired", which is correct only
    // for undoing a FIRST firing, not a re-firing after an earlier undo.
    const { firedAt } = patch as { readonly firedAt: string | null };
    await reminders.unfireReminder(tx, targetId, firedAt === null ? null : new Date(firedAt));
    return;
  }

  if ("id" in patch) {
    // create_reminder's inverse: invalidate. Now goes through the repository
    // — this previously issued raw SQL with a comment saying no reminders
    // repository existed yet. It does (packages/db, Phase 3), and
    // invalidateReminder is idempotent on an already-invalid row, so a second
    // undo reaching here is a no-op rather than an overwrite of a legitimate
    // earlier t_invalid.
    await reminders.invalidateReminder(tx, targetId);
    return;
  }

  throw new Error(
    `Unrecognized reminders inverse_patch shape for target ${targetId}: ${JSON.stringify(inversePatch)}`,
  );
});
