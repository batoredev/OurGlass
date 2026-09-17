/**
 * Scoring for the provider comparison. Free: no model is called.
 */
import { describe, expect, it } from "vitest";
import type { Extraction } from "@ourglass/shared";
import { EXTRACTION_FIXTURES } from "./fixtures.js";
import { aggregate, formatTable, scoreFixture } from "./provider-eval.js";

const byId = (id: string) => {
  const fixture = EXTRACTION_FIXTURES.find((f) => f.id === id);
  if (!fixture) throw new Error(`fixture ${id} missing`);
  return fixture;
};

describe("scoreFixture", () => {
  it("scores a perfect extraction as a match with no risk", () => {
    const fixture = byId("status-blocked");
    const score = scoreFixture(fixture, fixture.expected, 100);
    expect(score.matched).toBe(true);
    expect(score.kindMatched).toBe(true);
    expect(score.wrongMutationRisk).toBe(false);
  });

  it("flags an invented forbidden field as wrong-mutation risk", () => {
    // The failure that looks like the feature working.
    const fixture = byId("negative-commitment-is-not-a-memory");
    const polluted: Extraction = {
      intents: fixture.expected.intents.map((intent) => ({ ...intent, memoryBody: "invented" })),
    };
    const score = scoreFixture(fixture, polluted, 100);
    expect(score.invented).toEqual(["memoryBody@0"]);
    expect(score.wrongMutationRisk).toBe(true);
  });

  it("flags a mismatched write-driving extraction as wrong-mutation risk", () => {
    const fixture = byId("status-blocked");
    const wrong: Extraction = {
      intents: fixture.expected.intents.map((intent) => ({
        ...intent,
        newStatus: "cancelled" as const,
      })),
    };
    expect(scoreFixture(fixture, wrong, 100).wrongMutationRisk).toBe(true);
  });

  it("does NOT count a mismatched read-only answer as mutation risk", () => {
    const fixture = byId("inspection-waiting");
    const wrong: Extraction = {
      intents: [{ kind: "question", inferenceLevel: "CONFIRMED", sourceText: "x" }],
    };
    const score = scoreFixture(fixture, wrong, 100);
    expect(score.matched).toBe(false);
    expect(score.wrongMutationRisk).toBe(false);
  });

  it("does not count a failed call as a wrong mutation — failing writes nothing", () => {
    const score = scoreFixture(byId("status-blocked"), null, 50, "timeout");
    expect(score.matched).toBeNull();
    expect(score.wrongMutationRisk).toBe(false);
    expect(score.errorCategory).toBe("timeout");
  });

  it("detects unnecessary and missed clarification", () => {
    const clear = byId("status-blocked");
    const asked: Extraction = {
      intents: clear.expected.intents.map((i) => ({ ...i, inferenceLevel: "UNCERTAIN" as const })),
    };
    expect(scoreFixture(clear, asked, 1).unnecessaryClarification).toBe(true);

    const ambiguous = byId("ambiguous-pronoun");
    const guessed: Extraction = {
      intents: ambiguous.expected.intents.map((i) => ({
        ...i,
        inferenceLevel: "CONFIRMED" as const,
      })),
    };
    expect(scoreFixture(ambiguous, guessed, 1).missedClarification).toBe(true);
  });
});

describe("aggregate", () => {
  it("computes rates over ALL fixtures, so failing half the set cannot look accurate", () => {
    const a = byId("status-blocked");
    const b = byId("memory-role");
    const report = aggregate("claude", "m", [
      scoreFixture(a, a.expected, 100),
      scoreFixture(b, null, 300, "timeout"),
    ]);
    expect(report.fullMatchRate).toBe(0.5);
    expect(report.failures).toBe(1);
    expect(report.answered).toBe(1);
    expect(report.avgLatencyMs).toBe(200);
  });

  it("formats a table containing only the numbers it was given", () => {
    const f = byId("status-blocked");
    const table = formatTable([
      aggregate("gemini", "gemini-2.5-flash", [scoreFixture(f, f.expected, 1500)]),
    ]);
    expect(table).toContain("gemini-2.5-flash");
    expect(table).toContain("100.0%");
    expect(table).toContain("1.50s");
  });
});
