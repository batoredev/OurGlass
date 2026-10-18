/**
 * GET /api/entity-types/:key/records — instances of one dynamic type.
 *
 * 404s an unknown type rather than returning an empty list: "this type does
 * not exist" and "this type has no records yet" are different answers, and a
 * UI that cannot tell them apart shows an empty table for a typo'd URL.
 */
import { NextResponse } from "next/server";
import { entityRecords } from "@ourglass/db";
import { authorize } from "../../../_auth";
import { read } from "../../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const denied = await authorize(request);
  if (denied) return denied;

  const { key } = await params;
  const type = await read((tx) => entityRecords.getTypeByKey(tx, key));
  if (!type) return NextResponse.json({ error: `No entity type "${key}".` }, { status: 404 });

  return NextResponse.json({
    type,
    records: await read((tx) => entityRecords.listRecords(tx, key)),
  });
}
