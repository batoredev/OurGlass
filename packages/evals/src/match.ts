/**
 * The extraction comparator.
 *
 * Everything in the eval harness trusts this file, so it is deliberately small,
 * total, and separately unit-tested (see match.test.ts).
 *
 * Design constraints, each traceable to a decision record:
 *
 * - **Ownership direction is the product.** Spec §7 makes "who owes whom" the
 *   differentiator and DECISIONS.md #9 calls getting it wrong the worst failure
 *   in the system. `owner` and `recipient` are therefore compared positionally by
 *   normalized name: swapping them MUST produce a non-match. This is the single
 *   most important assertion in the harness.
 *
 * - **Resolved timestamps are never compared.** DECISIONS.md #4 / the extraction
 *   system prompt forbid the model from emitting a calculated instant; only the
 *   verbatim `sourcePhrase` is contractual. `chrono-node` resolves phrases later,
 *   deterministically, outside the model. So we compare `time.kind` exactly and
 *   `time.sourcePhrase` normalized — never a date.
 *
 * - **Free text is normalized, not exact.** Model wording varies ("the article"
 *   vs "The article."). Exact string equality would make the harness flap and
 *   train us to ignore it. But absent-vs-present is always a failure: a dropped
 *   `objectText` or a dropped `time` is a real regression, not a wording change.
 *
 * - **Expected fields are asserted; unspecified fields are ignored.** A fixture
 *   that does not label `reminderBody` does not constrain it. This keeps fixtures
 *   honest — you assert what you actually hand-labelled, and adding a label
 *   strengthens the fixture without rewriting the comparator.
 *
 * - **Intent order is not load-bearing.** "Barkha needs to give me the article by
 *   6. Remind me at 5 to ask her." legitimately yields the commitment and the
 *   reminder in either order. Intents are matched as a multiset via exact
 *   bipartite matching (Kuhn's algorithm), not index-by-index, so a reordered but
 *   correct extraction passes while a genuinely wrong one still fails.
 *
 * - **`sourceText` is not compared.** Utterance segmentation is a model style
 *   choice ("Barkha gave the article at 11" vs "Barkha gave the article at 11.").
 *   The structured fields carry the meaning; asserting segmentation would fail
 *   correct extractions.
 */
import type {
  CommitmentStatusHint,
  ConditionReference,
  EntityMention,
  EntityRecordHint,
  EntityTypeDefinitionHint,
  Extraction,
  ExtractedIntent,
  TimeReference,
} from "@ourglass/shared";
import { isFirstPersonMention } from "@ourglass/api/assistant";

/**
 * The optional fields a fixture may assert must be ABSENT.
 *
 * Only the six added for the stranded tools (docs/PLANNER-WIRING-DESIGN.md).
 * Each is a way for the model to OVER-trigger, and the comparator's normal rule
 * -- an unlabelled field is unconstrained -- cannot catch that by construction.
 */
export type ForbiddableField =
  | "newStatus"
  | "memoryBody"
  | "correctionTarget"
  | "condition"
  | "entityTypeDefinition"
  | "entityRecord"
  | "eventTitle";

export const FORBIDDABLE_FIELDS: readonly ForbiddableField[] = [
  "newStatus",
  "memoryBody",
  "correctionTarget",
  "condition",
  "entityTypeDefinition",
  "entityRecord",
  "eventTitle",
];

/**
 * Lowercase, strip punctuation, collapse whitespace.
 *
 * Deliberately lossy so that "The article." and "the article" compare equal,
 * while "the article" and "the poster" — and crucially "" and "the article" —
 * do not.
 */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Entity identity is the normalized name only.
 *
 * `kind` (person/organization/...) and the entity's own `inferenceLevel` are
 * genuinely ambiguous for a model — "Hult" is defensibly a person or an
 * organization at extraction time, and Resolve settles it against the database
 * in Phase 3. Asserting them here would fail correct extractions for a judgement
 * call the model is not the authority on. The *name*, and which slot it occupies,
 * is what carries ownership direction.
 */
function entityMatches(actual: EntityMention | undefined, expected: EntityMention | undefined): boolean {
  if (expected === undefined) return true;
  if (actual === undefined) return false;
  // "I" and "me" are the same party to the app — the resolver short-circuits
  // every first-person mention to the user (resolve.ts). Scoring them as
  // different failed fixtures whose writes would have been identical; the
  // matcher judges what the app would DO, so it uses the app's own test.
  if (isFirstPersonMention(actual.name) && isFirstPersonMention(expected.name)) return true;
  return normalizeText(actual.name) === normalizeText(expected.name);
}

