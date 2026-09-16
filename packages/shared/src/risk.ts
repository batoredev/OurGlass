/**
 * Risk classification for mutations (§15).
 *
 * ================================ READ THIS ================================
 * THE MODEL IS NEVER ASKED ABOUT RISK. It is not in the extraction contract,
 * not in the system prompt, and not a field a tool declares about itself.
 *
 * A tool that states its own risk level is a tool that can under-state it, and
 * a prompt that asks a model to respect a policy is a policy the model can
 * talk its way past. The level comes from a table the EXECUTOR consults, keyed
 * by tool name, and the executor is the only thing that can commit.
 *
 * The levels are ordered, and the order is load-bearing: `atOrAbove` is how a
 * confirmation gate asks "is this at least an external action?" without
 * restating the list.
 * ===========================================================================
 */

/**
 * Ordered least- to most-consequential. The INDEX is the severity, which is
 * why this is an array rather than a bare union.
 */
export const RISK_LEVELS = [
  /** Reads rows and nothing else. "What do I owe Hult?" */
  "READ",
  /** A write `undo` fully reverses. "Remind me tomorrow." */
  "REVERSIBLE_WRITE",
  /**
   * A write that changes what the assistant BELIEVES, not merely what it
   * holds. "Change Karthik's responsibility." Reversible, but the user may
   * never notice it happened — which is what separates it from the level
   * below.
   */
  "IMPORTANT_STATE_CHANGE",
  /** Leaves the system. "Send Karthik a WhatsApp." Nothing undoes a sent message. */
  "EXTERNAL_ACTION",
  /** Broad or destructive. "Delete all commitments." */
  "HIGH_IMPACT_ACTION",
] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === "string" && (RISK_LEVELS as readonly string[]).includes(value);
}

/** Severity rank. Higher is more consequential. */
export function riskRank(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level);
}

/** True when `level` is at least as consequential as `floor`. */
export function atOrAbove(level: RiskLevel, floor: RiskLevel): boolean {
  return riskRank(level) >= riskRank(floor);
}

/**
 * The level at which a turn needs explicit confirmation before it commits.
 *
 * EXTERNAL_ACTION, because that is the first level `undo` cannot reverse. Spec
 * §35 says external actions always confirm; everything below it is recoverable
 * from `action_log`, and confirming a recoverable write is the confirmation
 * fatigue §27 forbids.
 */
export const CONFIRMATION_FLOOR: RiskLevel = "EXTERNAL_ACTION";
