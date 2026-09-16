/**
 * The JSON Schema -> Gemini Schema converter.
 *
 * The interesting assertions are about what is DROPPED and what is ADDED,
 * because both are places a silent constraint loss would hide.
 */
import { describe, expect, it } from "vitest";
import { EXTRACTION_INPUT_SCHEMA, INTENT_KINDS } from "@ourglass/shared";
import { toGeminiSchema } from "./gemini-schema.js";

describe("toGeminiSchema", () => {
  it("converts the real extraction schema without losing the intents array", () => {
    const converted = toGeminiSchema(EXTRACTION_INPUT_SCHEMA);

    expect(converted.type).toBe("OBJECT");
    expect(converted.required).toEqual(["intents"]);
    expect(converted.properties?.["intents"]?.type).toBe("ARRAY");
    expect(converted.properties?.["intents"]?.items?.type).toBe("OBJECT");
  });

  it("DROPS additionalProperties, because Gemini has no such field", () => {
    // Carrying it would produce a schema Gemini rejects outright; the
    // constraint it expressed is enforced by isExtraction instead.
    const converted = toGeminiSchema(EXTRACTION_INPUT_SCHEMA);
    expect(converted).not.toHaveProperty("additionalProperties");
    expect(converted.properties?.["intents"]?.items).not.toHaveProperty("additionalProperties");
  });

  it("ADDS type STRING alongside every enum", () => {
    // Without it Gemini treats the field as an unconstrained string and the
    // enum silently stops constraining anything — so `kind` could come back
    // as a value that is not an intent kind at all.
    const intent = toGeminiSchema(EXTRACTION_INPUT_SCHEMA).properties?.["intents"]?.items;
    const kind = intent?.properties?.["kind"];

    expect(kind?.type).toBe("STRING");
    expect(kind?.enum).toEqual([...INTENT_KINDS]);
  });

  it("carries every intent kind through, derived rather than restated", () => {
    // If the taxonomy grows, the converted schema must grow with it. A
    // hardcoded list here would be another declaration of INTENT_KINDS.
    const intent = toGeminiSchema(EXTRACTION_INPUT_SCHEMA).properties?.["intents"]?.items;
    expect(intent?.properties?.["kind"]?.enum).toHaveLength(INTENT_KINDS.length);
  });

  it("maps the scalar types", () => {
    const converted = toGeminiSchema({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
        c: { type: "boolean" },
        d: { type: "integer" },
        e: { type: "array", items: { type: "string" } },
      },
    });

    expect(converted.properties?.["a"]?.type).toBe("STRING");
    expect(converted.properties?.["b"]?.type).toBe("NUMBER");
    expect(converted.properties?.["c"]?.type).toBe("BOOLEAN");
    expect(converted.properties?.["d"]?.type).toBe("INTEGER");
    expect(converted.properties?.["e"]?.items?.type).toBe("STRING");
  });

  it("drops an unsupported keyword rather than approximating it", () => {
    // An approximated constraint reads as enforced while letting things
    // through. Absent is more honest, and isExtraction is the real gate.
    const converted = toGeminiSchema({
      type: "string",
      pattern: "^x",
      additionalProperties: false,
      unevaluatedProperties: false,
      $comment: "ignored",
    });

    expect(converted).toEqual({ type: "STRING" });
  });

  it("survives a non-object node without throwing", () => {
    expect(toGeminiSchema(null)).toEqual({});
    expect(toGeminiSchema("nonsense")).toEqual({});
  });
});
