/**
 * The missing link: every phrase the fixtures label `deterministic` must
 * actually resolve.
 *
 * ================================ READ THIS ================================
 * THE SPEC'S HEADLINE SENTENCE DID NOT WORK, FOR FOUR PHASES.
 *
 *     "Barkha needs to give me the article by 6."
 *
 * `chrono` parses "at 6" and does NOT parse "by 6", or bare "6". So the
 * assistant answered *"When is 'by 6'?"* to the one sentence the product is
 * specified around — and to every other bare-hour deadline.
 *
 * Nothing caught it, because the two halves were never compared:
 *
 *   - `extraction.fixtures.test.ts` asserts the LABEL the model should emit.
 *     It never calls the resolver. A fixture can claim `deterministic`
 *     forever without anything checking that tier is reachable.
 *   - `time.test.ts` asserts the resolver, using phrases chosen while writing
 *     the resolver — so naturally ones chrono already liked.
 *
 * Two declarations of one capability with no cross-check, which is the defect
 * class this repo keeps recording. THIS FILE IS THE CROSS-CHECK.
 * ===========================================================================
 */
import { describe, expect, it } from "vitest";
import { resolveTime, timeDirectionForIntent } from "@ourglass/api/assistant";
import { EXTRACTION_FIXTURES } from "./fixtures.js";

/** Fixed, so a failure is never "it was late in the day on the runner". */
const NOW = new Date("2026-03-05T12:00:00.000Z");
const TIMEZONE = "Asia/Kolkata";

/**
 * Phrases a fixture labels `deterministic` that the resolver legitimately
 * cannot turn into an instant. Each needs a REASON, because the alternative
 * to an honest "when is that?" is a confidently wrong timestamp — the failure
 * DECISIONS.md #4 exists to prevent.
 *
 * The label is still correct: the extractor's job is to say "this is a
 * calendar-like phrase", and the resolver's is to say whether it can pin it
 * down. Declining is a real, honest outcome — not a labelling error.
 */
const UNRESOLVABLE_BY_DESIGN: Readonly<Record<string, string>> = {
  // chrono knows "end of the month" but not "month end", and "end of the
  // month" resolves to the same day NEXT month — a confidently wrong instant
  // rather than the last day of this one. Asking is the better answer.
  "by month end": "chrono has no correct reading; the near-miss is off by weeks",
};

function deterministicPhrases(): [string, string][] {
  const seen = new Map<string, string>();
  for (const fixture of EXTRACTION_FIXTURES) {
    for (const intent of fixture.expected.intents) {
      if (intent.time?.kind !== "deterministic") continue;
      if (!seen.has(intent.time.sourcePhrase)) seen.set(intent.time.sourcePhrase, intent.kind);
    }
  }
  return [...seen.entries()];
}

describe("every deterministic fixture phrase reaches an instant", () => {
  it("finds a non-trivial number of phrases to check", () => {
    // Guard the guard. If the extraction shape ever changes and this returns
    // nothing, the suite below would pass vacuously — the hollow-test failure
    // this repo has hit four times.
    expect(deterministicPhrases().length).toBeGreaterThanOrEqual(12);
  });

  it("resolves each one, or names it as unresolvable by design", () => {
    const broken: string[] = [];

    for (const [phrase, intentKind] of deterministicPhrases()) {
      const resolved = resolveTime(
        { kind: "deterministic", sourcePhrase: phrase },
        NOW,
        TIMEZONE,
        // The DIRECTION matters: "at 11" is a future time for an `action` and
        // a past one for a `completion_update`, and resolving both the same
        // way is wrong for one of them.
        timeDirectionForIntent(intentKind as Parameters<typeof timeDirectionForIntent>[0]),
      );

      const excused = UNRESOLVABLE_BY_DESIGN[phrase] !== undefined;
      if (resolved.tier === "deterministic" && excused) {
        broken.push(`"${phrase}" is excused but now resolves — remove it from the list`);
      }
      if (resolved.tier !== "deterministic" && !excused) {
        broken.push(`"${phrase}" (${intentKind}) -> ${resolved.tier}`);
      }
    }

    expect(broken).toEqual([]);
  });

  it("resolves the spec's own headline deadline", () => {
    // Stated separately from the sweep, so a regression names the sentence
    // rather than appearing as one entry in a list.
    const resolved = resolveTime(
      { kind: "deterministic", sourcePhrase: "by 6" },
      NOW,
      TIMEZONE,
      "forward",
    );
    expect(resolved.tier).toBe("deterministic");
  });

  it("keeps the ORIGINAL words in sourcePhrase, so the resolution stays auditable", () => {
    const resolved = resolveTime(
      { kind: "deterministic", sourcePhrase: "by 6" },
      NOW,
      TIMEZONE,
      "forward",
    );
    // Never "at 6". The retry changes what chrono is ASKED, not what we
    // recorded the user as saying.
    expect(resolved.sourcePhrase).toBe("by 6");
  });

  it("does NOT rewrite a phrase chrono already understands", () => {
    // The fix is a RETRY, not a normalisation pass: "by Friday" parses on its
    // own and must reach the same instant as "Friday".
    const friday = resolveTime(
      { kind: "deterministic", sourcePhrase: "by Friday" },
      NOW,
      TIMEZONE,
      "forward",
    );
    const plain = resolveTime(
      { kind: "deterministic", sourcePhrase: "Friday" },
      NOW,
      TIMEZONE,
      "forward",
    );

    expect(friday.tier).toBe("deterministic");
    expect(plain.tier).toBe("deterministic");
    if (friday.tier === "deterministic" && plain.tier === "deterministic") {
      expect(friday.at).toBe(plain.at);
    }
  });
});

describe("relational and event-trigger phrases are NOT silently resolved", () => {
  it("keeps every non-deterministic fixture phrase out of the deterministic tier", () => {
    // The inverse risk of the fix above: a broader rewrite that started
    // turning "before the meeting" into a timestamp would invent a deadline
    // the user never gave (DECISIONS.md #3).
    for (const fixture of EXTRACTION_FIXTURES) {
      for (const intent of fixture.expected.intents) {
        if (intent.time === undefined || intent.time.kind === "deterministic") continue;
        const resolved = resolveTime(
          intent.time,
          NOW,
          TIMEZONE,
          timeDirectionForIntent(intent.kind),
        );
        expect(resolved.tier, `${fixture.id}: "${intent.time.sourcePhrase}"`).not.toBe(
          "deterministic",
        );
      }
    }
  });
});
