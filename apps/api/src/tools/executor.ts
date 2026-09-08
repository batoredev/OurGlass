/**
 * executeTurn / undoTurn — the validate -> commit -> log -> undo pipeline.
 *
 * docs/PHASE-1-DESIGN.md §4.2, pseudocode and its five invariants:
 *   1. Validation completes before ANY write. A failed validation writes
 *      nothing — every call in the turn is validated before commit() is
 *      called on any of them.
 *   2. One transaction per turn; one transaction per undo. No partial
 *      application, ever.
 *   3. Tools never open their own transaction — they receive ctx.tx.
 *   4. Tools never DELETE. Invalidate via t_invalid (enforced by convention
 *      in each tool's commit(); the executor cannot itself verify a tool
 *      didn't DELETE, but code review + §2.1 must catch it).
 *   5. Every mutation returns its inverse, or declares invertibility:'none'.
 *
 * NOTE on invariant 1 as actually implemented below: the pseudocode in the
 * design doc validates and commits tool-by-tool inside a single loop
 * (`for (const [i, call] of calls.entries())`), which means tool N's
 * commit() can run before tool N+1's validate(). That still satisfies "a
 * failed validation writes nothing" ONLY because the whole loop runs inside
 * one transaction that gets rolled back on any failure — a later
 * validation failure unwinds earlier commits via the transaction, not by
 * having validated everything up front. This file follows the design doc's
 * pseudocode exactly (validate-then-commit per call, inside one shared
 * transaction) rather than a stricter "validate all calls first" variant,
 * because the design doc explicitly writes it that way and a dynamic tool's
 * validate() may depend on state written by an earlier tool in the SAME
 * turn (e.g. Resolve's create_person -> create_commitment(owner_id: new
 * uuid) sequence in §3, both in one turn, one transaction).
 */
import { randomUUID } from "node:crypto";
import type {
  ActorKind,
  DatabaseTransaction,
  Invertibility,
  LoggedMutation,
  ToolCall,
  ToolContext,
  ToolError,
} from "@ourglass/shared";
import type { ToolRegistry } from "./registry.js";
import {
  NotInvertibleError,
  PG_UNIQUE_VIOLATION,
  ToolNotFoundError,
  TurnAlreadyUndoneError,
  TurnNotFoundError,
} from "./errors.js";
import { applyInverseForTable } from "./inverses.js";

/**
 * Minimal shape the executor needs from packages/db. Deliberately narrow —
 * this is the seam that gets bound to schema2's real transaction-running
 * helper once published. `withTransaction` must open exactly one Postgres
 * transaction, run the callback, commit on success, and roll back (and
 * rethrow) on any error or thrown value — standard `BEGIN`/`COMMIT`/
 * `ROLLBACK` semantics.
 */
export interface Deps {
  readonly db: {
    withTransaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
  };
  readonly registry: ToolRegistry;
}

export interface ExecuteTurnSuccess {
  readonly ok: true;
  readonly turnId: string;
  readonly results: readonly unknown[];
}

export interface ExecuteTurnFailure {
  readonly ok: false;
  readonly toolName: string;
  readonly errors: readonly ToolError[];
}

export type ExecuteTurnOutcome = ExecuteTurnSuccess | ExecuteTurnFailure;

/**
 * Appends one action_log row for a single LoggedMutation. Exported so
 * tests / the DB layer can see the exact row shape without duplicating it.
 * This is the ONLY place that writes to action_log — tools never do.
 */
export async function appendActionLog(
  tx: DatabaseTransaction,
  ctx: ToolContext,
  toolName: string,
  mutation: LoggedMutation,
  extra?: { readonly undoesTurnId?: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO action_log
       (turn_id, seq, tool_name, actor_kind, invertibility,
        target_table, target_id, forward_patch, inverse_patch, undoes_turn_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      ctx.turnId,
      ctx.seq,
      toolName,
      ctx.actorKind,
      mutation.invertibility,
      mutation.targetTable,
      mutation.targetId,
      JSON.stringify(mutation.forwardPatch),
      JSON.stringify(mutation.inversePatch),
      extra?.undoesTurnId ?? null,
    ],
  );
}

/**
 * Row shape read back from action_log for undo. `seq` here is the ORIGINAL
 * seq of the forward mutation (used for descending-seq ordering, per §2.7
 * invariant 1 — FK ordering, a commitment must not be reversed before the
 * reminder referencing it).
 */
export interface ActionLogEntry {
  [key: string]: unknown;
  readonly id: number;
  readonly turnId: string;
  readonly seq: number;
  readonly toolName: string;
  readonly invertibility: Invertibility;
  readonly targetTable: string;
  readonly targetId: string | null;
  readonly inversePatch: unknown;
}

