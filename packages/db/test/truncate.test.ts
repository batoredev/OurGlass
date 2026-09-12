/**
 * Unit tests — no Postgres required, so these run in the fast lane (`pnpm test`).
 *
 * They cover the two things in this package that are pure logic: the truncate table
 * list and the config boundary. Everything else needs a real database and lives in
 * `*.integration.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { TRUNCATABLE_TABLES, truncateAll, createPool } from "../src/index.js";
import type { Queryable } from "../src/index.js";

describe("truncateAll", () => {
  it("emits one statement covering every table, with RESTART IDENTITY CASCADE", async () => {
    const seen: string[] = [];
    const fake = {
      query: async (text: string) => {
        seen.push(text);
        return { rows: [], rowCount: 0, command: "", oid: 0, fields: [] };
      },
    } as unknown as Queryable;

    await truncateAll(fake);

    // ONE statement, not one per table: no FK ordering to keep in sync.
    expect(seen).toHaveLength(1);
    const sql = seen[0]!;

    // CASCADE is required — commitments references people, and Postgres refuses to
    // truncate a referenced table without it.
    expect(sql).toContain("CASCADE");
    // RESTART IDENTITY resets action_log's bigserial, so order-dependent undo tests
    // cannot pass fresh and fail on re-run.
    expect(sql).toContain("RESTART IDENTITY");
    for (const table of TRUNCATABLE_TABLES) {
      expect(sql).toContain(table);
    }
  });

  it("lists every table that carries test data", () => {
    // A table missing here leaks rows between tests, which surfaces as a test that
    // passes alone and fails in suite order. Update this list when adding a table.
    expect([...TRUNCATABLE_TABLES].sort()).toEqual(
      [
        "action_log",
        "commitment_notes",
        "commitments",
        "entity_records",
        "entity_type_fields",
        "entity_types",
        "events",
        // Phase 4, migration 010.
        "memories",
        "messages",
        "organizations",
        "people",
        "projects",
        "relationships",
        "reminders",
        "users",
        "workflows",
      ].sort(),
    );
  });
});

describe("config boundary", () => {
  it("createPool refuses an empty connection string instead of reading env", () => {
    // packages/db reads NO process.env (PHASE-1-DESIGN §5). This asserts the failure
    // is loud and names the cause, rather than surfacing later as ECONNREFUSED ::1.
    expect(() => createPool("")).toThrow(/never reads process\.env/);
  });
});
