/**
 * The §35 permission decision — pure, no I/O (PHASE-7-PERMISSIONS-DESIGN §3).
 *
 * | Risk                    | no grant | grant allow | grant confirm |
 * |-------------------------|----------|-------------|---------------|
 * | READ .. IMPORTANT       | allow    | allow       | confirm       |
 * | EXTERNAL_ACTION         | confirm  | allow       | confirm       |
 * | HIGH_IMPACT_ACTION      | confirm  | confirm     | confirm       |
 *
 * Two asymmetries, both deliberate:
 *   - A STRICTER grant is honoured everywhere. Asking to confirm before
 *     forgetting a memory is a reasonable thing to want.
 *   - A LOOSER grant lifts only EXTERNAL_ACTION. HIGH_IMPACT_ACTION always
 *     confirms; "always allow" for it is refused when set, not silently ignored.
 */
import { CONFIRMATION_FLOOR, atOrAbove, type RiskLevel } from "@ourglass/shared";

export type PermissionGrantDecision = "allow" | "confirm";

export type PermissionOutcome =
  | { readonly decision: "allow" }
  | {
      readonly decision: "confirm";
      readonly reason: "risk_default" | "user_requires_confirmation" | "never_persistently_allowed";
    };

export function decidePermission(
  risk: RiskLevel,
  grant: PermissionGrantDecision | null,
): PermissionOutcome {
  if (grant === "confirm") return { decision: "confirm", reason: "user_requires_confirmation" };
  if (risk === "HIGH_IMPACT_ACTION") {
    return { decision: "confirm", reason: "never_persistently_allowed" };
  }
  if (atOrAbove(risk, CONFIRMATION_FLOOR)) {
    return grant === "allow" ? { decision: "allow" } : { decision: "confirm", reason: "risk_default" };
  }
  return { decision: "allow" };
}

/** Whether `allow` may be recorded for a risk level at all (set_permission validation). */
export function canPersistentlyAllow(risk: RiskLevel): boolean {
  return risk !== "HIGH_IMPACT_ACTION";
}

/**
 * The control plane. These tools change what is PERMITTED, so they are never
 * reachable from a conversation — a grant a model could propose is a grant a
 * prompt-injected document could propose (design §1). The orchestrator's gate
 * throws if a planner ever emits one.
 */
export const CONTROL_PLANE_TOOLS: ReadonlySet<string> = new Set([
  "set_permission",
  "revoke_permission",
  "release_pending_action",
  "decline_pending_action",
]);

/** How long a held action stays confirmable. An approval days later approves a moved-on world. */
export const PENDING_ACTION_TTL_SECONDS = 24 * 60 * 60;
