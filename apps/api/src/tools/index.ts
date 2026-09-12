/**
 * The concrete Phase 1 tool registry. Importing this module registers every
 * tool AND every table's inverse handler (each tool file calls
 * registerInverseHandler at module load — see create-commitment.ts,
 * create-reminder.ts, define-entity-type.ts).
 */
import { ToolRegistry } from "./registry.js";
import { createCommitmentTool } from "./create-commitment.js";
import { createReminderTool } from "./create-reminder.js";
import { defineEntityTypeTool } from "./define-entity-type.js";
import { completeCommitmentTool } from "./complete-commitment.js";
import { updateCommitmentTool } from "./update-commitment.js";

/**
 * EVERY tool the orchestrator can emit must appear here.
 *
 * complete_commitment and update_commitment were written, typechecked, and
 * unit-tested while being absent from this list — the fifth instance of the
 * defect class DECISIONS.md names "schema with no code path", in its tool-layer
 * form: the module exists and compiles, and nothing reaches it. runTurn emits
 * `complete_commitment` for the phase demo, so the failure would have been a
 * runtime "unknown tool" on the ONE sentence Phase 3 exists to support.
 *
 * `registry.test.ts` asserts this list against the orchestrator planner names
 * so the next addition cannot repeat it.
 */
export function buildToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createCommitmentTool);
  registry.register(createReminderTool);
  registry.register(defineEntityTypeTool);
  registry.register(completeCommitmentTool);
  registry.register(updateCommitmentTool);
  return registry;
}

export { ToolRegistry } from "./registry.js";
export { executeTurn, undoTurn, appendActionLog, type Deps } from "./executor.js";
export * from "./errors.js";
