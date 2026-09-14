/**
 * Contracts at the Interpret -> Resolve boundary.
 *
 * These deliberately hold natural-language mentions, never database identifiers.
 * Resolving a name to a UUID is a deterministic backend responsibility; allowing a
 * model to fabricate UUIDs would bypass the Phase 1 validated tool boundary.
 */

export const INTENT_KINDS = [
  "information",
  "action",
  "completion_update",
  "context",
  "question",
  "execution",
  /**
   * §28 — "What am I waiting on?", "What does Barkha owe me?", "What do you
   * know about Arun?"
   *
   * DISTINCT FROM `question`, and the distinction is load-bearing. `question`
   * is the honest-decline path for anything the assistant cannot answer;
   * `inspection` is a request for STRUCTURED STATE it can answer exactly, from
   * a `WHERE` clause. Collapsing them would either decline answerable
   * questions or route answerable ones through an approximate index — and a
   * vector search can MISS a row that SQL returns, which for "what does
   * Barkha owe me" means a commitment silently vanishing from the surface the
   * user relies on to catch mistakes (PHASE-4-DESIGN §5, finding F11).
   *
   * An inspection turn MUTATES NOTHING: no tool call, no turn_id, no
   * action_log row.
   */
  "inspection",
] as const;

export type IntentKind = (typeof INTENT_KINDS)[number];

export const INFERENCE_LEVELS = ["CONFIRMED", "INFERRED", "UNCERTAIN"] as const;

export type InferenceLevel = (typeof INFERENCE_LEVELS)[number];

export type TimeReferenceKind = "deterministic" | "relational" | "event_trigger";

export interface TimeReference {
  readonly kind: TimeReferenceKind;
  /** Exact words from the user; an LLM never supplies a calculated timestamp. */
  readonly sourcePhrase: string;
}

export interface EntityMention {
  readonly name: string;
  readonly kind: "person" | "organization" | "project" | "unknown";
  readonly inferenceLevel: InferenceLevel;
}

/**
 * A non-terminal status the user named. Mirrors `commitment_status` MINUS the
 * two completed values and `superseded`.
 *
 * Completion has its own intent kind and its own tool, because lateness is
 * derived there from two timestamptz columns (PHASE-3-DESIGN §2). Letting a
 * status field say "completed" would create a second completion path that
 * skips that derivation — so the type forbids it rather than the validator
 * catching it later.
 */
export type CommitmentStatusHint =
  | "pending"
  | "in_progress"
  | "waiting"
  | "waiting_on_someone"
  | "blocked"
  | "cancelled";

/**
 * §25's conditional, FLATTENED to one level. "If Arun hasn't sent the schema
 * by Friday, remind me."
 *
 * Not a tree: DECISIONS.md #2 records that recursive schemas are unsupported
 * under Anthropic's strict subset, and a shape the model cannot emit is a
 * shape we must not accept. Compound conditions ("if X and Y") are rejected
 * at tool validation with a clean error rather than half-stored.
 */
export interface ConditionReference {
  /** What is being waited on, in the user's words. Matched to a commitment. */
  readonly subjectText: string;
  /** The deadline phrase, VERBATIM. chrono resolves it; the model never does. */
  readonly deadlinePhrase: string;
  /** What to do when the condition holds. */
  readonly action: "remind" | "ask";
  /** The reminder or question text. */
  readonly actionBody: string;
}

/** One field of a type the user asked to track. */
export interface EntityFieldHint {
  readonly fieldKey: string;
  /** Must be one of the six closed kinds; validated at the tool boundary. */
  readonly fieldKind: string;
  readonly label: string;
  readonly required: boolean;
}

/** §36 — "track my gym sessions with a date and a duration". */
export interface EntityTypeDefinitionHint {
  readonly typeKey: string;
  readonly displayName: string;
  readonly fields: readonly EntityFieldHint[];
}

/** §36 — one instance: "log a 45 minute gym session today". */
export interface EntityRecordHint {
  readonly typeKey: string;
  /** Field key -> value, as the user stated it. Validated against the type. */
  readonly values: Readonly<Record<string, string>>;
}

export interface ExtractedIntent {
  readonly kind: IntentKind;
  readonly inferenceLevel: InferenceLevel;
  readonly sourceText: string;
  readonly owner?: EntityMention;
  readonly recipient?: EntityMention;
  readonly objectText?: string;
  readonly time?: TimeReference;
  readonly reminderBody?: string;
  readonly relatedEntity?: EntityMention;

