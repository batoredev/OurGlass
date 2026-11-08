/**
 * The day plan and meeting slots against real Postgres, on the seeded demo
 * week (ROADMAP Stage 3). CI only — the suite truncates every table.
 */
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool, truncateAll, users, withTransaction } from "@ourglass/db";
import { seedDemo } from "../demo/seed.js";
import { buildToolRegistry } from "../tools/index.js";
import { loadDayPlan, suggestMeetingSlots, WORK_END_HOUR, WORK_START_HOUR } from "./index.js";

const DATABASE_URL = process.env["DATABASE_URL"];
if (!DATABASE_URL && process.env["CI"]) {
  throw new Error("DATABASE_URL is unset in CI — the day-plan suite would silently skip.");
}
const suite = DATABASE_URL ? describe : describe.skip;

// Seeded at 06:00 UTC; planned at 06:30 UTC; the "day" is UTC.
const SEEDED = new Date("2026-11-09T06:00:00.000Z");
const NOW = new Date("2026-11-09T06:30:00.000Z");
const MIDNIGHT = new Date("2026-11-09T00:00:00.000Z");

suite("day plan (integration)", () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await truncateAll(pool);
    await withTransaction(pool, (tx) => users.ensureUser(tx, { displayName: "You" }));
    await seedDemo({ db: { withTransaction: (fn) => withTransaction(pool, fn) }, registry: buildToolRegistry() }, SEEDED);
  });

  it("plans what you owe, overdue first, inside working hours", async () => {
    const plan = await withTransaction(pool, (tx) => loadDayPlan(tx, NOW, MIDNIGHT, "UTC"));
    const work = plan.blocks.filter((block) => block.kind === "task");
    expect(work.map((block) => block.title)).toEqual(["feedback on the backend plan", "the venue quote"]);
    expect(work[0]!.reason).toMatch(/^overdue since/);
    expect(plan.next?.title).toBe("feedback on the backend plan");
    for (const block of work) {
      expect(block.start.getTime()).toBeGreaterThanOrEqual(MIDNIGHT.getTime() + WORK_START_HOUR * 3_600_000);
      expect(block.end.getTime()).toBeLessThanOrEqual(MIDNIGHT.getTime() + WORK_END_HOUR * 3_600_000);
    }
    // Work owed TO you is not on your list; no one's record says they run late yet.
    expect(plan.blocks.some((block) => block.title.includes("the article") && block.kind === "task")).toBe(false);
    expect(plan.blocks.filter((block) => block.kind === "nudge")).toEqual([]);
  });

  it("does not plan again what an accepted plan already booked", async () => {
    const first = await withTransaction(pool, (tx) => loadDayPlan(tx, NOW, MIDNIGHT, "UTC"));
    const feedback = first.blocks.find((block) => block.title === "feedback on the backend plan")!;
    await withTransaction(pool, (tx) =>
      tx.query(`INSERT INTO events (title, starts_at, ends_at) VALUES ($1, $2, $3)`, [
        "Focus: feedback on the backend plan",
        feedback.start,
        feedback.end,
      ]),
    );
    const again = await withTransaction(pool, (tx) => loadDayPlan(tx, NOW, MIDNIGHT, "UTC"));
    expect(again.blocks.filter((block) => block.kind === "task").map((block) => block.title)).toEqual(["the venue quote"]);
    expect(again.blocks.filter((block) => block.title === "Focus: feedback on the backend plan").map((b) => b.kind)).toEqual(["meeting"]);
  });

  it("plans around Google Calendar's busy times, without counting OurGlass's own copy twice", async () => {
    const nine = new Date("2026-11-09T09:00:00.000Z");
    const external = [{ id: "g-busy", title: "Dentist", start: nine, end: new Date("2026-11-09T12:00:00.000Z") }];
    const plan = await withTransaction(pool, (tx) => loadDayPlan(tx, NOW, MIDNIGHT, "UTC", external));
    expect(plan.blocks.find((block) => block.id === "google:g-busy")).toMatchObject({ kind: "meeting", title: "Dentist" });
    for (const block of plan.blocks.filter((b) => b.kind === "task")) {
      expect(block.end <= nine || block.start >= new Date("2026-11-09T12:10:00.000Z")).toBe(true);
    }
    // An event OurGlass itself put on Google shows once, not twice.
    await pool.query(
      `INSERT INTO events (title, starts_at, ends_at, google_event_id) VALUES ('Synced', '2026-11-09T13:00:00Z', '2026-11-09T13:30:00Z', 'g-mine')`,
    );
    const mirrored = [{ id: "g-mine", title: "Synced", start: new Date("2026-11-09T13:00:00Z"), end: new Date("2026-11-09T13:30:00Z") }];
    const again = await withTransaction(pool, (tx) => loadDayPlan(tx, NOW, MIDNIGHT, "UTC", mirrored));
    expect(again.blocks.filter((block) => block.title === "Synced")).toHaveLength(1);
  });

  it("offers Meera mornings, because she said she prefers them", async () => {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM people WHERE display_name = 'Meera'`);
    const suggestion = await withTransaction(pool, (tx) => suggestMeetingSlots(tx, rows[0]!.id, 30, NOW, MIDNIGHT, "UTC"));
    expect(suggestion?.preference).toBe("morning");
    expect(suggestion?.basis).toMatch(/^Meera prefers morning meetings \(you said so on/);
    expect(suggestion?.slots.length).toBe(3);
    for (const slot of suggestion!.slots) {
      const hour = slot.start.getUTCHours() + slot.start.getUTCMinutes() / 60;
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour + 0.5).toBeLessThanOrEqual(12);
    }
  });
});
