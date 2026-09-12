/**
 * The in-process reminder poller (docs/PHASE-3-DESIGN.md §6).
 *
 * WHY IN-PROCESS: `pg_cron` is absent from `pgvector/pgvector:pg17` (verified
 * from the image's Dockerfile source, DECISIONS.md #7), and the custom-image
 * path needs a GHCR publish step on a repo where we hold WRITE, not ADMIN.
 *
 * ┌─ THE ONE RULE THIS FILE EXISTS TO ENFORCE ─────────────────────────────┐
 * │ `pollOnce` reads `clock.now()` EXACTLY ONCE, at the top, and passes    │
 * │ that instant everywhere. It never calls `new Date()`.                  │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * That is not stylistic. `apps/api/vitest.integration.config.ts` sets
 * `testTimeout: 15_000`; any test that starts the real interval and waits for
 * a tick times out before it does anything useful (§6.4's "15-second trap").
 * The injectable clock is the ONLY thing that makes reminder firing testable.
 *
 * EVERY TEST CALLS `pollOnce` WITH A FIXED CLOCK. NO TEST CALLS
 * `startReminderPoller`. NO TEST SLEEPS. The next person's instinct is to
 * start the loop and wait — this comment exists to stop that.
 */
import type { DatabaseTransaction } from "@ourglass/shared";
import { reminders, type DueReminder } from "@ourglass/db";
import { executeTurn, type Deps as ExecutorDeps } from "../tools/index.js";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * What the poller does with a reminder once it has fired.
 *
 * Delivery is deliberately NOT this module's concern. Phase 3 has no
 * notification channel — no push, no email, no websocket — and inventing one
 * here would be the speculative architecture CLAUDE.md §1 forbids. The
 * callback receives the fired reminder and a transaction, so a future
 * delivery mechanism that must be transactional with its own bookkeeping (an
 * outbox row, say) can be added without restructuring this.
 */
export type OnFire = (reminder: DueReminder, tx: DatabaseTransaction) => Promise<void>;

export interface PollerDeps extends ExecutorDeps {
  readonly clock: Clock;
  readonly batchSize?: number;
  readonly onFire?: OnFire;
}

export interface PollResult {
  readonly fired: number;
  /** Reminders claimed but NOT fired — a lost race, or a validation refusal. */
  readonly skipped: number;
  /** The instant the pass ran at. Echoed so a caller can log it. */
  readonly asOf: Date;
}

/**
 * ONE pass. Pure with respect to time.
 *
 * Each firing — the `fired_at` update and its `action_log` insert — is ONE
 * transaction, opened by `executeTurn` (§6.5). If the process dies before
 * COMMIT, Postgres rolls it back when the connection drops: nothing is lost,
 * and nothing double-fires — by construction, not by recovery code.
 */
export async function pollOnce(deps: PollerDeps): Promise<PollResult> {
  // ONCE, at the top. Everything downstream uses this instant.
  const asOf = deps.clock.now();
  const batchSize = deps.batchSize ?? 100;

  // Claimed in its own transaction, then fired one at a time.
  //
  // Rejected: holding ONE transaction across the claim AND every firing.
  // `FOR UPDATE SKIP LOCKED` releases its locks at COMMIT, so a long batch
  // would hold row locks for the whole pass, and one poisoned reminder would
  // roll back the firings of every good one alongside it. Claiming separately
  // costs one reminder instead of the batch.
  //
  // What makes that safe WITHOUT holding the lock is `markFired`'s redundant
  // `AND fired_at IS NULL` (§6.2): a competing instance that claims the same
  // row after our locks drop still cannot double-fire it, because the UPDATE
  // matches zero rows and `fire_reminder` refuses. The lock is an
  // optimisation; `fired_at` is the correctness guarantee.
  const due = await deps.db.withTransaction((tx) =>
    reminders.claimDueReminders(tx, asOf, batchSize),
  );
  if (due.length === 0) return { fired: 0, skipped: 0, asOf };

  let fired = 0;
  let skipped = 0;

  for (const reminder of due) {
    // `"scheduled_job"`, and this argument is the whole access-control story
    // for undo (§6.3). `undoTurn` filters `actor_kind = 'user_turn'`, so a
    // scheduled turn returns zero rows and throws TurnNotFoundError — the
    // user cannot undo a clock tick. Letting this default to "user_turn"
    // would silently make every reminder firing user-undoable.
    const outcome = await executeTurn(
      [
        {
          name: "fire_reminder",
          input: { reminder_id: reminder.id, fired_at: asOf.toISOString() },
        },
      ],
      deps,
      "scheduled_job",
    );

    if (!outcome.ok) {
      // A lost race (another instance fired it first) or a refusal (the row
      // was invalidated between claim and call). Both are DESIGNED outcomes
      // of at-least-once delivery collapsing to effectively-once, not faults
      // — but they are COUNTED rather than swallowed, so a systematically
      // failing poller shows up in the numbers instead of looking idle.
      skipped += 1;
      continue;
    }

    fired += 1;
    if (deps.onFire) {
      await deps.db.withTransaction((tx) => deps.onFire!(reminder, tx));
    }
  }

  return { fired, skipped, asOf };
}

export interface PollerHandle {
  stop(): void;
}

/**
 * The loop. THE ONLY PLACE `setInterval` APPEARS in this codebase.
 *
 * `intervalMs = 30_000` is deliberately coarse and is a TUNABLE, not a
 * constant of nature. Reminders here are set at human granularity ("at 5"),
 * so a 30-second worst-case skew is invisible, while a 1-second poll is 30x
 * the query load for nothing.
 *
 * Never called from a test — see this file's header.
 */
export function startReminderPoller(deps: PollerDeps, intervalMs = 30_000): PollerHandle {
  let stopped = false;
  // Guards against OVERLAPPING passes: if one pass takes longer than the
  // interval, the next tick must not start a second concurrent pass. Without
  // this, a slow database turns a backlog into an ever-growing pile of
  // concurrent passes — the classic setInterval-with-async footgun.
  let running = false;

  const timer = setInterval(() => {
    if (stopped || running) return;
    running = true;
    void pollOnce(deps)
      .catch((error: unknown) => {
        // A poller that dies on one bad pass stops firing every future
        // reminder, silently. Log and keep the loop alive — "degrade
        // honestly" (.claude/rules/ai-systems.md) applied to a background
        // job: keep running, never pretend the pass succeeded.
        console.error("reminder poll failed:", error);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);

  // Do not hold the process open for the sake of the timer. An API server
  // should exit on SIGTERM; an unref'd interval lets it.
  timer.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
