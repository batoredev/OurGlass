/**
 * The `reminders` Supabase Edge Function: one scheduled pass per call.
 *
 * Called once a minute by `pg_cron` + `pg_net` (see
 * supabase/cron/schedule-reminders.sql). It is reachable from the
 * internet like any Edge Function, so it requires `CRON_SECRET` as a bearer
 * token: without it anyone could make the poller run, and with no secret
 * configured it refuses everything rather than running open.
 */
import { runScheduled } from "../lib/scheduled";

export async function handleReminders(request: Request): Promise<Response> {
  const secret = process.env["CRON_SECRET"];
  if (!secret || secret.length < 32) {
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (request.method !== "POST" || !(await sameSecret(auth, `Bearer ${secret}`))) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const databaseUrl = process.env["DATABASE_URL"] ?? process.env["SUPABASE_DB_URL"];
  if (!databaseUrl) {
    return Response.json({ error: "DATABASE_URL is required." }, { status: 500 });
  }
  await runScheduled({
    DATABASE_URL: databaseUrl,
    VOYAGE_API_KEY: process.env["VOYAGE_API_KEY"],
    ALERT_WEBHOOK_URL: process.env["ALERT_WEBHOOK_URL"],
  });
  return Response.json({ ok: true });
}

/** Constant-time comparison via digests, so a wrong secret leaks no timing. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
