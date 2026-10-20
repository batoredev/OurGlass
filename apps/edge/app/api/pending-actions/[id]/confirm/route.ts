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
import { googleConfigFromEnv } from "@ourglass/api/integrations";
import { rejectCrossSite } from "../../../_http";
import { authorize } from "../../../_auth";
import { db } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await authorize(request);
  if (denied) return denied;
  const refused = rejectCrossSite(request, { requireJson: true });
  if (refused) return refused;

  const { id } = await params;
  // Optional edits from an email draft card: { to, subject, body }.
  let edits: { to?: string; subject?: string; body?: string } | undefined;
  try {
    const body = (await request.json()) as Record<string, unknown> | null;
    if (body && typeof body === "object") {
      const pick = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : undefined);
      const candidate = { to: pick("to"), subject: pick("subject"), body: pick("body") };
      if (candidate.to !== undefined || candidate.subject !== undefined || candidate.body !== undefined) {
        edits = Object.fromEntries(Object.entries(candidate).filter(([, v]) => v !== undefined));
      }
    }
  } catch {
    // An empty body is a plain confirmation.
  }
  let outcome: Awaited<ReturnType<typeof releasePendingAction>>;
  try {
    outcome = await releasePendingAction(
    // Google config, because a held action may be add_to_google_calendar.
    { db, registry: buildToolRegistry({ google: googleConfigFromEnv(process.env) }) },
    id,
    edits,
  );
  } catch (error: unknown) {
    // Google refused at send/insert time. The turn rolled back, so the
    // action is still pending and can be sent again; say why, not "500".
    if (error instanceof Error && error.name === "GoogleCalendarError") {
      return NextResponse.json({ reason: "external", errors: [{ code: "google", message: error.message }] }, { status: 502 });
    }
    throw error;
  }

  if (outcome.ok) return NextResponse.json({ turnId: outcome.turnId });
  const status = outcome.reason === "not_found" ? 404 : outcome.reason === "not_pending" ? 409 : 422;
  return NextResponse.json({ reason: outcome.reason, errors: outcome.errors }, { status });
}
