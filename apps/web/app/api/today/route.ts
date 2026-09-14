/**
 * GET /api/today — §29.
 *
 * Assembled from existing reads rather than a SQL view: "today" is a
 * presentation concept, and baking it into a view would freeze a definition
 * the UI should stay free to change.
 */
import { NextResponse } from "next/server";
import { commitments, events } from "@ourglass/db";
import { demoEnabled, read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!demoEnabled()) return NextResponse.json({ error: "Not enabled." }, { status: 404 });

  const now = new Date();
  const open = await read((tx) => commitments.listCurrent(tx));
  const upcoming = await read((tx) => events.listUpcoming(tx, now, 20));
  const pending = open.filter((row) => !commitments.isTerminalStatus(row.status));

  return NextResponse.json({
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
