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
import { createPool, users, withTransaction } from "@ourglass/db";
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

let cachedUserId: string | null = null;

/**
 * The bootstrap user, resolved once per isolate and cached.
 *
 * Moved here from turn/route.ts when the upload route (Phase 6) needed the
 * same id — one declaration, not two. A missing user row is a DEPLOYMENT
 * fault, not a conversational one: ensureUser creates it rather than a
 * caller defaulting a timezone and replying hours wrong.
 */
export async function bootstrapUserId(): Promise<string> {
  if (!cachedUserId) {
    const account = await db.withTransaction((tx) => users.ensureUser(tx, { displayName: "You" }));
    cachedUserId = account.user.id;
  }
  return cachedUserId;
}

// Access control lives in `_auth.ts` (`authorize`), not here: it must be
// testable without this module's Postgres pool.
