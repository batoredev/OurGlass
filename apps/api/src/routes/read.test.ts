/**
 * The read surfaces are READ-ONLY, and this file exists to keep them that way.
 *
 * ================================ READ THIS ================================
 * THE CENTRAL TEST HERE IS "no mutating route is registered".
 *
 * Every write in this system goes through /turn and the validated tool layer
 * (spec §37). That is the architecture's load-bearing rule: the LLM proposes,
 * the backend validates and commits, and `action_log` records it with an
 * inverse so "undo that" is real.
 *
 * The moment a UI exists, `POST /api/commitments` becomes the obvious
 * shortcut — it is less code, it feels RESTful, and it silently creates a
 * second write path that bypasses validation, the action log, and undo.
 * Nothing else in the codebase would fail if someone added it.
 *
 * So the prohibition is asserted mechanically rather than documented and
 * hoped for. This inspects Fastify's actual route table, not a list someone
 * maintains by hand.
 * ===========================================================================
 */
import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { buildServer } from "../server.js";
import { READ_ROUTES } from "./read.js";

function stubPool(): pg.Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
  } as unknown as pg.Pool;
}

function demoServer() {
  return buildServer(stubPool(), {
    enableDemoEndpoint: true,
    anthropicApiKey: "test-key-not-used",
    demoUserId: "11111111-1111-1111-1111-111111111111",
  });
}

/** Fastify's own printed route table, as lines. */
function registeredRoutes(app: ReturnType<typeof demoServer>): string[] {
  // Reading Fastify's OWN table is the point — a hand-maintained list would
  // drift from reality at exactly the moment it mattered.
  return app
    .printRoutes({ commonPrefix: false })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("("));
}

describe("read surfaces (§29)", () => {
  it("registers NO mutating route under /api", async () => {
    // ⚠ THE TEST THIS FILE EXISTS FOR. If this ever fails, someone has added
    // a second write path around the tool layer — read §37 before "fixing"
    // the test.
    const app = demoServer();
    await app.ready();

    const mutating = registeredRoutes(app).filter(
      (line) => /\b(POST|PUT|PATCH|DELETE)\b/.test(line) && line.includes("api"),
    );

    expect(mutating).toEqual([]);
    await app.close();
  });

  it("still exposes /turn and /undo — writes go THERE, not to /api", async () => {
    // The complement of the test above: proving no /api mutation exists is
    // only meaningful if the legitimate write path is still present.
    const app = demoServer();
    await app.ready();
    const routes = registeredRoutes(app).join("\n");
    expect(routes).toMatch(/turn/);
    expect(routes).toMatch(/undo/);
    await app.close();
  });

  it("registers every route in READ_ROUTES", async () => {
    const app = demoServer();
    await app.ready();
    const printed = registeredRoutes(app).join("\n");

    for (const route of READ_ROUTES) {
      // Fastify prints a tree with parameters as `:key`; compare on the last
      // distinctive segment so the assertion survives formatting changes.
      const segment = route.split("/").filter(Boolean).pop()!;
      expect(printed, `missing route: ${route}`).toContain(segment.replace(":", ""));
    }
    await app.close();
  });

  it("does NOT register the read surfaces when the demo flag is off", async () => {
    // Same guard as /turn and /undo, and for a stronger reason than symmetry:
    // these serve personal data with no authentication. A route that does not
    // exist cannot be reached.
    const app = buildServer(stubPool());
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/api/commitments" });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

/**
 * NOT TESTED HERE, deliberately: that `/api/entity-types/:key/records` 404s
 * an unknown type rather than returning an empty list.
 *
 * It needs a real database. `withTransaction` calls `pool.connect()`, and a
 * stub implementing only `query` yields a 500 from "pool.connect is not a
 * function" — which looks exactly like the route failing, and would have been
 * very easy to "fix" by relaxing the assertion to accept a 500. That would
 * have left a test that passes while asserting nothing about the behaviour it
 * names.
 *
 * The richer-stub alternative is worse: faking connect/release/BEGIN/COMMIT
 * means the test measures the mock rather than the route. So the assertion
 * lives in the integration suite, where a live pool exists.
 */