  // -------------------------------------------------------------------------
  // Fields added to make the built-but-unreachable tools reachable.
  // See docs/PLANNER-WIRING-DESIGN.md.
  //
  // EVERY ONE IS OPTIONAL, deliberately. The 69 Phase 2 eval fixtures are the
  // only evidence the extractor behaves at all, and a required field would
  // invalidate all of them at once. They are also FIELDS rather than new
  // intent kinds: "the poster is blocked" is an `information` intent with a
  // status, not a different ACT. A kind per tool would turn IntentKind into a
  // list of function names, which is exactly what a taxonomy should spare the
  // model from choosing between.
  // -------------------------------------------------------------------------

  /** §22 — "the poster is blocked", "push that to Friday". update_commitment. */
  readonly newStatus?: CommitmentStatusHint;

  /** §16 — a durable fact to store, in the user's words. remember. */
  readonly memoryBody?: string;

  /**
   * §17/§28 — what to stop treating as true: "forget that Arun works on
   * backend", "no, Karthik handles it now". Drives forget_memory and
   * correct_relationship, which differ only in whether a REPLACEMENT was also
   * stated — a correction names both halves, a forget names one.
   */
  readonly correctionTarget?: string;

  /** §25 — the flattened conditional. create_workflow. */
  readonly condition?: ConditionReference;

  /** §36 — a type the user asked to track. define_entity_type. */
  readonly entityTypeDefinition?: EntityTypeDefinitionHint;

  /** §36 — one instance of an existing type. create_entity_record. */
  readonly entityRecord?: EntityRecordHint;
}

export interface Extraction {
  readonly intents: readonly ExtractedIntent[];
}

export interface ExtractionUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /**
   * Prompt-cache accounting. The ~200-token system prompt is resent on every
   * request, so caching is the obvious cost lever and these two fields are the
   * only way to tell whether it is working — DECISIONS.md open question 4
   * cannot be answered without them. Optional because a response may omit them.
   */
  readonly cacheCreationInputTokens?: number;
  readonly cacheReadInputTokens?: number;
}

export interface ExtractionTrace {
  readonly model: string;
  readonly latencyMs: number;
  readonly usage: ExtractionUsage;
  readonly requestId?: string;
  /**
   * Why the model stopped. `tool_use` is the only value that means "this
   * interpretation is complete"; see AnthropicExtractor for the failure taxonomy.
   */
  readonly stopReason?: string | null;
}

export interface ExtractionResult {
  readonly extraction: Extraction;
  readonly trace: ExtractionTrace;
}

/**
 * A required field an intent kind did not supply.
 *
 * Structured on purpose. Anthropic's strict-schema subset genuinely cannot
 * express "an `information` intent requires an owner" — `required` is per-object,
 * not conditional on a sibling's value — so completeness is enforced here,
 * after parsing, instead.
 *
 * The point of returning a REASON rather than throwing is spec §11: the
 * assistant's correct response to a missing owner is to ASK ("who do you mean?"),
 * not to error. A boolean could not drive that question. Phase 3 turns each of
 * these into a clarification; the alternative is discovering it at the Phase 1
 * tool boundary where `commitments.owner_id NOT NULL` rejects it, one layer too
 * late and unable to distinguish "the model omitted it" from "the user never
 * said it".
 */
export interface IntentCompletenessIssue {
  /** Index into `Extraction.intents`, so a caller can ask about the right one. */
  readonly intentIndex: number;
  readonly kind: IntentKind;
  readonly missingField: "owner" | "objectText" | "reminderBody" | "time";
  readonly sourceText: string;
  /**
   * Whether Phase 3 must resolve this before it can write.
   *
   * `blocking` means a NOT NULL column has no value — ask the user.
   * `advisory` means the intent is writable without it, but a caller that
   * intends to create a COMMITMENT from this intent still needs it.
   *
   * This distinction exists because "information" is two different things
   * wearing one label — see COMMITMENT_BEARING_NOTE.
   */
  readonly severity: "blocking" | "advisory";
}

/**
 * WHY `information` DOES NOT REQUIRE AN OWNER.
 *
 * `commitments.owner_id` is NOT NULL, so it is tempting to require `owner` on
 * every `information` intent. That is wrong, and the eval harness proved it:
 * four correctly-labelled CONFIRMED fixtures have no owner and should not —
 *
 *   "The poster is blocked until Karthik approves it."
 *   "The CRM project needs a backend review."
 *   "The Hult meeting is cancelled."
 *   "The MTTN call happened yesterday."
 *
 * These are statements of FACT. Nobody owes anything, so there is no owner to
 * supply, and demanding one would force the model to invent a person — the
 * exact fabrication the system prompt forbids. Worse, if Phase 3 turned every
 * completeness issue into a question, the assistant would ask "who owns 'the
 * Hult meeting is cancelled'?" — nonsense, and precisely the over-asking spec
 * §27 exists to prevent.
 *
 * So `information` covers both commitment-bearing statements ("Barkha needs to
 * give me the article") and ownerless facts, and only the former can become a
 * row in `commitments`. Rather than split the spec §5 kind — which would put
 * this contract out of step with the spec's own six categories — `owner` is
 * reported as ADVISORY: present in the result so a commitment-creating caller
 * can see it is missing, but never on its own a reason to interrogate the user.
 *
 * Phase 3 rule: ask about `blocking` issues; treat `advisory` as "do not create
 * a commitment from this intent", not as "ask a question".
 */
