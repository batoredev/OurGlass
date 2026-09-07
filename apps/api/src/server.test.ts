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