/**
 * Time compares `kind` exactly and `sourcePhrase` normalized.
 *
 * `kind` is exact because the three tiers drive completely different downstream
 * behaviour: deterministic goes to chrono-node, relational and event_trigger do
 * not. Mixing them is a real bug. The phrase is normalized but must be present.
 */
function timeMatches(actual: TimeReference | undefined, expected: TimeReference | undefined): boolean {
  if (expected === undefined) return true;
  if (actual === undefined) return false;
  if (actual.kind !== expected.kind) return false;
  return normalizeText(actual.sourcePhrase) === normalizeText(expected.sourcePhrase);
}

function optionalTextMatches(actual: string | undefined, expected: string | undefined): boolean {
  if (expected === undefined) return true;
  if (actual === undefined) return false;
  return normalizeText(actual) === normalizeText(expected);
}

/**
 * True when `actual` is an acceptable extraction of the single intent `expected`.
 *
 * Exported for the comparator's own tests and for diagnosing a live-lane failure
 * down to the individual intent.
 */
/**
 * A closed enum, so exact. There is no wording variance to absorb: the model
 * either picked the value the utterance implies or it did not, and each value
 * drives a different `commitments.status` write.
 */
function statusMatches(
  actual: CommitmentStatusHint | undefined,
  expected: CommitmentStatusHint | undefined,
): boolean {
  if (expected === undefined) return true;
  return actual === expected;
}

/** Present and non-blank. Used where the TEXT is wording but its absence is a bug. */
function isPresent(value: string | undefined): boolean {
  return typeof value === "string" && normalizeText(value) !== "";
}

/**
 * The conditional (spec 25).
 *
 * `action` is exact (a closed enum choosing between two different tools) and
 * `deadlinePhrase` is compared normalized because the prompt forbids the model
 * from paraphrasing it -- chrono-node parses those exact words later, so a
 * paraphrase is a real defect, not a style choice.
 *
 * `subjectText` and `actionBody` are checked for PRESENCE only. Both are whole
 * clauses rather than the short noun phrases `objectText` holds, and there are
 * many faithful renderings of "Arun hasn't sent the schema". Asserting equality
 * would make the lane flap and train us to ignore it -- the failure this file's
 * header already warns about.
 */
function conditionMatches(
  actual: ConditionReference | undefined,
  expected: ConditionReference | undefined,
): boolean {
  if (expected === undefined) return true;
  if (actual === undefined) return false;
  return (
    actual.action === expected.action &&
    normalizeText(actual.deadlinePhrase) === normalizeText(expected.deadlinePhrase) &&
    isPresent(actual.subjectText) &&
    isPresent(actual.actionBody)
  );
}

/**
 * A type definition (spec 36).
 *
 * Compares what the TOOL BOUNDARY validates: the type key, and the field keys
 * with their kinds. `displayName`, per-field `label`, and `required` are
 * ignored -- they are presentation and a judgement call the model is not the
 * authority on, exactly like `EntityMention.kind` above.
 *
 * `fieldKind` is exact because it is one of six closed values that decide how
 * the frontend renders the column with no code change. Getting it wrong is the
 * difference between a date picker and a text box.
 */
function typeDefinitionMatches(
  actual: EntityTypeDefinitionHint | undefined,
  expected: EntityTypeDefinitionHint | undefined,
): boolean {
  if (expected === undefined) return true;
  if (actual === undefined) return false;
  if (normalizeText(actual.typeKey) !== normalizeText(expected.typeKey)) return false;

  const actualKinds = new Map(actual.fields.map((field) => [normalizeText(field.fieldKey), field.fieldKind]));
  if (actualKinds.size !== expected.fields.length) return false;
  return expected.fields.every((field) => actualKinds.get(normalizeText(field.fieldKey)) === field.fieldKind);
}

/**
 * One record of an existing type (spec 36).
 *
 * Key set is exact -- an unknown key is rejected outright by validation, so a
 * wrong one is a failed write rather than a wording difference. The VALUES are
 * presence-only: "45", "45 minutes" and "forty-five" are the user's words, and
 * coercion happens at the tool boundary against the registered field kind.
 */
function entityRecordMatches(
  actual: EntityRecordHint | undefined,
  expected: EntityRecordHint | undefined,
): boolean {
  if (expected === undefined) return true;
  if (actual === undefined) return false;
  if (normalizeText(actual.typeKey) !== normalizeText(expected.typeKey)) return false;

  const actualKeys = new Map(Object.entries(actual.values).map(([key, value]) => [normalizeText(key), value]));
  const expectedKeys = Object.keys(expected.values);
  if (actualKeys.size !== expectedKeys.length) return false;
  return expectedKeys.every((key) => isPresent(actualKeys.get(normalizeText(key))));
}

