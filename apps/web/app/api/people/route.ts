/** GET /api/people — §29. Read-only. */
import { NextResponse } from "next/server";
import { people } from "@ourglass/db";
import { demoEnabled, read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!demoEnabled()) return NextResponse.json({ error: "Not enabled." }, { status: 404 });
  return NextResponse.json({ people: await read((tx) => people.list(tx)) });
}
