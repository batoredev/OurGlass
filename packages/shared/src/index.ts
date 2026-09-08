/**
 * @ourglass/shared
 *
 * Shared TypeScript types for the Batore Personal Assistant, used by both
 * apps/api and apps/web so the tool-call contract (spec §37) and entity
 * shapes never drift between frontend and backend.
 *
 * Phase 1 (docs/PHASE-1-DESIGN.md §4.1) adds the tool contract itself:
 * ToolContext, ToolError, LoggedMutation, ToolDefinition. See
 * ./tool-contract.ts. Concrete entity types (Commitment, Person, ...) are
 * intentionally NOT re-exported from here yet — they belong to whichever
 * package owns their canonical shape (packages/db for DB row shapes), and
 * are added once database-data-engineer publishes the schema.
 */

export const OURGLASS_SCHEMA_VERSION = 1 as const;

export interface HealthCheck {
  readonly ok: true;
  readonly service: string;
}

export * from "./tool-contract.js";
