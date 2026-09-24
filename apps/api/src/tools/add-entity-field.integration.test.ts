/**
 * add_entity_field against real Postgres: the non-breaking rule, and an undo
 * that removes one field rather than the whole type.
 *
 * CI only — the suite truncates every table between tests, so it must never
 * run against a database holding anyone's data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, entityRecords, truncateAll, withTransaction } from "@ourglass/db";
import { buildToolRegistry } from "./index.js";
import { executeTurn, undoTurn, type Deps, type ExecuteTurnFailure, type ExecuteTurnSuccess } from "./executor.js";

const DATABASE_URL = process.env["DATABASE_URL"];

// A skipped suite and a passing suite look identical in a CI summary line.
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error("DATABASE_URL is unset in CI — add_entity_field's integration suite would silently skip.");
}

const suite = DATABASE_URL ? describe : describe.skip;

suite("add_entity_field (integration)", () => {
  let pool: pg.Pool;
  let deps: Deps;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
    deps = { db: { withTransaction: (fn) => withTransaction(pool, fn) }, registry: buildToolRegistry() };
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  /** A gym tracker with one note field and one logged session. */
  async function populatedGymTracker() {
    const defined = await executeTurn(
      [
        {
          name: "define_entity_type",
          input: {
            type_key: "gym_session",
            display_name: "Gym Sessions",
            fields: [{ field_key: "note", field_kind: "text", label: "Note", required: false }],
          },
        },
      ],
      deps,
    );
    expect(defined.ok).toBe(true);
    const logged = await executeTurn(
      [{ name: "create_entity_record", input: { type_key: "gym_session", payload: { note: "45 minutes" } } }],
      deps,
    );
    expect(logged.ok).toBe(true);
  }

  const gym = (required: boolean) => ({
    name: "add_entity_field",
    input: { type_key: "gym_session", field: { field_key: "gym", field_kind: "text", label: "Gym", required } },
  });

  const typeNow = () => withTransaction(pool, (tx) => entityRecords.getTypeByKey(tx, "gym_session"));

  it("adds an optional field to a populated type, and the old record stays valid", async () => {
    await populatedGymTracker();
    const before = await typeNow();

    const result = await executeTurn([gym(false)], deps);
    expect(result.ok).toBe(true);

    const after = await typeNow();
    expect(after?.fields.map((field) => field.field_key)).toEqual(["note", "gym"]);
    // The schema changed, so records written from now on carry a new version.
    expect(after?.current_version).toBe((before?.current_version ?? 0) + 1);
    const records = await withTransaction(pool, (tx) => entityRecords.listRecords(tx, "gym_session"));
    expect(records).toHaveLength(1);
  });

  it("REFUSES a required field on a populated type, and writes nothing", async () => {
    // Migration 006's rule: required would make every existing record invalid.
    await populatedGymTracker();

    const result = (await executeTurn([gym(true)], deps)) as ExecuteTurnFailure;
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("required_field_on_populated_type");
    expect((await typeNow())?.fields.map((field) => field.field_key)).toEqual(["note"]);
  });

  it("refuses a field the type already has, and a type that does not exist", async () => {
    await populatedGymTracker();

    const duplicate = (await executeTurn(
      [
        {
          name: "add_entity_field",
          input: { type_key: "gym_session", field: { field_key: "note", field_kind: "text", label: "Note" } },
        },
      ],
      deps,
    )) as ExecuteTurnFailure;
    expect(duplicate.errors.map((error) => error.code)).toContain("duplicate_field_key");

    const unknown = (await executeTurn(
      [
        {
          name: "add_entity_field",
          input: { type_key: "reading", field: { field_key: "rating", field_kind: "number", label: "Rating" } },
        },
      ],
      deps,
    )) as ExecuteTurnFailure;
    expect(unknown.errors.map((error) => error.code)).toContain("unknown_type");
  });

  it("UNDO removes only the added field — never the type, never a record", async () => {
    // The trap this guards: define_entity_type's undo handler invalidates the
    // WHOLE type. Sharing it would have made "undo add a gym field" delete the
    // gym tracker.
    await populatedGymTracker();
    const added = (await executeTurn([gym(false)], deps)) as ExecuteTurnSuccess;

    await undoTurn(added.turnId, deps);

    const after = await typeNow();
    expect(after).not.toBeNull();
    expect(after?.fields.map((field) => field.field_key)).toEqual(["note"]);
    const records = await withTransaction(pool, (tx) => entityRecords.listRecords(tx, "gym_session"));
    expect(records).toHaveLength(1);
    expect((records[0]?.payload as { note?: string }).note).toBe("45 minutes");
  });
});