interface FieldRequirement {
  readonly field: IntentCompletenessIssue["missingField"];
  readonly severity: IntentCompletenessIssue["severity"];
}

/**
 * Fields each intent kind must carry to be actionable in Phase 3.
 *
 * Blocking entries are derived from NOT NULL columns in the Phase 1 schema, not
 * from taste. `context`, `question`, and `execution` require nothing: a question
 * is a retrieval, and `execution` never writes state in Phase 2 (spec §5 — it is
 * a request, not permission to act).
 */
const REQUIRED_INTENT_FIELDS: Readonly<Record<IntentKind, readonly FieldRequirement[]>> = {
  // objectText is blocking because `commitments.object_text` is NOT NULL and
  // there is nothing to record without it. owner is advisory — see above.
  information: [
    { field: "objectText", severity: "blocking" },
    { field: "owner", severity: "advisory" },
  ],
  action: [{ field: "reminderBody", severity: "blocking" }],
  completion_update: [{ field: "objectText", severity: "blocking" }],
  context: [],
  question: [],
  execution: [],
  /**
   * NOTHING IS REQUIRED, and that is deliberate rather than an omission.
   *
   * An inspection is a READ. "What am I waiting on?" carries no owner, no
   * objectText and no time, and demanding any of them would turn the most
   * natural §28 question into a clarification — the over-asking §27 forbids.
   *
   * The planner narrows an under-specified inspection by ASKING only when the
   * utterance genuinely names a person it cannot resolve; an unresolvable
   * query degrades to "nothing outstanding" or an honest decline, never to a
   * blocked turn. A read that returns nothing costs the user nothing.
   */
  inspection: [],
};

/**
 * Returns every missing required field across the extraction. An empty array
 * means "complete"; it never throws, because an incomplete interpretation is a
 * question to ask, not an exception to raise.
 *
 * Callers that only care about what must be asked should filter to
 * `severity === "blocking"`.
 */
export function validateIntentCompleteness(
  extraction: Extraction,
): readonly IntentCompletenessIssue[] {
  const issues: IntentCompletenessIssue[] = [];
  extraction.intents.forEach((intent, intentIndex) => {
    for (const requirement of REQUIRED_INTENT_FIELDS[intent.kind]) {
      if (intent[requirement.field] === undefined) {
        issues.push({
          intentIndex,
          kind: intent.kind,
          missingField: requirement.field,
          sourceText: intent.sourceText,
          severity: requirement.severity,
        });
      }
    }
  });
  return issues;
}

export function isInferenceLevel(value: unknown): value is InferenceLevel {
  return typeof value === "string" && (INFERENCE_LEVELS as readonly string[]).includes(value);
}

/**
 * Runtime mirror of EXTRACTION_INPUT_SCHEMA, including its
 * `additionalProperties: false` — see the ONLY-KEYS note below for why that
 * matters at this boundary specifically.
 *
 * Rejects an empty `intents` array: zero intents is a FAILURE to interpret the
 * utterance, not a valid interpretation of it. Accepting `[]` here would let a
 * refusal or a truncation reach Phase 3 disguised as "the user said nothing
 * actionable", which is silently wrong for every utterance in the spec.
 */
export function isExtraction(value: unknown): value is Extraction {
  if (!isRecord(value) || !hasOnlyKeys(value, ["intents"])) return false;
  if (!Array.isArray(value.intents) || value.intents.length === 0) return false;

  return value.intents.every((intent) => {
    if (!isRecord(intent) || !hasOnlyKeys(intent, INTENT_KEYS)) return false;
    if (typeof intent.kind !== "string" || !(INTENT_KINDS as readonly string[]).includes(intent.kind)) {
      return false;
    }
    if (!isInferenceLevel(intent.inferenceLevel) || typeof intent.sourceText !== "string") return false;

    return [intent.owner, intent.recipient, intent.relatedEntity].every(isEntityMentionOrUndefined) &&
      isStringOrUndefined(intent.objectText) &&
      isStringOrUndefined(intent.reminderBody) &&
      isTimeReferenceOrUndefined(intent.time) &&
      // The planner-wiring fields. Each is optional, so `undefined` passes —
      // but a present value of the wrong shape must NOT, or a malformed
      // condition reaches the tool layer disguised as a valid one.
      isStatusHintOrUndefined(intent.newStatus) &&
      isStringOrUndefined(intent.memoryBody) &&
      isStringOrUndefined(intent.correctionTarget) &&
      isConditionOrUndefined(intent.condition) &&
      isTypeDefinitionOrUndefined(intent.entityTypeDefinition) &&
      isEntityRecordOrUndefined(intent.entityRecord);
  });
}

