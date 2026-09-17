/**
 * POST /api/pending-actions/:id/decline — nothing held is executed (§35).
 * Undoable: undoing the decline reopens the request, still bounded by expiry.
 */
import { NextResponse } from "next/server";
import { declinePendingAction } from "@ourglass/api/permissions";
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
  const outcome = await declinePendingAction({ db, registry: buildToolRegistry() }, id);
  return outcome.ok
    ? NextResponse.json({ turnId: outcome.turnId })
    : NextResponse.json({ errors: outcome.errors }, { status: 409 });
}
