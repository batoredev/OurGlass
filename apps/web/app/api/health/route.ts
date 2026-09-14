/**
 * GET /api/health — round-trips through Postgres.
 *
 * NOT behind the demo flag: a health check that only answers when a feature
 * flag is on cannot tell you whether the deployment is alive. That makes it
 * the ONE route reachable by anyone who finds the hostname, which is why the
 * failure branch below is deliberately uninformative.
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
    //
    // The DETAIL GOES TO THE LOG, NOT THE RESPONSE. Do not put it back.
    //
    // The first version returned `error.message` here, reasoning that a health
    // check "exists to say WHY something is wrong". True — but it says it to
    // the OPERATOR, and a `pg` connection error is not a tidy sentence:
    //
    //     getaddrinfo ENOTFOUND db.<project-ref>.supabase.co
    //     password authentication failed for user "postgres.<project-ref>"
    //     no pg_hba.conf entry for host "...", user "postgres", ...
    //
    // Those carry the database host, the project ref, and the role name to an
    // unauthenticated caller — a free map of the backend, handed out at
    // exactly the moment the system is already unhealthy.
    //
    // wrangler.toml's [observability] block puts console output in Workers
    // Logs, so the operator loses nothing.
    //
    console.error("[health] database check failed:", error);
    return NextResponse.json(
      { ok: false, service: "api", db: false, error: "Database check failed." },
      { status: 503 },
    );
  }
}
