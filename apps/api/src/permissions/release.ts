/**
 * Releasing and declining held actions — PHASE-7-PERMISSIONS-DESIGN §5.
 *
 * The one-time confirmation. Called only from the control-plane routes, on an
 * explicit user action.
 */
import type { ToolCall, ToolError } from "@ourglass/shared";
import { permissions } from "@ourglass/db";
import { executeTurn, type Deps } from "../tools/executor.js";

export type ReleaseOutcome =
  | { readonly ok: true; readonly turnId: string; readonly results: readonly unknown[] }
  | {
      readonly ok: false;
      readonly reason: "not_found" | "not_pending" | "invalid";
      readonly errors: readonly ToolError[];
    };

function heldCalls(raw: unknown): readonly ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (call): call is ToolCall =>
      typeof call === "object" &&
      call !== null &&
      typeof (call as { name?: unknown }).name === "string",
  );
}

/**
 * ONE turn: `release_pending_action` first, then the held calls.
 *
 * Approval and execution commit or roll back TOGETHER. If a held call no
 * longer validates — the memory it forgets was already forgotten — the status
 * change rolls back with it, and the row is then marked `failed` in its own
 * transaction so the user sees why nothing happened.
 *
 * A concurrent second release cannot execute twice: its status update matches
 * zero rows, the tool throws, and its whole turn rolls back.
 */
export async function releasePendingAction(deps: Deps, id: string): Promise<ReleaseOutcome> {
  const pending = await deps.db.withTransaction((tx) => permissions.getPendingAction(tx, id));
  if (!pending) {
    return { ok: false, reason: "not_found", errors: [] };
  }

  const calls = heldCalls(pending.calls);
  const outcome = await executeTurn(
    [{ name: "release_pending_action", input: { pending_action_id: id } }, ...calls],
    deps,
  );

  if (outcome.ok) {
    // The first result is the release marker; the rest are the held calls'.
    return { ok: true, turnId: outcome.turnId, results: outcome.results.slice(1) };
  }

  if (outcome.toolName === "release_pending_action") {
    // Not pending, expired, or unknown — nothing ran and nothing to record.
    return { ok: false, reason: "not_pending", errors: outcome.errors };
  }

  // A HELD call failed validation. Record it outside the rolled-back turn.
  await deps.db.withTransaction((tx) =>
    permissions.markPendingActionFailed(tx, id, {
      toolName: outcome.toolName,
      errors: outcome.errors,
    }),
  );
  return { ok: false, reason: "invalid", errors: outcome.errors };
}

export type DeclineOutcome =
  | { readonly ok: true; readonly turnId: string }
  | { readonly ok: false; readonly errors: readonly ToolError[] };

export async function declinePendingAction(deps: Deps, id: string): Promise<DeclineOutcome> {
  const outcome = await executeTurn(
    [{ name: "decline_pending_action", input: { pending_action_id: id } }],
    deps,
  );
  return outcome.ok ? { ok: true, turnId: outcome.turnId } : { ok: false, errors: outcome.errors };
}
