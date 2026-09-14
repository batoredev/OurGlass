/**
 * Shared server-side wiring for the Route Handlers
 * (docs/DEPLOYMENT-DESIGN.md §1).
 *
 * SERVER-ONLY. Route Handlers never ship to the browser, so a Postgres
 * driver here is correct — the "apps/web must not import @ourglass/db" rule
 * is about CLIENT components, where it would land in the bundle.
 *
 * The pool is module-scoped and lazy because a Worker isolate serves many
 * requests: a pool per request would open a connection per call and exhaust
 * Supabase's limit under any real load. Module scope IS the isolate lifetime.
 */
import { createPool, withTransaction } from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";

type Pool = ReturnType<typeof createPool>;

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const url = process.env["DATABASE_URL"];
    if (!url) throw new Error("DATABASE_URL is required");
    pool = createPool(url);
  }
  return pool;
}

export const db = {
  withTransaction: <T>(fn: (tx: DatabaseTransaction) => Promise<T>) =>
    withTransaction(getPool(), fn),
};

export function read<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  return db.withTransaction(fn);
}

/**
 * The same guard the Fastify demo endpoint used, and for the same reason:
 * these serve personal data with no authentication, because Phase 7 owns the
 * permission model (§35). A route that refuses by default is stronger than
 * one that checks a flag it might forget.
 */
export function demoEnabled(): boolean {
  return process.env["ENABLE_DEMO_ENDPOINT"] === "true";
}
