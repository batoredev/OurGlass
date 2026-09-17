/**
 * /api/session — the door (PHASE-7-PERMISSIONS-DESIGN §8).
 *
 *   POST    { token }  -> a signed session cookie, when the token is right
 *   DELETE             -> signs out
 *
 * NOT behind `authorize`, necessarily: this is how a browser gets through it.
 * It never echoes the token, never says HOW a token was wrong, and answers a
 * wrong token and a server with no token configured identically, so a caller
 * learns nothing about the deployment from a failed attempt.
 *
 * Brute force: the token is at least 32 characters (MIN_TOKEN_LENGTH), which
 * makes online guessing hopeless without rate limiting. Cloudflare's WAF rate
 * rules are the right place for more, if the Worker is ever public.
 */
import { NextResponse } from "next/server";
import {
  accessMode,
  clearedSessionCookie,
  createSessionValue,
  sessionCookie,
  tokenMatches,
} from "../_auth";
import { rejectCrossSite } from "../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFUSED = { error: "That token is not valid." };

export async function POST(request: Request) {
  const crossSite = rejectCrossSite(request, { requireJson: true });
  if (crossSite) return crossSite;

  let body: { token?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const mode = accessMode();
  if (mode.kind !== "token" || typeof body.token !== "string") {
    return NextResponse.json(REFUSED, { status: 401 });
  }
  if (!(await tokenMatches(body.token, mode.token))) {
    return NextResponse.json(REFUSED, { status: 401 });
  }

  const response = new NextResponse(null, { status: 204 });
  response.headers.set("set-cookie", sessionCookie(await createSessionValue(mode.token)));
  return response;
}

export async function DELETE(request: Request) {
  const crossSite = rejectCrossSite(request, { requireJson: false });
  if (crossSite) return crossSite;

  const response = new NextResponse(null, { status: 204 });
  response.headers.set("set-cookie", clearedSessionCookie());
  return response;
}
