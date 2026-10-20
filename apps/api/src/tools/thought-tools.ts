/**
 * The Thoughts board — create, move between priorities, remove.
 *
 * Driven from the Thoughts page (POST/PATCH/DELETE /api/thoughts), like the
 * permission control plane: a UI-initiated write, but never a second write
 * path — each call runs through the executor, so it is validated, lands in
 * action_log, and the route hands back a turnId that /api/undo can reverse.
 *
 * Moves update `priority` in place and record the old value as the inverse,
 * the same shape as updateCommitment. Removal INVALIDATES; the row stays.
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { thoughts } from "@ourglass/db";
import { registerInverseHandler } from "./inverses.js";

type Priority = thoughts.ThoughtPriority;

export const MAX_THOUGHT_LENGTH = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a thoughts row's inverse does on undo. */
type ThoughtInverse =
  | { readonly op: "invalidate" }
  | { readonly op: "set_priority"; readonly priority: Priority }
  | { readonly op: "revalidate" };

function priorityError(field: string): ToolError {
  return { field, code: "invalid_priority", message: `${field} must be one of: high, mid, low.` };
}

// ---- create_thought --------------------------------------------------------

interface CreateThoughtInput {
  readonly body: string;
  readonly priority: Priority;
}

export const createThoughtTool: ToolDefinition<CreateThoughtInput, { id: string }> = {
  name: "create_thought",
  description: "Add an idea or goal to the Thoughts board at a priority (high, mid or low).",
  async validate(raw: unknown): Promise<Result<CreateThoughtInput, ToolError[]>> {
    const input = (raw ?? {}) as { body?: unknown; priority?: unknown };
    const errors: ToolError[] = [];
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (body === "") errors.push({ field: "body", code: "missing_body", message: "Write the thought first." });
    if (body.length > MAX_THOUGHT_LENGTH) {
      errors.push({ field: "body", code: "too_long", message: `Keep a thought under ${MAX_THOUGHT_LENGTH} characters.` });
    }
    if (!thoughts.isThoughtPriority(input.priority)) errors.push(priorityError("priority"));
    if (errors.length > 0) return err(errors);
    return ok({ body, priority: input.priority as Priority });
  },
  async commit(input: CreateThoughtInput, ctx: ToolContext) {
    const row = await thoughts.createThought(ctx.tx, input);
    const mutations: LoggedMutation[] = [
      {
        targetTable: "thoughts",
        targetId: row.id,
        forwardPatch: { body: row.body, priority: row.priority },
        inversePatch: { op: "invalidate" } satisfies ThoughtInverse,
        invertibility: "full",
      },
    ];
    return { output: { id: row.id }, mutations };
  },
};

// ---- move_thought ------------------------------------------------------------

interface MoveThoughtInput {
  readonly id: string;
  readonly priority: Priority;
  readonly previous: Priority;
}

export const moveThoughtTool: ToolDefinition<MoveThoughtInput, { id: string; priority: Priority }> = {
  name: "move_thought",
  description: "Move a thought on the board to another priority column.",
  async validate(raw: unknown, ctx: ToolContext): Promise<Result<MoveThoughtInput, ToolError[]>> {
    const input = (raw ?? {}) as { id?: unknown; priority?: unknown };
    if (typeof input.id !== "string" || !UUID_RE.test(input.id)) {
      return err([{ field: "id", code: "invalid_uuid", message: "id must be a thought's UUID." }]);
    }
    if (!thoughts.isThoughtPriority(input.priority)) return err([priorityError("priority")]);
    const current = await thoughts.getCurrent(ctx.tx, input.id);
    if (!current) return err([{ field: "id", code: "unknown_thought", message: "That thought no longer exists." }]);
    return ok({ id: input.id, priority: input.priority, previous: current.priority });
  },
  async commit(input: MoveThoughtInput, ctx: ToolContext) {
    await thoughts.setPriority(ctx.tx, input.id, input.priority);
    return {
      output: { id: input.id, priority: input.priority },
      mutations: [
        {
          targetTable: "thoughts",
          targetId: input.id,
          forwardPatch: { priority: input.priority },
          inversePatch: { op: "set_priority", priority: input.previous } satisfies ThoughtInverse,
          invertibility: "full",
        },
      ],
    };
  },
};

// ---- remove_thought ---------------------------------------------------------

export const removeThoughtTool: ToolDefinition<{ id: string }, { id: string }> = {
  name: "remove_thought",
  description: "Take a thought off the board (invalidated, never deleted).",
  async validate(raw: unknown, ctx: ToolContext): Promise<Result<{ id: string }, ToolError[]>> {
    const input = (raw ?? {}) as { id?: unknown };
    if (typeof input.id !== "string" || !UUID_RE.test(input.id)) {
      return err([{ field: "id", code: "invalid_uuid", message: "id must be a thought's UUID." }]);
    }
    if (!(await thoughts.getCurrent(ctx.tx, input.id))) {
      return err([{ field: "id", code: "unknown_thought", message: "That thought no longer exists." }]);
    }
    return ok({ id: input.id });
  },
  async commit(input: { id: string }, ctx: ToolContext) {
    await thoughts.invalidateThought(ctx.tx, input.id);
    return {
      output: { id: input.id },
      mutations: [
        {
          targetTable: "thoughts",
          targetId: input.id,
          forwardPatch: { removed: true },
          inversePatch: { op: "revalidate" } satisfies ThoughtInverse,
          invertibility: "full",
        },
      ],
    };
  },
};

registerInverseHandler("thoughts", async (tx, targetId, inversePatch) => {
  if (!targetId) return;
  const patch = inversePatch as Partial<ThoughtInverse> | null;
  switch (patch?.op) {
    case "invalidate":
      return thoughts.invalidateThought(tx, targetId);
    case "revalidate":
      return thoughts.revalidateThought(tx, targetId);
    case "set_priority":
      if (thoughts.isThoughtPriority(patch.priority)) return thoughts.setPriority(tx, targetId, patch.priority);
      break;
  }
  throw new Error(`Unrecognized thoughts inverse_patch for ${targetId}: ${JSON.stringify(inversePatch)}`);
});
