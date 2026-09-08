import { describe, expect, expectTypeOf, it } from "vitest";
import {
  err,
  fakeQueryResult,
  ok,
  type LoggedMutation,
  type Result,
  type ToolContext,
  type ToolDefinition,
  type ToolError,
} from "./tool-contract.js";

describe("Result helpers", () => {
  it("ok() produces an ok:true result carrying the value", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("err() produces an ok:false result carrying the errors", () => {
    const errors: ToolError[] = [{ code: "bad_input", message: "nope" }];
    const r = err(errors);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual(errors);
  });

  it("Result narrows by discriminant (compile-time + runtime)", () => {
    const r: Result<number, string[]> = Math.random() > 2 ? ok(1) : err(["x"]);
    if (r.ok) {
      expectTypeOf(r.value).toEqualTypeOf<number>();
    } else {
      expectTypeOf(r.errors).toEqualTypeOf<string[]>();
    }
  });
});

describe("ToolDefinition contract shape", () => {
  // This test exists to make a regression to a static-schema tool definition
  // fail loudly at compile time. See docs/PHASE-1-DESIGN.md §4.1: `validate`
  // must be a function that can query ctx.tx, never `{ schema: ZodType }`.
  it("validate is callable as a function receiving (raw, ctx)", async () => {
    interface Input {
      readonly foo: string;
    }
    interface Output {
      readonly id: string;
    }

    const fakeTx: ToolContext["tx"] = {
      query: async () => fakeQueryResult([]),
    };
    const ctx: ToolContext = { tx: fakeTx, turnId: "t1", seq: 0, actorKind: "user_turn" };

    const definition: ToolDefinition<Input, Output> = {
      name: "fake_tool",
      description: "test double",
      validate: async (raw, c) => {
        // Proves validate can read ctx.tx — the load-bearing property for
        // dynamic tools like define_entity_type.
        await c.tx.query("SELECT 1");
        if (typeof raw === "object" && raw !== null && "foo" in raw) {
          return ok({ foo: String((raw as { foo: unknown }).foo) });
        }
        return err([{ code: "invalid", message: "missing foo" }]);
      },
      commit: async (input) => {
        const mutations: LoggedMutation[] = [
          {
            targetTable: "fake",
            targetId: null,
            forwardPatch: input,
            inversePatch: null,
            invertibility: "none",
          },
        ];
        return { output: { id: "1" }, mutations };
      },
    };

    const result = await definition.validate({ foo: "bar" }, ctx);
    expect(result.ok).toBe(true);

    const rejected = await definition.validate({}, ctx);
    expect(rejected.ok).toBe(false);
  });
});
