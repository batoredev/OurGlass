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

Set these OPTIONAL fields only when the utterance plainly calls for them; omitting one is always safe,
and inventing one creates state the user did not ask for:
- newStatus: the user changes an existing commitment's state ("the poster is blocked", "that's on hold").
  NOT for completion — "the poster is done" is completion_update.
- memoryBody: a durable fact worth keeping ("Arun handles the backend", "I prefer morning meetings").
  NOT for a passing remark, and NOT for something the user asks you to DO.
- correctionTarget: the user says something you hold is wrong ("no, Karthik handles it now", "forget
  that Arun works on backend"). Only when correcting, never when stating something new.
- condition: a conditional rule ("if Arun hasn't sent the schema by Friday, remind me"). deadlinePhrase
  stays verbatim.
- entityTypeDefinition: the user asks to start tracking a NEW kind of thing ("track my gym sessions with
  a date and a duration").
- entityRecord: the user logs one instance of a kind they already track ("log a 45 minute gym session").
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

/**
 * Mirrors `CommitmentStatusHint`. The two completed values and `superseded`
 * are ABSENT on purpose: completion has its own intent kind and its own tool,
 * where lateness is derived from two timestamptz columns. A status field that
 * could say "completed" would be a second completion path skipping that.
 */
const COMMITMENT_STATUS_HINTS = [
  "pending",
  "in_progress",
  "waiting",
  "waiting_on_someone",
  "blocked",
  "cancelled",
] as const;

/** §25's conditional, flattened — never a tree (DECISIONS.md #2). */
const CONDITION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subjectText: { type: "string" },
    // VERBATIM, like every other time phrase in this contract. chrono resolves
    // it from (text, instant, timezone); the model never computes a timestamp.
    deadlinePhrase: { type: "string" },
    action: { enum: ["remind", "ask"] },
    actionBody: { type: "string" },
  },
  required: ["subjectText", "deadlinePhrase", "action", "actionBody"],
} as const;

const ENTITY_FIELD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    fieldKey: { type: "string" },
    // The six closed kinds. An open kind space would let the model invent one
    // the frontend has no renderer for — the exact failure the dynamic-entity
    // requirement rules out.
    fieldKind: { enum: ["text", "number", "bool", "date", "enum", "person_ref"] },
    label: { type: "string" },
    required: { type: "boolean" },
  },
  required: ["fieldKey", "fieldKind", "label", "required"],
} as const;

const ENTITY_TYPE_DEFINITION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    typeKey: { type: "string" },
    displayName: { type: "string" },
    fields: { type: "array", items: ENTITY_FIELD_SCHEMA },
  },
  required: ["typeKey", "displayName", "fields"],
} as const;

const ENTITY_RECORD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    typeKey: { type: "string" },
    // A flat string map, NOT a typed object: the legal shape depends on rows
    // in entity_type_fields that only the tool layer can read at call time.
    // The model states values as the user said them; validation coerces and
    // rejects there, where the schema is actually known.
    values: { type: "object", additionalProperties: { type: "string" } },
  },
  required: ["typeKey", "values"],
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

    // ⚠ `additionalProperties: false` ABOVE MAKES THIS LIST LOAD-BEARING.
    // A field added to ExtractedIntent and NOT added here is not merely
    // unpopulated — the API REJECTS a response containing it. So the planner
    // branch that reads it can never fire, and nothing anywhere fails. That
    // is the same dead-on-arrival shape the `kind` comment above describes,
    // and it is why docs/PLANNER-WIRING-DESIGN.md orders the schema change
    // BEFORE the planner branch.
    newStatus: { enum: [...COMMITMENT_STATUS_HINTS] },
    memoryBody: { type: "string" },
    correctionTarget: { type: "string" },
    condition: CONDITION_SCHEMA,
    entityTypeDefinition: ENTITY_TYPE_DEFINITION_SCHEMA,
    entityRecord: ENTITY_RECORD_SCHEMA,
  },
  required: ["kind", "inferenceLevel", "sourceText"],
} as const;

export const EXTRACTION_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { intents: { type: "array", items: INTENT_SCHEMA } },
  required: ["intents"],
} as const;
