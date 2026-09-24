import { describe, expect, it } from "vitest";
import { DEFAULT_TURN_LIMITS, rejectOverLimit, turnLimits } from "./_rate-limit";

const NOW = new Date("2026-09-22T12:00:00Z");

/** A counter that answers per window, keyed by how far back it was asked to look. */
function counter(perMinute: number, perDay: number) {
  const asked: number[] = [];
  const count = async (since: Date) => {
    const back = NOW.getTime() - since.getTime();
    asked.push(back);
    return back <= 60_000 ? perMinute : perDay;
  };
  return { count, asked };
}

describe("the /api/turn spend cap", () => {
  it("lets a turn through under both limits", async () => {
    const { count } = counter(3, 40);
    expect(await rejectOverLimit(count, DEFAULT_TURN_LIMITS, NOW)).toBeNull();
  });

  it("defaults to the owner's budget — 10 a minute, 200 a day", () => {
    // Pinned on purpose: a change to the spend cap should be a decision someone
    // makes and writes down (docs/DECISIONS.md), not a side effect of a refactor.
    expect(DEFAULT_TURN_LIMITS).toEqual({ perMinute: 10, perDay: 200 });
  });

  it("refuses with 429 and Retry-After once the minute window is full", async () => {
    const { count } = counter(DEFAULT_TURN_LIMITS.perMinute, DEFAULT_TURN_LIMITS.perMinute);
    const response = await rejectOverLimit(count, DEFAULT_TURN_LIMITS, NOW);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("60");
    // The user is told nothing was saved — the refusal happens before the turn.
    expect(((await response?.json()) as { error: string }).error).toMatch(/nothing was saved/i);
  });

  it("refuses once the DAY is full even when the last minute was quiet", async () => {
    // The runaway-script case: slow and steady still hits a ceiling.
    const { count } = counter(0, DEFAULT_TURN_LIMITS.perDay);
    const response = await rejectOverLimit(count, DEFAULT_TURN_LIMITS, NOW);
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("3600");
  });

  it("looks back exactly one minute and one day", async () => {
    const { count, asked } = counter(0, 0);
    await rejectOverLimit(count, DEFAULT_TURN_LIMITS, NOW);
    expect(asked).toEqual([60_000, 86_400_000]);
  });

  it("reads limits from the environment, and a typo never removes the cap", () => {
    expect(turnLimits({})).toEqual(DEFAULT_TURN_LIMITS);
    expect(turnLimits({ TURN_LIMIT_PER_MINUTE: "5", TURN_LIMIT_PER_DAY: "50" })).toEqual({ perMinute: 5, perDay: 50 });
    // Garbage, negatives and decimals keep the default rather than disabling it.
    expect(turnLimits({ TURN_LIMIT_PER_MINUTE: "lots", TURN_LIMIT_PER_DAY: "-1" })).toEqual(DEFAULT_TURN_LIMITS);
    expect(turnLimits({ TURN_LIMIT_PER_MINUTE: "2.5" }).perMinute).toBe(DEFAULT_TURN_LIMITS.perMinute);
  });

  it("disables a window only on an explicit 0", async () => {
    const { count, asked } = counter(999, 0);
    const response = await rejectOverLimit(count, { perMinute: 0, perDay: 500 }, NOW);
    expect(response).toBeNull();
    expect(asked).toEqual([86_400_000]);
  });
});
