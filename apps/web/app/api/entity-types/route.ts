/**
 * GET /api/entity-types — the dynamic registry.
 *
 * This is what makes the frontend schema-driven: it holds no hardcoded list
 * of entity types, so a type the assistant invented thirty seconds ago
 * renders on the next page load with no deploy.
 */
import { NextResponse } from "next/server";
import { entityRecords } from "@ourglass/db";
import { authorize } from "../_auth";
import { read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  return NextResponse.json({ types: await read((tx) => entityRecords.listTypes(tx)) });
}
