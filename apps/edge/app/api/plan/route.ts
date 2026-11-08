/**
 * GET /api/plan — today's plan, PROPOSED (ROADMAP Stage 3).
 *
 * The deterministic scheduler (apps/api planning/scheduler.ts) over today's
 * meetings, what you owe, and what others owe you with their own record.
 * Writes nothing; POST /api/plan/accept puts accepted blocks on the calendar.
 */
import { NextResponse } from "next/server";
import { googleAccounts } from "@ourglass/db";
import { accessToken, decryptToken, googleConfigFromEnv, listCalendarBusy } from "@ourglass/api/integrations";
import { loadDayPlan } from "@ourglass/api/planning";
import { authorize } from "../_auth";
import { localDayWindow, read, userTimeZone } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  const timeZone = await userTimeZone();
  const now = new Date();
  const { start, end } = localDayWindow(now, timeZone);
  // Stage 1b: Google Calendar's busy times, when connected. A failure plans
  // without them and says so — never a silent gap.
  let external: Awaited<ReturnType<typeof listCalendarBusy>> = [];
  let calendarNote: string | null = null;
  const config = googleConfigFromEnv(process.env);
  const account = config ? await read((tx) => googleAccounts.get(tx)) : null;
  if (config && account) {
    try {
      const token = await accessToken(config, await decryptToken(account.refresh_token_enc, config.clientSecret));
      external = await listCalendarBusy(token, start, end);
    } catch (error: unknown) {
      console.error("[plan] Google Calendar read failed:", error instanceof Error ? error.message : error);
      calendarNote = "Google Calendar couldn't be read just now, so this plan only knows OurGlass's own meetings.";
    }
  }
  const plan = await read((tx) => loadDayPlan(tx, now, start, timeZone, external));
  return NextResponse.json({ timeZone, calendarNote, ...plan });
}
