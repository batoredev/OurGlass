/**
 * GET /api/meetings — scheduled meetings from the start of today (the user's
 * day, not UTC's) through the next 30 days, each with whether it is on Google
 * Calendar.
 */
import { NextResponse } from "next/server";
import { events } from "@ourglass/db";
import { authorize } from "../_auth";
import { localDayWindow, read, userTimeZone } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAYS_AHEAD = 30;

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const timeZone = await userTimeZone();
  const { start } = localDayWindow(new Date(), timeZone);
  const end = new Date(start.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const rows = await read((tx) => events.listBetween(tx, start, end));
  return NextResponse.json({
    timeZone,
    meetings: rows.map((row) => ({
      id: row.id,
      title: row.title,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      location: row.location,
      on_google_calendar: row.google_event_id !== null,
    })),
  });
}
