/** GET /api/projects — §29. Read-only. */
import { NextResponse } from "next/server";
import { projects } from "@ourglass/db";
import { authorize } from "../_auth";
import { read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  return NextResponse.json({ projects: await read((tx) => projects.list(tx)) });
}
