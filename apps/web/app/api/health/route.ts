/**
 * GET /api/health — round-trips through Postgres.
 *
 * NOT behind the demo flag: a health check that only answers when a feature
 * flag is on cannot tell you whether the deployment is alive.
 */
import { NextResponse } from "next/server";
import { getPool } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getPool().query("SELECT 1 AS ok");
    return NextResponse.json({ ok: true, service: "api", db: result.rows[0]?.ok === 1 });
  } catch (error: unknown) {
    // Report the failure rather than 500ing anonymously — this endpoint
    // exists to say WHY something is wrong.
    return NextResponse.json(
      {
        ok: false,
        service: "api",
        db: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}
