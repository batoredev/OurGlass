/**
 * The §35 control plane as tools — PHASE-7-PERMISSIONS-DESIGN §2, §5, §6.
 *
 * ================================ READ THIS ================================
 * NONE OF THESE IS REACHABLE FROM A CONVERSATION. They change what is
 * PERMITTED, and a grant a model could propose is a grant a prompt-injected
 * document could propose. They are driven only by explicit user actions on
 * the control-plane routes, and the orchestrator's gate throws if a planner
 * ever emits one (CONTROL_PLANE_TOOLS).
 *
 * They are still TOOLS — validated, committed in one transaction, logged in
 * action_log, undoable — because "outside the model" must not mean "outside
 * the audit trail".
 * ===========================================================================
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import { err, ok } from "@ourglass/shared";
import { permissions } from "@ourglass/db";
import type { PermissionDecision } from "@ourglass/db";
import { CONTROL_PLANE_TOOLS, canPersistentlyAllow } from "../permissions/policy.js";
import { registerInverseHandler } from "./inverses.js";
import { UnclassifiedToolError, riskFor } from "./risk.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISIONS: readonly PermissionDecision[] = ["allow", "confirm"];

// ---------------------------------------------------------------------------
// set_permission — persistent permission, by action type
// ---------------------------------------------------------------------------

export interface SetPermissionInput {
  readonly actionType: string;
  readonly decision: PermissionDecision;
}

export interface SetPermissionOutput {
  readonly grantId: string;
  readonly actionType: string;
  readonly decision: PermissionDecision;
  readonly supersededGrantId: string | null;
}

/** Undo removes the new grant and restores whichever one it superseded. */
export interface SetPermissionInversePatch {
  readonly revertGrant: true;
  readonly restoreGrantId: string | null;
}

/** Undo of a revoke re-validates the revoked grant. */
export interface RevokePermissionInversePatch {
  readonly revokedGrant: true;
}

function validateActionType(value: unknown): Result<string, ToolError[]> {
  if (typeof value !== "string" || value.trim() === "") {
    return err([{ field: "action_type", code: "required", message: "action_type is required." }]);
  }
  if (CONTROL_PLANE_TOOLS.has(value)) {
    // A permission over the permission system is a way to make it bypassable.
    return err([
      {
        field: "action_type",
        code: "control_plane",
        message: `${value} is part of the permission system itself and cannot be granted.`,
      },
    ]);
  }
  try {
    riskFor(value);
  } catch (error: unknown) {
    if (error instanceof UnclassifiedToolError) {
      return err([
        { field: "action_type", code: "unknown_action_type", message: `No action named ${value}.` },
      ]);
    }
    throw error;
  }
  return ok(value);
}

export const setPermissionTool: ToolDefinition<SetPermissionInput, SetPermissionOutput> = {
  name: "set_permission",
  description:
    "Record a persistent permission for one action type: always allow it, or always require " +
    "confirmation. Control plane only — never reachable from a conversation.",
  async validate(raw) {
    const input = (raw ?? {}) as { action_type?: unknown; decision?: unknown };
    const actionType = validateActionType(input.action_type);
    if (!actionType.ok) return actionType;

    if (!DECISIONS.includes(input.decision as PermissionDecision)) {
      return err([
        { field: "decision", code: "invalid_decision", message: "decision must be allow or confirm." },
      ]);
    }
    const decision = input.decision as PermissionDecision;
    if (decision === "allow" && !canPersistentlyAllow(riskFor(actionType.value))) {
      // Refused rather than recorded-and-ignored: a grant the user sees in the
      // list must be a grant that actually applies.
      return err([
        {
          field: "decision",
          code: "never_persistently_allowed",
          message: `${actionType.value} always needs confirmation; it cannot be always-allowed.`,
        },
      ]);
    }
    return ok({ actionType: actionType.value, decision });
  },
  async commit(input, ctx: ToolContext) {
    const previous = await permissions.currentGrant(ctx.tx, input.actionType);
    // Invalidate BEFORE inserting: the unique index allows one current grant.
    if (previous) await permissions.invalidateGrant(ctx.tx, previous.id);
    const grant = await permissions.createGrant(ctx.tx, input);

    const mutation: LoggedMutation = {
      targetTable: "permission_grants",
      targetId: grant.id,
      forwardPatch: { action_type: input.actionType, decision: input.decision },
      inversePatch: {
        revertGrant: true,
        restoreGrantId: previous?.id ?? null,
      } satisfies SetPermissionInversePatch,
      invertibility: "full",
    };
    return {
      output: {
        grantId: grant.id,
        actionType: input.actionType,
        decision: input.decision,
        supersededGrantId: previous?.id ?? null,
      },
      mutations: [mutation],
    };
  },
};

// ---------------------------------------------------------------------------
// revoke_permission — revocation
// ---------------------------------------------------------------------------

export interface RevokePermissionInput {
  readonly grantId: string;
  readonly actionType: string;
}

export const revokePermissionTool: ToolDefinition<
  RevokePermissionInput,
  { readonly revokedGrantId: string; readonly actionType: string }
