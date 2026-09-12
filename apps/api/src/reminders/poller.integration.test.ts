/**
 * Integration tests for the reminder poller — docs/PHASE-3-DESIGN.md §6.4's
 * own prescribed suite. Needs a real Postgres 17 + pgvector with migrations
 * applied (`pnpm db:migrate`).
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ EVERY TEST HERE CALLS `pollOnce` WITH A FIXED CLOCK.                   │
 * │ NO TEST CALLS `startReminderPoller`. NO TEST SLEEPS.                   │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * `vitest.integration.config.ts` sets `testTimeout: 15_000` and the poller's
 * default interval is 30_000 — so a test that starts the real loop and waits
 * for a tick times out having proved nothing. That is §6.4's "15-second
 * trap", and it is written here because the next person's instinct is to
 * start the loop and wait.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  commitments,
  createPool,
  people,
  reminders,
  truncateAll,
  withTransaction,
  workflows,
} from "@ourglass/db";
import { buildToolRegistry } from "../tools/index.js";
import { undoTurn, type Deps } from "../tools/executor.js";
import { TurnNotFoundError } from "../tools/errors.js";
import { pollOnce, type Clock, type PollerDeps } from "./poller.js";

const DATABASE_URL = process.env["DATABASE_URL"];

// A skipped suite and a passing suite look identical in a CI summary line.
// This file holds the ONLY tests of at-least-once firing, the `fired_at`
// idempotency key, and invariant 4 (a clock tick is not undoable). If
// DATABASE_URL is ever dropped or renamed in CI, this must fail loudly rather
// than quietly report "skipped".
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error(
    "DATABASE_URL is unset in CI — the reminder poller's integration suite (§6.4) " +
      "would otherwise silently skip instead of running.",
  );
}

const suite = DATABASE_URL ? describe : describe.skip;

/** A clock frozen at one instant. The whole reason this suite is fast. */
function frozen(iso: string): Clock {
  const at = new Date(iso);
  return { now: () => at };
}

