/**
 * The demo seed against a real database: it writes the week it promises,
 * through the tools (so the action log holds one undoable user turn), and it
 * refuses a database that already holds people — the guard that keeps demo
 * rows out of real data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, truncateAll, withTransaction } from "@ourglass/db";
import { buildToolRegistry } from "../tools/index.js";
import { undoTurn, type Deps } from "../tools/executor.js";
import { DatabaseNotEmptyError, seedDemo } from "./seed.js";

const DATABASE_URL = process.env["DATABASE_URL"];

if (!DATABASE_URL && process.env["CI"]) {
  throw new Error("DATABASE_URL is unset in CI — the demo seed's integration suite would silently skip.");
}

const suite = DATABASE_URL ? describe : describe.skip;

suite("seedDemo (integration)", () => {
  let pool: pg.Pool;
  let deps: Deps;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
    deps = { db: { withTransaction: (fn) => withTransaction(pool, fn) }, registry: buildToolRegistry() };
  });
  beforeEach(async () => {
    await truncateAll(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  async function count(view: string): Promise<number> {
    const result = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${view}`);
    return Number(result.rows[0]!.n);
  }

  it("writes the demo week as one undoable user turn", async () => {
    const now = new Date("2026-11-05T09:20:00Z");
    const result = await seedDemo(deps, now);

    expect(await count("people_current")).toBe(5); // the four, plus "You"
    expect(await count("commitments_current")).toBe(4);
    expect(await count("reminders_current")).toBe(1);
    expect(await count("events_current")).toBe(2);
    expect(await count("memories_current")).toBe(2);

    const turns = await pool.query<{ turn_id: string; actor_kind: string }>(
      "SELECT DISTINCT turn_id, actor_kind::text FROM action_log",
    );
    expect(turns.rows).toEqual([{ turn_id: result.turnId, actor_kind: "user_turn" }]);

    await undoTurn(result.turnId, deps);
    expect(await count("commitments_current")).toBe(0);
    expect(await count("events_current")).toBe(0);
  });

  it("refuses a database that already holds people", async () => {
    await seedDemo(deps);
    await expect(seedDemo(deps)).rejects.toBeInstanceOf(DatabaseNotEmptyError);
    expect(await count("commitments_current")).toBe(4);
  });
});
