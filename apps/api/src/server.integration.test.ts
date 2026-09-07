/**
 * Requires a live Postgres reachable via DATABASE_URL (CI's service
 * container, or `docker compose up postgres` locally). Run via
 * `pnpm --filter @ourglass/api test:integration`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { buildServer } from "./server.js";

describe("GET /health (integration)", () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;

  beforeAll(() => {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL must be set for integration tests");
    }
    pool = new pg.Pool({ connectionString });
    app = buildServer(pool);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("reports db: true when Postgres is reachable", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: "api", db: true });
  });
});
