/**
 * GET /api/activity — §29, every mutation with who caused it.
 *
 * Deliberately UNFILTERED by actor_kind. Undo filters to `user_turn` because
 * a clock tick is not undoable — but this surface is the opposite case: a
 * reminder that fired while the user was away is exactly what "what happened"
 * should show.
 */
import { NextResponse } from "next/server";
import { listRecentActivity } from "@ourglass/api/tools";
import { demoEnabled, read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!demoEnabled()) return NextResponse.json({ error: "Not enabled." }, { status: 404 });
  return NextResponse.json({ activity: await read((tx) => listRecentActivity(tx)) });
}
