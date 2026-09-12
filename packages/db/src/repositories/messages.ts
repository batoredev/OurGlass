/**
 * messages — conversation turns and TRACE PERSISTENCE (PHASE-3-DESIGN §8).
 *
 * Part of finding F5: `messages` was a table with no repository. Phase 2's
 * extractor already captures model, latency, stop reason and token counts
 * including cache accounting, and PHASE-2-DESIGN deliberately persisted none of
 * it, assigning that here.
 *
 * .claude/rules/ai-systems.md: "an LLM failure with no trace is unfixable" — a
 * 200 OK can still be a wrong answer, so ordinary APM does not cover this.
 *
 * TRACE IS WRITTEN EVEN WHEN THE TURN MUTATES NOTHING (a question, a refusal, a
 * validation rejection). Those are exactly the turns worth studying. In that case
 * `turn_id` stays NULL (§3.2) and the trace lives on the assistant message anyway
 * — which is WHY trace is on `messages` and not on `action_log`, whose ledger has
 * no row at all for a non-mutating turn.
 */
import type { Queryable } from "../client.js";

export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  /**
   * Ties the message to its `action_log` turn. NULL for messages that produced no
   * mutation — migration 004 says so explicitly, and §3.2 rejects hoisting id
   * generation into the orchestrator precisely so this stays honest. A `turn_id`
   * that names zero action_log rows would make `action_log_turn_idx` lookups
   * return empty for ids the messages table swears are real.
   */
  turn_id: string | null;
  role: MessageRole;
  body: string;
  /** ExtractionTrace + respond trace. NULL for user messages. */
  trace: unknown;
  /** true iff the deterministic template fallback produced this reply (§5.2). */
  degraded: boolean | null;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

export interface CreateMessageInput {
  id?: string | null;
  role: MessageRole;
  body: string;
  turnId?: string | null;
  /**
   * Persist model, stopReason, latencyMs, usage (input/output/cache tokens) and
   * requestId. DO NOT persist the raw completion object or the extracted
   * `Extraction` payload (§8.2): the utterance plus this trace is enough to re-run
   * and compare, and storing the intermediate interpretation doubles per-turn
   * storage to preserve a value reproducible from data we already keep.
   */
  trace?: unknown;
  degraded?: boolean | null;
}

export async function createMessage(
  tx: Queryable,
  input: CreateMessageInput,
): Promise<Message> {
  const { rows } = await tx.query<Message>(
    // `$5::jsonb` with a JS value serialised by `pg` — never string-concatenated.
    // `undefined` must become SQL NULL rather than the string "undefined", which
    // is what `?? null` is doing on every optional field here.
    `INSERT INTO messages (id, turn_id, role, body, trace, degraded)
     VALUES (COALESCE($6::uuid, gen_random_uuid()), $1::uuid, $2, $3, $4::jsonb, $5)
     RETURNING *`,
    [
      input.turnId ?? null,
      input.role,
      input.body,
      input.trace === undefined ? null : JSON.stringify(input.trace),
      input.degraded ?? null,
      input.id ?? null,
    ],
  );
  return rows[0]!;
}

export async function getById(
  tx: Queryable,
  id: string,
): Promise<Message | null> {
  const { rows } = await tx.query<Message>(
    `SELECT * FROM messages WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Attach a `turn_id` to a message after the fact.
 *
 * This is step 5 of §3.2's ordering and it exists BECAUSE turn_id generation is
 * not hoisted into the orchestrator: the user message must be inserted before
 * Interpret runs (so it survives a failed turn and so Phase 4's
 * `relationships.source_message_id` can point at it), but the turn id only exists
 * after `executeTurn`. One small extra write per MUTATING turn — a turn that
 * mutates nothing never calls this and correctly keeps `turn_id` NULL.
 *
 * Returns the previous value so a caller can log an exact inverse, using the same
 * `FROM (SELECT ...) AS old` self-join as `completeCommitment` — `RETURNING *` on
 * an UPDATE is post-update state (Phase 1 build finding #4).
 */
export async function setTurnId(
  tx: Queryable,
  id: string,
  turnId: string | null,
): Promise<{ message: Message; previousTurnId: string | null }> {
  const { rows } = await tx.query<Message & { prev_turn_id: string | null }>(
    `UPDATE messages AS m
        SET turn_id = $2::uuid
       FROM (SELECT id, turn_id FROM messages WHERE id = $1) AS old
      WHERE m.id = old.id
      RETURNING m.*, old.turn_id AS prev_turn_id`,
    [id, turnId],
  );
  const row = rows[0];
  if (!row) throw new Error(`no message with id ${id}`);
  const { prev_turn_id, ...message } = row;
  return { message: message as Message, previousTurnId: prev_turn_id };
}

/**
 * Recent conversation, newest last — the shape a transcript is rendered in.
 *
 * ORDERING CAVEAT, found in CI rather than review: `t_created` defaults to
 * `now()`, which in Postgres is TRANSACTION start time, not statement time.
 * Messages inserted inside ONE transaction therefore share a byte-identical
 * `t_created`, and the `id DESC` tiebreak below is arbitrary because ids are
 * random UUIDs — so a same-transaction batch comes back in no meaningful
 * order. This is not a bug to fix here: production never creates that
 * arrangement (runTurn writes the user and assistant messages in two separate
 * transactions, orchestrator.ts §3.2 steps 1 and 7), and changing the shared
 * bitemporal default to `statement_timestamp()` would alter every table in
 * the schema to serve one read. Callers batching messages atomically and
 * needing a stable order must supply it themselves.
 */
export async function listRecent(
  tx: Queryable,
  limit = 50,
): Promise<Message[]> {
  const { rows } = await tx.query<Message>(
    // Ordered DESC inside, re-ordered ASC outside, so LIMIT takes the NEWEST rows
    // while the caller receives them oldest-first. `ORDER BY t_created LIMIT n`
    // would return the oldest n messages in the database — the opposite.
    `SELECT * FROM (
       SELECT * FROM messages_current ORDER BY t_created DESC, id DESC LIMIT $1
     ) AS recent
     ORDER BY t_created ASC, id ASC`,
    [limit],
  );
  return rows;
}

/** Every message belonging to one turn. */
export async function listByTurn(
  tx: Queryable,
  turnId: string,
): Promise<Message[]> {
  const { rows } = await tx.query<Message>(
    `SELECT * FROM messages_current WHERE turn_id = $1 ORDER BY t_created, id`,
    [turnId],
  );
  return rows;
}

/**
 * INVALIDATE, NEVER DELETE. Idempotent on an already-invalid row, for the same
 * reason as every other invalidate in this package.
 */
export async function invalidateMessage(
  tx: Queryable,
  id: string,
  at?: Date,
): Promise<void> {
  await tx.query(
    `UPDATE messages
        SET t_invalid = COALESCE($2::timestamptz, t_invalid, now())
      WHERE id = $1`,
    [id, at ?? null],
  );
}