/**
 * ⚠ THE THIRD DECLARATION OF THE FIELD LIST, and the one that silently eats
 * new fields.
 *
 * `hasOnlyKeys(intent, INTENT_KEYS)` REJECTS any intent carrying a key absent
 * from this array. So adding a field to `ExtractedIntent` and to the JSON
 * schema is still not enough: without a line here the extraction is discarded
 * WHOLESALE — not the field, the whole intent — and the planner branch never
 * fires. Nothing fails; extraction just quietly returns less.
 *
 * Three places must agree for one field to work: this list, the interface,
 * and `extraction-schema.ts`'s `INTENT_SCHEMA`. That is one more than the two
 * the planner-wiring design anticipated, and it is why the design's
 * "verify the whole path" rule exists.
 */
const INTENT_KEYS = [
  "kind",
  "inferenceLevel",
  "sourceText",
  "owner",
  "recipient",
  "objectText",
  "time",
  "reminderBody",
  "relatedEntity",
  "newStatus",
  "memoryBody",
  "correctionTarget",
  "condition",
  "entityTypeDefinition",
  "entityRecord",
] as const;

const STATUS_HINTS: readonly string[] = [
  "pending",
  "in_progress",
  "waiting",
  "waiting_on_someone",
  "blocked",
  "cancelled",
];

function isStatusHintOrUndefined(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && STATUS_HINTS.includes(value));
}

function isConditionOrUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, CONDITION_KEYS)) return false;
  return (
    typeof value.subjectText === "string" &&
    typeof value.deadlinePhrase === "string" &&
    (value.action === "remind" || value.action === "ask") &&
    typeof value.actionBody === "string"
  );
}

function isTypeDefinitionOrUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, TYPE_DEF_KEYS)) return false;
  if (typeof value.typeKey !== "string" || typeof value.displayName !== "string") return false;
  if (!Array.isArray(value.fields)) return false;
  return value.fields.every(
    (field) =>
      isRecord(field) &&
      hasOnlyKeys(field, FIELD_KEYS) &&
      typeof field.fieldKey === "string" &&
      typeof field.fieldKind === "string" &&
      typeof field.label === "string" &&
      typeof field.required === "boolean",
  );
}

function isEntityRecordOrUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, ENTITY_RECORD_KEYS)) return false;
  if (typeof value.typeKey !== "string" || !isRecord(value.values)) return false;
  // Values are strings as the user stated them; the tool layer coerces per
  // field_kind, where the schema is actually known.
  return Object.values(value.values).every((entry) => typeof entry === "string");
}

const CONDITION_KEYS = ["subjectText", "deadlinePhrase", "action", "actionBody"] as const;
const TYPE_DEF_KEYS = ["typeKey", "displayName", "fields"] as const;
const FIELD_KEYS = ["fieldKey", "fieldKind", "label", "required"] as const;
const ENTITY_RECORD_KEYS = ["typeKey", "values"] as const;

const ENTITY_KEYS = ["name", "kind", "inferenceLevel"] as const;
const TIME_KEYS = ["kind", "sourcePhrase"] as const;

/**
 * ONLY-KEYS, not "has the keys we read".
 *
 * The JSON Schema sets `additionalProperties: false` at every level, but a
 * `strict` tool is the model's contract, not a guarantee about the bytes that
 * arrive here. This guard is the trust boundary (docs/PHASE-1-DESIGN.md §3):
 * an unexpected key means the payload is not the shape we agreed on, so we
 * reject rather than pass the extra through.
 *
 * Concretely, this is what stops an injected `ownerId` — a key that LOOKS like
 * a resolved database identifier — from riding an otherwise-valid extraction
 * into Phase 3. Model output must never supply UUIDs; Resolve owns that.
 */
function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isEntityMentionOrUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, ENTITY_KEYS)) return false;
  return (
    typeof value.name === "string" &&
    typeof value.kind === "string" &&
    ["person", "organization", "project", "unknown"].includes(value.kind) &&
    isInferenceLevel(value.inferenceLevel)
  );
}

function isTimeReferenceOrUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnlyKeys(value, TIME_KEYS)) return false;
  return (
    typeof value.sourcePhrase === "string" &&
    typeof value.kind === "string" &&
    ["deterministic", "relational", "event_trigger"].includes(value.kind)
  );
}

function isStringOrUndefined(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
