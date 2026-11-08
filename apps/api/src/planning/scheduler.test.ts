import { describe, expect, it } from "vitest";
import {
  gaps,
  merge,
  planDay,
  suggestSlots,
  timeOfDayPreference,
  type FixedBlock,
  type IncomingInput,
  type PlannedBlock,
  type TaskInput,
} from "./scheduler.js";

const DAY = new Date("2026-11-09T00:00:00.000Z");
const at = (h: number, m = 0) => new Date(DAY.getTime() + (h * 60 + m) * 60_000);
const window = { dayStart: at(9), dayEnd: at(18) };
const meeting = (id: string, h1: number, h2: number, m1 = 0, m2 = 0): FixedBlock => ({ id, title: id, start: at(h1, m1), end: at(h2, m2) });
const task = (id: string, due: Date | null, minutes?: number): TaskInput => ({ id, title: id, due, ...(minutes ? { minutes } : {}) });

function overlaps(blocks: readonly PlannedBlock[]): boolean {
  const sorted = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  return sorted.some((block, i) => i > 0 && block.start < sorted[i - 1]!.end);
}

describe("interval helpers", () => {
  it("merges overlapping and touching intervals", () => {
    expect(merge([{ start: at(10), end: at(11) }, { start: at(11), end: at(12) }, { start: at(9), end: at(9, 30) }])).toEqual([
      { start: at(9), end: at(9, 30) },
      { start: at(10), end: at(12) },
    ]);
  });

  it("finds the free gaps around busy time", () => {
    expect(gaps(at(9), at(13), [{ start: at(10), end: at(11) }])).toEqual([
      { start: at(9), end: at(10) },
      { start: at(11), end: at(13) },
    ]);
  });
});

describe("planDay", () => {
  it("places the most urgent work first, around meetings with a buffer", () => {
    const plan = planDay(
      [meeting("Hult review", 10, 11)],
      [task("later", at(17)), task("overdue", at(8)), task("no deadline", null)],
      [],
      { ...window, now: at(9) },
    );
    const work = plan.blocks.filter((block) => block.kind === "task");
    expect(work.map((block) => block.id)).toEqual(["overdue", "later", "no deadline"]);
    expect(work[0]).toMatchObject({ start: at(9), end: at(9, 30) });
    // 9:30-9:50 is free but too short with the 10-min buffer before 10:00; next fit is after 11:10.
    expect(work[1]).toMatchObject({ start: at(11, 10), end: at(11, 40) });
    expect(plan.next?.id).toBe("overdue");
    expect(work[0]!.reason).toMatch(/overdue since/);
    expect(work[0]!.reason).toMatch(/estimated/);
  });

  it("starts from now, rounded up, never in the past", () => {
    const plan = planDay([], [task("a", null)], [], { ...window, now: at(13, 3) });
    expect(plan.blocks[0]).toMatchObject({ start: at(13, 5) });
  });

  it("lists what does not fit instead of squeezing it", () => {
    const plan = planDay([meeting("all day", 9, 18)], [task("a", null)], [], { ...window, now: at(9) });
    expect(plan.blocks.filter((block) => block.kind === "task")).toEqual([]);
    expect(plan.unplaced).toEqual([{ id: "a", title: "a", reason: "does not fit today (no deadline)" }]);
    expect(plan.next).toBeNull();
  });

  it("says when a slot ends after the deadline it serves", () => {
    const plan = planDay([meeting("m", 9, 12)], [task("a", at(11))], [], { ...window, now: at(9) });
    expect(plan.blocks.find((block) => block.id === "a")?.reason).toMatch(/this slot ends after it/);
  });

  it("nudges someone who runs late before their deadline today, and anyone overdue", () => {
    const incoming: IncomingInput[] = [
      { id: "article", who: "Barkha", what: "the article", due: at(16), lateBufferHours: 24 },
      { id: "draft", who: "Meera", what: "the draft", due: at(16), lateBufferHours: null },
      { id: "schema", who: "Arun", what: "the schema", due: at(-30), lateBufferHours: null },
    ];
    const plan = planDay([], [], incoming, { ...window, now: at(9) });
    const nudges = plan.blocks.filter((block) => block.kind === "nudge");
    expect(nudges.map((block) => block.title).sort()).toEqual(["Ask Arun about the schema", "Ask Barkha about the article"]);
    expect(nudges.find((block) => block.id === "article")?.reason).toMatch(/usually 24 h late/);
    expect(nudges.every((block) => block.end <= at(16))).toBe(true);
  });

  it("is deterministic: the same inputs give the same plan", () => {
    const run = () => planDay([meeting("m", 11, 12)], [task("b", at(15)), task("a", at(15))], [], { ...window, now: at(9) });
    expect(run()).toEqual(run());
    expect(run().blocks.filter((block) => block.kind === "task").map((block) => block.id)).toEqual(["a", "b"]);
  });
});

