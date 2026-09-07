/**
 * Batore Personal Assistant — API entry point.
 *
 * Phase 0: a minimal Fastify server with a /health route that round-trips
 * through Postgres, so CI's integration job and `docker compose up` have a
 * real, non-trivial thing to verify. Phase 1 (docs/PHASES.md) replaces this
 * with the schema, migrations, and the typed tool registry.
 */
import Fastify from "fastify";
import pg from "pg";
import type { HealthCheck } from "@ourglass/shared";

export function buildServer(pool: pg.Pool) {
  const app = Fastify({ logger: true });

  app.get("/health", async (): Promise<HealthCheck & { db: boolean }> => {
    const result = await pool.query("SELECT 1 AS ok");
    return { ok: true, service: "api", db: result.rows[0]?.ok === 1 };
  });

  return app;
}

async function main() {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new pg.Pool({ connectionString });
  const app = buildServer(pool);

  const port = Number(process.env["PORT"] ?? 3001);
  await app.listen({ port, host: "0.0.0.0" });
}

// Only auto-start when run directly (not when imported by tests).
if (process.env["VITEST"] !== "true") {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
