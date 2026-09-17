/** GET /api/commitments — §29. Read-only. */
import { NextResponse } from "next/server";
import { commitments } from "@ourglass/db";
import { authorize } from "../_auth";
import { read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  return NextResponse.json({ commitments: await read((tx) => commitments.listCurrent(tx)) });
}
