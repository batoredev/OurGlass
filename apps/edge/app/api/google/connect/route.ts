/**
 * POST /api/google/connect — start connecting Google Calendar.
 *
 * Returns Google's consent URL with a signed `state`; the page then sends the
 * browser there. A POST with the access token, not a plain link: starting the
 * flow is what an authorised user does, and the signed state carries that
 * proof through Google's redirect to /api/google/callback.
 */
import { NextResponse } from "next/server";
import { authorizationUrl, googleConfigFromEnv, signState } from "@ourglass/api/integrations";
import { authorize } from "../../_auth";
import { rejectCrossSite } from "../../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const refused = rejectCrossSite(request, { requireJson: false });
  if (refused) return refused;

  const config = googleConfigFromEnv(process.env);
  if (!config) {
    return NextResponse.json(
      { error: "Google Calendar isn't set up on the server yet (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)." },
      { status: 503 },
    );
  }
  return NextResponse.json({ url: authorizationUrl(config, await signState(config.clientSecret)) });
}
