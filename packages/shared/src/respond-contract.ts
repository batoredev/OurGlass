/**
 * The Respond stage contract (docs/PHASE-3-DESIGN.md §5).
 *
 * Respond is ONE constrained Haiku call, no tools, no DB handle, with a
 * MANDATORY deterministic template fallback. This file defines the shapes
 * both the real Haiku-backed Responder (apps/api/src/assistant) and its
 * template fallback build against, so the two never drift.
 *
 * TRUST BOUNDARY: `RespondInput` carries only plain data — no row objects,
 * no UUIDs. The model must never see an identifier it could echo back and
 * have mistaken for a resolved reference (§5.1). Every field here is a
 * primitive, a formatted string, or a closed enum.
 */

// ---------------------------------------------------------------------------
// Model constant — mirrors packages/shared/src/extraction-schema.ts's
// EXTRACTION_MODEL for the identical anti-drift reason: the literal must not
// be retyped at each call site (this file, the live Responder, the eval
// harness if Phase 4 adds one for Respond).
//
// Owner decision: Sonnet and Haiku only, no Opus, anywhere in this product
// (docs/DECISIONS.md open question 2). Respond is the one Haiku call.
// ---------------------------------------------------------------------------

export const RESPOND_MODEL = "claude-haiku-5" as const;

// ---------------------------------------------------------------------------
// CommittedFact — one already-applied mutation, described as plain data.
// This is what Mutate hands to Respond: never a Commitment/Reminder row,
// always a flattened, pre-formatted summary. `*Local` fields are already
// converted to the user's timezone and formatted as a display string
// (never an ISO instant) — Respond has no DB handle and cannot look up
// users.timezone itself.
// ---------------------------------------------------------------------------

export interface CommitmentCreatedFact {
  readonly kind: "commitment_created";
  readonly ownerName: string;
  readonly recipientName: string | null;
  readonly objectText: string;
  /** Already formatted in the user's local timezone, or null if no deadline. */
  readonly expectedAtLocal: string | null;
}

export interface ReminderCreatedFact {
  readonly kind: "reminder_created";
  /** Already formatted in the user's local timezone. */
  readonly fireAtLocal: string;
}

export interface CommitmentCompletedFact {
  readonly kind: "commitment_completed";
  readonly objectText: string;
  /**
   * null when expected_at IS NULL (docs/PHASE-3-DESIGN.md §2) — there was no
   * deadline to be late against. Never zero-as-null: zero means "exactly on
   * time", which is a real, different claim.
   */
  readonly latenessMs: number | null;
}

export interface CommitmentUpdatedFact {
  readonly kind: "commitment_updated";
  readonly objectText: string;
  readonly status: string | null;
}

/**
 * §16 — a durable fact was stored.
 *
 * Carries the BODY rather than an id because Respond has no database handle
 * and, more importantly, because the user needs to see what the assistant now
 * believes. A reply of "Noted." to a misheard fact is how a wrong memory
 * survives: §28's "inspect and correct what the assistant believes" starts
 * with the assistant saying it out loud.
 */
export interface MemoryStoredFact {
  readonly kind: "memory_stored";
  readonly body: string;
}

/** §17 — a stored fact was invalidated. Never deleted; see the bitemporal rule. */
export interface MemoryForgottenFact {
  readonly kind: "memory_forgotten";
  readonly body: string;
}

/** §25 — a conditional rule now stands. */
export interface WorkflowCreatedFact {
  readonly kind: "workflow_created";
  readonly actionBody: string;
  /** Already formatted in the user's local timezone. */
  readonly evaluateAtLocal: string;
}

/** §36 — a new kind of thing is now tracked, and the UI renders it with no deploy. */
export interface EntityTypeDefinedFact {
  readonly kind: "entity_type_defined";
  readonly displayName: string;
  readonly fieldCount: number;
}

/** §36 — one instance of a tracked kind. */
export interface EntityRecordCreatedFact {
  readonly kind: "entity_record_created";
  readonly displayName: string;
}

/** §24 — a meeting or appointment was put on the internal calendar. */
export interface EventScheduledFact {
  readonly kind: "event_scheduled";
  readonly title: string;
  /** Already formatted in the user's local timezone. */
  readonly startsAtLocal: string;
}

export type CommittedFact =
  | CommitmentCreatedFact
  | ReminderCreatedFact
  | CommitmentCompletedFact
  | CommitmentUpdatedFact
  | MemoryStoredFact
  | MemoryForgottenFact
  | WorkflowCreatedFact
  | EntityTypeDefinedFact
  | EntityRecordCreatedFact
  | EventScheduledFact;

// ---------------------------------------------------------------------------
// RespondInput / Responder — the call contract (§5.1).
// ---------------------------------------------------------------------------

export interface RespondInput {
  /** Plain data describing what already committed this turn — no rows, no ids. */
  readonly committed: readonly CommittedFact[];
  /** Already-composed clarification questions raised this turn. */
  readonly questions: readonly string[];
  /** Already-composed honest-decline messages, e.g. "I can't look things up yet." */
  readonly declined: readonly string[];
}

export interface RespondOutput {
  readonly reply: string;
  /** true iff the template fallback (never the model) produced `reply`. */
  readonly degraded: boolean;
}

export interface Responder {
  respond(input: RespondInput): Promise<RespondOutput>;
}
