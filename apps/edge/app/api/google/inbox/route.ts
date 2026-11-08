/**
 * GET /api/google/inbox — the recent inbox, triaged (ROADMAP Stage 1c).
 *
 * Read-only Gmail. Sender, subject and Gmail's own snippet, as QUOTED DATA:
 * nothing here reaches a model, and "needs a reply" / "looks suspicious" are
 * decided by code from headers and the people you know
 * (apps/api integrations/google-read.ts). Answers with what is missing when
 * Google is not set up, not connected, or connected without the read scope.
 */
import { NextResponse } from "next/server";
import { googleAccounts, people } from "@ourglass/db";
import {
  accessToken,
  canReadEmail,
  decryptToken,
  googleConfigFromEnv,
  listInbox,
  triageInbox,
} from "@ourglass/api/integrations";
import { authorize } from "../../_auth";
import { read } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const config = googleConfigFromEnv(process.env);
  if (!config) return NextResponse.json({ state: "not_configured", messages: [] });
  const account = await read((tx) => googleAccounts.get(tx));
  if (!account) return NextResponse.json({ state: "not_connected", messages: [] });
  if (!canReadEmail(account.scope)) return NextResponse.json({ state: "needs_read_permission", messages: [] });

  try {
    const token = await accessToken(config, await decryptToken(account.refresh_token_enc, config.clientSecret));
    const inbox = await listInbox(token);
    const known = await read((tx) => people.list(tx));
    const messages = triageInbox(
      inbox,
      known.map((person) => ({ id: person.id, name: person.display_name, email: person.email ?? null })),
    );
    return NextResponse.json({ state: "ok", messages });
  } catch (error: unknown) {
    console.error("[inbox] Gmail read failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ state: "unavailable", messages: [] });
  }
}
