import { describe, expect, it } from "vitest";
import { composeEvening, composeMorning, dueBrief, localClock } from "./compose.js";

const at = (iso: string) => new Date(iso);

describe("localClock and dueBrief — the right brief, in its window, never late", () => {
  it("reads the owner's local date, hour and weekday", () => {
    // 02:45 UTC on Mon 9 Nov is 08:15 in Kolkata.
    expect(localClock(at("2026-11-09T02:45:00Z"), "Asia/Kolkata")).toEqual({ date: "2026-11-09", hour: 8, weekday: 1 });
    // ...and 21:00 UTC on Sun 8 Nov is already Monday there.
    expect(localClock(at("2026-11-08T21:00:00Z"), "Asia/Kolkata").date).toBe("2026-11-09");
  });

  it("is due in its window, once", () => {
    const clock = { date: "2026-11-09", hour: 8, weekday: 1 };
    expect(dueBrief(clock, new Set())).toEqual({ kind: "morning", key: "morning:2026-11-09" });
    expect(dueBrief(clock, new Set(["morning:2026-11-09"]))).toBeNull();
    expect(dueBrief({ ...clock, hour: 19 }, new Set(["morning:2026-11-09"]))).toEqual({ kind: "evening", key: "evening:2026-11-09" });
  });

  it("stays quiet outside the windows — a morning brief at 4 pm is noise", () => {
    for (const hour of [0, 6, 7, 12, 15, 17, 21, 23]) {
      expect(dueBrief({ date: "2026-11-09", hour, weekday: 1 }, new Set()), `hour ${hour}`).toBeNull();
    }
  });
});

describe("composeMorning", () => {
  const timeZone = "UTC";
  it("lists meetings with who, the first thing, and what is owed — facts only", () => {
    const text = composeMorning({
      timeZone,
      meetings: [{ title: "Coffee with Meera", start: at("2026-11-09T10:00:00Z"), people: [{ name: "Meera", line: "Owes you: the poster draft (due 11 Nov 2026)." }] }],
      first: { title: "feedback on the backend plan", at: at("2026-11-09T09:00:00Z"), reason: "overdue since 7 Nov" },
      youOwe: [{ what: "feedback on the backend plan", who: "Arun", overdue: true }],
      dueToYou: [{ what: "the article", who: "Barkha" }],
      reminders: [{ body: "Ask Barkha for the article", at: at("2026-11-09T11:00:00Z") }],
    });
    expect(text.split("\n")).toEqual([
      "Morning summary:",
      "• 10:00 Coffee with Meera",
      "  Meera: Owes you: the poster draft (due 11 Nov 2026).",
      "First: feedback on the backend plan at 09:00 — overdue since 7 Nov.",
      "You owe: feedback on the backend plan (Arun) — overdue.",
      "Due to you: the article (Barkha).",
      "Reminders: 11:00 Ask Barkha for the article.",
    ]);
  });

  it("says plainly when the day is empty, and adds last week on Mondays", () => {
    expect(composeMorning({ timeZone, meetings: [], first: null, youOwe: [], dueToYou: [], reminders: [] })).toBe(
      "Morning summary:\nNothing on record for today.",
    );
    const monday = composeMorning({
      timeZone,
      meetings: [],
      first: null,
      youOwe: [],
      dueToYou: [],
      reminders: [],
      week: { finished: 3, slipped: [{ what: "the schema", who: "Arun" }], quiet: [{ name: "Dev", since: "12 Oct" }] },
    });
    expect(monday).toContain("Last week: 3 finished; slipped: the schema (Arun).");
    expect(monday).toContain("Quiet for a while, with something open: Dev (since 12 Oct).");
  });
});

describe("composeEvening", () => {
  it("says what was done, what is still open from today, and tomorrow", () => {
    const text = composeEvening({
      timeZone: "UTC",
      done: [{ what: "the article", who: "Barkha" }],
      stillOpen: [{ what: "the venue quote", who: "Dev" }],
      tomorrow: [{ title: "Hult poster review", start: at("2026-11-10T09:00:00Z"), people: [] }],
    });
    expect(text.split("\n")).toEqual([
      "Evening summary:",
      "Done today: the article (Barkha).",
      "Still open from today: the venue quote (Dev).",
      "Tomorrow: 09:00 Hult poster review.",
    ]);
    expect(composeEvening({ timeZone: "UTC", done: [], stillOpen: [], tomorrow: [] })).toBe(
      "Evening summary:\nNothing was marked done today.",
    );
  });
});
