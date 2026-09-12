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

export type CommittedFact =
  | CommitmentCreatedFact
  | ReminderCreatedFact
  | CommitmentCompletedFact
  | CommitmentUpdatedFact;

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
