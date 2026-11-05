/**
 * GET /api/data/export — everything stored, as one JSON file (ROADMAP Stage 0).
 *
 * Every table, current and undone rows alike, in one consistent snapshot
 * (`exportEverything`). Search vectors and the Google sign-in token are left
 * out; uploaded files' bytes are not included (each document row carries its
 * filename and extracted text).
 *
 * A GET, guarded like every read: the token travels in the Authorization
 * header (which a foreign page cannot set without a CORS preflight this API
 * refuses) or the SameSite=Strict session cookie (which a foreign page does
 * not send).
 */
import { NextResponse } from "next/server";
import { exportEverything } from "@ourglass/api/data";
import { authorize } from "../../_auth";
import { db } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const now = new Date();
  const exported = await exportEverything({ db, store: null }, now);
  return new NextResponse(JSON.stringify(exported, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="ourglass-export-${now.toISOString().slice(0, 10)}.json"`,
      "cache-control": "private, no-store",
    },
  });
}
