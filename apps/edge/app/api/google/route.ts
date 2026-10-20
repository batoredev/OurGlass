/**
 * GET /api/google — is Google Calendar set up, and which account is connected.
 * DELETE /api/google — disconnect: revoke at Google (best effort) and forget it.
 */
import { NextResponse } from "next/server";
import { googleAccounts } from "@ourglass/db";
import { decryptToken, googleConfigFromEnv, revoke } from "@ourglass/api/integrations";
import { authorize } from "../_auth";
import { rejectCrossSite } from "../_http";
import { db, read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const account = await read((tx) => googleAccounts.get(tx));
  return NextResponse.json({
    configured: googleConfigFromEnv(process.env) !== null,
    connected: account !== null,
    email: account?.email ?? null,
    connectedAt: account?.connected_at ?? null,
  });
}

export async function DELETE(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const refused = rejectCrossSite(request, { requireJson: false });
  if (refused) return refused;

  const config = googleConfigFromEnv(process.env);
  const account = await read((tx) => googleAccounts.get(tx));
  if (account && config) {
    try {
      await revoke(await decryptToken(account.refresh_token_enc, config.clientSecret));
    } catch {
      // A token that no longer decrypts (rotated secret) is still forgotten below.
    }
  }
  await db.withTransaction((tx) => googleAccounts.remove(tx));
  return NextResponse.json({ connected: false });
}
