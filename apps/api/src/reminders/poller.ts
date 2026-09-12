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
import { reminders, workflows, type DueReminder, type DueWorkflow } from "@ourglass/db";
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

/**
 * Called for a conditional rule whose condition HELD (§7.2's "emit the
 * action"). Not called for a rule that was evaluated and correctly declined —
 * that rule is deliberately silent.
 *
 * Same delivery caveat as `onFire`: Phase 3 has no notification channel, so
 * this is the seam a future one attaches to rather than a mechanism invented
 * here.
 */
export type OnRuleFired = (workflow: DueWorkflow, tx: DatabaseTransaction) => Promise<void>;

export interface PollerDeps extends ExecutorDeps {
  readonly clock: Clock;
  readonly batchSize?: number;
  readonly onFire?: OnFire;
  readonly onRuleFired?: OnRuleFired;
}

export interface PollResult {
  readonly fired: number;
  /** Reminders claimed but NOT fired — a lost race, or a validation refusal. */
  readonly skipped: number;
  /** Conditional rules evaluated this pass (§7.2), whether or not they fired. */
  readonly workflowsEvaluated: number;
  /**
   * Rules whose condition HELD. Strictly <= workflowsEvaluated: a rule whose
   * subject completed early is evaluated and correctly declines (§7.3), which
   * is a successful evaluation, not a skip.
   */
  readonly workflowsFired: number;
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

  const rules = await evaluateDueWorkflows(deps, asOf, batchSize);

  return {
    fired,
    skipped,
    workflowsEvaluated: rules.evaluated,
    workflowsFired: rules.held,
    asOf,
  };
}

/**
 * The second claim of the pass: conditional rules due for evaluation (§7.2).
 *
 * A SEPARATE CLAIM, not a merged one. Reminders and workflows are different
 * tables with different idempotency keys (`fired_at` vs `evaluated_at`) and
 * different partial indexes, and §7.1 explicitly rejected overloading
 * `reminders` with a nullable condition for exactly this reason.
 *
 * EVALUATED AT `evaluate_at`, NEVER CONTINUOUSLY. "If Arun hasn't sent the
 * schema BY FRIDAY" is a statement about Friday, not about Wednesday.
 * Checking every pass whether the condition holds YET would fire on Wednesday
 * when Arun simply has not gotten to it — the nagging spec §26 forbids, and
 * out of scope besides.
 */
async function evaluateDueWorkflows(
  deps: PollerDeps,
  asOf: Date,
  batchSize: number,
): Promise<{ evaluated: number; held: number }> {
  const due = await deps.db.withTransaction((tx) =>
    workflows.claimDueWorkflows(tx, asOf, batchSize),
  );
  if (due.length === 0) return { evaluated: 0, held: 0 };

  let evaluated = 0;
  let held = 0;

  for (const workflow of due) {
    const outcome = await executeTurn(
      [
        {
          name: "evaluate_workflow",
          input: { workflow_id: workflow.id, evaluated_at: asOf.toISOString() },
        },
      ],
      deps,
      "scheduled_job",
    );
    if (!outcome.ok) continue;

    evaluated += 1;

    // Did the condition actually hold? The tool returns it rather than this
    // layer re-deriving it — re-reading the commitment here would be a second
    // read at a different instant, and §7.3's whole guarantee is that the
    // condition is evaluated ONCE, against live state, inside the same
    // transaction that records the outcome.
    const result = outcome.results[0] as { fired?: unknown } | undefined;
    if (result?.fired === true) {
      held += 1;
      if (deps.onRuleFired) {
        await deps.db.withTransaction((tx) => deps.onRuleFired!(workflow, tx));
      }
    }
    // A rule that did NOT fire is deliberately silent. It is still marked
    // `evaluated_at` with `fired = false`, which is what makes §28's "why
    // didn't you remind me?" answerable in Phase 4: the log says *evaluated
    // on Friday, condition did not hold* rather than saying nothing at all.
  }

  return { evaluated, held };
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
