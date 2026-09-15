/**
 * The reminder poller as a LOCAL DEVELOPMENT process.
 *
 * ================================ READ THIS ================================
 * `startReminderPoller` was written in Phase 3, documented, and NEVER CALLED —
 * not by the Fastify server, not by any test. `apps/web/worker/scheduled.ts`
 * even says it "stays in the codebase for local `pnpm dev`", which described a
 * call site that did not exist. This file is that call site.
 *
 * In PRODUCTION the poller is a Cloudflare Cron Trigger calling `pollOnce`
 * (see `apps/web/worker/scheduled.ts`): a Worker has no process to hold an
 * interval. Locally there IS a process, and a 30-second in-process loop beats
 * waiting on Cloudflare's one-minute floor while watching a reminder you just
 * set.
 *
 * Both paths call the SAME `pollOnce` with the same injected clock. That is
 * the property Phase 3's design bought, and it is why neither needed adapting.
 * ===========================================================================
 */
import { createPool, withTransaction } from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";
import { startReminderPoller, systemClock } from "./reminders/poller.js";
import { buildToolRegistry } from "./tools/index.js";

function main(): void {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    // Fail at STARTUP. A poller that runs with no database logs one error per
    // tick forever, which reads as noise rather than as "this never worked".
    throw new Error("DATABASE_URL is required to run the reminder poller.");
  }

  const pool = createPool(connectionString);
  const handle = startReminderPoller({
    db: {
      withTransaction: <T>(fn: (tx: DatabaseTransaction) => Promise<T>) =>
        withTransaction(pool, fn),
    },
    registry: buildToolRegistry(),
    clock: systemClock,
  });

  console.log("[poller] running — reminders and conditional rules, every 30s. Ctrl-C to stop.");

  // ⚠ THE POLLER'S INTERVAL IS `unref`'d, on purpose (poller.ts): an API
  // server should exit on SIGTERM rather than being held open by a timer.
  // That makes it the wrong thing to rely on HERE, where the poller is the
  // only reason the process exists — with nothing else keeping the loop
  // alive, node would find no work pending and exit immediately.
  //
  // A ref'd no-op interval is the smallest thing that holds the process open
  // without changing the poller's semantics for its other caller.
  const keepAlive = setInterval(() => {}, 60_000);

  const shutdown = (signal: string): void => {
    console.log(`[poller] ${signal} — stopping.`);
    handle.stop();
    clearInterval(keepAlive);
    // Release the pool so a local Postgres does not accumulate connections
    // across restarts of `pnpm dev`.
    void pool.end().finally(() => {
      process.exitCode = 0;
    });
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

main();
