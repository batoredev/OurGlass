/**
 * §24 conflict detection and §26 proactive behaviour, with the relevance gate
 * (docs/PHASE-4-DESIGN.md §6 and §7).
 *
 * These live together because a detected conflict is one of exactly two things
 * §26 permits the assistant to volunteer, and both must pass the same gate.
 *
 * ┌─ SPEC §26's OWN GOOD/BAD LIST IS THE ACCEPTANCE CRITERION ─────────────┐
 * │ GOOD "Barkha's article is five hours overdue and you haven't marked    │
 * │       it as received."                                                 │
 * │ GOOD "You have a 5 PM meeting with Hult and you're trying to schedule  │
 * │       Arun at the same time."                                          │
 * │ BAD  "You have 17 tasks! Here's how to optimize your day!"             │
 * │ BAD  "You should study now."                                           │
 * │ BAD  "Would you like me to create a plan?" after every statement.      │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * THE DISTINGUISHING PROPERTY, stated precisely because a prompt cannot be
 * tested: every GOOD example is a specific, checkable fact about a specific
 * ENTITY, surfaced at the moment it became relevant. Every BAD one is a
 * summary statistic, unsolicited advice (§4), or an offer with no trigger.
 *
 * So the gate is structural, not a prompt instruction:
 *
 *   1. A proactive line MUST cite a specific row id. No row, no line — this
 *      alone eliminates "you have 17 tasks".
 *   2. It must have a trigger that JUST BECAME TRUE, not one that is merely
 *      still true. "Still overdue" fires every turn; that is nagging.
 *   3. At most ONE per turn, and never when the turn already asks a question.
 *      Two asks in one reply is the confirmation fatigue §27 forbids.
 *   4. Never advice. §4 violations are test failures, not style notes.
 *
 * Rules 1–3 are checkable in code and are enforced below. Rule 4 is enforced
 * by construction: this module can only emit the shapes defined here, and
 * none of them is an opinion.
 */
import type { DatabaseTransaction } from "@ourglass/shared";
import { commitments, events, type Event } from "@ourglass/db";

// ---------------------------------------------------------------------------
// §24 — conflict detection
// ---------------------------------------------------------------------------

export interface TimeConflict {
  readonly kind: "time_overlap";
  /** The existing event that the proposed time collides with. */
  readonly existingEventId: string;
  readonly existingTitle: string;
  readonly existingStartsAt: string;
}

/**
 * Does a proposed time collide with something already scheduled?
 *
 * Deterministic SQL (see `events.findOverlapping`), never a model judgement.
 *
 * PHASE 4 IMPLEMENTS ONE OF §24's SIX CONFLICT TYPES — time overlap — and
 * declines the rest honestly. "Impossible deadlines" needs an effort model
 * that does not exist; "contradictory commitments" needs semantic equivalence,
 * which is duplicate detection (§23, already built in Phase 2). Shipping a
 * shallow version of either produces false conflicts, and a false conflict is
 * worse than no conflict: it trains the user to dismiss the surface entirely.
 */
