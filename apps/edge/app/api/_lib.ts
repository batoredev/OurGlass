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
    // DATABASE_URL when set explicitly; otherwise the connection string every
    // Supabase Edge Function is given automatically.
    const url = process.env["DATABASE_URL"] || process.env["SUPABASE_DB_URL"];
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

/**
 * Today, in the USER'S timezone, as [start, end) instants.
 *
 * The Edge Function runs in UTC; "today" for a user in Asia/Kolkata starts at
 * 18:30 UTC the day before. Computed from the zone's offset at `now`, which is
 * exact except on a DST-change day, where it can be off by that hour.
 */
export function localDayWindow(now: Date, timeZone: string): { start: Date; end: Date } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const localAsUtc = Date.UTC(parts["year"]!, parts["month"]! - 1, parts["day"]!, parts["hour"]!, parts["minute"]!, parts["second"]!);
  const offsetMs = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const start = new Date(Date.UTC(parts["year"]!, parts["month"]! - 1, parts["day"]!) - offsetMs);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** The bootstrap user's IANA timezone. */
export async function userTimeZone(): Promise<string> {
  const id = await bootstrapUserId();
  const account = await db.withTransaction((tx) => users.getUserWithPerson(tx, id));
  return account?.user.timezone ?? "UTC";
}
