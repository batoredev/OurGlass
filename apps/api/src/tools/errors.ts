/**
 * Executor-level error types. Distinct from ToolError (packages/shared),
 * which is a single validation failure a tool reports. These are thrown by
 * the executor itself for conditions outside any single tool's control.
 */
import type { ToolError } from "@ourglass/shared";

export class ToolNotFoundError extends Error {
  constructor(public readonly toolName: string) {
    super(`Unknown tool: "${toolName}"`);
    this.name = "ToolNotFoundError";
  }
}

/** Thrown by undoTurn when any entry in the turn declares invertibility:'none'. */
export class NotInvertibleError extends Error {
  constructor(public readonly turnId: string) {
    super(`Turn ${turnId} contains a mutation with invertibility:'none' and cannot be undone`);
    this.name = "NotInvertibleError";
  }
}

/** Thrown by undoTurn when turn_id has no user_turn action_log entries at all. */
export class TurnNotFoundError extends Error {
  constructor(public readonly turnId: string) {
    super(`No user_turn action_log entries found for turn ${turnId}`);
    this.name = "TurnNotFoundError";
  }
}

/**
 * Thrown when the DB rejects a second undo of the same turn. The message
 * intentionally matches the substring the design spec's own test asserts on
 * (`/already undone/`, docs/PHASE-1-DESIGN.md §4.3) while wrapping whatever
 * underlying Postgres unique-violation error triggered it (23505 on
 * action_log_undo_once_idx) — see docs/PHASE-1-DESIGN.md §2.7 invariant 3.
 * The executor must not pre-check this in application code; it lets the
 * partial unique index reject the write and translates the resulting DB
 * error into this class. That is what makes the double-undo rejection a
 * database constraint rather than a check-then-act race.
 */
export class TurnAlreadyUndoneError extends Error {
  constructor(public readonly turnId: string, cause?: unknown) {
    super(
      `Turn ${turnId} is already undone`,
      cause !== undefined ? { cause } : undefined,
    );
    this.name = "TurnAlreadyUndoneError";
  }
}

/** Aggregates ToolError[] from a failed validate() call for the caller. */
export class ValidationFailedError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly errors: readonly ToolError[],
  ) {
    super(`Validation failed for tool "${toolName}": ${errors.map((e) => e.message).join("; ")}`);
    this.name = "ValidationFailedError";
  }
}

/** Postgres unique_violation SQLSTATE. */
export const PG_UNIQUE_VIOLATION = "23505";
