/**
 * POST /api/pending-actions/:id/confirm — one-time confirmation (§35).
 *
 * The approval and the held calls commit in ONE turn, so they succeed or roll
 * back together, and a second confirm cannot execute them twice
 * (PHASE-7-PERMISSIONS-DESIGN §5). The resulting turn is undoable.
 */
import { NextResponse } from "next/server";
import { releasePendingAction } from "@ourglass/api/permissions";
import { buildToolRegistry } from "@ourglass/api/tools";
import { rejectCrossSite } from "../../../_http";
import { db, demoEnabled } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!demoEnabled()) return NextResponse.json({ error: "Not enabled." }, { status: 404 });
  const refused = rejectCrossSite(request, { requireJson: true });
  if (refused) return refused;

  const { id } = await params;
  const outcome = await releasePendingAction({ db, registry: buildToolRegistry() }, id);

  if (outcome.ok) return NextResponse.json({ turnId: outcome.turnId });
  const status = outcome.reason === "not_found" ? 404 : outcome.reason === "not_pending" ? 409 : 422;
  return NextResponse.json({ reason: outcome.reason, errors: outcome.errors }, { status });
}
