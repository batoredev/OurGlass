/**
 * The §29 read surfaces against a real database — and the Phase 5 demo's
 * central claim, which no unit test can make.
 *
 * ================================ READ THIS ================================
 * THE TEST THAT MATTERS HERE IS "define a type, then record one".
 *
 * Finding F12 was that `define_entity_type` could create a TYPE while nothing
 * in the repo could create a RECORD of it — so "track my gym sessions"
 * succeeded and the user had nowhere to put a session. A test asserting the
 * table accepts an INSERT would not have caught that: the table always did.
 * What was missing was the path.
 *
 * So this exercises the whole path in one test: define the type through the
 * tool layer, record an instance through the tool layer, then read it back
 * through the HTTP surface the frontend will use. If any link is missing the
 * test fails, which is the only honest way to claim the demo works.
 * ===========================================================================
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import { createPool, truncateAll, withTransaction } from "@ourglass/db";
import { buildServer } from "../server.js";
import { buildToolRegistry, executeTurn, type Deps } from "../tools/index.js";

const DATABASE_URL = process.env["DATABASE_URL"];

// A skipped suite and a passing suite look identical in a CI summary line.
// This file holds the ONLY end-to-end proof that a dynamic type is usable.
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error(
    "DATABASE_URL is unset in CI — the §29 read-surface suite would otherwise " +
      "silently skip instead of running.",
  );
}

const suite = DATABASE_URL ? describe : describe.skip;

suite("read surfaces (integration)", () => {
  let pool: pg.Pool;
  let deps: Deps;
  let app: FastifyInstance;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
    deps = {
      db: { withTransaction: (fn) => withTransaction(pool, fn) },
      registry: buildToolRegistry(),
    };
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    app = buildServer(pool, {
      enableDemoEndpoint: true,
      anthropicApiKey: "test-key-never-used-by-a-GET",
      demoUserId: "11111111-1111-1111-1111-111111111111",
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // The demo: a type the user invents becomes usable AND visible
  // -------------------------------------------------------------------------

  it("defines a type, records an instance, and serves both over HTTP", async () => {
    // ⚠ THE PHASE'S CENTRAL CLAIM. Every step goes through the real path —
    // the tool layer for writes, the HTTP surface for reads. Nothing here
    // inserts a row directly, because "the table accepts an insert" is
    // exactly what was already true when F12 was a bug.
    const defined = await executeTurn(
      [
        {
          name: "define_entity_type",
          input: {
            type_key: "gym_session",
            display_name: "Gym Session",
            fields: [
              { field_key: "performed_on", field_kind: "date", label: "Date", required: true },
              { field_key: "minutes", field_kind: "number", label: "Duration (minutes)", required: true },
              { field_key: "notes", field_kind: "text", label: "Notes", required: false },
            ],
          },
        },
      ],
      deps,
    );
    expect(defined.ok, JSON.stringify(defined)).toBe(true);

    // The registry is immediately visible to the frontend — NO DEPLOY between
    // defining the type and it being renderable. That is the user's stated
    // requirement, asserted rather than assumed.
    const registry = await app.inject({ method: "GET", url: "/api/entity-types" });
    expect(registry.statusCode).toBe(200);
    const types = registry.json<{ types: { type_key: string; fields: unknown[] }[] }>().types;
    const gym = types.find((type) => type.type_key === "gym_session");
    expect(gym).toBeDefined();
    // Fields arrive ordered, which is what makes the rendered table stable.
    expect(gym!.fields).toHaveLength(3);

    // Now the half that did not exist before this phase.
    const recorded = await executeTurn(
      [
        {
          name: "create_entity_record",
          input: {
            type_key: "gym_session",
            payload: { performed_on: "2026-09-14T07:00:00+05:30", minutes: 45, notes: "legs" },
          },
        },
      ],
      deps,
    );
    expect(recorded.ok, JSON.stringify(recorded)).toBe(true);

    const records = await app.inject({
      method: "GET",
      url: "/api/entity-types/gym_session/records",
    });
    expect(records.statusCode).toBe(200);
    const body = records.json<{ records: { payload: Record<string, unknown> }[] }>();
    expect(body.records).toHaveLength(1);
    expect(body.records[0]!.payload["minutes"]).toBe(45);
  });

  it("404s an unknown type rather than returning an empty list", async () => {
    // "This type does not exist" and "this type has no records yet" are
    // different answers. A UI that cannot distinguish them shows an empty
    // table for a typo'd URL, and the user concludes their data vanished.
    //
    // This lives here rather than in read.test.ts because withTransaction
    // needs a real pool — a query-only stub 500s on `pool.connect`, which
    // looks identical to the route being broken.
    const response = await app.inject({
      method: "GET",
      url: "/api/entity-types/definitely_not_a_type/records",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: expect.stringContaining("definitely_not_a_type"),
    });
  });

  it("rejects a payload key the type does not define", async () => {
    // The guard that stops `payload` becoming an untyped bag. A typo'd key
    // must fail loudly rather than persist and then vanish from every render
    // because no field definition names it.
    await executeTurn(
      [
        {
          name: "define_entity_type",
          input: {
            type_key: "book",
            display_name: "Book",
            fields: [{ field_key: "title", field_kind: "text", label: "Title", required: true }],
          },
        },
      ],
      deps,
    );

    const outcome = await executeTurn(
      [{ name: "create_entity_record", input: { type_key: "book", payload: { titel: "Dune" } } }],
      deps,
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      const codes = outcome.errors.map((error) => error.code);
      // Both problems are reported: the unknown key AND the missing required
      // one. Reporting only the first would make the user fix them one round
      // trip at a time.
      expect(codes).toContain("unknown_field");
      expect(codes).toContain("missing_required_field");
    }
  });

  // -------------------------------------------------------------------------
  // The §29 surfaces
  // -------------------------------------------------------------------------

  it("serves every §29 surface with a 200 and its named key", async () => {
    // Empty is a legitimate answer for all of these on a truncated database;
    // what is asserted is that each surface EXISTS and returns its documented
    // shape, which is what F14 established was missing.
    const surfaces: readonly [string, string][] = [
      ["/api/commitments", "commitments"],
      ["/api/people", "people"],
      ["/api/projects", "projects"],
      ["/api/memories", "memories"],
      ["/api/activity", "activity"],
    ];

    for (const [url, key] of surfaces) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, `${url} should be 200`).toBe(200);
      expect(response.json(), `${url} should return { ${key} }`).toHaveProperty(key);
    }

    const today = await app.inject({ method: "GET", url: "/api/today" });
    expect(today.statusCode).toBe(200);
    expect(today.json()).toMatchObject({
      overdue: expect.any(Array),
      dueLater: expect.any(Array),
      undated: expect.any(Array),
      events: expect.any(Array),
    });
  });

  it("shows a fired reminder in Activity — scheduled work is not hidden", async () => {
    // Undo filters action_log to `user_turn` because a clock tick is not
    // undoable. Activity deliberately does NOT filter: a reminder that fired
    // while the user was away is exactly what "what happened" should show.
    await executeTurn(
      [{ name: "create_reminder", input: { body: "ask Barkha", fire_at: null, commitment_id: null } }],
      deps,
      "scheduled_job",
    );

    const response = await app.inject({ method: "GET", url: "/api/activity" });
    const entries = response.json<{ activity: { actorKind: string }[] }>().activity;
    expect(entries.some((entry) => entry.actorKind === "scheduled_job")).toBe(true);
  });
});
