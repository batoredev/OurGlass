/**
 * POST /api/undo — reverse one conversational turn.
 *
 * Replaces Fastify's /undo. `undoTurn` filters `actor_kind = 'user_turn'`, so
 * a scheduled job returns TurnNotFoundError: the user cannot undo a clock
 * tick (PHASE-3-DESIGN §6.3), and that is surfaced as a 404 with the reason.
 *
 * ┌─ AUTHORISATION ─────────────────────────────────────────────────────────┐
 * │ `authorize` (PHASE-7-PERMISSIONS-DESIGN §8): the access token or a      │
 * │ session derived from it. Until stage 12b the demo flag was the ENTIRE   │
 * │ access control on the most destructive endpoint in the application.     │
 * │                                                                        │
 * │ It still does not ask WHOSE turn this is, and that is correct rather    │
 * │ than a gap: the system is single-user — one `users` row, one            │
 * │ `action_log`. Anyone holding the token IS the owner. A multi-user       │
 * │ deployment would need `undoTurn` scoped to an actor, and a schema that  │
 * │ records one; that is a different product, not a missing check.         │
 * │                                                                        │
 * │ Guessing a turn id is not the threat: GET /api/activity lists them. The │
 * │ threat is a foreign page making a signed-in browser POST here, which    │
 * │ `rejectCrossSite` and the SameSite=Strict cookie close.                 │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { NextResponse } from "next/server";
import {
  TurnAlreadyUndoneError,
  TurnNotFoundError,
  buildToolRegistry,
  undoTurn,
} from "@ourglass/api/tools";
import { authorize } from "../_auth";
import { rejectCrossSite } from "../_http";
import { db } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const crossSite = rejectCrossSite(request, { requireJson: true });
  if (crossSite) return crossSite;

  let body: { turnId?: unknown };
  try {
    body = (await request.json()) as { turnId?: unknown };
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (typeof body.turnId !== "string") {
    return NextResponse.json({ error: "turnId must be a string" }, { status: 400 });
  }

  try {
    return NextResponse.json(await undoTurn(body.turnId, { db, registry: buildToolRegistry() }));
  } catch (error: unknown) {
    // Both are EXPECTED outcomes with distinct meanings; collapsing them
    // would hide the more interesting one. TurnNotFound covers "no such turn"
    // AND "that was a scheduled job".
    if (error instanceof TurnNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof TurnAlreadyUndoneError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
