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
 * ┌─ WHERE THIS IS ENFORCED, AND WHY NOT YET IN THE EXECUTOR ───────────────┐
 * │ The first version called `riskFor` inside `executeTurn`, before every   │
 * │ write. It was removed, and the reason is worth keeping.                 │
 * │                                                                        │
 * │ THERE IS NO CONFIRMATION MECHANISM YET — §35 builds it in stage 12. A   │
 * │ call that can only THROW enforces nothing except that a name appears in │
 * │ a table: enforcement theatre. It also forced every in-memory test       │
 * │ double (`create_widget`, `send_email`) to become an entry in the        │
 * │ PRODUCTION risk table, which directly contradicts this file's own       │
 * │ "classifies nothing that is not registered" test. Two rules that cannot │
 * │ both hold is the signal that the design was wrong, not the tests.       │
 * │                                                                        │
 * │ The real threat is a future tool reaching `buildToolRegistry` with no   │
 * │ classification. That is a PROGRAMMING error, not a runtime condition,   │
 * │ and `assertRiskTableCovers` catches it at test time — the right layer.  │
 * │                                                                        │
 * │ `requiresConfirmation` is the seam stage 12 will call, once there is    │
 * │ something to confirm WITH.                                             │
 * └────────────────────────────────────────────────────────────────────────┘
 * ===========================================================================
 */
import { CONFIRMATION_FLOOR, atOrAbove, type RiskLevel } from "@ourglass/shared";
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
  create_entity_record: "REVERSIBLE_WRITE",
  remember: "REVERSIBLE_WRITE",

  forget_memory: "IMPORTANT_STATE_CHANGE",
  correct_relationship: "IMPORTANT_STATE_CHANGE",
  define_entity_type: "IMPORTANT_STATE_CHANGE",
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

/** True when a turn containing these calls needs explicit confirmation (§35). */
export function requiresConfirmation(toolNames: readonly string[]): boolean {
  const highest = highestRisk(toolNames);
  return highest !== null && atOrAbove(highest, CONFIRMATION_FLOOR);
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
