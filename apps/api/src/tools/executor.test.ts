/**
 * Unit tests for executeTurn/undoTurn against an in-memory fake transaction
 * — no live Postgres. These exercise the ORCHESTRATION invariants (§4.2):
 * validate-before-write, one transaction per turn, tools never DELETE
 * (not directly testable here since tools are fakes, but the executor
 * itself issues no DELETE), every mutation logged, undo ordering.
 *
 * What this file does NOT and CANNOT prove: that the double-undo rejection
 * is a real Postgres constraint (23505 on action_log_undo_once_idx) rather
 * than the fake's in-memory unique check happening to behave the same way.
 * That requires apps/api/src/tools/create-commitment.integration.test.ts
 * against real Postgres — see docs/PHASE-1-DESIGN.md §4.3's own caveat.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseTransaction, ToolContext, ToolDefinition } from "@ourglass/shared";
import { ok, err, fakeQueryResult } from "@ourglass/shared";
import { ToolRegistry } from "./registry.js";
import { executeTurn, undoTurn, type Deps } from "./executor.js";
import { __resetInverseHandlersForTests, registerInverseHandler } from "./inverses.js";
import { NotInvertibleError, ToolNotFoundError, TurnAlreadyUndoneError } from "./errors.js";

// ---------------------------------------------------------------------------
// A minimal in-memory fake standing in for Postgres. Good enough to test
// orchestration; NOT a substitute for the real DB-backed constraint tests.
// ---------------------------------------------------------------------------

interface FakeRow {
  turn_id: string;
  seq: number;
  tool_name: string;
  actor_kind: string;
  invertibility: string;
  target_table: string;
  target_id: string | null;
  forward_patch: string;
  inverse_patch: string;
  undoes_turn_id: string | null;
}

function makeFakeDb() {
  const actionLog: FakeRow[] = [];
  const widgets = new Map<string, { name: string; deleted: boolean }>();

  const tx: DatabaseTransaction = {
    query: async <TRow = unknown>(text: string, params: readonly unknown[] = []) => {
      const sql = text.trim();
      if (sql.startsWith("INSERT INTO action_log")) {
        const [
          turn_id,
          seq,
          tool_name,
          actor_kind,
          invertibility,
          target_table,
          target_id,
          forward_patch,
          inverse_patch,
          undoes_turn_id,
        ] = params as [
          string,
          number,
          string,
          string,
          string,
          string,
          string | null,
          string,
          string,
          string | null,
        ];

        // Emulate the partial unique index on (undoes_turn_id) WHERE NOT NULL.
        if (
          undoes_turn_id !== null &&
          actionLog.some((r) => r.undoes_turn_id === undoes_turn_id)
        ) {
          const dup = new Error(
            `duplicate key value violates unique constraint "action_log_undo_once_idx"`,
          ) as Error & { code: string };
          dup.code = "23505";
          throw dup;
        }

        actionLog.push({
          turn_id,
          seq,
          tool_name,
          actor_kind,
          invertibility,
          target_table,
          target_id,
          forward_patch,
          inverse_patch,
          undoes_turn_id,
        });
        return fakeQueryResult([] as TRow[]);
      }

      if (sql.startsWith("SELECT id, turn_id")) {
        const [turnId] = params as [string];
        const rows = actionLog
          .filter((r) => r.turn_id === turnId && r.actor_kind === "user_turn")
          .sort((a, b) => b.seq - a.seq)
          .map((r, i) => ({
            id: i,
            turnId: r.turn_id,
            seq: r.seq,
            toolName: r.tool_name,
            invertibility: r.invertibility,
            targetTable: r.target_table,
            targetId: r.target_id,
            inversePatch: JSON.parse(r.inverse_patch) as unknown,
          }));
        return fakeQueryResult(rows as unknown as TRow[]);
      }

      throw new Error(`FakeDb: unhandled query: ${sql}`);
    },
  };

  return {
    tx,
    actionLog,
    widgets,
    db: {
      withTransaction: async <T>(fn: (t: DatabaseTransaction) => Promise<T>): Promise<T> => {
        // Real transactional atomicity isn't modeled here — good enough for
        // orchestration tests where thrown errors just propagate.
        return fn(tx);
      },
    },
  };
}

// A trivial "create_widget" tool that writes to an in-memory map and is
// fully invertible, to exercise the pipeline without any real schema.
function makeWidgetTool(
  widgets: Map<string, { name: string; deleted: boolean }>,
): ToolDefinition<{ name: string }, { id: string }> {
  return {
    name: "create_widget",
    description: "test double",
    validate: async (raw) => {
      if (
        typeof raw === "object" &&
        raw !== null &&
        "name" in raw &&
        typeof (raw as { name: unknown }).name === "string"
      ) {
        return ok({ name: (raw as { name: string }).name });
      }
      return err([{ code: "invalid_name", message: "name must be a string" }]);
    },
    commit: async (input, ctx: ToolContext) => {
      const id = `widget-${ctx.turnId}-${ctx.seq}`;
      widgets.set(id, { name: input.name, deleted: false });
      return {
        output: { id },
        mutations: [
          {
            targetTable: "widgets",
            targetId: id,
            forwardPatch: { name: input.name },
            inversePatch: { id },
            invertibility: "full",
          },
        ],
      };
    },
  };
}

describe("executeTurn / undoTurn (in-memory fake)", () => {
  let fake: ReturnType<typeof makeFakeDb>;
  let deps: Deps;

  beforeEach(() => {
    __resetInverseHandlersForTests();
    fake = makeFakeDb();
    const registry = new ToolRegistry();
    registry.register(makeWidgetTool(fake.widgets));
    registerInverseHandler("widgets", async (_tx, targetId) => {
      if (targetId) fake.widgets.set(targetId, { name: "", deleted: true });
    });
    deps = { db: fake.db, registry };
  });

  it("rejects unknown tool names", async () => {
    await expect(
      executeTurn([{ name: "nonexistent_tool", input: {} }], deps),
    ).rejects.toThrow(ToolNotFoundError);
  });

  it("writes nothing when validation fails", async () => {
    const result = await executeTurn([{ name: "create_widget", input: {} }], deps);
    expect(result.ok).toBe(false);
    expect(fake.actionLog.length).toBe(0);
    expect(fake.widgets.size).toBe(0);
  });

  it("commits and logs one action_log row per mutation on success", async () => {
    const result = await executeTurn(
      [{ name: "create_widget", input: { name: "a" } }],
      deps,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.results).toHaveLength(1);
    }
    expect(fake.actionLog).toHaveLength(1);
    expect(fake.actionLog[0]?.tool_name).toBe("create_widget");
    expect(fake.actionLog[0]?.actor_kind).toBe("user_turn");
  });

  it("undoes a whole turn — every mutation in it", async () => {
    const result = await executeTurn(
      [
        { name: "create_widget", input: { name: "a" } },
        { name: "create_widget", input: { name: "b" } },
      ],
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    const undo = await undoTurn(result.turnId, deps);
    expect(undo.undone).toBe(2);
    for (const w of fake.widgets.values()) {
      expect(w.deleted).toBe(true);
    }
  });

  it("refuses to undo the same turn twice — DB constraint, not app check", async () => {
    const result = await executeTurn([{ name: "create_widget", input: { name: "a" } }], deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    await undoTurn(result.turnId, deps);
    await expect(undoTurn(result.turnId, deps)).rejects.toThrow(/already undone/);
  });

  // Regression test for a real bug caught in review: writing one undo-marker
  // row PER LOGGED MUTATION (rather than exactly one marker row per undone
  // turn) makes the SECOND insert of the FIRST undo of a multi-mutation turn
  // collide with the FIRST insert of that same undo attempt, since the
  // partial unique index is on undoes_turn_id alone. That bug's symptom is
  // indistinguishable from this test's failure mode: the first (and only)
  // undo attempt on a 2+-mutation turn throws TurnAlreadyUndoneError even
  // though the turn was never undone before. A 1-mutation turn cannot catch
  // this — it never reaches a second insert.
  it("succeeds on the FIRST undo of a multi-mutation turn (no false already-undone)", async () => {
    const result = await executeTurn(
      [
        { name: "create_widget", input: { name: "a" } },
        { name: "create_widget", input: { name: "b" } },
        { name: "create_widget", input: { name: "c" } },
      ],
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    // Must NOT throw — this is the exact regression.
    const undo = await undoTurn(result.turnId, deps);
    expect(undo.undone).toBe(3);

    // And a genuine second undo of the same (now-undone) multi-mutation
    // turn must still be rejected as a real double-undo.
    await expect(undoTurn(result.turnId, deps)).rejects.toThrow(TurnAlreadyUndoneError);
  });

  it("refuses to undo a turn containing an invertibility:'none' mutation", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "send_email",
      description: "test double, not invertible",
      validate: async () => ok({}),
      commit: async () => ({
        output: {},
        mutations: [
          {
            targetTable: "emails",
            targetId: null,
            forwardPatch: {},
            inversePatch: null,
            invertibility: "none",
          },
        ],
      }),
    });
    const nonInvertibleDeps: Deps = { db: fake.db, registry };
    registerInverseHandler("emails", async () => {
      throw new Error("must never be called — invertibility is none");
    });

    const result = await executeTurn([{ name: "send_email", input: {} }], nonInvertibleDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");

    await expect(undoTurn(result.turnId, nonInvertibleDeps)).rejects.toThrow(NotInvertibleError);
  });
});
