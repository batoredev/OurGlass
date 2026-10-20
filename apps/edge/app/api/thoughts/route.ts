/**
 * The Thoughts board.
 *
 *   GET     the board
 *   POST    { body, priority }  add a thought
 *   PATCH   { id, priority }    move it to another column
 *   DELETE  ?id=...             take it off the board
 *
 * Every write runs a tool through the executor — validated, in action_log,
 * and answered with a turnId that POST /api/undo reverses.
 */
import { NextResponse } from "next/server";
import { buildToolRegistry, executeTurn } from "@ourglass/api/tools";
import { thoughts } from "@ourglass/db";
import { authorize } from "../_auth";
import { rejectCrossSite } from "../_http";
import { db, read } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function run(name: string, input: unknown) {
  const outcome = await executeTurn([{ name, input }], { db, registry: buildToolRegistry() });
  return outcome.ok
    ? NextResponse.json({ turnId: outcome.turnId, result: outcome.results[0] })
    : NextResponse.json({ errors: outcome.errors }, { status: 400 });
}

async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const rows = await read((tx) => thoughts.listCurrent(tx));
  return NextResponse.json({
    thoughts: rows.map((row) => ({ id: row.id, body: row.body, priority: row.priority, created_at: row.t_created })),
  });
}

export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const refused = rejectCrossSite(request, { requireJson: true });
  if (refused) return refused;
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
  return run("create_thought", { body: body["body"], priority: body["priority"] });
}

export async function PATCH(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const refused = rejectCrossSite(request, { requireJson: true });
  if (refused) return refused;
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
  return run("move_thought", { id: body["id"], priority: body["priority"] });
}

export async function DELETE(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const refused = rejectCrossSite(request, { requireJson: false });
  if (refused) return refused;
  return run("remove_thought", { id: new URL(request.url).searchParams.get("id") });
}
