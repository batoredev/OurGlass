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
  /** The Google Calendar copy (migration 014); null when not synced. */
  google_event_id: string | null;
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
 * How long an event with no stated end is taken to last, for clashes and for
 * its Google Calendar copy (integrations/google-calendar.ts uses this too).
 */
export const DEFAULT_EVENT_MINUTES = 30;

/**
 * Events overlapping a proposed window — §24's detection query.
 *
 * ⚠ `'[)'` — HALF-OPEN, and this is a product decision rather than a SQL
 * detail. An event ending at 5:00 and one starting at 5:00 must NOT conflict:
 * back-to-back meetings are normal, and reporting them is the false positive
 * that trains a user to dismiss the conflict surface entirely.
 *
 * A NULL `ends_at` MEANS DEFAULT_EVENT_MINUTES, on both sides. It used to
 * mean a single instant, so only two meetings at the SAME minute clashed:
 * "Meeting with Arjun at 6" and a new meeting at 6:15 were both booked
 * (reported 2026-10-20). A meeting is not an instant; thirty minutes is the
 * length Google Calendar is given for it, so the two agree. Before that the
 * instant was itself a fix — `tstzrange(t, t, '[)')` is EMPTY and matched
 * nothing — and a real range sidesteps both problems with one bound style.
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
        AND tstzrange(starts_at, COALESCE(ends_at, starts_at + make_interval(mins => $4::int)), '[)')
         && tstzrange($1::timestamptz,
                      COALESCE($2::timestamptz, $1::timestamptz + make_interval(mins => $4::int)), '[)')
      ORDER BY starts_at`,
    [startsAt, endsAt, excludeId ?? null, DEFAULT_EVENT_MINUTES],
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

/** Current events starting in [from, to) — the Meetings surface and Today's checklist. */
export async function listBetween(tx: Queryable, from: Date, to: Date, limit = 200): Promise<Event[]> {
  const { rows } = await tx.query<Event>(
    `SELECT * FROM events_current
      WHERE starts_at IS NOT NULL AND starts_at >= $1::timestamptz AND starts_at < $2::timestamptz
      ORDER BY starts_at
      LIMIT $3`,
    [from, to, limit],
  );
  return rows;
}

/** Record (or clear, on undo) the Google Calendar copy of an event. */
export async function setGoogleEventId(tx: Queryable, id: string, googleEventId: string | null): Promise<void> {
  await tx.query(`UPDATE events SET google_event_id = $2 WHERE id = $1`, [id, googleEventId]);
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
