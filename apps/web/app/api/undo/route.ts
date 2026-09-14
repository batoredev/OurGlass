/**
 * POST /api/undo — reverse one conversational turn.
 *
 * Replaces Fastify's /undo. `undoTurn` filters `actor_kind = 'user_turn'`, so
 * a scheduled job returns TurnNotFoundError: the user cannot undo a clock
 * tick (PHASE-3-DESIGN §6.3), and that is surfaced as a 404 with the reason.
 */
import { NextResponse } from "next/server";
import {
  TurnAlreadyUndoneError,
  TurnNotFoundError,
  buildToolRegistry,
  undoTurn,
} from "@ourglass/api/tools";
import { db, demoEnabled } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!demoEnabled()) return NextResponse.json({ error: "Not enabled." }, { status: 404 });

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