export async function detectTimeConflicts(
  tx: DatabaseTransaction,
  startsAt: Date,
  endsAt: Date | null,
  excludeEventId?: string | null,
): Promise<readonly TimeConflict[]> {
  const overlapping = await events.findOverlapping(tx, startsAt, endsAt, excludeEventId ?? null);
  return overlapping.map((event: Event) => ({
    kind: "time_overlap" as const,
    existingEventId: event.id,
    existingTitle: event.title,
    existingStartsAt: event.starts_at!.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// §26 — the candidates, and the gate
// ---------------------------------------------------------------------------

/**
 * Something the assistant MAY volunteer. Both variants carry a row id,
 * because rule 1 makes that mandatory — a candidate that cannot name a row
 * cannot be constructed.
 */
export type ProactiveCandidate =
  | {
      readonly kind: "conflict";
      /** The event this collides with. Rule 1's specific row. */
      readonly rowId: string;
      readonly conflict: TimeConflict;
    }
  | {
      readonly kind: "overdue";
      /** The commitment that just crossed its deadline. */
      readonly rowId: string;
      readonly objectText: string;
      readonly ownerName: string | null;
      readonly overdueByMs: number;
    };

export interface ProactiveContext {
  /** True when this turn already asks the user something. Rule 3. */
  readonly turnAsksQuestion: boolean;
}

/**
 * Apply the gate. Returns at most ONE candidate, or null.
 *
 * Rule 3 is why this returns a single value rather than a list: the type
 * makes "two proactive lines in one reply" unrepresentable, instead of
 * relying on every caller to slice correctly.
 *
 * A conflict outranks an overdue notice when both are available, because the
 * conflict is about the sentence the user JUST said — it is the more relevant
 * of the two by §26's own standard ("proactivity should be driven by actual
 * relevance"), and it is the one the user can act on immediately.
 */
export function selectProactiveLine(
  candidates: readonly ProactiveCandidate[],
  ctx: ProactiveContext,
): ProactiveCandidate | null {
  // RULE 3: never alongside a question. The user is already being asked for
  // one thing; adding a second is the confirmation fatigue §27 forbids.
  if (ctx.turnAsksQuestion) return null;
  if (candidates.length === 0) return null;

  const conflict = candidates.find((candidate) => candidate.kind === "conflict");
  return conflict ?? candidates[0]!;
}

/**
 * Render a candidate as one sentence.
 *
 * DELIBERATELY DETERMINISTIC — no model call. §26's boundary between "good"
 * and "bad" is exactly the boundary a prompt cannot be tested against, and a
 * template can only say what it is given. This function CANNOT emit "you
 * should study now" because it has no branch that produces advice.
 *
 * The wording mirrors §26's good examples: state the fact, name the entities,
 * stop. No suggestion, no offer, no exclamation mark.
 */
export function renderProactiveLine(
  candidate: ProactiveCandidate,
  formatLocal: (iso: string) => string,
): string {
  if (candidate.kind === "conflict") {
    // §24 requires the reply to name BOTH sides and NOT resolve: "Do not
    // automatically choose." The question is deliberately open.
    return (
      `That conflicts with ${candidate.conflict.existingTitle} at ` +
      `${formatLocal(candidate.conflict.existingStartsAt)}. ` +
      `Move it or keep both?`
    );
  }

  const who = candidate.ownerName ? `${candidate.ownerName}'s ` : "";
  return `${who}${candidate.objectText} is ${formatDuration(candidate.overdueByMs)} overdue and not marked complete.`;
}

/** Whole units only, matching respond.ts's register. Never "3.7 hours". */
function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${Math.max(minutes, 1)} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours`;
  return `${Math.round(hours / 24)} days`;
}

/**
 * Commitments that crossed their deadline SINCE the given instant.
 *
 * ⚠ RULE 2 LIVES HERE, in the half-open `since`/`now` window, and it is the
 * whole difference between §26's "good" and "bad" columns.
 *
 * "Is overdue" stays true on every turn until the thing is completed —
 * surfacing that is nagging. "JUST BECAME overdue" is true exactly once. The
 * caller passes the previous turn's timestamp as `since`, so the window is
 * what elapsed between then and now.
 *
 * A caller with no previous timestamp must pass `now` itself, which yields an
 * empty window and therefore no line. Silence is the correct default when we
 * cannot tell whether the user has already been told.
 */
export async function findNewlyOverdue(
  tx: DatabaseTransaction,
  since: Date,
  now: Date,
): Promise<readonly ProactiveCandidate[]> {
  const crossed = await commitments.listOverdueBetween(tx, since, now);
  return crossed.map((row) => ({
    kind: "overdue" as const,
    rowId: row.id,
    objectText: row.object_text,
    ownerName: row.owner_name,
    overdueByMs: now.getTime() - row.expected_at.getTime(),
  }));
}