/** A small seeded generator, so a failing case can be replayed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("planDay — properties over 500 random days", () => {
  it("never double-books, stays in the working window, and accounts for every task", () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const next = random(seed);
      const minute = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo));
      const fixed: FixedBlock[] = Array.from({ length: minute(0, 6) }, (_, i) => {
        const start = minute(7 * 60, 19 * 60);
        return { id: `m${i}`, title: `m${i}`, start: at(0, start), end: at(0, start + minute(15, 120)) };
      });
      const tasks: TaskInput[] = Array.from({ length: minute(0, 10) }, (_, i) => ({
        id: `t${i}`,
        title: `t${i}`,
        due: next() < 0.3 ? null : at(0, minute(0, 24 * 60)),
        ...(next() < 0.5 ? { minutes: minute(10, 120) } : {}),
      }));
      const now = at(0, minute(8 * 60, 17 * 60));
      const plan = planDay(fixed, tasks, [], { ...window, now });

      const placed = plan.blocks.filter((block) => block.kind !== "meeting");
      // No placed block overlaps another, or a meeting.
      expect(overlaps(placed), `seed ${seed}`).toBe(false);
      for (const block of placed) {
        for (const m of fixed) expect(block.start < m.end && m.start < block.end, `seed ${seed}`).toBe(false);
        expect(block.start >= now && block.end <= window.dayEnd, `seed ${seed}`).toBe(true);
      }
      // Every task is placed exactly once or listed as not fitting.
      const accounted = [...placed.map((block) => block.id), ...plan.unplaced.map((item) => item.id)].sort();
      expect(accounted, `seed ${seed}`).toEqual(tasks.map((t) => t.id).sort());
    }
  });
});

describe("meeting slots that suit the other person", () => {
  it("reads a stated time of day — and refuses a contradiction", () => {
    expect(timeOfDayPreference(["Meera prefers morning meetings"])).toBe("morning");
    expect(timeOfDayPreference(["Dev likes calls in the afternoon"])).toBe("afternoon");
    expect(timeOfDayPreference(["Arun prefers morning meetings", "Arun prefers evening calls"])).toBeNull();
    expect(timeOfDayPreference(["Barkha runs in the morning"])).toBeNull();
  });

  it("offers one slot per day inside the preferred hours, around what is booked", () => {
    const days = [0, 1, 2, 3].map((d) => ({ dayStart: new Date(DAY.getTime() + d * 86_400_000) }));
    const slots = suggestSlots([{ start: at(9), end: at(10) }], {
      days,
      now: at(8),
      minutes: 30,
      preference: "morning",
    });
    expect(slots).toHaveLength(3);
    expect(slots[0]).toEqual({ start: at(10, 10), end: at(10, 40) });
    for (const slot of slots) {
      const hour = (slot.start.getTime() - DAY.getTime()) / 3_600_000 % 24;
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour + 0.5).toBeLessThanOrEqual(12);
    }
  });
});
