/**
 * GET /api/entity-types — the dynamic registry.
 *
 * This is what makes the frontend schema-driven: it holds no hardcoded list
 * of entity types, so a type the assistant invented thirty seconds ago
 * renders on the next page load with no deploy.
 */
import { NextResponse } from "next/server";
import { entityRecords } from "@ourglass/db";
import { demoEnabled, read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!demoEnabled()) return NextResponse.json({ error: "Not enabled." }, { status: 404 });
  return NextResponse.json({ types: await read((tx) => entityRecords.listTypes(tx)) });
}
