/**
 * The §35 permission model end to end, against a real database
 * (PHASE-7-PERMISSIONS-DESIGN §2–§5).
 *
 * The extractor and responder are faked; the gate, the orchestrator, the
 * control-plane tools, the executor, action_log and undo are real. Every
 * property the design claims "by construction" is asserted here rather than
 * trusted: one current grant, hold-not-commit, approval and execution in one
 * transaction, no double execution, and undo reopening a decision.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  createPool,
  memories,
  permissions,
  truncateAll,
  users,
  withTransaction,
} from "@ourglass/db";
import type {
  ExtractedIntent,
  ExtractionResult,
  RespondInput,
  RespondOutput,
} from "@ourglass/shared";
import { runTurn, type OrchestratorDeps } from "../assistant/orchestrator.js";
import { buildToolRegistry, executeTurn, undoTurn, type Deps } from "../tools/index.js";
import { declinePendingAction, releasePendingAction } from "./release.js";

const DATABASE_URL = process.env["DATABASE_URL"];

if (!DATABASE_URL && process.env["CI"]) {
  throw new Error(
    "DATABASE_URL is unset in CI — the §35 permission suite would otherwise silently skip.",
  );
}

const suite = DATABASE_URL ? describe : describe.skip;

suite("§35 permission model (integration)", () => {
  let pool: pg.Pool;
  let userId: string;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    const account = await withTransaction(pool, (tx) =>
      users.ensureUser(tx, { displayName: "You", timezone: "Asia/Kolkata" }),
    );
    userId = account.user.id;
  });

  const executor = (): Deps => ({
    db: { withTransaction: (fn) => withTransaction(pool, fn) },
    registry: buildToolRegistry(),
  });

  function turnDeps(intents: readonly ExtractedIntent[]) {
    const calls: RespondInput[] = [];
    const deps: OrchestratorDeps = {
      ...executor(),
      extractor: {
        extract: async (): Promise<ExtractionResult> => ({
          extraction: { intents },
          trace: {
            model: "fake",
            latencyMs: 1,
            stopReason: "tool_use",
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        }),
      },
      responder: {
        respond: async (input: RespondInput): Promise<RespondOutput> => {
          calls.push(input);
          return { reply: "ok", degraded: false };
        },
      },
    };
    return { deps, calls };
  }

  const forgetArun: ExtractedIntent = {
    kind: "context",
    inferenceLevel: "CONFIRMED",
    sourceText: "Forget that Arun handles the backend",
    correctionTarget: "Arun handles the backend",
  };

  async function storeArun() {
    return withTransaction(pool, (tx) =>
      memories.createMemory(tx, {
        kind: "fact",
        body: "Arun handles the backend",
        inferenceLevel: "CONFIRMED",
      }),
    );
  }

  async function requireConfirmationFor(actionType: string) {
    const outcome = await executeTurn(
      [{ name: "set_permission", input: { action_type: actionType, decision: "confirm" } }],
      executor(),
    );
    expect(outcome.ok).toBe(true);
    return outcome;
  }

  async function holdAForget() {
    const memory = await storeArun();
    await requireConfirmationFor("forget_memory");
    const { deps, calls } = turnDeps([forgetArun]);
    const result = await runTurn({ utterance: "Forget that Arun handles the backend.", userId }, deps);
    const [pending] = await withTransaction(pool, (tx) => permissions.listRecentPendingActions(tx));
    return { memory, result, calls, pending: pending! };
  }

  const memoryInvalidAt = async (id: string) =>
    (await withTransaction(pool, (tx) => memories.getById(tx, id)))?.t_invalid ?? null;

  // -------------------------------------------------------------------------
  // Grants
  // -------------------------------------------------------------------------

  it("keeps ONE current grant per action type, and undo restores the one it replaced", async () => {
    await requireConfirmationFor("forget_memory");
    const second = await executeTurn(
      [{ name: "set_permission", input: { action_type: "forget_memory", decision: "allow" } }],
      executor(),
    );
    expect(second.ok).toBe(true);

    let current = await withTransaction(pool, (tx) => permissions.listCurrentGrants(tx));
    expect(current.map((grant) => grant.decision)).toEqual(["allow"]);

    await undoTurn((second as { turnId: string }).turnId, executor());
    current = await withTransaction(pool, (tx) => permissions.listCurrentGrants(tx));
    expect(current.map((grant) => grant.decision)).toEqual(["confirm"]);
  });

  it("refuses a grant for an unknown action or for the permission system itself", async () => {
    for (const actionType of ["send_rocket", "set_permission"]) {
      const outcome = await executeTurn(
        [{ name: "set_permission", input: { action_type: actionType, decision: "allow" } }],
        executor(),
      );
      expect(outcome.ok, actionType).toBe(false);
    }
    expect(await withTransaction(pool, (tx) => permissions.listCurrentGrants(tx))).toEqual([]);
  });

  it("revocation invalidates, and undoing it restores the grant", async () => {
    await requireConfirmationFor("forget_memory");
    const revoke = await executeTurn(
      [{ name: "revoke_permission", input: { action_type: "forget_memory" } }],
      executor(),
    );
    expect(revoke.ok).toBe(true);
    expect(await withTransaction(pool, (tx) => permissions.listCurrentGrants(tx))).toEqual([]);

    await undoTurn((revoke as { turnId: string }).turnId, executor());
    expect(await withTransaction(pool, (tx) => permissions.listCurrentGrants(tx))).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Hold
  // -------------------------------------------------------------------------

  it("without a grant, an internal write still acts immediately", async () => {
    const memory = await storeArun();
    const { deps } = turnDeps([forgetArun]);

    const result = await runTurn({ utterance: "Forget that Arun handles the backend.", userId }, deps);

    expect(result.committed).toEqual(["forget_memory"]);
    expect(await memoryInvalidAt(memory.id)).not.toBeNull();
    expect(await withTransaction(pool, (tx) => permissions.listRecentPendingActions(tx))).toEqual([]);
  });

  it("with a confirm grant, the forget is HELD: nothing commits, the user is asked, a request exists", async () => {
    const { memory, result, calls, pending } = await holdAForget();

    expect(result.committed).toEqual([]);
    expect(result.turnId).toBeNull();
    expect(await memoryInvalidAt(memory.id)).toBeNull();
    expect(calls[0]?.questions.join(" ")).toMatch(/approval/i);

    expect(pending.status).toBe("pending");
    expect(pending.risk_level).toBe("IMPORTANT_STATE_CHANGE");
    expect(pending.calls).toEqual([{ name: "forget_memory", input: { memory_id: memory.id } }]);
    expect(pending.summary).toContain("Arun handles the backend");
  });

  // -------------------------------------------------------------------------
  // Release
  // -------------------------------------------------------------------------

  it("confirming executes the held calls and marks the request, in ONE turn", async () => {
    const { memory, pending } = await holdAForget();

    const released = await releasePendingAction(executor(), pending.id);

    expect(released.ok).toBe(true);
    const turnId = (released as { turnId: string }).turnId;
    expect(await memoryInvalidAt(memory.id)).not.toBeNull();

    const after = await withTransaction(pool, (tx) => permissions.getPendingAction(tx, pending.id));
    expect(after?.status).toBe("executed");
    // The SAME turn: approval and execution are one audit unit.
    expect(after?.executed_turn_id).toBe(turnId);
  });

  it("a second confirmation cannot execute the held calls twice", async () => {
    const { pending } = await holdAForget();

    expect((await releasePendingAction(executor(), pending.id)).ok).toBe(true);
    const again = await releasePendingAction(executor(), pending.id);

    expect(again).toMatchObject({ ok: false, reason: "not_pending" });
    const turns = await pool.query(
      "SELECT DISTINCT turn_id FROM action_log WHERE tool_name = 'forget_memory'",
    );
    expect(turns.rows).toHaveLength(1);
  });

  it("undoing a confirmed turn reverses the held calls AND reopens the request", async () => {
    const { memory, pending } = await holdAForget();
    const released = await releasePendingAction(executor(), pending.id);

    await undoTurn((released as { turnId: string }).turnId, executor());

    expect(await memoryInvalidAt(memory.id)).toBeNull();
    const reopened = await withTransaction(pool, (tx) => permissions.getPendingAction(tx, pending.id));
    expect(reopened?.status).toBe("pending");
    expect(reopened?.executed_turn_id).toBeNull();
  });

  it("a held call that no longer validates runs nothing and records why", async () => {
    const { memory, pending } = await holdAForget();
    // The world moved on: the request now names a memory that does not exist.
    await pool.query("UPDATE pending_actions SET calls = $2::jsonb WHERE id = $1", [
      pending.id,
      JSON.stringify([
        { name: "forget_memory", input: { memory_id: "00000000-0000-4000-8000-000000000000" } },
      ]),
    ]);

    const released = await releasePendingAction(executor(), pending.id);

    expect(released).toMatchObject({ ok: false, reason: "invalid" });
    const after = await withTransaction(pool, (tx) => permissions.getPendingAction(tx, pending.id));
    // FAILED, not executed: the status change rolled back with the failed call.
    expect(after?.status).toBe("failed");
    expect(after?.executed_turn_id).toBeNull();
    expect(await memoryInvalidAt(memory.id)).toBeNull();
  });

  it("an expired request cannot be confirmed", async () => {
    const { memory, pending } = await holdAForget();
    await pool.query(
      "UPDATE pending_actions SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [pending.id],
    );

    expect(await releasePendingAction(executor(), pending.id)).toMatchObject({
      ok: false,
      reason: "not_pending",
    });
    expect(await memoryInvalidAt(memory.id)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Decline
  // -------------------------------------------------------------------------

  it("declining runs nothing, blocks a later confirmation, and undo reopens it", async () => {
    const { memory, pending } = await holdAForget();

    const declined = await declinePendingAction(executor(), pending.id);
    expect(declined.ok).toBe(true);
    expect(await releasePendingAction(executor(), pending.id)).toMatchObject({ ok: false });
    expect(await memoryInvalidAt(memory.id)).toBeNull();

    await undoTurn((declined as { turnId: string }).turnId, executor());
    const reopened = await withTransaction(pool, (tx) => permissions.getPendingAction(tx, pending.id));
    expect(reopened?.status).toBe("pending");
  });
});
