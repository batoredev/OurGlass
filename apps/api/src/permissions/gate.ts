/**
 * The permission gate — PHASE-7-PERMISSIONS-DESIGN §4.
 *
 * Called by `runTurn` after Resolve and before Mutate, once per planned intent.
 * Reads the current grants and the risk table; writes nothing.
 */
import type { DatabaseTransaction, RiskLevel, ToolCall } from "@ourglass/shared";
import { permissions } from "@ourglass/db";
import { highestRisk, riskFor } from "../tools/risk.js";
import { CONTROL_PLANE_TOOLS, decidePermission, type PermissionGrantDecision } from "./policy.js";

/** A planner emitted a control-plane tool. A bug, never a request to honour. */
export class ControlPlaneToolEmittedError extends Error {
  constructor(readonly toolName: string) {
    super(
      `${toolName} changes what is permitted and must never come from a conversation ` +
        "(PHASE-7-PERMISSIONS-DESIGN §1). Refusing the turn.",
    );
    this.name = "ControlPlaneToolEmittedError";
  }
}

export type GateDecision =
  | { readonly decision: "allow" }
  | {
      readonly decision: "confirm";
      readonly risk: RiskLevel;
      readonly reason: "risk_default" | "user_requires_confirmation" | "never_persistently_allowed";
    };

/** Current grants, read once per turn rather than once per call. */
export async function loadGrants(
  tx: DatabaseTransaction,
): Promise<ReadonlyMap<string, PermissionGrantDecision>> {
  const grants = await permissions.listCurrentGrants(tx);
  return new Map(grants.map((grant) => [grant.action_type, grant.decision]));
}

/**
 * One intent's calls -> allow, or confirm with the highest risk among them.
 *
 * An intent is held WHOLE if any one of its calls needs confirmation: its calls
 * are interdependent, and committing part of an intent now and the rest later
 * would split one atomic unit across two moments.
 *
 * FAILS CLOSED twice: a control-plane tool throws, and an unclassified tool
 * throws inside `riskFor`.
 */
export function gateIntentCalls(
  calls: readonly ToolCall[],
  grants: ReadonlyMap<string, PermissionGrantDecision>,
): GateDecision {
  // Every call is checked for the control plane BEFORE any is classified, so
  // the refusal does not depend on where in the intent the call sits.
  for (const call of calls) {
    if (CONTROL_PLANE_TOOLS.has(call.name)) throw new ControlPlaneToolEmittedError(call.name);
  }

  let held: Extract<GateDecision, { decision: "confirm" }>["reason"] | null = null;
  for (const call of calls) {
    const outcome = decidePermission(riskFor(call.name), grants.get(call.name) ?? null);
    if (outcome.decision === "confirm") {
      held = outcome.reason;
      break;
    }
  }

  const risk: RiskLevel | null = highestRisk(calls.map((call) => call.name));
  if (held === null || risk === null) return { decision: "allow" };
  return { decision: "confirm", risk, reason: held };
}
