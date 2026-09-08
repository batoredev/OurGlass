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

export function buildToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createCommitmentTool);
  registry.register(createReminderTool);
  registry.register(defineEntityTypeTool);
  return registry;
}

export { ToolRegistry } from "./registry.js";
export { executeTurn, undoTurn, appendActionLog, type Deps } from "./executor.js";
export * from "./errors.js";
