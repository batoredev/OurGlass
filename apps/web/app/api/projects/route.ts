/** GET /api/projects — §29. Read-only. */
import { NextResponse } from "next/server";
import { projects } from "@ourglass/db";
import { demoEnabled, read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!demoEnabled()) return NextResponse.json({ error: "Not enabled." }, { status: 404 });
  return NextResponse.json({ projects: await read((tx) => projects.list(tx)) });
}
