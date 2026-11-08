/**
 * `pnpm db:seed-demo` — fill an EMPTY local database with the demo week
 * (seed.ts). Costs nothing: no model is called.
 *
 * Refuses a database that is not on this machine unless `--allow-remote` is
 * given, because the seed writes rows a real user would see. Use that flag only
 * for a dedicated demo project, never the one that holds your own data. The
 * seed itself also refuses any database that already holds people.
 */
import { createPool, withTransaction } from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";
import { buildToolRegistry } from "../tools/index.js";
import { seedDemo } from "./seed.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

async function main(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host) && !process.argv.includes("--allow-remote")) {
    throw new Error(
      `DATABASE_URL points at ${host}, not this machine. The demo seed writes rows a user would see; ` +
        "pass --allow-remote only for a dedicated demo project.",
    );
  }

  const pool = createPool(connectionString);
  try {
    const result = await seedDemo({
      db: { withTransaction: <T>(fn: (tx: DatabaseTransaction) => Promise<T>) => withTransaction(pool, fn) },
      registry: buildToolRegistry(),
    });
    console.log(
      `Seeded ${result.people} people and ${result.commitments} commitments, plus a reminder, two meetings, ` +
        `three thoughts and two memories (turn ${result.turnId}). Undo it from the Activity page.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
