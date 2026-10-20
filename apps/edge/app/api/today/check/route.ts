/**
 * POST /api/today/check — tick or untick a line of Today's checklist.
 *
 *   { kind: "commitment", id, done: true }   complete_commitment, now
 *   { kind: "commitment", id, done: false }  undo the completing tick
 *   { kind: "meeting" | "reminder", id, done } set_checklist_mark
 *
 * Every path is a tool through the executor (or its undo), so a tick is
 * validated, logged and reversible like anything said in the chat.
 */
import { NextResponse } from "next/server";
import { buildToolRegistry, completionTurn, executeTurn, undoTurn } from "@ourglass/api/tools";
import { authorize } from "../../_auth";
import { rejectCrossSite } from "../../_http";
import { db, read } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const refused = rejectCrossSite(request, { requireJson: true });
  if (refused) return refused;

  let body: { kind?: unknown; id?: unknown; done?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (typeof body.done !== "boolean" || typeof body.id !== "string") {
    return NextResponse.json({ error: "id and done are required." }, { status: 400 });
  }
  const registry = buildToolRegistry();

  if (body.kind === "commitment") {
    if (body.done) {
      const outcome = await executeTurn(
        [{ name: "complete_commitment", input: { commitment_id: body.id, completed_at: new Date().toISOString() } }],
        { db, registry },
      );
      return outcome.ok
        ? NextResponse.json({ turnId: outcome.turnId, done: true })
        : NextResponse.json({ errors: outcome.errors }, { status: 400 });
    }
    // Unticking = undoing the tick — but only a completion that was its own
    // turn. One said in the chat may share a turn with other changes.
    const commitmentId = body.id;
    const completion = await read((tx) => completionTurn(tx, commitmentId));
    if (!completion) {
      return NextResponse.json({ error: "That isn't marked done by a tick here." }, { status: 409 });
    }
    if (!completion.sole) {
      return NextResponse.json(
        { error: "That was completed in the chat along with other changes, so it can't be unticked here." },
        { status: 409 },
      );
    }
    await undoTurn(completion.turnId, { db, registry });
    return NextResponse.json({ turnId: null, done: false });
  }

  if (body.kind === "meeting" || body.kind === "reminder") {
    const outcome = await executeTurn(
      [{ name: "set_checklist_mark", input: { kind: body.kind, id: body.id, done: body.done } }],
      { db, registry },
    );
    return outcome.ok
      ? NextResponse.json({ turnId: outcome.turnId, done: body.done })
      : NextResponse.json({ errors: outcome.errors }, { status: 400 });
  }

  return NextResponse.json({ error: "kind must be commitment, meeting or reminder." }, { status: 400 });
}
