/**
 * The fixture lane. Runs on every PR, needs no API key, makes no model calls.
 *
 * WHAT THIS LANE PROVES: the eval set is schema-valid against the shared contract,
 * covers the behaviours the spec cares about, and the comparator that judges model
 * output has the properties we depend on — above all that a reversed ownership
 * direction fails.
 *
 * WHAT IT DOES NOT PROVE: anything whatsoever about how the model behaves. There is
 * no recorded model output in this repository, so nothing here exercises an
 * extraction. Green here means "prompt changes are safer to make", not "the
 * extractor is correct" — see PHASE-1-DESIGN.md §4.3. Only `pnpm test:live`, which
 * costs money and is manually dispatched, speaks to model correctness.
 *
 * The previous version of this file asserted matchesExpected(x, x) — a value
 * against itself — which is a tautology that no implementation can fail. The
 * comparator's real behavioural tests live in match.test.ts; this file asserts the
 * fixture set's own integrity and coverage.
 */
import { describe, expect, it } from "vitest";
import { INTENT_KINDS, isExtraction, validateIntentCompleteness } from "@ourglass/shared";
import type { IntentKind, TimeReferenceKind } from "@ourglass/shared";
import { EXTRACTION_FIXTURES } from "./fixtures.js";
import { matchesExpected } from "./match.js";

const allIntents = EXTRACTION_FIXTURES.flatMap((fixture) => fixture.expected.intents);

describe("fixture set integrity", () => {
  it("is a non-trivial, fully hand-labelled set", () => {
    expect(EXTRACTION_FIXTURES.length).toBeGreaterThanOrEqual(50);
  });

  it("validates against the shared runtime contract", () => {
    for (const fixture of EXTRACTION_FIXTURES) {
      expect(isExtraction(fixture.expected), fixture.id).toBe(true);
    }
  });

  it("has unique ids and a non-empty utterance and intent list per fixture", () => {
    const ids = EXTRACTION_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const fixture of EXTRACTION_FIXTURES) {
      expect(fixture.utterance.trim(), fixture.id).not.toBe("");
      expect(fixture.expected.intents.length, fixture.id).toBeGreaterThan(0);
    }
  });

  it("never encodes a resolved timestamp — the model must only emit verbatim phrases", () => {
    // DECISIONS.md #4: chrono-node resolves phrases outside the model. An ISO-8601
    // instant in a fixture would mean we were asserting the model does date
    // arithmetic, which the system prompt explicitly forbids.
    const isoLike = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
    for (const fixture of EXTRACTION_FIXTURES) {
      for (const intent of fixture.expected.intents) {
        if (intent.time === undefined) continue;
        expect(isoLike.test(intent.time.sourcePhrase), `${fixture.id}: ${intent.time.sourcePhrase}`).toBe(false);
      }
    }
  });

  it("labels every time-bearing intent with a source phrase drawn from its utterance", () => {
    // Guards against a labelling drift where someone paraphrases the time instead of
    // quoting it. Comparison is case-insensitive; the phrase must still be verbatim.
    for (const fixture of EXTRACTION_FIXTURES) {
      for (const intent of fixture.expected.intents) {
        if (intent.time === undefined) continue;
        expect(
          fixture.utterance.toLowerCase().includes(intent.time.sourcePhrase.toLowerCase()),
          `${fixture.id}: "${intent.time.sourcePhrase}" not verbatim in utterance`,
        ).toBe(true);
      }
    }
  });
});

