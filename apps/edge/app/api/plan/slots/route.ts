/**
 * GET /api/plan/slots?person=<id>&minutes=30 — times in the next week to meet
 * one person (ROADMAP Stage 3), inside their stated time of day when there is
 * one ("Meera prefers morning meetings"), around what is already booked.
 * Read only: booking is a sentence in the chat, as before.
 */
import { NextResponse } from "next/server";
import { suggestMeetingSlots } from "@ourglass/api/planning";
import { authorize } from "../../_auth";
import { localDayWindow, read, userTimeZone } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const person = url.searchParams.get("person") ?? "";
  const minutes = Number(url.searchParams.get("minutes") ?? "30");
  if (!UUID_RE.test(person)) return NextResponse.json({ error: "person must be a person's id." }, { status: 400 });
  if (!Number.isInteger(minutes) || minutes < 10 || minutes > 240) {
    return NextResponse.json({ error: "minutes must be 10 to 240." }, { status: 400 });
  }
  const timeZone = await userTimeZone();
  const now = new Date();
  const { start } = localDayWindow(now, timeZone);
  const suggestion = await read((tx) => suggestMeetingSlots(tx, person, minutes, now, start, timeZone));
  if (!suggestion) return NextResponse.json({ error: "No such person." }, { status: 404 });
  return NextResponse.json({ timeZone, ...suggestion });
}
