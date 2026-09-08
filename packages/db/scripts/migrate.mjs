/**
 * Migration entry point — `pnpm db:migrate` and `pnpm db:reset`.
 *
 * THIS is a script entry point, so THIS is where `process.env` is read
 * (docs/PHASE-1-DESIGN.md §5 config boundary). `packages/db/src/**` reads none.
 *
 * Uses node-pg-migrate@9 programmatically rather than via its CLI: the CLI would need
 * its own flag plumbing for the same three inputs, and calling the exported `runner`
 * keeps the reset-then-migrate sequence in one process with one connection config.
 *
 * FORWARD-ONLY. node-pg-migrate has no built-in down-migration for raw SQL files, and
 * that is the accepted model for a greenfield repo with no production data (§5).
 * `db:reset` is the rollback. Production rollback (Phase 7+) is a compensating
 * FORWARD migration, not a down script. Recorded so this is not later mistaken for a
 * defect.
 *
 * Usage:
 *   node --env-file-if-exists=.env scripts/migrate.mjs          # migrate up
 *   node --env-file-if-exists=.env scripts/migrate.mjs --reset  # drop schema, migrate up
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
// NAMED export, not default: node-pg-migrate@9 exports { runner, Migration, ... }
// and has NO default export. `import runner from "node-pg-migrate"` yields undefined
// and fails at call time, not import time. Verified against the installed package.
import { runner } from "node-pg-migrate";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "  Local: copy .env.example to .env (its defaults already match " +
      "docker-compose.yml) and start Postgres with `docker compose up -d postgres`.\n" +
      "  CI: the integration job sets it as a job-level env key.",
  );
  process.exit(1);
}

const reset = process.argv.includes("--reset");

/**
 * DESTRUCTIVE, and deliberately narrow: drops `public` and the migrations bookkeeping
 * table, then rebuilds from migration 001. Only reachable via `db:reset`, never as a
 * side effect of `db:migrate`.
 *
 * This is also what re-establishes `CREATE EXTENSION vector` for free: migration 001
 * is the single mechanism that creates it, so a reset exercises the same path a fresh
 * clone does. There is no other mechanism — the previously-explicit step in
 * .github/workflows/ci.yml was deleted in the same commit as migration 001
 * (docs/DECISIONS.md #8).
 */
async function dropSchema(client) {
  // Extensions live in `public` here, so dropping it drops `vector` too — which is
  // the point: reset must prove migration 001 can recreate it from nothing.
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query("DROP TABLE IF EXISTS pgmigrations");
}

async function main() {
  if (reset) {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await dropSchema(client);
      console.log("schema dropped");
    } finally {
      await client.end();
    }
  }

  const applied = await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: "up",
    migrationsTable: "pgmigrations",
    // Plain numbered .sql files, not JS migrations (§5).
    // `log` is silenced to a plain console so migration output is readable in CI.
    log: (msg) => console.log(msg),
    verbose: false,
  });

  if (applied.length === 0) {
    console.log("no pending migrations");
  } else {
    console.log(`applied ${applied.length} migration(s):`);
    for (const m of applied) console.log(`  ${m.name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
