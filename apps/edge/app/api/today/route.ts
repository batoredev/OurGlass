/**
 * GET /api/today — §29.
 *
 * Assembled from existing reads rather than a SQL view: "today" is a
 * presentation concept, and baking it into a view would freeze a definition
 * the UI should stay free to change.
 */
import { NextResponse } from "next/server";
import { checklistMarks, commitments, events, people, reminders } from "@ourglass/db";
import { authorize } from "../_auth";
import { localDayWindow, read, userTimeZone } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;

  const now = new Date();
  const open = await read((tx) => commitments.listCurrent(tx));
  const upcoming = await read((tx) => events.listUpcoming(tx, now, 20));
  const pending = open.filter((row) => !commitments.isTerminalStatus(row.status));

  // ---- Today's checklist: what the day holds, and which of it is done --------
  // Commitments due today or finished today, meetings today (done once begun),
  // reminders due today (done once fired). Times are the USER'S day.
  const timeZone = await userTimeZone();
  const { start, end } = localDayWindow(now, timeZone);
  const inDay = (at: Date | null) => at !== null && at >= start && at < end;
  const [todaysEvents, todaysReminders, everyone] = await Promise.all([
    read((tx) => events.listBetween(tx, start, end)),
    read((tx) => reminders.listBetween(tx, start, end)),
    read((tx) => people.list(tx)),
  ]);
  const nameOf = new Map(everyone.map((person) => [person.id, person.display_name]));
  // The user's own ticks (migration 015) override the automatic reading of a
  // meeting (done once begun) or reminder (done once fired), either way.
  const marks = await read((tx) =>
    checklistMarks.listCurrentFor(tx, [
      ...todaysEvents.map((row) => ({ kind: "meeting" as const, id: row.id })),
      ...todaysReminders.map((row) => ({ kind: "reminder" as const, id: row.id })),
    ]),
  );
  const checklist = [
    ...open
      .filter((row) => inDay(row.expected_at) || inDay(row.completed_at))
      .map((row) => ({
        kind: "commitment" as const,
        id: row.id,
        title: row.object_text,
        detail: nameOf.get(row.owner_id) ?? null,
        at: (row.completed_at ?? row.expected_at)!.toISOString(),
        done: commitments.isTerminalStatus(row.status) && row.status !== "cancelled",
        status: row.status,
      })),
    ...todaysEvents.map((row) => ({
      kind: "meeting" as const,
      id: row.id,
      title: row.title,
      detail: row.google_event_id ? "On Google Calendar" : null,
      at: row.starts_at!.toISOString(),
      done: marks.get(`meeting:${row.id}`) ?? row.starts_at!.getTime() <= now.getTime(),
      status: null,
    })),
    ...todaysReminders.map((row) => ({
      kind: "reminder" as const,
      id: row.id,
      title: row.body,
      detail: null,
      at: row.fire_at!.toISOString(),
      done: marks.get(`reminder:${row.id}`) ?? row.fired_at !== null,
      status: null,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return NextResponse.json({
    checklist,
    overdue: pending.filter(
      (r) => r.expected_at !== null && r.expected_at.getTime() < now.getTime(),
    ),
    dueLater: pending.filter(
      (r) => r.expected_at !== null && r.expected_at.getTime() >= now.getTime(),
    ),
    undated: pending.filter((r) => r.expected_at === null),
    events: upcoming,
  });
}
