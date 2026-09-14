/**
 * The Cron Trigger handler — reminders and conditional rules on Cloudflare
 * (docs/DEPLOYMENT-DESIGN.md §3).
 *
 * ┌─ WHY THIS EXISTS AT ALL ───────────────────────────────────────────────┐
 * │ `startReminderPoller` calls `setInterval` every 30 seconds. On Workers │
 * │ that does not work: timers are supported, but Cloudflare's own docs    │
 * │ say they "don't persist across requests in the serverless context".    │
 * │ A Worker has no process to hold an interval.                          │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ `pollOnce` IS CALLED UNCHANGED — not adapted, not wrapped, not rewritten.
 *
 * That is entirely down to Phase 3's injected clock. `PHASE-3-DESIGN.md` §6.4
 * made the clock a parameter so tests would not have to sleep through a
 * 30-second interval under a 15-second timeout. The identical property makes
 * the function callable from a cron handler that owns no loop of its own. A
 * poller that read `new Date()` internally would need rewriting here.
 *
 * `startReminderPoller` stays in the codebase for local `pnpm dev`, where a
 * long-running Node process genuinely exists. It is simply unused in the
 * Cloudflare deployment.
 */
import { buildToolRegistry } from "@ourglass/api/tools";
import { pollOnce, systemClock } from "@ourglass/api/reminders/poller";
import { createPool, withTransaction } from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";

export interface Env {
  DATABASE_URL: string;
}

/**
 * The scheduled handler.
 *
 * ONE PASS PER INVOCATION, deliberately. The cron fires every minute and
 * `pollOnce` claims a bounded batch, so a backlog drains over several
 * invocations rather than in one unbounded transaction — the same property
 * §6.1's `LIMIT` was chosen for, now doing double duty as a guard against a
 * Worker's wall-clock limit.
 *
 * Errors are logged and swallowed. A cron handler that throws gets retried by
 * the platform, and a retry over a poll that already committed some firings
 * would stack at-least-once delivery on at-least-once delivery. The
 * `fired_at` idempotency key (§6.2) makes that safe, but there is nothing to
 * gain: the next minute's tick picks up whatever was missed.
 */
export async function runScheduled(env: Env): Promise<void> {
  const pool = createPool(env.DATABASE_URL);
  try {
    const result = await pollOnce({
      db: {
        withTransaction: <T>(fn: (tx: DatabaseTransaction) => Promise<T>) =>
          withTransaction(pool, fn),
      },
      registry: buildToolRegistry(),
      clock: systemClock,
    });
    // Logged even when nothing fired: a poller that has silently stopped
    // looks identical to a quiet one, and this is the only signal that
    // distinguishes them.
    console.log(
      `[cron] fired=${result.fired} skipped=${result.skipped} ` +
        `rules=${result.workflowsEvaluated}/${result.workflowsFired} ` +
        `at=${result.asOf.toISOString()}`,
    );
  } catch (error: unknown) {
    console.error("[cron] poll failed:", error);
  } finally {
    // A Worker isolate may be evicted at any time; releasing the pool keeps
    // Supabase's connection count honest rather than relying on eviction.
    await pool.end();
  }
}

/**
 * Named before export so the object is inspectable and the lint rule against
 * anonymous default exports stays satisfied — Cloudflare reads `scheduled`
 * off whatever the module's default happens to be.
 */
const worker = {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await runScheduled(env);
  },
};

export default worker;
