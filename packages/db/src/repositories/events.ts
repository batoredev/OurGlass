/**
 * events — scheduled things with a time range, and §24 conflict detection
 * (docs/PHASE-4-DESIGN.md §6).
 *
 * ANOTHER INSTANCE OF THE F-CLASS: `events` has had a table, an
 * `events_current` view, and `events_starts_idx` since migration 004, and no
 * repository. Nothing read or wrote it for three phases. The §24 demo —
 * "Schedule Arun at 5 tomorrow" surfacing the 5 PM Hult meeting — is
 * unreachable without this file, so it is built here rather than assumed.
 *
 * CONFLICT DETECTION IS DETERMINISTIC SQL, NOT A MODEL JUDGEMENT. An overlap
 * is an interval comparison; asking a model whether two timestamps overlap is
 * exactly the "different result each run" case .claude/rules/wat.md §1 says
 * belongs in a script.
 */
import type { Queryable } from "../client.js";

export interface Event {
  id: string;
  /** Raw content field — stored verbatim, never resolved. */
  title: string;
  starts_at: Date | null;
  ends_at: Date | null;
  location: string | null;
  project_id: string | null;
  notes: string | null;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

export interface CreateEventInput {
  id?: string | null;
  title: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  location?: string | null;
  projectId?: string | null;
  notes?: string | null;
}

export async function createEvent(tx: Queryable, input: CreateEventInput): Promise<Event> {
  const { rows } = await tx.query<Event>(
    `INSERT INTO events (id, title, starts_at, ends_at, location, project_id, notes)
     VALUES (COALESCE($7::uuid, gen_random_uuid()), $1, $2::timestamptz, $3::timestamptz,
             $4, $5::uuid, $6)
     RETURNING *`,
    [
      input.title,
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.location ?? null,
      input.projectId ?? null,
      input.notes ?? null,
      input.id ?? null,
    ],
  );
  return rows[0]!;
}

export async function getById(tx: Queryable, id: string): Promise<Event | null> {
  const { rows } = await tx.query<Event>(`SELECT * FROM events WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Events overlapping a proposed window — §24's detection query.
 *
 * ⚠ `'[)'` — HALF-OPEN, and this is a product decision rather than a SQL
 * detail. An event ending at 5:00 and one starting at 5:00 must NOT conflict:
 * back-to-back meetings are normal, and reporting them is the false positive
 * that trains a user to dismiss the conflict surface entirely. A false
 * conflict is worse than no conflict.
 *
 * `COALESCE(ends_at, starts_at)` treats an event with no end as
 * INSTANTANEOUS, not infinite. An open-ended event that swallowed every later
 * window would make the surface useless the moment one existed.
 *
 * Events with no `starts_at` are excluded: an unscheduled event cannot
 * overlap anything.
 */
export async function findOverlapping(
  tx: Queryable,
  startsAt: Date,
  endsAt: Date | null,
  excludeId?: string | null,
): Promise<Event[]> {
  const { rows } = await tx.query<Event>(
    `SELECT * FROM events_current
      WHERE starts_at IS NOT NULL
        AND ($3::uuid IS NULL OR id <> $3::uuid)
        AND tstzrange(starts_at, COALESCE(ends_at, starts_at), '[)')
         && tstzrange($1::timestamptz, COALESCE($2::timestamptz, $1::timestamptz), '[)')
      ORDER BY starts_at`,
    [startsAt, endsAt, excludeId ?? null],
  );
  return rows;
}

/** Upcoming events from an instant — the read the Today surface will want. */
export async function listUpcoming(tx: Queryable, from: Date, limit = 50): Promise<Event[]> {
  const { rows } = await tx.query<Event>(
    `SELECT * FROM events_current
      WHERE starts_at IS NOT NULL AND starts_at >= $1::timestamptz
      ORDER BY starts_at
      LIMIT $2`,
    [from, limit],
  );
  return rows;
}

/** INVALIDATE, NEVER DELETE. Idempotent on an already-invalid row. */
export async function invalidateEvent(tx: Queryable, id: string, at?: Date): Promise<void> {
  await tx.query(
    `UPDATE events SET t_invalid = COALESCE($2::timestamptz, t_invalid, now()) WHERE id = $1`,
    [id, at ?? null],
  );
}

/** The inverse. Takes the prior value with NO DEFAULT. */
export async function revalidateEvent(
  tx: Queryable,
  id: string,
  previousInvalidAt: Date | null,
): Promise<void> {
  await tx.query(`UPDATE events SET t_invalid = $2::timestamptz WHERE id = $1`, [
    id,
    previousInvalidAt,
  ]);
}
