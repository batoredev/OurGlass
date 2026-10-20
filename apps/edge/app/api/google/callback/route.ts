/**
 * GET /api/google/callback — where Google sends the browser after consent.
 *
 * NOT behind authorize(): a redirect from Google carries no access token. The
 * HMAC-signed `state` from POST /api/google/connect (which IS guarded) is the
 * proof this flow was started by the signed-in user; without a valid, unexpired
 * state nothing is exchanged or stored. See access-guard.test.ts's exemption.
 *
 * Always ends in a redirect back to the site's Settings page with a result
 * flag, never a raw error page: the user is mid-flow in a browser tab.
 */
import { googleAccounts } from "@ourglass/db";
import {
  encryptToken,
  exchangeCode,
  googleConfigFromEnv,
  verifyState,
} from "@ourglass/api/integrations";
import { allowedOrigins } from "../../_http";
import { db } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(result: string): Response {
  // The Pages site — the first allowed origin — not anything from the query
  // string, so the callback cannot be turned into an open redirect.
  const site = allowedOrigins(process.env)[0] ?? "";
  return new Response(null, { status: 302, headers: { location: `${site}/settings?google=${result}` } });
}

export async function GET(request: Request) {
  const config = googleConfigFromEnv(process.env);
  if (!config) return back("not_configured");

  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? "";
  if (!(await verifyState(state, config.clientSecret))) return back("expired");
  if (params.get("error")) return back("denied");
  const code = params.get("code");
  if (!code) return back("error");

  try {
    const granted = await exchangeCode(config, code);
    const refreshTokenEnc = await encryptToken(granted.refreshToken, config.clientSecret);
    await db.withTransaction((tx) =>
      googleAccounts.save(tx, { email: granted.email, refreshTokenEnc, scope: granted.scope }),
    );
    return back("connected");
  } catch (error: unknown) {
    console.error("[google] callback failed:", error instanceof Error ? error.message : error);
    return back("error");
  }
}
