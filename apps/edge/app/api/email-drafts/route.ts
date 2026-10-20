/**
 * GET /api/email-drafts — email drafts still waiting to be sent.
 *
 * The chat shows each as an editable card. Drafted in a turn, they also come
 * back in that turn's response; this route is what keeps them on screen
 * after a reload, until they are sent, cancelled or expire.
 */
import { NextResponse } from "next/server";
import { people, permissions } from "@ourglass/db";
import { authorize } from "../_auth";
import { read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HeldCall {
  name?: unknown;
  input?: { person_id?: unknown; to?: unknown; subject?: unknown; body?: unknown };
}

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const now = Date.now();
  const drafts = await read(async (tx) => {
    const pending = (await permissions.listRecentPendingActions(tx, 50)).filter(
      (action) => action.status === "pending" && action.expires_at.getTime() > now,
    );
    const out = [];
    for (const action of pending) {
      const call = (Array.isArray(action.calls) ? (action.calls as HeldCall[]) : []).find((c) => c.name === "send_email");
      if (!call?.input) continue;
      const personId = typeof call.input.person_id === "string" ? call.input.person_id : null;
      const person = personId ? await people.resolvePerson(tx, personId) : null;
      out.push({
        pendingActionId: action.id,
        personId,
        toName: person?.display_name ?? "them",
        // The person's address may have been saved since the draft was made.
        to: (typeof call.input.to === "string" && call.input.to) || person?.email || "",
        subject: typeof call.input.subject === "string" ? call.input.subject : "",
        body: typeof call.input.body === "string" ? call.input.body : "",
        createdAt: action.t_created,
      });
    }
    return out;
  });
  return NextResponse.json({ drafts });
}
