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
      isTimeReferenceOrUndefined(intent.time);
  });
}

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
] as const;

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
