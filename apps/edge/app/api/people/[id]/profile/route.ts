/**
 * GET /api/people/:id/profile — the person model (ROADMAP Stage 2).
 *
 * Derived on every read from the rows already stored (apps/api people/profile.ts),
 * every field with its source. Read only; nothing is looked up elsewhere.
 */
import { NextResponse } from "next/server";
import { personProfile } from "@ourglass/db";
import { deriveProfile } from "@ourglass/api/people";
import { followUpDraft, recipientStyle } from "@ourglass/api/replies";
import { authorize } from "../../../_auth";
import { read, userTimeZone } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await authorize(request);
  if (denied) return denied;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "No such person." }, { status: 404 });

  const timeZone = await userTimeZone();
  const result = await read(async (tx) => {
    const data = await personProfile.loadPersonProfile(tx, id);
    if (!data) return null;
    const profile = deriveProfile(data, new Date(), timeZone);
    // Stage 4: a follow-up about what is open, in the owner's own style — a
    // suggestion to copy, never sent from here.
    const style = await recipientStyle(tx, id, profile.name);
    const followUp = followUpDraft(profile.name, [
      ...profile.owesYou.value.map((item) => ({ what: item.what, due: item.due, theyOwe: true })),
      ...profile.youOwe.value.map((item) => ({ what: item.what, due: item.due, theyOwe: false })),
    ], style);
    return { profile, followUp, styleFrom: style.from };
  });
  if (!result) return NextResponse.json({ error: "No such person." }, { status: 404 });
  return NextResponse.json(result);
}
