import { describe, expect, it } from "vitest";
import { fakeQueryResult, type DatabaseTransaction, type ToolContext } from "@ourglass/shared";
import { createThoughtTool, moveThoughtTool, removeThoughtTool } from "./thought-tools.js";

const ID = "11111111-1111-4111-8111-111111111111";

/** A transaction whose thoughts_current lookup finds `row` (or nothing). */
function ctxWith(row: Record<string, unknown> | null): ToolContext {
  const tx: DatabaseTransaction = {
    query: async () => fakeQueryResult(row ? [row] : []) as never,
  };
  return { tx, turnId: "t", seq: 0, actorKind: "user_turn" };
}

describe("create_thought", () => {
  it("accepts a thought at a priority and trims it", async () => {
    const result = await createThoughtTool.validate({ body: "  Launch the newsletter  ", priority: "high" }, ctxWith(null));
    expect(result).toEqual({ ok: true, value: { body: "Launch the newsletter", priority: "high" } });
  });

  it("refuses an empty thought, an overlong one, and an unknown priority", async () => {
    const empty = await createThoughtTool.validate({ body: "   ", priority: "high" }, ctxWith(null));
    expect(empty.ok).toBe(false);
    const long = await createThoughtTool.validate({ body: "x".repeat(501), priority: "low" }, ctxWith(null));
    expect(long.ok).toBe(false);
    const urgent = await createThoughtTool.validate({ body: "Ship it", priority: "urgent" }, ctxWith(null));
    expect(urgent.ok).toBe(false);
  });
});

describe("move_thought", () => {
  it("records where the thought came from, which is what undo restores", async () => {
    const result = await moveThoughtTool.validate({ id: ID, priority: "high" }, ctxWith({ id: ID, priority: "low" }));
    expect(result).toEqual({ ok: true, value: { id: ID, priority: "high", previous: "low" } });
  });

  it("refuses a thought that no longer exists", async () => {
    const result = await moveThoughtTool.validate({ id: ID, priority: "mid" }, ctxWith(null));
    expect(result.ok).toBe(false);
  });
});

describe("remove_thought", () => {
  it("refuses an id that is not a UUID", async () => {
    const result = await removeThoughtTool.validate({ id: "nope" }, ctxWith(null));
    expect(result.ok).toBe(false);
  });

  it("invalidates rather than deletes, and is fully undoable", async () => {
    const ctx = ctxWith({ id: ID, priority: "mid" });
    const validated = await removeThoughtTool.validate({ id: ID }, ctx);
    if (!validated.ok) throw new Error("expected valid");
    const { mutations } = await removeThoughtTool.commit(validated.value, ctx);
    expect(mutations[0]?.invertibility).toBe("full");
    expect(mutations[0]?.inversePatch).toEqual({ op: "revalidate" });
  });
});
