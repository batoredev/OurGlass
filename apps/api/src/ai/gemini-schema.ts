/**
 * JSON Schema -> Gemini `Schema`.
 *
 * ================================ READ THIS ================================
 * The two dialects are NOT the same, and one difference is load-bearing.
 *
 * `additionalProperties` DOES NOT EXIST in Gemini's Schema. Our
 * `EXTRACTION_INPUT_SCHEMA` sets `additionalProperties: false` on every object
 * — that is what stops a model inventing a field — and Gemini simply has no
 * way to express it. So the converter drops it, and Gemini CAN return an
 * extra key.
 *
 * That is safe, and it is safe for a specific reason: `isExtraction` rejects
 * unknown keys itself (`hasOnlyKeys`), so a stray field fails validation,
 * becomes `schema_invalid`, and the router retries then falls back. The
 * provider's schema is a HINT; our validator is the authority. That asymmetry
 * is the whole point of a provider-neutral contract — three dialects, one
 * gate.
 *
 * The other difference is quieter: Gemini requires `type: STRING` alongside
 * `enum`, while our schema writes a bare `{ enum: [...] }`. Omitting the type
 * makes the enum silently unconstrained, which would let `kind` come back as
 * something that is not an intent kind at all.
 * ===========================================================================
 */

/** The subset of Gemini's `Schema` this converter emits. */
export interface GeminiSchema {
  type?: string;
  description?: string;
  enum?: string[];
  items?: GeminiSchema;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  nullable?: boolean;
}

const TYPE_BY_JSON_TYPE: Readonly<Record<string, string>> = {
  object: "OBJECT",
  array: "ARRAY",
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  null: "NULL",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Convert one JSON-Schema node.
 *
 * Unsupported keywords are DROPPED rather than approximated. An approximated
 * constraint is worse than an absent one: it reads as enforced while letting
 * something through, and the thing that actually enforces this contract is
 * `isExtraction` on the way back.
 */
export function toGeminiSchema(node: unknown): GeminiSchema {
  if (!isRecord(node)) return {};

  const out: GeminiSchema = {};

  const enumValues = node["enum"];
  if (Array.isArray(enumValues)) {
    out.enum = enumValues.map((value) => String(value));
    // REQUIRED alongside enum. Without it Gemini treats the field as an
    // unconstrained string and the enum stops being a constraint at all.
    out.type = "STRING";
  }

  const jsonType = node["type"];
  if (typeof jsonType === "string") {
    const mapped = TYPE_BY_JSON_TYPE[jsonType];
    if (mapped !== undefined) out.type = mapped;
  }

  const description = node["description"];
  if (typeof description === "string") out.description = description;

  const items = node["items"];
  if (items !== undefined) out.items = toGeminiSchema(items);

  const properties = node["properties"];
  if (isRecord(properties)) {
    const converted: Record<string, GeminiSchema> = {};
    for (const [key, value] of Object.entries(properties)) {
      converted[key] = toGeminiSchema(value);
    }
    out.properties = converted;
  }

  const required = node["required"];
  if (Array.isArray(required)) {
    out.required = required.filter((value): value is string => typeof value === "string");
  }

  // `additionalProperties` is deliberately NOT carried across — see the header.
  return out;
}