export async function executeTurn(
  calls: readonly ToolCall[],
  deps: Deps,
  actorKind: ActorKind = "user_turn",
): Promise<ExecuteTurnOutcome> {
  const turnId = randomUUID();

  return deps.db.withTransaction(async (tx) => {
    const results: unknown[] = [];

    for (const [i, call] of calls.entries()) {
      const tool = deps.registry.get(call.name);
      if (!tool) {
        throw new ToolNotFoundError(call.name);
      }

      const ctx: ToolContext = { tx, turnId, seq: i, actorKind };

      // 1. VALIDATE — must complete, and reject, before any write.
      const validated = await tool.validate(call.input, ctx);
      if (!validated.ok) {
        // Returning here (rather than throwing) inside deps.db.withTransaction's
        // callback still must trigger a rollback with nothing written, because
        // no commit() has been called for this call and no earlier call in
        // this loop wrote anything the caller wants to keep on a validation
        // failure. We throw a typed error so withTransaction's rollback path
        // is exercised uniformly for both thrown errors and validation
        // failures — see the catch below.
        throw new ValidationRollback(call.name, validated.errors);
      }

      // 2. COMMIT
      const { output, mutations } = await tool.commit(validated.value, ctx);

      // 3. LOG — one action_log row per mutation the tool reports.
      for (const mutation of mutations) {
        await appendActionLog(tx, ctx, tool.name, mutation);
      }

      results.push(output);
    }

    return { ok: true, turnId, results } as const;
  }).catch((error: unknown) => {
    if (error instanceof ValidationRollback) {
      return { ok: false, toolName: error.toolName, errors: error.errors } as const;
    }
    throw error;
  });
}

/** Internal — used only to unwind executeTurn's transaction on validation failure. */
class ValidationRollback extends Error {
  constructor(
    public readonly toolName: string,
    public readonly errors: readonly ToolError[],
  ) {
    super(`validation failed for ${toolName}`);
  }
}

export interface UndoResult {
  readonly undone: number;
}

export async function undoTurn(turnId: string, deps: Deps): Promise<UndoResult> {
  return deps.db.withTransaction(async (tx) => {
    const { rows: entries } = await tx.query<ActionLogEntry>(
      `SELECT id, turn_id AS "turnId", seq, tool_name AS "toolName",
              invertibility, target_table AS "targetTable",
              target_id AS "targetId", inverse_patch AS "inversePatch"
         FROM action_log
        WHERE turn_id = $1 AND actor_kind = 'user_turn'
        ORDER BY seq DESC`,
      [turnId],
    );

    if (entries.length === 0) {
      throw new TurnNotFoundError(turnId);
    }

    if (entries.some((e) => e.invertibility === "none")) {
      throw new NotInvertibleError(turnId);
    }

    // On a SECOND undoTurn call for an already-undone turn, this re-applies
    // every inverse before the duplicate-marker insert below throws. That is
    // safe only because (a) the whole thing runs in ONE transaction that
    // rolls back on the unique-violation catch, so nothing here is
    // persisted, AND (b) every Phase 1 inverse handler is idempotent
    // (invalidate-via-COALESCE(t_invalid, now()) — see inverses.ts
    // registrations in create-commitment.ts/create-reminder.ts/
    // define-entity-type.ts). The original action_log rows are never
    // mutated (append-only, §2.7 invariant 2), so they remain visible to
    // this SELECT even after a successful undo, which is why a second call
    // reaches this loop at all rather than finding zero rows.
    //
    // If a future inverse handler is NOT idempotent (e.g. it appends rather
    // than sets), this re-application-then-rollback pattern would need
    // revisiting — the transaction rollback still makes it safe for
    // Postgres-visible state, but any non-transactional side effect
    // triggered inside applyInverse (there are none in Phase 1) would not
    // be undone by the rollback.
    for (const entry of entries) {
      await applyInverse(tx, entry);
    }

    // Append-only undo marker: EXACTLY ONE row per undone turn, carrying
    // undoes_turn_id. The partial unique index
    // action_log_undo_once_idx ON action_log(undoes_turn_id)
    //   WHERE undoes_turn_id IS NOT NULL
    // is defined on undoes_turn_id ALONE (§2.7), not on (undoes_turn_id, seq)
    // — so it permits at most one row with a given undoes_turn_id, full
    // stop. Writing one marker row per ORIGINAL entry (one per seq) would
    // make every insert after the first collide with the previous one from
    // the SAME undo attempt, throwing "already undone" on a turn that was
    // never undone before. All per-entry detail therefore lives in this one
    // row's forward_patch, as an array — one entry per original action_log
    // row reversed, in the same descending-seq order they were applied.
    //
    // We do NOT pre-check "has this turn already been undone" in
    // application code before attempting this insert — the whole point is
    // that the constraint, not a query-then-act race, rejects a second
    // attempt.
    try {
      const undoCtx: ToolContext = { tx, turnId: randomUUID(), seq: 0, actorKind: "undo" };
      await appendActionLog(
        tx,
        undoCtx,
        "undo",
        {
          targetTable: "action_log",
          targetId: null,
          forwardPatch: entries.map((e) => ({
            targetTable: e.targetTable,
            targetId: e.targetId,
            appliedInverse: e.inversePatch,
          })),
          inversePatch: null,
          invertibility: "none",
        },
        { undoesTurnId: turnId },
      );
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new TurnAlreadyUndoneError(turnId, error);
      }
      throw error;
    }

    return { undone: entries.length };
  });
}

/**
 * Applies one action_log entry's inverse_patch. Phase 1 ships this as a
 * thin dispatcher tools register an "applyInverse" handler for, keyed by
 * targetTable — see ./inverses.ts. Kept separate so individual tools stay
 * responsible for the *shape* of their inverse_patch while the executor
 * stays responsible for *when* it runs (transaction, ordering).
 */
async function applyInverse(tx: DatabaseTransaction, entry: ActionLogEntry): Promise<void> {
  await applyInverseForTable(tx, entry.targetTable, entry.targetId, entry.inversePatch);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