suite("reminder poller (integration)", () => {
  let pool: pg.Pool;
  let base: Deps;

  // Asia/Kolkata offsets throughout, matching the spec's own narratives and
  // the timezone every other suite in this repo pins.
  const DUE_AT = "2026-09-11T11:00:00+05:30";
  const AFTER = "2026-09-11T11:30:00+05:30";
  const BEFORE = "2026-09-11T10:59:00+05:30";

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
    base = {
      db: { withTransaction: (fn) => withTransaction(pool, fn) },
      registry: buildToolRegistry(),
    };
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  function deps(at: string, over: Partial<PollerDeps> = {}): PollerDeps {
    return { ...base, clock: frozen(at), ...over };
  }

  async function seedReminder(fireAt: string | null, body = "ask Barkha for the article") {
    return withTransaction(pool, (tx) =>
      reminders.createReminder(tx, { body, fireAt: fireAt === null ? null : new Date(fireAt) }),
    );
  }

  it("fires a reminder whose fire_at has passed", async () => {
    const r = await seedReminder(DUE_AT);
    const result = await pollOnce(deps(AFTER));

    expect(result.fired).toBe(1);
    expect(result.skipped).toBe(0);

    const after = await withTransaction(pool, (tx) => reminders.getById(tx, r.id));
    expect(after?.fired_at).not.toBeNull();
    // The stamped time is the INJECTED instant, not wall-clock. If this ever
    // reads "about now" instead, someone has reintroduced `new Date()` inside
    // the firing path and the whole suite has quietly stopped being
    // deterministic.
    expect(after!.fired_at!.toISOString()).toBe(new Date(AFTER).toISOString());
  });

  it("does not fire the same reminder twice", async () => {
    await seedReminder(DUE_AT);

    const first = await pollOnce(deps(AFTER));
    const second = await pollOnce(deps(AFTER));

    expect(first.fired).toBe(1);
    // `fired_at IS NOT NULL` now excludes it from claimDueReminders entirely,
    // so the second pass claims nothing — it does not claim-then-refuse.
    // THIS is what makes at-least-once delivery effectively-once (§6.2).
    expect(second.fired).toBe(0);
    expect(second.skipped).toBe(0);
  });

  it("does not fire a reminder that is not yet due", async () => {
    await seedReminder(DUE_AT);
    const result = await pollOnce(deps(BEFORE));
    expect(result.fired).toBe(0);
  });

  it("does not fire an invalidated reminder", async () => {
    // The undo path: a cancelled reminder must stay silent rather than fire
    // anyway. `claimDueReminders` filters `t_invalid IS NULL`, so this never
    // even reaches the tool.
    const r = await seedReminder(DUE_AT);
    await withTransaction(pool, (tx) => reminders.invalidateReminder(tx, r.id));

    const result = await pollOnce(deps(AFTER));
    expect(result.fired).toBe(0);

    const after = await withTransaction(pool, (tx) => reminders.getById(tx, r.id));
    expect(after?.fired_at).toBeNull();
  });

  it("ignores reminders with no fire_at — the relational and event tiers", async () => {
    // DECISIONS.md #3's three-tier time model: "before the meeting" and
    // "after Arun replies" have NO timestamp and belong to the rule engine
    // (§7), not the poller. `reminders_pending_idx` does not filter them, so
    // the QUERY must — this asserts that it does.
    await seedReminder(null, "remind me before the meeting");
    const result = await pollOnce(deps(AFTER));
    expect(result.fired).toBe(0);
  });

  it("logs the firing as scheduled_job, and undo REFUSES it", async () => {
    // THE REGRESSION TEST FOR INVARIANT 4 (PHASE-1-DESIGN §2.7, §6.3).
    //
    // Without this, someone "simplifying" undoTurn's
    // `WHERE turn_id = $1 AND actor_kind = 'user_turn'` down to
    // `WHERE turn_id = $1` makes every clock tick user-undoable and NOTHING
    // ELSE FAILS. The user cannot undo time passing.
    await seedReminder(DUE_AT);
    await pollOnce(deps(AFTER));

    const { rows } = await pool.query<{ turn_id: string; actor_kind: string; tool_name: string }>(
      `SELECT turn_id, actor_kind, tool_name FROM action_log ORDER BY seq`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_kind).toBe("scheduled_job");
    expect(rows[0]!.tool_name).toBe("fire_reminder");

    await expect(undoTurn(rows[0]!.turn_id, base)).rejects.toThrow(TurnNotFoundError);
  });

  it("fires a batch in fire_at order and respects batchSize", async () => {
    // A backlog after downtime must not be read in one unbounded transaction
    // (§6.1's LIMIT). Oldest first, so a backlog drains in the order the
    // reminders were meant to fire.
    await seedReminder("2026-09-11T09:00:00+05:30", "first");
    await seedReminder("2026-09-11T10:00:00+05:30", "second");
    await seedReminder("2026-09-11T10:30:00+05:30", "third");

    const firstPass = await pollOnce(deps(AFTER, { batchSize: 2 }));
    expect(firstPass.fired).toBe(2);

    const fired = await pool.query<{ body: string }>(
      `SELECT body FROM reminders WHERE fired_at IS NOT NULL ORDER BY fire_at`,
    );
    expect(fired.rows.map((row) => row.body)).toEqual(["first", "second"]);

    const secondPass = await pollOnce(deps(AFTER, { batchSize: 2 }));
    expect(secondPass.fired).toBe(1);
  });

  it("hands each fired reminder to onFire", async () => {
    await seedReminder(DUE_AT, "ask Barkha for the article");
    const seen: string[] = [];

    const result = await pollOnce(
      deps(AFTER, {
        onFire: async (reminder) => {
          seen.push(reminder.body);
        },
      }),
    );

    expect(result.fired).toBe(1);
    expect(seen).toEqual(["ask Barkha for the article"]);
  });

  // -------------------------------------------------------------------------
  // Conditional rules (§25, §7). "If Arun hasn't sent the schema by Friday,
  // remind me."
  //
  // §7.3 IS THE CORRECTNESS REQUIREMENT OF THE WHOLE SECTION: early
  // completion must NOT fire the rule. All three tests below use a fixed
  // clock, like everything else in this file.
  // -------------------------------------------------------------------------
  describe("conditional rules (§7)", () => {
    const EVALUATE_AT = "2026-09-11T11:00:00+05:30";

    async function seedRule(opts: { completed?: boolean; invalidateSubject?: boolean } = {}) {
      return withTransaction(pool, async (tx) => {
        const arun = await people.createPerson(tx, { displayName: "Arun" });
        const commitment = await commitments.createCommitment(tx, {
          ownerId: arun.id,
          objectText: "the schema",
        });
        if (opts.completed) {
          await commitments.completeCommitment(tx, commitment.id, {
            status: "completed",
            // Wednesday: BEFORE the Friday evaluate_at. This is the scenario
            // §7.3 exists for.
            completedAt: new Date("2026-09-09T15:00:00+05:30"),
          });
        }
        if (opts.invalidateSubject) {
          await commitments.invalidateCommitment(tx, commitment.id);
        }
        const workflow = await workflows.createWorkflow(tx, {
          conditionKind: "commitment_not_completed",
          subjectCommitmentId: commitment.id,
          evaluateAt: new Date(EVALUATE_AT),
          actionKind: "remind",
          actionBody: "chase Arun about the schema",
          sourcePhrase: "if Arun hasn't sent the schema by Friday",
        });
        return { commitment, workflow };
      });
    }

    it("fires when the commitment is still open at evaluate_at", async () => {
      const { workflow } = await seedRule();
      const result = await pollOnce(deps(AFTER));

      expect(result.workflowsEvaluated).toBe(1);
      expect(result.workflowsFired).toBe(1);

      const after = await withTransaction(pool, (tx) => workflows.getById(tx, workflow.id));
      expect(after?.evaluated_at).not.toBeNull();
      expect(after?.fired).toBe(true);
    });

    it("does NOT fire when the commitment completed early", async () => {
      // §7.3, THE REQUIREMENT. Arun sent the schema on Wednesday; on Friday
      // the status is `completed`, the condition is false, and nothing is
      // emitted. The user is never reminded about something that already
      // happened.
      const { workflow } = await seedRule({ completed: true });
      const result = await pollOnce(deps(AFTER));

      expect(result.workflowsEvaluated).toBe(1);
      expect(result.workflowsFired).toBe(0);

      const after = await withTransaction(pool, (tx) => workflows.getById(tx, workflow.id));
      // EVALUATED, and correctly declined — not skipped, not left pending.
      // That distinction is what makes §28's "why didn't you remind me?"
      // answerable in Phase 4: the log says *evaluated on Friday, condition
      // did not hold*.
      expect(after?.evaluated_at).not.toBeNull();
      expect(after?.fired).toBe(false);
    });

    it("does NOT fire when the subject commitment was invalidated", async () => {
      // The zero-rows path. An absent subject means DO NOT FIRE. Getting this
      // backwards ("it isn't completed, so the condition holds") would remind
      // the user about a commitment that no longer exists — the most
      // confusing possible output.
      const { workflow } = await seedRule({ invalidateSubject: true });
      const result = await pollOnce(deps(AFTER));

      expect(result.workflowsEvaluated).toBe(1);
      expect(result.workflowsFired).toBe(0);

      const after = await withTransaction(pool, (tx) => workflows.getById(tx, workflow.id));
      expect(after?.fired).toBe(false);
    });

    it("does not evaluate a rule before its evaluate_at", async () => {
      // NEVER CONTINUOUSLY. "by Friday" is a statement about Friday, not
      // about Wednesday — evaluating early fires while Arun simply has not
      // gotten to it yet.
      await seedRule();
      const result = await pollOnce(deps(BEFORE));
      expect(result.workflowsEvaluated).toBe(0);
    });

    it("does not evaluate the same rule twice", async () => {
      await seedRule();
      const first = await pollOnce(deps(AFTER));
      const second = await pollOnce(deps(AFTER));
      expect(first.workflowsEvaluated).toBe(1);
      // `evaluated_at IS NOT NULL` excludes it from the claim entirely.
      expect(second.workflowsEvaluated).toBe(0);
    });

    it("does not evaluate an invalidated rule", async () => {
      const { workflow } = await seedRule();
      await withTransaction(pool, (tx) => workflows.invalidateWorkflow(tx, workflow.id));
      const result = await pollOnce(deps(AFTER));
      expect(result.workflowsEvaluated).toBe(0);
    });

    it("logs the evaluation as scheduled_job, and undo REFUSES it", async () => {
      await seedRule();
      await pollOnce(deps(AFTER));

      const { rows } = await pool.query<{ turn_id: string; actor_kind: string; tool_name: string }>(
        `SELECT turn_id, actor_kind, tool_name FROM action_log ORDER BY seq`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor_kind).toBe("scheduled_job");
      expect(rows[0]!.tool_name).toBe("evaluate_workflow");
      await expect(undoTurn(rows[0]!.turn_id, base)).rejects.toThrow(TurnNotFoundError);
    });

    it("hands a rule whose condition held to onRuleFired, and a declining one not at all", async () => {
      await seedRule();
      await seedRule({ completed: true });
      const seen: string[] = [];

      const result = await pollOnce(
        deps(AFTER, {
          onRuleFired: async (workflow) => {
            seen.push(workflow.action_body);
          },
        }),
      );

      expect(result.workflowsEvaluated).toBe(2);
      expect(result.workflowsFired).toBe(1);
      // ONE callback, not two. A rule that declined is deliberately silent.
      expect(seen).toEqual(["chase Arun about the schema"]);
    });
  });

  it("a pass with nothing due writes no action_log rows at all", async () => {
    // Not tidiness: an empty pass that still minted a turn would fill the
    // ledger with rows naming zero mutations every 30 seconds forever, and
    // the Activity surface (§29) reads that table.
    await seedReminder(DUE_AT);
    await pollOnce(deps(BEFORE));

    const { rows } = await pool.query(`SELECT 1 FROM action_log`);
    expect(rows).toHaveLength(0);
  });
});
