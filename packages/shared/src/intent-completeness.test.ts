/**
 * `validateIntentCompleteness` — what Phase 3 asks the user about.
 *
 * ================================ READ THIS ================================
 * This validator decides when the assistant STOPS and asks a question. Spec §27
 * forbids over-asking, so a requirement that fires on a perfectly clear
 * utterance is not a harmless strictness — it is the product failing in the way
 * the spec names explicitly.
 *
 * The `satisfiedBy` mechanism exists for exactly one reason, and it is asserted
 * below: one intent kind can feed more than one TOOL. An `action` normally
 * becomes a reminder and needs `reminderBody`; an `action` carrying a
 * `condition` becomes a WORKFLOW instead, and `create_workflow` reads its text
 * from `condition.actionBody` and never looks at `reminderBody`. Without
 * `satisfiedBy`, "If Arun hasn't sent the schema by Friday, remind me" would be
 * reported incomplete and Phase 3 would ask the user to restate a body it was
 * already given.
 * ===========================================================================
 */
import { describe, expect, it } from "vitest";
import { validateIntentCompleteness } from "./assistant-contract.js";
import type { ExtractedIntent, Extraction } from "./assistant-contract.js";

const wrap = (...intents: ExtractedIntent[]): Extraction => ({ intents });

const base = {
  inferenceLevel: "CONFIRMED",
  sourceText: "some utterance",
} as const;

const blockingFields = (extraction: Extraction) =>
  validateIntentCompleteness(extraction)
    .filter((issue) => issue.severity === "blocking")
    .map((issue) => issue.missingField);

describe("an action needs a body, from whichever field carries it", () => {
  it("flags a bare action with no body at all", () => {
    expect(blockingFields(wrap({ ...base, kind: "action" }))).toEqual(["reminderBody"]);
  });

  it("accepts a plain reminder", () => {
    expect(blockingFields(wrap({ ...base, kind: "action", reminderBody: "ask her" }))).toEqual([]);
  });

  it("accepts a CONDITIONAL, whose body lives in condition.actionBody", () => {
    // The §27 case. This utterance is completely clear; asking about it would
    // be the over-asking the spec forbids.
    const conditional: ExtractedIntent = {
      ...base,
      kind: "action",
      condition: {
        subjectText: "the schema",
        deadlinePhrase: "by Friday",
        action: "remind",
        actionBody: "Arun hasn't sent the schema",
      },
    };
    expect(blockingFields(wrap(conditional))).toEqual([]);
  });

  it("accepts a type definition and a record, which are also bodies", () => {
    const definition: ExtractedIntent = {
      ...base,
      kind: "action",
      entityTypeDefinition: {
        typeKey: "gym_session",
        displayName: "Gym Sessions",
        fields: [{ fieldKey: "date", fieldKind: "date", label: "Date", required: true }],
      },
    };
    const record: ExtractedIntent = {
      ...base,
      kind: "action",
      entityRecord: { typeKey: "gym_session", values: { date: "today" } },
    };

    expect(blockingFields(wrap(definition))).toEqual([]);
    expect(blockingFields(wrap(record))).toEqual([]);
  });

  it("accepts an event to schedule", () => {
    // Added AFTER this mechanism existed and STILL forgotten from the list, so
    // every "schedule Arun at 5 tomorrow" answered "What should the reminder
    // say?" and planEvent was unreachable. CI caught it; this pins it.
    expect(blockingFields(wrap({ ...base, kind: "action", eventTitle: "the Hult review" }))).toEqual(
      [],
    );
  });

  it("does NOT let an unrelated field satisfy the requirement", () => {
    // The mechanism must stay narrow. `memoryBody` is not a thing to DO, so an
    // action carrying only a memory is still missing its body — otherwise
    // satisfiedBy would quietly become "any field will do".
    expect(blockingFields(wrap({ ...base, kind: "action", memoryBody: "Arun handles backend" }))).toEqual([
      "reminderBody",
    ]);
  });
});

describe("the other kinds are unchanged by satisfiedBy", () => {
  it("still requires objectText on information, and reports owner as advisory", () => {
    const issues = validateIntentCompleteness(wrap({ ...base, kind: "information" }));
    expect(issues.map((issue) => [issue.missingField, issue.severity])).toEqual([
      ["objectText", "blocking"],
      ["owner", "advisory"],
    ]);
  });

  it("requires nothing of a context, question, execution or inspection", () => {
    for (const kind of ["context", "question", "execution", "inspection"] as const) {
      expect(validateIntentCompleteness(wrap({ ...base, kind })), kind).toEqual([]);
    }
  });

  it("reports the index and source text so Phase 3 can ask about the right intent", () => {
    const issues = validateIntentCompleteness(
      wrap(
        { ...base, kind: "action", reminderBody: "ask her" },
        { ...base, kind: "action", sourceText: "the incomplete one" },
      ),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.intentIndex).toBe(1);
    expect(issues[0]?.sourceText).toBe("the incomplete one");
  });
});
