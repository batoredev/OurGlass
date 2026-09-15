/**
 * `events.findOverlapping` — §24's conflict detector, against real SQL.
 *
 * ================================ READ THIS ================================
 * THIS QUERY HAD NO TEST, AND IT WAS WRONG.
 *
 * It built each side of the overlap check as
 * `tstzrange(starts_at, COALESCE(ends_at, starts_at), '[)')`. With no end
 * time that is `[t, t)` — lower bound included, upper excluded, same instant —
 * which is the EMPTY RANGE. An empty range overlaps nothing, so any event
 * without an end time could never conflict with anything.
 *
 * Every event the assistant creates has no end time: it does not invent a
 * duration the user never stated. So §24 returned nothing for the one shape
 * it exists to catch, and nothing failed anywhere — `proactive.test.ts`
 * exercises `detectTimeConflicts` against a fake transaction and never
 * reaches this SQL, which is exactly how a wrong query stays green.
 *
 * The rule this file enforces: a query whose only tests use a fake `tx` is an
 * untested query.
 * ===========================================================================
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool, events, truncateAll, withTransaction } from "../src/index.js";

const DATABASE_URL = process.env["DATABASE_URL"];

// A skipped suite and a passing suite are indistinguishable in a CI summary
// line, and this file is the only coverage of the conflict predicate.
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error(
    "DATABASE_URL is unset in CI — events.findOverlapping (§24) would silently skip.",
  );
}

const suite = DATABASE_URL ? describe : describe.skip;

/** A fixed instant, so nothing here races the wall clock. */
const FIVE_PM = new Date("2026-03-05T17:00:00.000Z");
const at = (offsetMinutes: number) => new Date(FIVE_PM.getTime() + offsetMinutes * 60_000);

suite("events.findOverlapping", () => {
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

  const seed = (title: string, startsAt: Date | null, endsAt: Date | null = null) =>
    withTransaction(pool, (tx) => events.createEvent(tx, { title, startsAt, endsAt }));

  const overlapping = (startsAt: Date, endsAt: Date | null = null) =>
    withTransaction(pool, (tx) => events.findOverlapping(tx, startsAt, endsAt, null));

  it("THE BUG: two open-ended events at the same instant DO conflict", async () => {
    await seed("Hult review", FIVE_PM);

    const found = await overlapping(FIVE_PM);

    expect(found.map((row) => row.title)).toEqual(["Hult review"]);
  });

  it("an open-ended event conflicts with a ranged one that contains it", async () => {
    await seed("Hult review", FIVE_PM, at(60));

    expect((await overlapping(at(30))).map((row) => row.title)).toEqual(["Hult review"]);
  });

  it("a ranged event conflicts with an open-ended one inside it", async () => {
    await seed("Hult review", at(30));

    expect((await overlapping(FIVE_PM, at(60))).map((row) => row.title)).toEqual(["Hult review"]);
  });

  it("BACK-TO-BACK IS NOT A CONFLICT — the half-open bound still does its job", async () => {
    // The fix must not turn every adjacent meeting into a collision. A real
    // range keeps '[)', so [5:00, 6:00) excludes 6:00 and a 6:00 start is free.
    // A false conflict is worse than none: it trains the user to dismiss the
    // surface entirely.
    await seed("Hult review", FIVE_PM, at(60));

    expect(await overlapping(at(60))).toEqual([]);
  });

  it("a different time does not conflict", async () => {
    await seed("Hult review", FIVE_PM);

    expect(await overlapping(at(60))).toEqual([]);
  });

  it("an unscheduled event cannot conflict with anything", async () => {
    await seed("Someday: the retro", null);

    expect(await overlapping(FIVE_PM)).toEqual([]);
  });

  it("excludes the named event, so rescheduling does not collide with itself", async () => {
    const existing = await seed("Hult review", FIVE_PM);

    const found = await withTransaction(pool, (tx) =>
      events.findOverlapping(tx, FIVE_PM, null, existing.id),
    );
    expect(found).toEqual([]);
  });

  it("ignores an invalidated event", async () => {
    // Bitemporal: undoing the turn that created an event must stop it
    // conflicting, without deleting the row.
    const existing = await seed("Hult review", FIVE_PM);
    await withTransaction(pool, (tx) => events.invalidateEvent(tx, existing.id));

    expect(await overlapping(FIVE_PM)).toEqual([]);
  });
});
