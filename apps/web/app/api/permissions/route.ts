/**
 * /api/permissions — the §35 control plane (PHASE-7-PERMISSIONS-DESIGN §6).
 *
 *   GET     current grants and recent pending actions
 *   POST    { action_type, decision }  -> set_permission
 *   DELETE  ?action_type=…             -> revoke_permission
 *
 * NOT A SECOND WRITE PATH. Every change runs through the tool layer —
 * validated, one transaction, action_log, undoable via /api/undo. It exists
 * OUTSIDE the conversation on purpose: a grant a model could propose is a
 * grant a prompt-injected document could propose (design §1).
 */
import { NextResponse } from "next/server";
import { CONTROL_PLANE_TOOLS } from "@ourglass/api/permissions";
import { RISK_BY_TOOL, buildToolRegistry, executeTurn } from "@ourglass/api/tools";
import { permissions } from "@ourglass/db";
import { rejectCrossSite } from "../_http";
import { db, demoEnabled, read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!demoEnabled()) return NextResponse.json({ error: "Not enabled." }, { status: 404 });
  const [grants, pending] = await read(async (tx) => [
    await permissions.listCurrentGrants(tx),
    await permissions.listRecentPendingActions(tx),
  ]);
  // What a grant can name: every classified tool EXCEPT the control plane,
  // which set_permission refuses anyway. Offering it would invite a doomed click.
  const actionTypes = Object.entries(RISK_BY_TOOL)
    .filter(([name]) => !CONTROL_PLANE_TOOLS.has(name))
    .map(([name, risk]) => ({ name, risk }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ grants, pending, actionTypes });
}

export async function POST(request: Request) {
  if (!demoEnabled()) return NextResponse.json({ error: "Not enabled." }, { status: 404 });
  const refused = rejectCrossSite(request, { requireJson: true });
  if (refused) return refused;

  let body: { action_type?: unknown; decision?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const outcome = await executeTurn(
    [{ name: "set_permission", input: { action_type: body.action_type, decision: body.decision } }],
    { db, registry: buildToolRegistry() },
  );
  return outcome.ok
    ? NextResponse.json({ turnId: outcome.turnId, result: outcome.results[0] })
    : NextResponse.json({ errors: outcome.errors }, { status: 400 });
}

export async function DELETE(request: Request) {
  if (!demoEnabled()) return NextResponse.json({ error: "Not enabled." }, { status: 404 });
  const refused = rejectCrossSite(request, { requireJson: false });
  if (refused) return refused;

  const actionType = new URL(request.url).searchParams.get("action_type");
  const outcome = await executeTurn(
    [{ name: "revoke_permission", input: { action_type: actionType } }],
    { db, registry: buildToolRegistry() },
  );
  return outcome.ok
    ? NextResponse.json({ turnId: outcome.turnId, result: outcome.results[0] })
    : NextResponse.json({ errors: outcome.errors }, { status: 400 });
}