describe("fixture set coverage", () => {
  it("represents all six spec §5 intent kinds", () => {
    const covered = new Set<IntentKind>(allIntents.map((intent) => intent.kind));
    for (const kind of INTENT_KINDS) expect(covered, `missing intent kind: ${kind}`).toContain(kind);
  });

  it("represents all three time tiers", () => {
    const tiers = new Set<TimeReferenceKind>(
      allIntents.flatMap((intent) => (intent.time === undefined ? [] : [intent.time.kind])),
    );
    for (const tier of ["deterministic", "relational", "event_trigger"] as const) {
      expect(tiers, `missing time tier: ${tier}`).toContain(tier);
    }
  });

  it("covers both ownership directions several times each (spec §7)", () => {
    const ownedByUser = allIntents.filter((intent) => intent.owner?.name === "me" && intent.recipient !== undefined);
    const ownedByOther = allIntents.filter(
      (intent) => intent.owner !== undefined && intent.owner.name !== "me" && intent.recipient?.name === "me",
    );

    expect(ownedByUser.length).toBeGreaterThanOrEqual(3);
    expect(ownedByOther.length).toBeGreaterThanOrEqual(3);
  });

  it("covers multi-intent utterances", () => {
    const multi = EXTRACTION_FIXTURES.filter((fixture) => fixture.expected.intents.length > 1);
    expect(multi.length).toBeGreaterThanOrEqual(3);

    // The spec §26 narrative: one utterance producing a commitment AND a reminder.
    const commitmentPlusReminder = multi.find((fixture) =>
      fixture.expected.intents.some((intent) => intent.kind === "information") &&
      fixture.expected.intents.some((intent) => intent.kind === "action"),
    );
    expect(commitmentPlusReminder).toBeDefined();
  });

  it("covers completion, late completion and context attached afterwards", () => {
    const ids = new Set(EXTRACTION_FIXTURES.map((fixture) => fixture.id));
    expect(ids).toContain("finished-poster");
    expect(ids).toContain("late-completion");
    expect(ids).toContain("context-after-completion");
  });

  it("asserts UNCERTAIN on unresolvable-referent utterances", () => {
    // Load-bearing since the Sonnet decision (DECISIONS.md open question 2): these
    // fixtures are what catches a model inferring where it should ask.
    const uncertainIds = new Set(
      EXTRACTION_FIXTURES.filter((fixture) =>
        fixture.expected.intents.every((intent) => intent.inferenceLevel === "UNCERTAIN"),
      ).map((fixture) => fixture.id),
    );

    for (const id of ["ambiguous-pronoun", "uncertain-reference", "ambiguous-which-arun"]) {
      expect(uncertainIds, `${id} must be labelled UNCERTAIN`).toContain(id);
    }
  });
});

describe("comparator behaviour on the real fixture set", () => {
  // match.test.ts tests the comparator against purpose-built inputs. These assert the
  // same properties hold across all 50+ real fixtures, so a badly-labelled fixture
  // (e.g. one with no distinguishing structure) cannot silently weaken the harness.

  it("matches every fixture against itself", () => {
    for (const fixture of EXTRACTION_FIXTURES) {
      expect(matchesExpected(fixture.expected, fixture.expected), fixture.id).toBe(true);
    }
  });

  it("REJECTS a reversed owner/recipient on every fixture that has both", () => {
    // The headline acceptance criterion, applied to real data rather than a synthetic
    // pair. Spec §7 / DECISIONS.md #9: a wrong ownership direction is the worst
    // failure in the system, and the previous comparator accepted it silently.
    const reversible = EXTRACTION_FIXTURES.filter((fixture) =>
      fixture.expected.intents.some(
        (intent) =>
          intent.owner !== undefined &&
          intent.recipient !== undefined &&
          intent.owner.name.toLowerCase() !== intent.recipient.name.toLowerCase(),
      ),
    );
    expect(reversible.length).toBeGreaterThanOrEqual(8);

    for (const fixture of reversible) {
      const reversed = {
        intents: fixture.expected.intents.map((intent) =>
          intent.owner !== undefined && intent.recipient !== undefined
            ? { ...intent, owner: intent.recipient, recipient: intent.owner }
            : intent,
        ),
      };
      expect(matchesExpected(reversed, fixture.expected), `${fixture.id} must reject reversed ownership`).toBe(false);
    }
  });

  it("REJECTS a wrong intent kind on every fixture", () => {
    for (const fixture of EXTRACTION_FIXTURES) {
      const mutated = {
        intents: fixture.expected.intents.map((intent) => ({
          ...intent,
          kind: (intent.kind === "question" ? "execution" : "question") as IntentKind,
        })),
      };
      expect(matchesExpected(mutated, fixture.expected), fixture.id).toBe(false);
    }
  });

  it("REJECTS a dropped time on every fixture that expects one", () => {
    const timed = EXTRACTION_FIXTURES.filter((fixture) =>
      fixture.expected.intents.some((intent) => intent.time !== undefined),
    );
    expect(timed.length).toBeGreaterThanOrEqual(10);

    for (const fixture of timed) {
      const stripped = {
        intents: fixture.expected.intents.map((intent) => {
          const copy: Record<string, unknown> = { ...intent };
          delete copy["time"];
          return copy as unknown as (typeof fixture.expected.intents)[number];
        }),
      };
      expect(matchesExpected(stripped, fixture.expected), `${fixture.id} must reject a dropped time`).toBe(false);
    }
  });

  it("REJECTS a dropped intent on every multi-intent fixture", () => {
    for (const fixture of EXTRACTION_FIXTURES.filter((f) => f.expected.intents.length > 1)) {
      const dropped = { intents: fixture.expected.intents.slice(1) };
      expect(matchesExpected(dropped, fixture.expected), fixture.id).toBe(false);
    }
  });
});

