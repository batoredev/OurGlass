/**
 * Tests FOR the comparator.
 *
 * The fixture lane and the live lane both trust `matchesExpected`. If it is wrong,
 * every other green test in this package is meaningless — which is exactly the
 * failure this file exists to prevent. The previous comparator compared only
 * `kind` and `inferenceLevel` and so accepted a fully reversed ownership
 * direction; the reversal tests below are the regression coverage for that.
 */
import { describe, expect, it } from "vitest";
import type { Extraction, ExtractedIntent, EntityMention } from "@ourglass/shared";
import { intentMatches, matchesExpected, normalizeText } from "./match.js";

const person = (name: string): EntityMention => ({ name, kind: "person", inferenceLevel: "CONFIRMED" });

const barkhaOwesMe: ExtractedIntent = {
  kind: "information",
  inferenceLevel: "CONFIRMED",
  sourceText: "Barkha needs to give me the article by 6",
  owner: person("Barkha"),
  recipient: person("me"),
  objectText: "the article",
  time: { kind: "deterministic", sourcePhrase: "by 6" },
};

const one = (intent: ExtractedIntent): Extraction => ({ intents: [intent] });

/** Returns the intent without `key`, avoiding an unused destructuring binding. */
function omit(intent: ExtractedIntent, key: keyof ExtractedIntent): ExtractedIntent {
  const copy: Record<string, unknown> = { ...intent };
  delete copy[key];
  return copy as unknown as ExtractedIntent;
}


describe("normalizeText", () => {
  it("ignores case, punctuation and whitespace differences", () => {
    expect(normalizeText("The Article.")).toBe(normalizeText("the article"));
    expect(normalizeText("  send   the deck  ")).toBe("send the deck");
  });

  it("still distinguishes genuinely different text", () => {
    expect(normalizeText("the article")).not.toBe(normalizeText("the poster"));
  });
});

describe("ownership direction (spec §7, DECISIONS.md #9)", () => {
  it("REJECTS a reversed owner/recipient pair", () => {
    // The exact probe that the previous comparator passed. It must now fail.
    const reversed: ExtractedIntent = {
      ...barkhaOwesMe,
      owner: person("me"),
      recipient: person("Barkha"),
    };

    expect(matchesExpected(one(reversed), one(barkhaOwesMe))).toBe(false);
  });

  it("accepts the correct direction", () => {
    expect(matchesExpected(one(barkhaOwesMe), one(barkhaOwesMe))).toBe(true);
  });

  it("REJECTS a dropped owner and a dropped recipient", () => {
    expect(matchesExpected(one(omit(barkhaOwesMe, "owner")), one(barkhaOwesMe))).toBe(false);
    expect(matchesExpected(one(omit(barkhaOwesMe, "recipient")), one(barkhaOwesMe))).toBe(false);
  });

  it("REJECTS a substituted person", () => {
    const wrongPerson: ExtractedIntent = { ...barkhaOwesMe, owner: person("Arun") };
    expect(matchesExpected(one(wrongPerson), one(barkhaOwesMe))).toBe(false);
  });

  it("compares entity names ignoring case and punctuation", () => {
    const styled: ExtractedIntent = { ...barkhaOwesMe, owner: person("barkha") };
    expect(matchesExpected(one(styled), one(barkhaOwesMe))).toBe(true);
  });

  it("ignores entity kind and entity inferenceLevel, which Resolve settles later", () => {
    const asUnknown: ExtractedIntent = {
      ...barkhaOwesMe,
      owner: { name: "Barkha", kind: "unknown", inferenceLevel: "INFERRED" },
    };
    expect(matchesExpected(one(asUnknown), one(barkhaOwesMe))).toBe(true);
  });
});

