import { describe, expect, it } from "vitest";
import { resolveTime, timeDirectionForIntent } from "./time.js";

const now = new Date("2026-09-09T08:00:00.000Z"); // Wed 13:30 Asia/Kolkata

describe("resolveTime", () => {
  it("resolves a verbatim deterministic phrase in the user's timezone", () => {
    expect(resolveTime({ kind: "deterministic", sourcePhrase: "tomorrow at 5pm" }, now, "Asia/Kolkata", "forward")).toEqual({
      tier: "deterministic",
      sourcePhrase: "tomorrow at 5pm",
      at: "2026-09-10T11:30:00.000Z",
    });
  });

  it("does not invent a timestamp for relational or event-trigger time", () => {
    expect(resolveTime({ kind: "relational", sourcePhrase: "before the meeting" }, now, "Asia/Kolkata", "forward")).toEqual({
      tier: "relational", sourcePhrase: "before the meeting", relation: "before", target: "the meeting",
    });
    expect(resolveTime({ kind: "event_trigger", sourcePhrase: "after Arun replies" }, now, "Asia/Kolkata", "forward")).toEqual({
      tier: "event_trigger", sourcePhrase: "after Arun replies", event: "after Arun replies",
    });
  });

  it("fails honestly for an invalid timezone or unknown phrase", () => {
    expect(resolveTime({ kind: "deterministic", sourcePhrase: "later" }, now, "Asia/Kolkata", "forward")).toMatchObject({
      tier: "unresolved", reason: "unparseable",
    });
    expect(() => resolveTime({ kind: "deterministic", sourcePhrase: "tomorrow" }, now, "not/a-zone", "forward")).toThrow("Invalid IANA timezone");
  });
});

/**
 * REGRESSION — DST. The offset used to be sampled once at `now` and handed to
 * chrono as a fixed number, so any phrase resolving ACROSS a DST boundary came
 * back exactly one hour wrong. Latent while Asia/Kolkata (no DST) is the only
 * timezone, and active the moment a second one exists — which
 * docs/PHASE-1-DESIGN.md §2.2 explicitly designs for.
 *
 * Every `produced` value below was measured against the pre-fix code.
 */
describe("resolveTime across DST boundaries", () => {
  const cases = [
    {
      zone: "America/New_York",
      phrase: "next Monday at 9am",
      from: "2026-10-30T12:00:00.000Z", // Fri Oct 30, before Nov 1 fall-back
      correct: "2026-11-02T14:00:00.000Z",
      producedByOldCode: "2026-11-02T13:00:00.000Z",
    },
    {
      zone: "America/New_York",
      phrase: "Monday at 9am",
      from: "2026-03-06T12:00:00.000Z", // Fri Mar 6, before Mar 8 spring-forward
      correct: "2026-03-09T13:00:00.000Z",
      producedByOldCode: "2026-03-09T14:00:00.000Z",
    },
    {
      zone: "Europe/London",
      phrase: "Monday at 9am",
      from: "2026-10-23T09:00:00.000Z", // Fri Oct 23, before Oct 25 BST->GMT
      correct: "2026-10-26T09:00:00.000Z",
      producedByOldCode: "2026-10-26T08:00:00.000Z",
    },
  ] as const;

  for (const { zone, phrase, from, correct, producedByOldCode } of cases) {
    it(`${zone}: "${phrase}" from ${from} resolves to ${correct}`, () => {
      const resolved = resolveTime(
        { kind: "deterministic", sourcePhrase: phrase },
        new Date(from),
        zone,
        "forward",
      );
      expect(resolved).toMatchObject({ tier: "deterministic", at: correct });
      // Pin the specific wrong answer so a regression is unmistakable rather
      // than just "some other timestamp".
      expect(resolved).not.toMatchObject({ at: producedByOldCode });
    });
  }

  it("does not regress a zone without DST (Asia/Kolkata control)", () => {
    expect(resolveTime({ kind: "deterministic", sourcePhrase: "tomorrow at 5pm" }, now, "Asia/Kolkata", "forward")).toMatchObject({
      at: "2026-09-10T11:30:00.000Z",
    });
  });
});

/**
 * REGRESSION — forwardDate dated past-tense completions into the FUTURE.
 *
 * `forwardDate: true` was hardcoded, which is right for a reminder ("at 5" means
 * the next 5) and wrong for spec §5's own completion example, "Barkha gave the
 * article at 11" — past tense, dated to TOMORROW. Spec §20's lateness maths
 * ("expected 6 PM, actual 11 PM, five hours late") then ran against a future
 * timestamp, and "last Friday" resolved to a FUTURE Friday.
 */
describe("resolveTime direction", () => {
  const past = (phrase: string) => resolveTime({ kind: "deterministic", sourcePhrase: phrase }, now, "Asia/Kolkata", "past");
  const forward = (phrase: string) => resolveTime({ kind: "deterministic", sourcePhrase: phrase }, now, "Asia/Kolkata", "forward");

  it("resolves completion phrases backwards, never into the future", () => {
    // Reference is Wed 2026-09-09 13:30 IST.
    expect(past("at 11")).toMatchObject({ at: "2026-09-09T05:30:00.000Z" });        // today 11:00, not tomorrow
    expect(past("this morning")).toMatchObject({ at: "2026-09-09T00:30:00.000Z" }); // today, not tomorrow
    expect(past("last Friday")).toMatchObject({ at: "2026-09-04T06:30:00.000Z" });  // the PREVIOUS Friday
    expect(past("yesterday at 11")).toMatchObject({ at: "2026-09-08T05:30:00.000Z" });
  });

  it("never resolves a past-direction phrase after the reference instant", () => {
    for (const phrase of ["at 11", "this morning", "last Friday", "yesterday at 11"]) {
      const resolved = past(phrase);
      expect(resolved.tier).toBe("deterministic");
      if (resolved.tier !== "deterministic") throw new Error("unreachable");
      expect(new Date(resolved.at).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it("still resolves reminders forwards", () => {
    expect(forward("at 5")).toMatchObject({ at: "2026-09-09T23:30:00.000Z" });
    expect(forward("tomorrow at 5pm")).toMatchObject({ at: "2026-09-10T11:30:00.000Z" });
    expect(forward("next Friday")).toMatchObject({ at: "2026-09-18T06:30:00.000Z" });
  });

  it("maps spec §5 intent kinds to the direction their tense implies", () => {
    expect(timeDirectionForIntent("completion_update")).toBe("past");
    expect(timeDirectionForIntent("action")).toBe("forward");
    expect(timeDirectionForIntent("information")).toBe("forward");
    expect(timeDirectionForIntent("question")).toBe("none");
    expect(timeDirectionForIntent("context")).toBe("none");
  });

  it("gives the demo completion utterance a past timestamp end to end", () => {
    // Spec §5: "Barkha gave the article at 11." -> completion_update.
    const resolved = resolveTime(
      { kind: "deterministic", sourcePhrase: "at 11" },
      now,
      "Asia/Kolkata",
      timeDirectionForIntent("completion_update"),
    );
    expect(resolved).toMatchObject({ tier: "deterministic", at: "2026-09-09T05:30:00.000Z" });
  });
});