export function intentMatches(actual: ExtractedIntent, expected: ExtractedIntent): boolean {
  return (
    actual.kind === expected.kind &&
    actual.inferenceLevel === expected.inferenceLevel &&
    // Positional, and therefore direction-sensitive. A swap fails here.
    entityMatches(actual.owner, expected.owner) &&
    entityMatches(actual.recipient, expected.recipient) &&
    entityMatches(actual.relatedEntity, expected.relatedEntity) &&
    optionalTextMatches(actual.objectText, expected.objectText) &&
    optionalTextMatches(actual.reminderBody, expected.reminderBody) &&
    timeMatches(actual.time, expected.time) &&
    // The six fields that make the stranded tools reachable. Added late, and
    // their absence here made every fixture asserting one of them DECORATIVE:
    // an extraction that omitted newStatus entirely still matched a fixture
    // that labelled it.
    statusMatches(actual.newStatus, expected.newStatus) &&
    optionalTextMatches(actual.memoryBody, expected.memoryBody) &&
    optionalTextMatches(actual.correctionTarget, expected.correctionTarget) &&
    conditionMatches(actual.condition, expected.condition) &&
    typeDefinitionMatches(actual.entityTypeDefinition, expected.entityTypeDefinition) &&
    entityRecordMatches(actual.entityRecord, expected.entityRecord) &&
    optionalTextMatches(actual.eventTitle, expected.eventTitle)
  );
}

/**
 * Exact bipartite matching (Kuhn's algorithm) between expected and actual intents.
 *
 * Greedy first-fit is wrong here: with two similar expected intents, greedily
 * consuming the only actual that matches the second would fail a set that does
 * in fact match perfectly. Sizes are tiny (1-3 intents), so the O(V*E) cost is
 * irrelevant and correctness is worth the extra dozen lines.
 */
function hasPerfectMatching(actual: readonly ExtractedIntent[], expected: readonly ExtractedIntent[]): boolean {
  const assignedTo: number[] = new Array<number>(actual.length).fill(-1);

  const tryAssign = (expectedIndex: number, seen: boolean[]): boolean => {
    for (let actualIndex = 0; actualIndex < actual.length; actualIndex += 1) {
      const candidate = actual[actualIndex];
      const wanted = expected[expectedIndex];
      if (candidate === undefined || wanted === undefined) continue;
      if (seen[actualIndex] === true || !intentMatches(candidate, wanted)) continue;
      seen[actualIndex] = true;
      const holder = assignedTo[actualIndex];
      if (holder === undefined || holder === -1 || tryAssign(holder, seen)) {
        assignedTo[actualIndex] = expectedIndex;
        return true;
      }
    }
    return false;
  };

  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
    if (!tryAssign(expectedIndex, new Array<boolean>(actual.length).fill(false))) return false;
  }
  return true;
}

/**
 * True when `actual` is an acceptable extraction of `expected`.
 *
 * Intent count must match exactly — a missing intent (the reminder never
 * created) and a spurious one (an invented commitment) are both real failures.
 * Order is not significant; see hasPerfectMatching.
 */
export function matchesExpected(actual: Extraction, expected: Extraction): boolean {
  if (actual.intents.length !== expected.intents.length) return false;
  return hasPerfectMatching(actual.intents, expected.intents);
}


/**
 * Which forbidden fields the extraction actually produced.
 *
 * ================================ WHY THIS EXISTS ==========================
 * `matchesExpected` treats an unlabelled field as UNCONSTRAINED, which keeps
 * fixtures honest -- you assert what you hand-labelled. The cost is that it can
 * never catch OVER-triggering: an extraction that invents a `memoryBody` for
 * "Karthik needs to send me the deck by Tuesday" matches a fixture that simply
 * did not mention memoryBody.
 *
 * Every one of the six new fields is a way to over-trigger, and over-triggering
 * is the failure that LOOKS like the feature working -- a spurious memory reads
 * as a good memory until you notice the assistant believes something nobody
 * said. So the negative fixtures name the field that must stay absent, and this
 * is what checks it.
 *
 * Returns ids like "memoryBody@1" (field, intent index) so a live-lane failure
 * says which intent over-triggered, not merely that one did.
 * ===========================================================================
 */
export function forbiddenFieldsPresent(
  actual: Extraction,
  forbids: readonly ForbiddableField[] | undefined,
): readonly string[] {
  if (forbids === undefined || forbids.length === 0) return [];
  const violations: string[] = [];
  actual.intents.forEach((intent, index) => {
    for (const field of forbids) {
      if (intent[field] !== undefined) violations.push(`${field}@${index}`);
    }
  });
  return violations;
}
