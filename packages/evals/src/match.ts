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
import type { Extraction, ExtractedIntent, EntityMention, TimeReference } from "@ourglass/shared";

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
    timeMatches(actual.time, expected.time)
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
