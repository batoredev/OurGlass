/**
 * reminders — tier-1 timed reminders and the poller's claim query.
 *
 * This repository did not exist before Phase 3, which is docs/PHASE-3-DESIGN.md §0
 * finding F5: `reminders` and `messages` were tables with no repository, so
 * `apps/api/src/tools/create-reminder.ts` writes raw SQL through `ctx.tx` and says
 * so in its own header comment. Phase 3 adds a poller and trace persistence, both
 * of which need these tables; leaving raw SQL in three more places is not in scope.
 *
 * THE CLOCK IS ALWAYS A PARAMETER, NEVER `now()`. `claimDueReminders` takes the
 * instant to compare against. That is what makes the poller testable without
 * sleeping — `apps/api/vitest.integration.config.ts` sets `testTimeout: 15_000`, so
 * any test waiting on a real 30-second interval fails by construction (§6.4).
 */
import type { Queryable } from "../client.js";

export interface Reminder {
  id: string;
  commitment_id: string | null;
  body: string;
  /**
   * NULL for the tier-2 (relational) and tier-3 (event-trigger) reminders of
   * DECISIONS.md #3 — those have no timestamp until another entity resolves, and
   * belong to the rule engine, not this poller.
   */
  fire_at: Date | null;
  fired_at: Date | null;
  source_phrase: string | null;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

export interface CreateReminderInput {
  /** Optional client-generated id, for the same-turn dependency case (§3.3). */
  id?: string | null;
  commitmentId?: string | null;
  body: string;
  fireAt?: Date | string | null;
  /**
   * The verbatim phrase ("next Friday"). The LLM MUST NOT compute timestamps
   * (DECISIONS.md #4) — it extracts the phrase, chrono-node resolves it. Keeping
   * the phrase is what makes the resolution auditable and re-runnable.
   */
  sourcePhrase?: string | null;
}

export async function createReminder(
  tx: Queryable,
  input: CreateReminderInput,
): Promise<Reminder> {
  const { rows } = await tx.query<Reminder>(
    `INSERT INTO reminders (id, commitment_id, body, fire_at, source_phrase)
     VALUES (COALESCE($5::uuid, gen_random_uuid()), $1, $2, $3::timestamptz, $4)
     RETURNING *`,
    [
      input.commitmentId ?? null,
      input.body,
      input.fireAt ?? null,
      input.sourcePhrase ?? null,
      input.id ?? null,
    ],
  );
  return rows[0]!;
}

export async function getById(
  tx: Queryable,
  id: string,
): Promise<Reminder | null> {
  const { rows } = await tx.query<Reminder>(
    `SELECT * FROM reminders WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listByCommitment(
  tx: Queryable,
  commitmentId: string,
): Promise<Reminder[]> {
  const { rows } = await tx.query<Reminder>(
    `SELECT * FROM reminders_current WHERE commitment_id = $1 ORDER BY fire_at NULLS LAST`,
    [commitmentId],
  );
  return rows;
}

/** The subset of columns the poller needs; it does not read the whole row. */
export interface DueReminder {
  id: string;
  commitment_id: string | null;
  body: string;
  fire_at: Date;
  source_phrase: string | null;
}

/**
 * Claim the due reminders for one poller pass. MUST RUN INSIDE A TRANSACTION.
 *
 * `FOR UPDATE SKIP LOCKED` so two API instances never hand the same reminder to
 * two users, and so a stuck instance holding row locks blocks nobody — other
 * instances step over locked rows rather than waiting. Rejected alternative: an
 * advisory lock around the whole batch, which serialises every instance onto one
 * and defeats the point of running more than one (§6.1).
 *
 * `fire_at <= $1`, NEVER `now()`: the clock is a parameter (see the file header).
 *
 * `fire_at IS NOT NULL` is REQUIRED even though it looks redundant next to the
 * `<=` comparison. It excludes the relational and event-trigger tiers explicitly,
 * and `reminders_pending_idx` (migration 004) does NOT filter them — the partial
 * index's predicate is only `fired_at IS NULL AND t_invalid IS NULL`, so the query
 * must do it.
 *
 * `limit` bounds the batch (default 100): a backlog after downtime must not be
 * read in one unbounded transaction.
 */
export async function claimDueReminders(
  tx: Queryable,
  asOf: Date,
  limit = 100,
): Promise<DueReminder[]> {
  const { rows } = await tx.query<DueReminder>(
    `SELECT id, commitment_id, body, fire_at, source_phrase
       FROM reminders
      WHERE fired_at IS NULL
        AND t_invalid IS NULL
        AND fire_at IS NOT NULL
        AND fire_at <= $1::timestamptz
      ORDER BY fire_at
      LIMIT $2
        FOR UPDATE SKIP LOCKED`,
    [asOf, limit],
  );
  return rows;
}

/**
 * Mark reminders fired. Runs in the SAME transaction as `claimDueReminders`.
 *
 * `fired_at` IS THE IDEMPOTENCY KEY. Delivery is at-least-once; this is what
 * collapses it to effectively-once. `pg_cron` would have needed the identical
 * guard (§6.2).
 *
 * The redundant `AND fired_at IS NULL` costs nothing and makes a double-fire
 * impossible even if the row lock were somehow not held. Returns the ids actually
 * transitioned, so a caller can tell a real claim from a lost race rather than
 * assuming its own batch won.
 */
export async function markFired(
  tx: Queryable,
  ids: readonly string[],
  firedAt: Date,
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE reminders SET fired_at = $2::timestamptz
      WHERE id = ANY($1::uuid[]) AND fired_at IS NULL
      RETURNING id`,
    [[...ids], firedAt],
  );
  return rows.map((r) => r.id);
}

/**
 * The inverse of firing — resets `fired_at` to the captured prior value.
 *
 * `fire_reminder` declares `invertibility: 'full'` even though undo will never
 * reach it (`undoTurn` filters to `actor_kind = 'user_turn'` and firing is
 * `scheduled_job`, so a scheduled turn returns zero rows and throws
 * `TurnNotFoundError`). A tool that could not name its inverse would have to
 * declare `'none'`, and declaring `'none'` on something that IS reversible would
 * poison any future admin-level replay (§6.3).
 *
 * Takes the prior value with NO DEFAULT, for the same reason as
 * `uncompleteCommitment` and `unmergePerson`.
 */
export async function unfireReminder(
  tx: Queryable,
  id: string,
  previousFiredAt: Date | null,
): Promise<void> {
  await tx.query(
    `UPDATE reminders SET fired_at = $2::timestamptz WHERE id = $1`,
    [id, previousFiredAt],
  );
}

/**
 * INVALIDATE, NEVER DELETE — the inverse of `createReminder`.
 *
 * IDEMPOTENT ON AN ALREADY-INVALID ROW, for the same reason as
 * `invalidateCommitment`: `t_invalid` records when the fact stopped being true in
 * the world, so re-invalidating must not move it.
 *
 * An invalidated reminder is INVISIBLE TO THE POLLER (`claimDueReminders` filters
 * `t_invalid IS NULL`), which is what makes a cancelled or undone reminder stay
 * silent rather than fire anyway.
 */
export async function invalidateReminder(
  tx: Queryable,
  id: string,
  at?: Date,
): Promise<void> {
  await tx.query(
    `UPDATE reminders
        SET t_invalid = COALESCE($2::timestamptz, t_invalid, now())
      WHERE id = $1`,
    [id, at ?? null],
  );
}

/** Un-invalidate — used by undo-of-an-undo. */
export async function revalidateReminder(
  tx: Queryable,
  id: string,
): Promise<void> {
  await tx.query(`UPDATE reminders SET t_invalid = NULL WHERE id = $1`, [id]);
}
