/**
 * GET /api/plan — today's plan, PROPOSED (ROADMAP Stage 3).
 *
 * The deterministic scheduler (apps/api planning/scheduler.ts) over today's
 * meetings, what you owe, and what others owe you with their own record.
 * Writes nothing; POST /api/plan/accept puts accepted blocks on the calendar.
 */
import { NextResponse } from "next/server";
import { loadDayPlan } from "@ourglass/api/planning";
import { authorize } from "../_auth";
import { localDayWindow, read, userTimeZone } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const timeZone = await userTimeZone();
  const now = new Date();
  const { start } = localDayWindow(now, timeZone);
  const plan = await read((tx) => loadDayPlan(tx, now, start, timeZone));
  return NextResponse.json({ timeZone, ...plan });
}
