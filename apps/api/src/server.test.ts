/**
 * Unit test — no live database. Uses a stub pool so `pnpm test` runs in CI
 * without the Postgres service container (that's what
 * server.integration.test.ts is for).
 */
import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { buildServer } from "./server.js";

function stubPool(): pg.Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
  } as unknown as pg.Pool;
}

describe("GET /health (unit)", () => {
  it("returns ok:true and db:true when the pool query resolves ok:1", async () => {
    const app = buildServer(stubPool());
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: "api", db: true });

    await app.close();
  });
});

/**
 * The demo endpoint's guards (docs/PHASE-3-DESIGN.md §9).
 *
 * These are a SECURITY boundary, not a feature flag: /turn is an
 * unauthenticated write endpoint that spends model tokens on whatever it is
 * sent. .claude/rules/security.md treats that input as untrusted, and Phase 7
 * owns the real permission model (§35). Until then the guarantee is "the
 * route does not exist", which is stronger than "the route exists and checks
 * a flag" — so it is worth a test that would fail if someone reversed the
 * default while making the demo easier to run.
 *
 * The third guard, loopback binding, lives in `main()` and is not reachable
 * from `buildServer`. It is verified by reading the code, not here — noted so
 * the gap is explicit rather than assumed covered.
 */
describe("demo endpoint guards (§9)", () => {
  it("does NOT register /turn or /undo by default", async () => {
    const app = buildServer(stubPool());

    // 404, not 401 or 400: the route genuinely is not registered.
    const turn = await app.inject({ method: "POST", url: "/turn", payload: { utterance: "hi" } });
    const undo = await app.inject({ method: "POST", url: "/undo", payload: { turnId: "x" } });
    expect(turn.statusCode).toBe(404);
    expect(undo.statusCode).toBe(404);

    await app.close();
  });

  it("refuses to BUILD without an API key when the demo endpoint is on", () => {
    // At startup, not at first request. Discovering a missing key mid-demo,
    // after typing a sentence, is the worst moment to find out.
    expect(() => buildServer(stubPool(), { enableDemoEndpoint: true, demoUserId: "u" })).toThrow(
      /ANTHROPIC_API_KEY is required/,
    );
  });

  it("refuses to build without a bootstrap user", () => {
    expect(() =>
      buildServer(stubPool(), { enableDemoEndpoint: true, anthropicApiKey: "k" }),
    ).toThrow(/demoUserId is required/);
  });

  it("registers /turn and rejects an empty utterance without calling a model", async () => {
    // A key string is required to construct the clients, but no request
    // reaches Anthropic: validation rejects before runTurn is called. If this
    // ever starts making a network call it will be obvious — it will get slow
    // and start failing without a real key in the environment.
    const app = buildServer(stubPool(), {
      enableDemoEndpoint: true,
      anthropicApiKey: "test-key-not-used",
      demoUserId: "11111111-1111-1111-1111-111111111111",
    });

    const empty = await app.inject({ method: "POST", url: "/turn", payload: { utterance: "  " } });
    expect(empty.statusCode).toBe(400);

    const missing = await app.inject({ method: "POST", url: "/undo", payload: {} });
    expect(missing.statusCode).toBe(400);

    await app.close();
  });
});
