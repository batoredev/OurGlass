/**
 * Row Level Security — migration 017 (ROADMAP Stage 0).
 *
 * Pins three things against the real migrated schema:
 *   1. EVERY table in `public` has RLS enabled — including any a future
 *      migration adds, which must enable it in the same migration.
 *   2. EVERY view runs with the caller's rights, so it cannot read past RLS
 *      on its owner's behalf.
 *   3. It works: a role that is not the owner, even one GRANTED select, sees
 *      no rows through a table or a view and can write none — while the owner
 *      (the app) still reads and writes as before.
 *
 * The probe role is created inside a transaction that is rolled back, so it
 * never outlives the test (CREATE ROLE is transactional in Postgres).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, truncateAll } from "../src/index.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error("DATABASE_URL is unset in CI — the RLS suite would silently skip.");
}
const suite = DATABASE_URL ? describe : describe.skip;

suite("row level security (integration)", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  it("is enabled on every table in public", async () => {
    const { rows } = await pool.query<{ table: string }>(
      `SELECT c.relname AS table
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
        ORDER BY 1`,
    );
    expect(rows.map((row) => row.table)).toEqual([]);
  });

  it("every view in public runs with the caller's rights", async () => {
    const { rows } = await pool.query<{ view: string }>(
      `SELECT c.relname AS view
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v'
          AND NOT coalesce('security_invoker=true' = ANY (c.reloptions), false)
        ORDER BY 1`,
    );
    expect(rows.map((row) => row.view)).toEqual([]);
  });

  it("a non-owner sees no rows and can write none, even with grants; the owner is unaffected", async () => {
    await pool.query(`INSERT INTO messages (role, body) VALUES ('user', 'Barkha owes me the article')`);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE ROLE og_rls_probe NOLOGIN");
      await client.query("GRANT USAGE ON SCHEMA public TO og_rls_probe");
      await client.query("GRANT SELECT, INSERT ON messages, messages_current TO og_rls_probe");
      await client.query("SET LOCAL ROLE og_rls_probe");

      const table = await client.query("SELECT body FROM messages");
      const view = await client.query("SELECT body FROM messages_current");
      expect(table.rows).toEqual([]);
      expect(view.rows).toEqual([]);

      await client.query("SAVEPOINT write_attempt");
      await expect(client.query(`INSERT INTO messages (role, body) VALUES ('user', 'x')`)).rejects.toThrow(
        /row-level security/i,
      );
      await client.query("ROLLBACK TO SAVEPOINT write_attempt");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    // The owner — the app's role — still sees its row, through table and view.
    const owner = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM messages_current");
    expect(owner.rows[0]!.n).toBe(1);
  });
});
