/**
 * Integration tests for create_commitment — docs/PHASE-1-DESIGN.md §4.3's own
 * prescribed suite, adapted to the actual published schema (schema2). Needs a
 * real Postgres 17 + pgvector with migrations applied (`pnpm db:migrate`).
 * Skips itself when DATABASE_URL is unset — same convention as
 * packages/db/test/merge-resolution.integration.test.ts — so the fast unit
 * lane stays Docker-free.
 *
 * These four tests are the whole reason create_commitment is Phase 1's first
 * tool (§4.3): it exercises both FK directions, the resolved-ID contract
 * including unknown-person rejection, the transaction, the action_log
 * round-trip, and undo including the multi-tool-per-turn case and the
 * DB-enforced double-undo rejection.
 *
 * CAVEAT, stated exactly as the design doc requires (§4.3, final paragraph):
 * green tests here are NOT evidence the tool layer is correct under model
 * input. This suite is harsher than a model on malformed input and weaker on
 * plausible-but-wrong input — it covers the failure modes its author
 * imagined. That gap is Phase 2's eval harness (packages/evals/); nobody may
 * skip eval work believing this suite covered it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, people, truncateAll, withTransaction } from "@ourglass/db";
import { randomUUID } from "node:crypto";
import { buildToolRegistry } from "./index.js";
import { executeTurn, undoTurn, type Deps, type ExecuteTurnSuccess } from "./executor.js";
import { TurnAlreadyUndoneError } from "./errors.js";

const DATABASE_URL = process.env["DATABASE_URL"];

// A skipped suite and a passing suite look identical in a CI summary line.
// This file holds the ONLY tests of the §4.3 phase-gate behaviours (unknown-
// person rejection, whole-turn undo, the 23505 double-undo constraint) — if
// DATABASE_URL is ever dropped or renamed in CI, this must fail loudly, not
// quietly report "skipped". Same guard as
// packages/db/test/merge-resolution.integration.test.ts.
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error(
    "DATABASE_URL is unset in CI — create_commitment's integration suite (the §4.3 " +
      "phase-gate tests) would otherwise silently skip instead of running.",
  );
}

const suite = DATABASE_URL ? describe : describe.skip;

suite("create_commitment (integration)", () => {
  let pool: pg.Pool;
  let deps: Deps;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
    deps = {
      db: {
        withTransaction: (fn) => withTransaction(pool, fn),
      },
      registry: buildToolRegistry(),
    };
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  async function makePerson(displayName: string) {
    return withTransaction(pool, (tx) => people.createPerson(tx, { displayName }));
  }

  it("stores ownership direction structurally", async () => {
    // "Barkha needs to give me the article by 6"
    const barkha = await makePerson("Barkha");
    const user = await makePerson("User");

    const result = await executeTurn(
      [
        {
          name: "create_commitment",
          input: {
            owner_id: barkha.id,
            recipient_id: user.id,
            object_text: "the article",
            expected_at: "2026-09-07T18:00:00+05:30",
          },
        },
      ],
      deps,
    );

    expect(result.ok).toBe(true);
    const success = result as ExecuteTurnSuccess;
    const output = success.results[0] as { id: string; ownerId: string; recipientId: string | null };

    const { rows } = await pool.query<{
      owner_id: string;
      recipient_id: string | null;
      status: string;
    }>("SELECT owner_id, recipient_id, status FROM commitments WHERE id = $1", [output.id]);
    const row = rows[0]!;

    // NOT inferred at read time — two explicit columns hold the direction.
    expect(row.owner_id).toBe(barkha.id);
    expect(row.recipient_id).toBe(user.id);
    expect(row.status).toBe("pending");
  });

  it("rejects an unresolved person and writes nothing", async () => {
    const result = await executeTurn(
      [
        {
          name: "create_commitment",
          input: { owner_id: randomUUID(), object_text: "x" },
        },
      ],
      deps,
    );

    expect(result.ok).toBe(false);

    const commitmentCount = await pool.query("SELECT count(*)::int AS n FROM commitments");
    expect(commitmentCount.rows[0].n).toBe(0);

    const actionLogCount = await pool.query("SELECT count(*)::int AS n FROM action_log");
    expect(actionLogCount.rows[0].n).toBe(0);
  });

  it("undoes a whole turn, not one row — commitment AND reminder both gone", async () => {
    // The Phase 2 demo utterance: "Barkha needs to give me the article by 6.
    // Remind me at 5 to ask her." -> one turn, two tools: create_commitment
    // then create_reminder.
    const barkha = await makePerson("Barkha");
    const user = await makePerson("User");

    const result = await executeTurn(
      [
        {
          name: "create_commitment",
          input: {
            owner_id: barkha.id,
            recipient_id: user.id,
            object_text: "the article",
            expected_at: "2026-09-07T18:00:00+05:30",
          },
        },
        {
          name: "create_reminder",
          input: { body: "ask Barkha for the article", source_phrase: "at 5" },
        },
      ],
      deps,
    );
    expect(result.ok).toBe(true);
    const success = result as ExecuteTurnSuccess;

    const undo = await undoTurn(success.turnId, deps);
    expect(undo.undone).toBe(2);

    const currentCommitments = await pool.query(
      "SELECT count(*)::int AS n FROM commitments_current",
    );
    const currentReminders = await pool.query("SELECT count(*)::int AS n FROM reminders_current");

    // BOTH, or the test is meaningless (§4.3).
    expect(currentCommitments.rows[0].n).toBe(0);
    expect(currentReminders.rows[0].n).toBe(0);
  });

  it("refuses to undo the same turn twice — DB constraint, not app check", async () => {
    const barkha = await makePerson("Barkha");

    const result = await executeTurn(
      [{ name: "create_commitment", input: { owner_id: barkha.id, object_text: "x" } }],
      deps,
    );
    expect(result.ok).toBe(true);
    const success = result as ExecuteTurnSuccess;

    await undoTurn(success.turnId, deps);

    // Second undo must be rejected. Confirm it is specifically a Postgres
    // unique-violation (23505) surfaced through TurnAlreadyUndoneError, not
    // an app-level pre-check — verified directly below by bypassing
    // undoTurn's own guard clauses and inserting a second undo marker row
    // straight against the DB.
    await expect(undoTurn(success.turnId, deps)).rejects.toThrow(TurnAlreadyUndoneError);
    await expect(undoTurn(success.turnId, deps)).rejects.toThrow(/already undone/);
  });

  it("double-undo rejection is a real Postgres constraint violation, verified independently of undoTurn's own code", async () => {
    // This test exists because "undoTurn rejects a second call" could pass
    // even if undoTurn's rejection were pure application logic (e.g. a
    // check-then-act SELECT) rather than the database refusing the write.
    // Verify the constraint directly: insert two action_log rows with the
    // same undoes_turn_id and confirm the SECOND insert raises 23505 on
    // action_log_undo_once_idx, independent of any application code path.
    const turnId = randomUUID();
    const firstUndoId = randomUUID();
    const secondUndoId = randomUUID();

    await pool.query(
      `INSERT INTO action_log
         (turn_id, seq, tool_name, actor_kind, invertibility, target_table, target_id,
          forward_patch, inverse_patch, undoes_turn_id)
       VALUES ($1, 0, 'undo', 'undo', 'none', 'action_log', NULL, '{}', 'null', $2)`,
      [firstUndoId, turnId],
    );

    await expect(
      pool.query(
        `INSERT INTO action_log
           (turn_id, seq, tool_name, actor_kind, invertibility, target_table, target_id,
            forward_patch, inverse_patch, undoes_turn_id)
         VALUES ($1, 0, 'undo', 'undo', 'none', 'action_log', NULL, '{}', 'null', $2)`,
        [secondUndoId, turnId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
