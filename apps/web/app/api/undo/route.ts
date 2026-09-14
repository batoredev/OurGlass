/**
 * POST /api/undo — reverse one conversational turn.
 *
 * Replaces Fastify's /undo. `undoTurn` filters `actor_kind = 'user_turn'`, so
 * a scheduled job returns TurnNotFoundError: the user cannot undo a clock
 * tick (PHASE-3-DESIGN §6.3), and that is surfaced as a 404 with the reason.
 *
 * ┌─ AUTHORISATION: THERE IS NONE, AND THAT IS A RECORDED GAP ──────────────┐
 * │                                                                        │
 * │ This route takes a `turnId` and reverses it. It does not ask WHOSE turn │
 * │ that was, because the data model has no answer yet: §35's permission    │
 * │ model is Phase 7, and until it lands the system is single-user by       │
 * │ assumption — one owner, one `action_log`, no actor identity beyond      │
 * │ `actor_kind`.                                                          │
 * │                                                                        │
 * │ So `demoEnabled()` is not a convenience toggle here. It is the ENTIRE   │
 * │ access control on the most destructive endpoint in the application, and │
 * │ it is off in every deployed environment (see wrangler.toml, which       │
 * │ explains why the flag alone was never the protection — the Fastify      │
 * │ server's 127.0.0.1 binding was).                                        │
 * │                                                                        │
 * │ Guessing a turn id is not the threat that matters: GET /api/activity    │
 * │ lists them. Anyone who can reach these routes at all can enumerate and  │
 * │ reverse every mutation the assistant has made.                         │
 * │                                                                        │
 * │ PHASE 7 MUST replace this comment with a real check — an authenticated  │
 * │ actor, and `undoTurn` scoped to turns that actor owns. Until then, do   │
 * │ not expose this route to a network; put Cloudflare Access in front of   │
 * │ the Worker if it needs to be reachable.                                 │
 * └────────────────────────────────────────────────────────────────────────┘
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
  // The only authorisation check that exists. See the block above.
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