> = {
  name: "revoke_permission",
  description:
    "Revoke the current permission for one action type, returning it to the default for its " +
    "risk level. Invalidates, never deletes. Control plane only.",
  async validate(raw, ctx) {
    const input = (raw ?? {}) as { action_type?: unknown };
    if (typeof input.action_type !== "string" || input.action_type.trim() === "") {
      return err([{ field: "action_type", code: "required", message: "action_type is required." }]);
    }
    const grant = await permissions.currentGrant(ctx.tx, input.action_type);
    if (!grant) {
      return err([
        {
          field: "action_type",
          code: "no_grant",
          message: `There is no permission set for ${input.action_type}.`,
        },
      ]);
    }
    return ok({ grantId: grant.id, actionType: input.action_type });
  },
  async commit(input, ctx) {
    await permissions.invalidateGrant(ctx.tx, input.grantId);
    return {
      output: { revokedGrantId: input.grantId, actionType: input.actionType },
      mutations: [
        {
          targetTable: "permission_grants",
          targetId: input.grantId,
          forwardPatch: { revoked: true },
          inversePatch: { revokedGrant: true } satisfies RevokePermissionInversePatch,
          invertibility: "full",
        },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// release_pending_action / decline_pending_action — one-time confirmation
// ---------------------------------------------------------------------------

export interface PendingActionDecisionInput {
  readonly pendingActionId: string;
}

async function validatePendingDecision(
  raw: unknown,
  ctx: ToolContext,
): Promise<Result<PendingActionDecisionInput, ToolError[]>> {
  const input = (raw ?? {}) as { pending_action_id?: unknown };
  if (typeof input.pending_action_id !== "string" || !UUID_RE.test(input.pending_action_id)) {
    return err([
      {
        field: "pending_action_id",
        code: "invalid_uuid",
        message: "pending_action_id must be a pending action UUID.",
      },
    ]);
  }
  const pending = await permissions.getPendingAction(ctx.tx, input.pending_action_id);
  if (!pending) {
    return err([{ field: "pending_action_id", code: "not_found", message: "No such pending action." }]);
  }
  if (pending.status !== "pending") {
    return err([
      {
        field: "pending_action_id",
        code: "already_decided",
        message: `That action was already ${pending.status}.`,
      },
    ]);
  }
  // A friendly early refusal. NOT the guarantee: `decidePendingAction` checks
  // `expires_at > now()` on the database clock inside the same UPDATE.
  if (pending.expires_at.getTime() <= Date.now()) {
    return err([
      {
        field: "pending_action_id",
        code: "expired",
        message: "That request has expired. Ask again if you still want it done.",
      },
    ]);
  }
  return ok({ pendingActionId: input.pending_action_id });
}

/** Undo of a decision reopens the request. Expiry still bounds it. */
export interface PendingActionInversePatch {
  readonly reopen: true;
}

function decisionMutation(id: string, status: "executed" | "declined"): LoggedMutation {
  return {
    targetTable: "pending_actions",
    targetId: id,
    forwardPatch: { status },
    inversePatch: { reopen: true } satisfies PendingActionInversePatch,
    invertibility: "full",
  };
}

export const releasePendingActionTool: ToolDefinition<
  PendingActionDecisionInput,
  { readonly pendingActionId: string; readonly turnId: string }
> = {
  name: "release_pending_action",
  description:
    "Mark a held action approved. Always the FIRST call of the turn that executes the held " +
    "calls, so approval and execution commit or roll back together. Control plane only.",
  validate: validatePendingDecision,
  async commit(input, ctx) {
    const decided = await permissions.decidePendingAction(ctx.tx, input.pendingActionId, {
      status: "executed",
      turnId: ctx.turnId,
    });
    if (!decided) {
      // Validated as pending a moment ago, so someone else decided it (or it
      // expired) in between. THROW: this rolls back the whole turn, so the
      // held calls cannot run twice.
      throw new Error(
        `pending action ${input.pendingActionId} was decided concurrently; not executing it twice`,
      );
    }
    return {
      output: { pendingActionId: input.pendingActionId, turnId: ctx.turnId },
      mutations: [decisionMutation(input.pendingActionId, "executed")],
    };
  },
};

export const declinePendingActionTool: ToolDefinition<
  PendingActionDecisionInput,
  { readonly pendingActionId: string }
> = {
  name: "decline_pending_action",
  description: "Decline a held action. Nothing it held is executed. Control plane only.",
  validate: validatePendingDecision,
  async commit(input, ctx) {
    const decided = await permissions.decidePendingAction(ctx.tx, input.pendingActionId, {
      status: "declined",
    });
    if (!decided) {
      throw new Error(`pending action ${input.pendingActionId} was decided concurrently`);
    }
    return {
      output: { pendingActionId: input.pendingActionId },
      mutations: [decisionMutation(input.pendingActionId, "declined")],
    };
  },
};

// ---------------------------------------------------------------------------
// Inverse handlers — explicit shape checks with a loud throw, like every other
// handler: one that ignores its patch silently reverses the wrong thing.
// ---------------------------------------------------------------------------

registerInverseHandler("permission_grants", async (tx, targetId, inversePatch) => {
  if (!targetId || inversePatch === null || typeof inversePatch !== "object") {
    throw new Error(`Unrecognized permission_grants inverse_patch: ${JSON.stringify(inversePatch)}`);
  }
  if ("revertGrant" in inversePatch) {
    const { restoreGrantId } = inversePatch as SetPermissionInversePatch;
    // Invalidate the new grant FIRST: the unique index allows one current grant.
    await permissions.invalidateGrant(tx, targetId);
    if (restoreGrantId) await permissions.revalidateGrant(tx, restoreGrantId);
    return;
  }
  if ("revokedGrant" in inversePatch) {
    await permissions.revalidateGrant(tx, targetId);
    return;
  }
  throw new Error(`Unrecognized permission_grants inverse_patch: ${JSON.stringify(inversePatch)}`);
});

registerInverseHandler("pending_actions", async (tx, targetId, inversePatch) => {
  if (
    !targetId ||
    inversePatch === null ||
    typeof inversePatch !== "object" ||
    !("reopen" in inversePatch)
  ) {
    throw new Error(`Unrecognized pending_actions inverse_patch: ${JSON.stringify(inversePatch)}`);
  }
  await permissions.reopenPendingAction(tx, targetId);
});
