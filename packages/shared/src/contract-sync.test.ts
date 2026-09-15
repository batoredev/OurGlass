/**
 * ONE FIELD, THREE DECLARATIONS — this file keeps them agreeing.
 *
 * ================================ READ THIS ================================
 * Adding a field to `ExtractedIntent` requires changing THREE places, and
 * missing any one of them fails SILENTLY in a different way:
 *
 *   1. `ExtractedIntent` (assistant-contract.ts) — miss it and the planner
 *      cannot read the field. Caught by the compiler.
 *   2. `INTENT_SCHEMA` (extraction-schema.ts) — miss it and the API REJECTS
 *      any response containing the field, because the schema sets
 *      `additionalProperties: false`. The model can never emit it.
 *   3. `INTENT_KEYS` (assistant-contract.ts) — miss it and `isExtraction`
 *      discards the WHOLE INTENT, not just the field, because `hasOnlyKeys`
 *      rejects unknown keys. Extraction quietly returns less.
 *
 * Only #1 is compiler-checked. #2 and #3 are runtime arrays, and both were
 * nearly missed while wiring the planner — #3 was found only by reading
 * `isExtraction` after the other two were already done.
 *
 * So this asserts the two runtime lists against each other and against a
 * sample intent carrying every field. If they drift, a feature goes dead on
 * arrival with nothing else failing.
 * ===========================================================================
 */
import { describe, expect, it } from "vitest";
import { EXTRACTION_INPUT_SCHEMA, isExtraction, type ExtractedIntent } from "./index.js";

/**
 * An intent carrying EVERY optional field. If a field is missing from
 * `INTENT_KEYS`, `isExtraction` rejects this whole object; if it is missing
 * from the JSON schema, the second test catches it.
 */
const FULLY_POPULATED: ExtractedIntent = {
  kind: "information",
  inferenceLevel: "CONFIRMED",
  sourceText: "everything at once",
  owner: { name: "Barkha", kind: "person", inferenceLevel: "CONFIRMED" },
  recipient: { name: "me", kind: "person", inferenceLevel: "CONFIRMED" },
  objectText: "the article",
  time: { kind: "deterministic", sourcePhrase: "by 6" },
  reminderBody: "ask her",
  relatedEntity: { name: "Hult", kind: "organization", inferenceLevel: "INFERRED" },
  newStatus: "blocked",
  memoryBody: "Arun handles the backend",
  correctionTarget: "Arun works on backend",
  condition: {
    subjectText: "the schema",
    deadlinePhrase: "by Friday",
    action: "remind",
    actionBody: "chase Arun",
  },
  entityTypeDefinition: {
    typeKey: "gym_session",
    displayName: "Gym Session",
    fields: [
      { fieldKey: "minutes", fieldKind: "number", label: "Minutes", required: true },
      // enumOptions is optional, so a schema/interface drift on it would not
      // show up in an intent that omits it. Populated deliberately.
      { fieldKey: "mood", fieldKind: "enum", label: "Mood", required: false, enumOptions: ["good", "bad"] },
    ],
  },
  entityRecord: { typeKey: "gym_session", values: { minutes: "45" } },
  eventTitle: "the Hult review",
};

function schemaProperties(): string[] {
  const intentSchema = EXTRACTION_INPUT_SCHEMA.properties.intents.items;
  return Object.keys(intentSchema.properties).sort();
}

describe("the three declarations agree", () => {
  it("isExtraction ACCEPTS an intent carrying every field", () => {
    // ⚠ THE INTENT_KEYS CHECK. `hasOnlyKeys` rejects unknown keys, so a field
    // present in the interface and the JSON schema but absent from
    // INTENT_KEYS makes this fail — which is the whole point, because in
    // production that discard is silent.
    expect(isExtraction({ intents: [FULLY_POPULATED] })).toBe(true);
  });

  it("the JSON schema declares a property for every field on the interface", () => {
    // The interface is compile-time only, so it cannot be enumerated at
    // runtime. `FULLY_POPULATED` is the bridge: it is TYPED as
    // ExtractedIntent, so the compiler guarantees its keys are valid fields,
    // and this asserts the schema knows all of them.
    //
    // Without this, a new field reaches the model's schema never — the API
    // rejects any response containing it, and the planner branch is dead.
    const onSchema = schemaProperties();
    for (const key of Object.keys(FULLY_POPULATED)) {
      expect(onSchema, `JSON schema is missing "${key}"`).toContain(key);
    }
  });

  it("the schema declares no property the interface lacks", () => {
    // The other direction: a stale schema property the contract dropped would
    // let the model emit something nothing reads.
    const onIntent = Object.keys(FULLY_POPULATED).sort();
    for (const key of schemaProperties()) {
      expect(onIntent, `interface is missing "${key}"`).toContain(key);
    }
  });
});

describe("isExtraction still rejects malformed new fields", () => {
  it("rejects a status outside the non-terminal set", () => {
    // "completed" is deliberately absent: completion has its own intent kind
    // and its own tool, where lateness is derived from two timestamptz
    // columns. A status field that accepted it would be a second completion
    // path skipping that derivation.
    const intent = { ...FULLY_POPULATED, newStatus: "completed" };
    expect(isExtraction({ intents: [intent] })).toBe(false);
  });

  it("rejects a condition missing a half", () => {
    const intent = {
      ...FULLY_POPULATED,
      condition: { subjectText: "the schema", action: "remind", actionBody: "chase" },
    };
    expect(isExtraction({ intents: [intent] })).toBe(false);
  });

  it("rejects an entity field with a non-boolean `required`", () => {
    const intent = {
      ...FULLY_POPULATED,
      entityTypeDefinition: {
        typeKey: "book",
        displayName: "Book",
        fields: [{ fieldKey: "title", fieldKind: "text", label: "Title", required: "yes" }],
      },
    };
    expect(isExtraction({ intents: [intent] })).toBe(false);
  });

  it("rejects entityRecord values that are not strings", () => {
    // The model states values as the user said them; the tool layer coerces
    // per field_kind. A number here would bypass that coercion.
    const intent = {
      ...FULLY_POPULATED,
      entityRecord: { typeKey: "gym_session", values: { minutes: 45 } },
    };
    expect(isExtraction({ intents: [intent] })).toBe(false);
  });

  it("still rejects an unknown key outright", () => {
    const intent = { ...FULLY_POPULATED, madeUpField: "nope" };
    expect(isExtraction({ intents: [intent] })).toBe(false);
  });
});