describe("time", () => {
  it("REJECTS a missing time when one was expected", () => {
    expect(matchesExpected(one(omit(barkhaOwesMe, "time")), one(barkhaOwesMe))).toBe(false);
  });

  it("REJECTS a wrong time tier even with the same phrase", () => {
    const wrongTier: ExtractedIntent = {
      ...barkhaOwesMe,
      time: { kind: "relational", sourcePhrase: "by 6" },
    };
    expect(matchesExpected(one(wrongTier), one(barkhaOwesMe))).toBe(false);
  });

  it("REJECTS a different source phrase", () => {
    const wrongPhrase: ExtractedIntent = {
      ...barkhaOwesMe,
      time: { kind: "deterministic", sourcePhrase: "by 7" },
    };
    expect(matchesExpected(one(wrongPhrase), one(barkhaOwesMe))).toBe(false);
  });

  it("accepts punctuation/case variation in the source phrase", () => {
    const styled: ExtractedIntent = {
      ...barkhaOwesMe,
      time: { kind: "deterministic", sourcePhrase: "By 6." },
    };
    expect(matchesExpected(one(styled), one(barkhaOwesMe))).toBe(true);
  });
});

describe("kind, inference level and object text", () => {
  it("REJECTS a wrong intent kind", () => {
    expect(matchesExpected(one({ ...barkhaOwesMe, kind: "action" }), one(barkhaOwesMe))).toBe(false);
  });

  it("REJECTS a wrong inference level", () => {
    expect(matchesExpected(one({ ...barkhaOwesMe, inferenceLevel: "UNCERTAIN" }), one(barkhaOwesMe))).toBe(false);
  });

  it("REJECTS a missing or wrong objectText", () => {
    expect(matchesExpected(one(omit(barkhaOwesMe, "objectText")), one(barkhaOwesMe))).toBe(false);
    expect(matchesExpected(one({ ...barkhaOwesMe, objectText: "the poster" }), one(barkhaOwesMe))).toBe(false);
  });
});

describe("unspecified expected fields", () => {
  it("does not constrain fields the fixture did not label", () => {
    const expected: ExtractedIntent = {
      kind: "question",
      inferenceLevel: "CONFIRMED",
      sourceText: "What am I waiting on",
    };
    const actual: ExtractedIntent = { ...expected, objectText: "anything at all", relatedEntity: person("Arun") };

    expect(intentMatches(actual, expected)).toBe(true);
  });
});

describe("multi-intent matching", () => {
  const commitment = barkhaOwesMe;
  const reminder: ExtractedIntent = {
    kind: "action",
    inferenceLevel: "CONFIRMED",
    sourceText: "Remind me at 5 to ask her",
    relatedEntity: person("Barkha"),
    reminderBody: "ask her",
    time: { kind: "deterministic", sourcePhrase: "at 5" },
  };
  const expected: Extraction = { intents: [commitment, reminder] };

  it("accepts intents emitted in either order", () => {
    expect(matchesExpected({ intents: [commitment, reminder] }, expected)).toBe(true);
    expect(matchesExpected({ intents: [reminder, commitment] }, expected)).toBe(true);
  });

  it("REJECTS a missing intent", () => {
    expect(matchesExpected({ intents: [commitment] }, expected)).toBe(false);
  });

  it("REJECTS a spurious extra intent", () => {
    expect(matchesExpected({ intents: [commitment, reminder, reminder] }, expected)).toBe(false);
  });

  it("REJECTS a reversed commitment even when the reminder is correct", () => {
    const reversed: ExtractedIntent = { ...commitment, owner: person("me"), recipient: person("Barkha") };
    expect(matchesExpected({ intents: [reversed, reminder] }, expected)).toBe(false);
  });

  it("finds a perfect assignment where greedy first-fit would fail", () => {
    // `loose` matches both expected intents; `strict` matches only the second.
    // A greedy pass that assigns `loose` to the first expected intent would then
    // fail the second. Exact matching must succeed here.
    const looseExpected: ExtractedIntent = { kind: "context", inferenceLevel: "CONFIRMED", sourceText: "a" };
    const strictExpected: ExtractedIntent = { ...looseExpected, objectText: "the printer outage" };
    const strictActual: ExtractedIntent = { ...looseExpected, objectText: "The printer outage." };
    const looseActual: ExtractedIntent = { ...looseExpected, objectText: "something else entirely" };

    expect(
      matchesExpected({ intents: [strictActual, looseActual] }, { intents: [looseExpected, strictExpected] }),
    ).toBe(true);
  });
});