describe("actionability (validateIntentCompleteness)", () => {
  // This validator is the layer that now carries the weight the stronger model's
  // ask-tendency used to (DECISIONS.md open question 2). It returns issues rather
  // than throwing because the right response to a missing owner is to ASK the user
  // (spec §11), not to error.

  it("flags every UNCERTAIN-and-incomplete fixture as needing a question, never a silent write", () => {
    // The pairing that matters: an intent that is both incomplete AND uncertain is
    // exactly the shape Phase 3 must turn into a clarifying question.
    for (const fixture of EXTRACTION_FIXTURES) {
      for (const issue of validateIntentCompleteness(fixture.expected)) {
        const intent = fixture.expected.intents[issue.intentIndex];
        expect(intent, `${fixture.id}: issue points at a real intent`).toBeDefined();
        expect(issue.sourceText, fixture.id).toBe(intent?.sourceText);
      }
    }
  });

  it("keeps commitment-bearing fixtures fully actionable", () => {
    // Any fixture asserting a real commitment — both ownership slots filled — must
    // carry everything Phase 1's NOT NULL columns need. If one of these ever goes
    // incomplete, we would be asserting the model may emit an unwritable commitment.
    const commitments = EXTRACTION_FIXTURES.filter((fixture) =>
      fixture.expected.intents.some((intent) => intent.owner !== undefined && intent.recipient !== undefined),
    );
    expect(commitments.length).toBeGreaterThanOrEqual(8);

    for (const fixture of commitments) {
      const blocking = validateIntentCompleteness(fixture.expected).filter((issue) => {
        const intent = fixture.expected.intents[issue.intentIndex];
        // UNCERTAIN intents are exempt: being incomplete is the POINT of them.
        // "Barkha finally sent it after dinner" has both ownership slots but an
        // unresolved "it", so it is correctly incomplete AND correctly UNCERTAIN —
        // Phase 3 asks what "it" was rather than writing a commitment with no object.
        return intent?.owner !== undefined && intent.inferenceLevel !== "UNCERTAIN";
      });
      expect(blocking, `${fixture.id} asserts an unwritable CONFIRMED commitment`).toEqual([]);
    }
  });

  it("documents the ownerless-information tension rather than hiding it", () => {
    // KNOWN CONTRACT TENSION, deliberately asserted so it cannot drift silently.
    //
    // REQUIRED_INTENT_FIELDS marks `owner` required for ALL `information` intents,
    // derived from `commitments.owner_id NOT NULL`. But not every `information`
    // intent is a commitment: "The Hult meeting is cancelled" and "The CRM project
    // needs a backend review" are ownerless statements of fact with no one who owes
    // anything. They are correctly labelled and correctly ownerless.
    //
    // So these report a completeness issue while being RIGHT. Phase 3 must not treat
    // an ownerless `information` intent as a failed extraction to re-ask about; it
    // should record the fact and move on. If Phase 3 instead asks "who owns 'the
    // Hult meeting is cancelled'?", this test is where the mismatch was written down.
    const ownerlessInformation = EXTRACTION_FIXTURES.filter((fixture) =>
      fixture.expected.intents.some(
        (intent) => intent.kind === "information" && intent.owner === undefined,
      ),
    ).map((fixture) => fixture.id);

    expect(ownerlessInformation).toEqual([
      "blocked-dependency",
      "project-information",
      "cancelled-meeting",
      "yesterday-context",
    ]);
  });
});
