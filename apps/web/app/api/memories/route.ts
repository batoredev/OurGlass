/**
 * GET /api/memories — §29.
 *
 * §28's "inspect and correct what the assistant believes" is impossible until
 * the memories are visible at all.
 */
import { NextResponse } from "next/server";
import { memories } from "@ourglass/db";
import { demoEnabled, read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!demoEnabled()) return NextResponse.json({ error: "Not enabled." }, { status: 404 });
  return NextResponse.json({ memories: await read((tx) => memories.listAll(tx)) });
}
