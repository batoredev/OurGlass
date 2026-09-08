/**
 * Connection and transaction primitives.
 *
 * CONFIG BOUNDARY (docs/PHASE-1-DESIGN.md §5): this package reads NO ambient
 * `process.env`. Every entry point takes an explicit connection string. Env
 * reading happens only at script entry points (apps/api's server bootstrap, the
 * migrate scripts) — never in here. That is what makes this package testable
 * against an arbitrary database without mutating global state.
 */
import pg from "pg";

/**
 * The minimal surface the repositories and the tool layer need.
 *
 * Structurally satisfied by both `pg.Pool` and `pg.PoolClient`, which is the whole
 * point: a repository function does not care whether it was handed a pool (one-shot)
 * or a checked-out client inside an open transaction. The tool layer's `ctx.tx` is
 * the latter — tools never open their own transaction, they receive one (§4.1).
 *
 * Deliberately NOT a query builder and NOT an ORM (docs/DECISIONS.md #1): this
 * schema is unusual exactly where a generator would fight it — bitemporal columns
 * applied by a plpgsql helper, a `regclass`-taking resolver, JSONB validated against
 * a runtime registry, and a DEFERRABLE unique index.
 */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

/**
 * `pg.Pool` and `pg.PoolClient` both satisfy `Queryable`, but TypeScript cannot see
 * that through `readonly unknown[]` vs pg's `any[]`. This asserts it once, here,
 * rather than at every call site.
 */
export type Transactable = pg.Pool;

export function createPool(connectionString: string): pg.Pool {
  if (!connectionString) {
    // Fail here rather than letting `pg` produce a confusing "connect ECONNREFUSED
    // ::1:5432" when an entry point forgot to read DATABASE_URL.
    throw new Error(
      "createPool requires a connection string. packages/db never reads process.env " +
        "— pass DATABASE_URL from the script entry point.",
    );
  }
  return new pg.Pool({ connectionString });
}

/**
 * Run `fn` inside a single transaction on one dedicated client.
 *
 * The tool layer's contract IS "commit in a transaction + append to action_log", and
 * undo applies every inverse for a turn in ONE transaction (§4.2). This is that
 * primitive. The client is always released, including on a failed ROLLBACK.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // A failed ROLLBACK means the connection is already broken; surfacing it
      // would mask the original error, which is the one worth reading.
    }
    throw error;
  } finally {
    client.release();
  }
}
