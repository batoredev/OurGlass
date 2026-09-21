/**
 * The read surfaces must agree with the reply about how precise a time is.
 *
 * A commitment created from "by Friday" is stored at the last millisecond of
 * Friday, because that is the honest reading of a deadline with no clock time
 * (apps/api/src/assistant/time.ts, END_OF_DAY). Chat says "by Friday,
 * September 25". A card beside it saying "Fri, 25 Sept, 11:59 pm" would
 * invent precision the conversation never had — the same defect the resolver
 * fix removed, re-introduced one layer up.
 */
import { describe, expect, it } from "vitest";
import { statusLabel, when } from "./surface";

/** Local time, so the assertion does not depend on the runner's zone. */
function localIso(year: number, month: number, day: number, h: number, m: number, s = 0, ms = 0) {
  return new Date(year, month - 1, day, h, m, s, ms).toISOString();
}

describe("when", () => {
  it("prints the DAY alone for an end-of-day instant", () => {
    const rendered = when(localIso(2026, 9, 25, 23, 59, 59, 999));
    expect(rendered).toContain("Sep");
    expect(rendered).toContain("25");
    expect(rendered).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("keeps the clock time when the user gave one", () => {
    expect(when(localIso(2026, 9, 25, 17, 0))).toMatch(/\d{1,2}:\d{2}/);
    // One millisecond before the sentinel is an ordinary time, not a day.
    expect(when(localIso(2026, 9, 25, 23, 59, 59, 998))).toMatch(/\d{1,2}:\d{2}/);
  });

  it("never renders an empty cell", () => {
    expect(when(null)).toBe("No date");
    expect(when("not-a-date")).toBe("No date");
  });
});

describe("statusLabel", () => {
  it("reads a stored enum as words", () => {
    expect(statusLabel("completed_late")).toBe("Completed late");
    expect(statusLabel("pending")).toBe("Pending");
  });
});
