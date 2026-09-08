/**
 * Test isolation: TRUNCATE between tests. THE shared helper — one copy, here.
 *
 * WHY TRUNCATE AND NOT TRANSACTION-PER-TEST (docs/PHASE-1-DESIGN.md §5):
 *
 * The tool layer's contract IS "commit in a transaction + append to action_log", and
 * undo applies every inverse for a turn in a single transaction. Wrapping each test
 * in an outer transaction means the code under test runs in a NESTED transaction that
 * behaves differently from production — you would be testing savepoint semantics
 * rather than the shipped path. A strategy that cannot exercise the primary contract
 * is a blind spot, not isolation.
 *
 * The cost is real and accepted: TRUNCATE is slower than ROLLBACK. That is the price
 * of testing the actual commit path.
 *
 * RESTART IDENTITY resets `action_log.id` (bigserial) so an order-dependent undo test
 * cannot pass on a fresh database and fail on a re-run — the flake class that makes a
 * suite untrustworthy exactly when it starts failing for real reasons.
 *
 * CASCADE is required, not optional: `commitments` references `people`, and Postgres
 * refuses to truncate a referenced table without it. Listing every table in one
 * statement (rather than one TRUNCATE per table) also means no FK ordering to keep
 * in sync as tables are added.
 */
import type { Queryable } from "../client.js";

/**
 * Every table carrying test data, in one statement.
 *
 * Deliberately a literal list rather than a query over `pg_tables`: a dynamic list
 * would silently start truncating a future table that a test intended to seed once,
 * and it would interpolate identifiers from a query result into DDL. If you add a
 * table, add it here — the compiler will not remind you, but the reviewer will.
 */
export const TRUNCATABLE_TABLES = [
  "action_log",
  "entity_records",
  "entity_type_fields",
  "entity_types",
  "relationships",
  "reminders",
  "events",
  "messages",
  "commitments",
  "projects",
  "people",
  "organizations",
  "users",
] as const;

/**
 * Reset the database to empty between tests.
 *
 * Safe to call against any database this package can reach; it is the caller's job
 * not to point it at one that matters. Test entry points read DATABASE_URL — this
 * package reads no env of its own (§5 config boundary), which is exactly why this
 * helper cannot check whether it is about to truncate production. Point it at a test
 * database.
 */
export async function truncateAll(tx: Queryable): Promise<void> {
  await tx.query(
    `TRUNCATE ${TRUNCATABLE_TABLES.join(", ")} RESTART IDENTITY CASCADE`,
  );
}
