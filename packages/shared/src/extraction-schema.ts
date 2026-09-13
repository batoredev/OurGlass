/** Shared, versioned model-output contract for the API extractor and live evals. */
import { INTENT_KINDS } from "./assistant-contract.js";

export const EXTRACTION_TOOL_NAME = "extract_intents";

/**
 * The extraction model, defined ONCE for every lane that calls the API.
 *
 * Owner decision: this product runs on Sonnet and Haiku only — no Opus. That is
 * a cost/tier decision, and it costs us something real: Opus's stronger tendency
 * to ASK for a missing parameter rather than infer one (spec §27, "never guess
 * when guessing can cause a meaningful mistake"). `isExtraction`,
 * `validateIntentCompleteness`, and the eval harness carry that weight instead.
 *
 * This lives in the shared contract because the literal previously appeared in
 * two places — apps/api's extractor and the live eval lane — and drifted twice
 * in a single session. Two lanes disagreeing about which model they measure
 * makes every eval number unattributable. Import it; do not retype it.
 */
export const EXTRACTION_MODEL = "claude-sonnet-5" as const;

export const EXTRACTION_SYSTEM_PROMPT = `You interpret a personal-assistant user's single utterance.
Return the extract_intents tool call and nothing else. Extract one or more intents using exactly
these categories: ${INTENT_KINDS.join(", ")}.
Mark every intent CONFIRMED when explicit, INFERRED only when strongly supported by the utterance,
or UNCERTAIN when it needs clarification. Preserve time words verbatim in time.sourcePhrase; NEVER
calculate, guess, normalize, or emit an ISO timestamp. Classify calendar-like phrases as deterministic,
references such as "before the meeting" as relational, and state-dependent phrases such as "after Arun
replies" as event_trigger. Keep entity names as mentions, never IDs. A message that requests an external
action is execution, not permission to carry it out.
Use inspection when the user asks to SEE existing state — "what am I waiting on", "what does Barkha owe
me", "what do I owe Hult", "what do you know about Arun". Use question only for something outside that.
Do not invent commitments, people, dates, or context.`;

const ENTITY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    kind: { enum: ["person", "organization", "project", "unknown"] },
    inferenceLevel: { enum: ["CONFIRMED", "INFERRED", "UNCERTAIN"] },
  },
  required: ["name", "kind", "inferenceLevel"],
} as const;

const TIME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { enum: ["deterministic", "relational", "event_trigger"] },
    sourcePhrase: { type: "string" },
  },
  required: ["kind", "sourcePhrase"],
} as const;

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    // DERIVED from INTENT_KINDS, never retyped. This was a hardcoded literal,
    // and it is exactly the drift this file's own header warns about: adding
    // `inspection` to the taxonomy would otherwise have left the model unable
    // to EMIT one, so the new kind would be dead on arrival with nothing
    // failing — the validator would accept it, the planner would handle it,
    // and the model would simply never produce it.
    kind: { enum: [...INTENT_KINDS] },
    inferenceLevel: { enum: ["CONFIRMED", "INFERRED", "UNCERTAIN"] },
    sourceText: { type: "string" },
    owner: ENTITY_SCHEMA,
    recipient: ENTITY_SCHEMA,
    objectText: { type: "string" },
    time: TIME_SCHEMA,
    reminderBody: { type: "string" },
    relatedEntity: ENTITY_SCHEMA,
  },
  required: ["kind", "inferenceLevel", "sourceText"],
} as const;

export const EXTRACTION_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { intents: { type: "array", items: INTENT_SCHEMA } },
  required: ["intents"],
} as const;
