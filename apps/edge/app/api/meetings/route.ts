/**
 * GET /api/meetings — scheduled meetings from the start of today (the user's
 * day, not UTC's) through the next 30 days, each with whether it is on Google
 * Calendar.
 */
import { NextResponse } from "next/server";
import { events, people, personProfile, users } from "@ourglass/db";
import { briefFor, deriveProfile, peopleInMeeting, type BriefForPerson } from "@ourglass/api/people";
import { authorize } from "../_auth";
import { localDayWindow, read, userTimeZone } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAYS_AHEAD = 30;
/** Meetings this close get a brief (ROADMAP Stage 2): who, what is open, the record, the last interaction. */
const BRIEF_DAYS = 7;

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const timeZone = await userTimeZone();
  const { start } = localDayWindow(new Date(), timeZone);
  const end = new Date(start.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const now = new Date();
  const briefUntil = new Date(now.getTime() + BRIEF_DAYS * 24 * 60 * 60 * 1000);
  const { rows, briefs } = await read(async (tx) => {
    const rows = await events.listBetween(tx, start, end);
    const everyone = await people.list(tx);
    const selfId = (await users.currentAccount(tx))?.self?.id ?? null;
    // One profile per person, however many meetings name them.
    const cache = new Map<string, BriefForPerson | null>();
    const briefs = new Map<string, BriefForPerson[]>();
    for (const row of rows) {
      if (row.starts_at === null || row.starts_at.getTime() < now.getTime() || row.starts_at > briefUntil) continue;
      const named = peopleInMeeting(row, everyone, selfId);
      const forMeeting: BriefForPerson[] = [];
      for (const person of named) {
        if (!cache.has(person.id)) {
          const data = await personProfile.loadPersonProfile(tx, person.id);
          cache.set(person.id, data ? briefFor(deriveProfile(data, now, timeZone)) : null);
        }
        const brief = cache.get(person.id);
        if (brief) forMeeting.push(brief);
      }
      if (forMeeting.length > 0) briefs.set(row.id, forMeeting);
    }
    return { rows, briefs };
  });
  return NextResponse.json({
    timeZone,
    meetings: rows.map((row) => ({
      id: row.id,
      title: row.title,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      location: row.location,
      on_google_calendar: row.google_event_id !== null,
      brief: briefs.get(row.id) ?? [],
    })),
  });
}
