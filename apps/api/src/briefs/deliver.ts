/**
 * Delivering the proactive briefs (ROADMAP Stage 5) — called by every
 * scheduled pass (reminders/poller.ts pollOnce), once a minute.
 *
 * In the app first: a brief is an assistant message in the conversation, so
 * it is where you already look, and it needs no new channel or permission.
 * (An email digest is the owner's later decision: YOUR-ACTIONS item 19.)
 *
 * IDEMPOTENT PER DAY by construction: each brief has a key
 * ("morning:2026-11-09") and messages.createBriefOnce inserts it at most once
 * (migration 018's unique index), however many passes race. QUIET HOURS: a
 * brief is delivered only inside its window (compose.ts DELIVERY_HOURS) and
 * never late.
 */
import { commitments, events, messages, personProfile, reminders, users } from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";
import { briefsForMeetings } from "../people/meetings.js";
import { loadDayPlan, localDayWindow } from "../planning/index.js";
import {
  composeEvening,
  composeMorning,
  dueBrief,
  localClock,
  type BriefItem,
  type BriefMeeting,
  type WeekInput,
} from "./compose.js";

const OPEN = new Set(["pending", "in_progress", "waiting", "waiting_on_someone", "blocked"]);
const DAY = 24 * 3_600_000;
/** "Quiet for a while": three weeks with something open and nothing recorded. */
const QUIET_DAYS = 21;

export interface BriefDeps {
  readonly db: { withTransaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> };
}

/** The key of the brief delivered by this call, or null when none was due (or it was already sent). */
export async function deliverDueBrief(deps: BriefDeps, now: Date): Promise<string | null> {
  return deps.db.withTransaction(async (tx) => {
    const account = await users.currentAccount(tx);
    if (!account) return null;
    const timeZone = account.user.timezone ?? "UTC";
    const clock = localClock(now, timeZone);
    const delivered = await messages.deliveredBriefs(tx, [`morning:${clock.date}`, `evening:${clock.date}`]);
    const due = dueBrief(clock, delivered);
    if (!due) return null;
    const body =
      due.kind === "morning"
        ? await morningBrief(tx, now, timeZone, account.self?.id ?? null, clock.weekday === 1)
        : await eveningBrief(tx, now, timeZone, account.self?.id ?? null);
    return (await messages.createBriefOnce(tx, { key: due.key, kind: due.kind, body })) ? due.key : null;
  });
}

async function meetingsBetween(tx: DatabaseTransaction, from: Date, to: Date, now: Date, timeZone: string): Promise<BriefMeeting[]> {
  const rows = (await events.listBetween(tx, from, to)).filter((row) => row.starts_at !== null);
  const briefs = await briefsForMeetings(tx, rows, now, to, timeZone);
  return rows.map((row) => ({
    title: row.title,
    start: row.starts_at!,
    people: (briefs.get(row.id) ?? []).map((brief) => ({ name: brief.name, line: brief.lines[0] ?? "" })),
  }));
}

/** Names for owner/recipient ids, from the current people. */
async function namesOf(tx: DatabaseTransaction): Promise<Map<string, string>> {
  const { rows } = await tx.query<{ id: string; display_name: string }>(`SELECT id, display_name FROM people_current`);
  return new Map(rows.map((row) => [row.id, row.display_name]));
}

/** The morning brief: today's meetings with briefs, the first thing to do, what is owed today, reminders. */
export async function morningBrief(
  tx: DatabaseTransaction,
  now: Date,
  timeZone: string,
  selfId: string | null,
  withWeek: boolean,
): Promise<string> {
  const { start, end } = localDayWindow(now, timeZone);
  const plan = await loadDayPlan(tx, now, start, timeZone);
  const names = await namesOf(tx);
  const open = (await commitments.listCurrent(tx)).filter((row) => OPEN.has(row.status));
  const dueByToday = (row: { expected_at: Date | null }) => row.expected_at !== null && row.expected_at < end;
  const item = (row: { object_text: string; expected_at: Date | null }, who: string | null): BriefItem => ({
    what: row.object_text,
    ...(who ? { who } : {}),
    overdue: row.expected_at !== null && row.expected_at < now,
  });
  const youOwe = open
    .filter((row) => selfId !== null && row.owner_id === selfId && dueByToday(row))
    .map((row) => item(row, row.recipient_id ? (names.get(row.recipient_id) ?? null) : null));
  const dueToYou = open
    .filter((row) => selfId !== null && row.recipient_id === selfId && row.owner_id !== selfId && dueByToday(row))
    .map((row) => item(row, row.owner_id ? (names.get(row.owner_id) ?? null) : null));
  const reminderRows = (await reminders.listBetween(tx, now, end)).filter(
    (row): row is typeof row & { fire_at: Date } => row.fired_at === null && row.fire_at !== null,
  );
  const first = plan.next ? { title: plan.next.title, at: plan.next.start, reason: plan.next.reason } : null;

  let week: WeekInput | undefined;
  if (withWeek && selfId !== null) {
    const weekAgo = new Date(now.getTime() - 7 * DAY);
    const all = await commitments.listCurrent(tx);
    const quiet = await personProfile.quietPeople(tx, new Date(now.getTime() - QUIET_DAYS * DAY), selfId);
    week = {
      finished: all.filter((row) => row.completed_at !== null && row.completed_at >= weekAgo).length,
      slipped: open
        .filter((row) => row.expected_at !== null && row.expected_at >= weekAgo && row.expected_at < now)
        .map((row) => item(row, row.owner_id && row.owner_id !== selfId ? (names.get(row.owner_id) ?? null) : null)),
      quiet: quiet.map((person) => ({
        name: person.display_name,
        since: person.last.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone }),
      })),
    };
  }

  return composeMorning({
    timeZone,
    meetings: await meetingsBetween(tx, now, end, now, timeZone),
    first,
    youOwe,
    dueToYou,
    reminders: reminderRows.map((row) => ({ body: row.body, at: row.fire_at })),
    ...(week ? { week } : {}),
  });
}

/** The evening review: what was finished today, what is still open from today, tomorrow's meetings. */
export async function eveningBrief(tx: DatabaseTransaction, now: Date, timeZone: string, selfId: string | null): Promise<string> {
  const { start, end } = localDayWindow(now, timeZone);
  const names = await namesOf(tx);
  const all = await commitments.listCurrent(tx);
  const whoElse = (row: { owner_id: string | null; recipient_id: string | null }) => {
    const other = row.owner_id === selfId ? row.recipient_id : row.owner_id;
    return other ? (names.get(other) ?? null) : null;
  };
  const done = all
    .filter((row) => row.completed_at !== null && row.completed_at >= start && row.completed_at < end)
    .map((row) => ({ what: row.object_text, ...(whoElse(row) ? { who: whoElse(row)! } : {}) }));
  const stillOpen = all
    .filter((row) => OPEN.has(row.status) && row.expected_at !== null && row.expected_at >= start && row.expected_at < end)
    .map((row) => ({ what: row.object_text, ...(whoElse(row) ? { who: whoElse(row)! } : {}) }));
  return composeEvening({
    timeZone,
    done,
    stillOpen,
    tomorrow: await meetingsBetween(tx, end, new Date(end.getTime() + DAY), end, timeZone),
  });
}
