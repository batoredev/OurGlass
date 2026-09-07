/**
 * @ourglass/shared
 *
 * Shared TypeScript types for the Batore Personal Assistant, used by both
 * apps/api and apps/web so the tool-call contract (spec §37) and entity
 * shapes never drift between frontend and backend.
 *
 * This is a placeholder for Phase 0. Phase 1 (see docs/PHASES.md) adds the
 * real entity types: Commitment, Person, Organization, Project, Reminder,
 * Relationship, EntityType (for the dynamic-entity registry), and the typed
 * tool-call union.
 */

export const OURGLASS_SCHEMA_VERSION = 0 as const;

export interface HealthCheck {
  readonly ok: true;
  readonly service: string;
}
