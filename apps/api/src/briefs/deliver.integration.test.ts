/**
 * Brief delivery against real Postgres (ROADMAP Stage 5): due only in its
 * window, built from the seeded week, and idempotent per day — even when two
 * scheduled passes race. CI only — the suite truncates every table.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool, truncateAll, users, withTransaction } from "@ourglass/db";
import { seedDemo } from "../demo/seed.js";
import { buildToolRegistry } from "../tools/index.js";
import { deliverDueBrief } from "./deliver.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error("DATABASE_URL is unset in CI — the brief-delivery suite would silently skip.");
}
const suite = DATABASE_URL ? describe : describe.skip;

// The account's zone is UTC here, so the windows are 08-12 and 18-21 UTC.
const SEEDED = new Date("2026-11-09T06:00:00.000Z"); // a Monday
const MORNING = new Date("2026-11-09T08:05:00.000Z");

suite("brief delivery (integration)", () => {
  let pool: pg.Pool;
  const deps = () => ({ db: { withTransaction: <T,>(fn: Parameters<typeof withTransaction<T>>[1]) => withTransaction(pool, fn) } });
  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await truncateAll(pool);
    await withTransaction(pool, (tx) => users.ensureUser(tx, { displayName: "You", timezone: "UTC" }));
    await seedDemo({ db: { withTransaction: (fn) => withTransaction(pool, fn) }, registry: buildToolRegistry() }, SEEDED);
  });

  const briefs = async () =>
    (await pool.query<{ body: string; key: string }>(`SELECT body, trace->>'brief' AS key FROM messages WHERE trace->>'brief' IS NOT NULL`)).rows;

  it("delivers the morning brief once, from stored facts, with last week on a Monday", async () => {
    expect(await deliverDueBrief(deps(), MORNING)).toBe("morning:2026-11-09");
    expect(await deliverDueBrief(deps(), new Date(MORNING.getTime() + 60_000))).toBeNull();
    const [brief] = await briefs();
    expect(brief!.key).toBe("morning:2026-11-09");
    expect(brief!.body).toMatch(/^Morning summary:/);
    expect(brief!.body).toContain("You owe: feedback on the backend plan (Arun) — overdue");
    expect(brief!.body).toContain("Due to you: the article (Barkha)");
    expect(brief!.body).toContain("Last week:");
  });

  it("is idempotent even when two passes race", async () => {
    const results = await Promise.all([deliverDueBrief(deps(), MORNING), deliverDueBrief(deps(), MORNING)]);
    expect(results.filter((key) => key !== null)).toHaveLength(1);
    expect(await briefs()).toHaveLength(1);
  });

  it("stays quiet outside the windows, and sends the evening review in its own", async () => {
    expect(await deliverDueBrief(deps(), new Date("2026-11-09T15:00:00.000Z"))).toBeNull();
    expect(await deliverDueBrief(deps(), new Date("2026-11-09T18:30:00.000Z"))).toBe("evening:2026-11-09");
    const [evening] = await briefs();
    expect(evening!.body).toMatch(/^Evening summary:/);
  });
});
