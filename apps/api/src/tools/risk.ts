/**
 * Which risk level each tool carries (§15).
 *
 * ================================ READ THIS ================================
 * A TABLE, KEYED BY TOOL NAME — not a field on ToolDefinition.
 *
 * `ToolDefinition` deliberately has no risk field. A tool that declares its own
 * level is a tool that can under-declare it, and the classification exists
 * precisely to be something neither the tool nor the model controls. The
 * executor reads this table; the executor is the only thing that can commit.
 *
 * ⚠ EVERY REGISTERED TOOL MUST APPEAR HERE. `assertRiskTableCovers` enforces
 * it against the live registry, so adding a tool without classifying it fails
 * a test rather than defaulting to something — and a default would be either
 * too permissive (silently allowing an unclassified external action) or too
 * strict (blocking every new tool until someone noticed).
 *
 * ┌─ WHERE THIS IS ENFORCED — AND WHY NOT IN THE EXECUTOR ──────────────────┐
 * │ ENFORCED in `apps/api/src/permissions/gate.ts`, called by `runTurn`     │
 * │ between Resolve and Mutate (PHASE-7-PERMISSIONS-DESIGN §4). The gate    │
 * │ combines this table with the user's grants and HOLDS an intent for      │
 * │ confirmation rather than refusing it.                                   │
 * │                                                                        │
 * │ The first version called `riskFor` inside `executeTurn`. It was removed │
 * │ in stage 7: a check that can only THROW enforces nothing but that a     │
 * │ name appears in a table, and it forced every in-memory test double      │
 * │ (`create_widget`, `send_email`) into the PRODUCTION table. Holding      │
 * │ needs the planner's intent grouping, which exists only in `runTurn`.    │
 * │                                                                        │
 * │ What keeps a gate outside the executor honest is                       │
 * │ `executor.callsites.test.ts`: every other caller of `executeTurn` must  │
 * │ be listed with the reason it is not model-driven.                       │
 * │                                                                        │
 * │ `requiresConfirmation` (risk only) was deleted when the gate landed:    │
 * │ it ignored grants, so any caller would have got the wrong answer the    │
 * │ moment a user set one. `decidePermission` is the one decision.          │
 * └────────────────────────────────────────────────────────────────────────┘
 * ===========================================================================
 */
import { atOrAbove, type RiskLevel } from "@ourglass/shared";
import type { ToolRegistry } from "./registry.js";

/**
 * Tool name -> risk level.
 *
 * Reasoning for the non-obvious ones:
 *
 * - `forget_memory` and `correct_relationship` are IMPORTANT_STATE_CHANGE, not
 *   REVERSIBLE_WRITE. Both ARE reversible — nothing here deletes — but they
 *   change what the assistant believes, and the user may never notice the
 *   wrong one went. Recoverability is not the only axis; noticeability is too.
 * - `define_entity_type` is IMPORTANT_STATE_CHANGE: a junk type is reversible
 *   but persistently clutters a UI that renders the registry with no code.
 * - `fire_reminder` and `evaluate_workflow` are REVERSIBLE_WRITE despite being
 *   poller-driven. Risk is a property of the MUTATION, not of who triggered it.
 * - Nothing is EXTERNAL_ACTION or HIGH_IMPACT_ACTION yet, and that is honest:
 *   no tool in this registry leaves the system. Gmail, Calendar and Drive
 *   arrive in Phase 7 (§34) and will be the first.
 */
export const RISK_BY_TOOL: Readonly<Record<string, RiskLevel>> = {
  create_commitment: "REVERSIBLE_WRITE",
  update_commitment: "REVERSIBLE_WRITE",
  complete_commitment: "REVERSIBLE_WRITE",
  create_reminder: "REVERSIBLE_WRITE",
  fire_reminder: "REVERSIBLE_WRITE",
  create_workflow: "REVERSIBLE_WRITE",
  evaluate_workflow: "REVERSIBLE_WRITE",
  attach_context: "REVERSIBLE_WRITE",
  create_event: "REVERSIBLE_WRITE",
  // Internal state only, and its undo keeps the person if anything else now
  // references them — so undoing it can never orphan a row.
  create_person: "REVERSIBLE_WRITE",
  create_entity_record: "REVERSIBLE_WRITE",
  remember: "REVERSIBLE_WRITE",

  forget_memory: "IMPORTANT_STATE_CHANGE",
  correct_relationship: "IMPORTANT_STATE_CHANGE",
  define_entity_type: "IMPORTANT_STATE_CHANGE",
  // Same reasoning as defining a type: reversible, but it changes a UI that
  // renders the registry with no code, on every surface showing that type.
  add_entity_field: "IMPORTANT_STATE_CHANGE",

  // The §35 control plane. Classified like any tool, but never gated by the
  // permission policy: they ARE the user's explicit decision, reached only
  // from control-plane routes (PHASE-7-PERMISSIONS-DESIGN §1).
  set_permission: "IMPORTANT_STATE_CHANGE",
  revoke_permission: "IMPORTANT_STATE_CHANGE",
  release_pending_action: "REVERSIBLE_WRITE",
  decline_pending_action: "REVERSIBLE_WRITE",
};

/** Raised when a tool call reaches the executor with no classification. */
export class UnclassifiedToolError extends Error {
  readonly toolName: string;

  constructor(toolName: string) {
    super(
      `Tool "${toolName}" has no risk classification. Add it to RISK_BY_TOOL — ` +
        "an unclassified mutation must never commit.",
    );
    this.name = "UnclassifiedToolError";
    this.toolName = toolName;
  }
}

/**
 * The level for a tool, or a throw.
 *
 * FAILS CLOSED. An unclassified tool is a programming error, and the safe
 * response to "I do not know how dangerous this is" is to refuse — not to
 * assume the lowest level and commit.
 */
export function riskFor(toolName: string): RiskLevel {
  const level = RISK_BY_TOOL[toolName];
  if (level === undefined) throw new UnclassifiedToolError(toolName);
  return level;
}

/** The highest risk level across a set of calls; null when there are none. */
export function highestRisk(toolNames: readonly string[]): RiskLevel | null {
  let highest: RiskLevel | null = null;
  for (const name of toolNames) {
    const level = riskFor(name);
    if (highest === null || atOrAbove(level, highest)) highest = level;
  }
  return highest;
}

/**
 * Every registered tool is classified. Called by a test, not at startup.
 *
 * Returns the offenders rather than throwing, so a failure names ALL of them
 * at once instead of one per run.
 */
export function assertRiskTableCovers(registry: ToolRegistry): readonly string[] {
  return registry
    .list()
    .map((tool) => tool.name)
    .filter((name) => RISK_BY_TOOL[name] === undefined);
}
