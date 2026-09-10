import type { EntityMention } from "@ourglass/shared";
import { people, type CurrentCommitment, type Person } from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";

export type ResolutionBand = "auto" | "ask" | "reject";

export interface MentionCandidate {
  readonly id: string;
  readonly displayName: string;
}

export type EntityResolution =
  | { readonly band: "auto"; readonly id: string; readonly score: number }
  | { readonly band: "ask"; readonly candidates: readonly MentionCandidate[]; readonly score: number }
  | { readonly band: "reject"; readonly score: number };

const AUTO_THRESHOLD = 0.92;
const ASK_THRESHOLD = 0.65;

/**
 * Three-band entity policy. It deliberately does not merge candidates or follow
 * transitive similarity: an automatic false merge is worse than a visible duplicate
 * (docs/DECISIONS.md #6, #9).
 *
 * A perfect score is NOT sufficient to auto-resolve. With "Arun" (Batore) and
 * "Arun Kumar" (MTTN) both present, the mention "Arun" scores 1.0 against the
 * first — an exact match — yet spec §11 names this exact case as one that must
 * ASK ("Arun from Batore or Arun from MTTN?"). Ranking alone cannot see that,
 * because the runner-up is a different person, not a tie. So a contested
 * runner-up — anything else at or above ASK_THRESHOLD — forces `ask` even when
 * the leader is exact.
 */
export function resolveMention(
  mention: Pick<EntityMention, "name">,
  candidates: readonly MentionCandidate[],
): EntityResolution {
  const scored = candidates
    .map((candidate) => ({ candidate, score: nameSimilarity(mention.name, candidate.displayName) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < ASK_THRESHOLD) return { band: "reject", score: best?.score ?? 0 };

  // Every candidate plausible enough to be the intended person. Not just exact
  // ties — "Arun Kumar" at 0.8 contests an exact "Arun" at 1.0.
  const contenders = scored.filter((entry) => entry.score >= ASK_THRESHOLD);
  if (best.score >= AUTO_THRESHOLD && contenders.length === 1) {
    return { band: "auto", id: best.candidate.id, score: best.score };
  }
  return { band: "ask", candidates: contenders.map((entry) => entry.candidate), score: best.score };
}

export async function resolvePersonMention(
  tx: DatabaseTransaction,
  mention: Pick<EntityMention, "name">,
): Promise<EntityResolution> {
  // UNION, never replace. `findByDisplayName` is exact equality
  // (`lower(display_name) = lower($1)`), so with two Aruns in the table a
  // mention of "Arun" returns exactly ONE row. Taking that as the candidate set
  // and skipping `list()` meant the second Arun was never scored, and the
  // mention auto-resolved to whichever one happened to match exactly —
  // violating spec §11 and §12, and risking the wrong-merge failure mode
  // DECISIONS.md #9 calls the worst in the system. The typo "Aru" correctly
  // asked while the CORRECT name silently guessed.
  //
  // The exact query is kept because it is the only case-insensitive index-backed
  // lookup available, but it now only ensures an exact match is present in the
  // set; the three-band policy runs over ALL current people.
  const [exact, all] = await Promise.all([
    people.findByDisplayName(tx, mention.name),
    people.list(tx),
  ]);
  const byId = new Map<string, Person>();
  for (const person of [...exact, ...all]) byId.set(person.id, person);
  return resolveMention(mention, [...byId.values()].map(toCandidate));
}

export interface CommitmentProposal {
  readonly ownerId: string;
  readonly recipientId: string | null;
  readonly objectText: string;
  readonly status: CurrentCommitment["status"];
}

export type DuplicateDecision =
  | { readonly kind: "auto_match"; readonly commitmentId: string; readonly score: number }
  | { readonly kind: "ask"; readonly commitmentIds: readonly string[]; readonly score: number }
  /**
   * `reason` feeds spec §28's inspection surface ("why did you create a second
   * one?"), so it must name the filter that actually fired:
   *   no_candidates — nothing existed to compare against
   *   hard_veto     — candidates existed but ALL were vetoed on direction/state
   *   below_threshold — candidates survived the veto but none scored high enough
   */
  | { readonly kind: "create"; readonly reason: "no_candidates" | "hard_veto" | "below_threshold"; readonly score: number };

/**
 * Conservative duplicate detection. Owner/recipient direction and terminal state
 * are hard vetoes before text similarity; this preserves the product's central
 * ownership distinction and prevents a wrong merge from hiding a commitment.
 */
export function detectDuplicate(
  proposal: CommitmentProposal,
  existing: readonly CurrentCommitment[],
): DuplicateDecision {
  if (existing.length === 0) return { kind: "create", reason: "no_candidates", score: 0 };

  const eligible = existing.filter((candidate) => !hasHardVeto(proposal, candidate));
  if (eligible.length === 0) return { kind: "create", reason: "hard_veto", score: 0 };

  const scored = eligible
    .map((candidate) => ({ candidate, score: objectTextSimilarity(proposal.objectText, candidate.object_text) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  if (best.score >= AUTO_THRESHOLD) {
    return { kind: "auto_match", commitmentId: best.candidate.id, score: best.score };
  }
  if (best.score >= ASK_THRESHOLD) {
    return {
      kind: "ask",
      commitmentIds: scored.filter((entry) => entry.score >= ASK_THRESHOLD).map((entry) => entry.candidate.id),
      score: best.score,
    };
  }
  // Candidates survived the veto and were scored; none was close enough. This is
  // NOT "hard_veto" — reporting it as one would tell a debugger the direction or
  // state differed when in fact the text simply did not match.
  return { kind: "create", reason: "below_threshold", score: best.score };
}

function hasHardVeto(proposal: CommitmentProposal, candidate: CurrentCommitment): boolean {
  // `?? null` because a proposal with no recipient may arrive as `undefined`
  // while the column is SQL NULL, and `undefined !== null` is true — which
  // produced a spurious veto that silently forced a duplicate for every
  // self-owned commitment ("I need to finish the poster").
  if (proposal.ownerId !== candidate.owner_id) return true;
  if ((proposal.recipientId ?? null) !== (candidate.recipient_id ?? null)) return true;
  return isCompleted(proposal.status) !== isCompleted(candidate.status);
}

function isCompleted(status: CurrentCommitment["status"]): boolean {
  return status === "completed" || status === "completed_late";
}

function toCandidate(person: Person): MentionCandidate {
  return { id: person.id, displayName: person.display_name };
}

/**
 * Name similarity, weighted by how much of the name is actually shared.
 *
 * The previous version returned a flat 0.8 for ANY containment, so
 * `nameSimilarity("a", "Barkha")` scored the same as
 * `nameSimilarity("Arun", "Arun Kumar")` — a single stray character landed in
 * the ask band against every person in the table, turning a typo into a
 * disambiguation prompt listing everyone.
 *
 * Two containment cases are genuinely different and are now scored differently:
 *   whole-token ("Arun" in "Arun Kumar")  — a real name-vs-fuller-name match
 *   substring   ("Aru" in "Arun")          — a typo or fragment
 */
function nameSimilarity(a: string, b: string): number {
  const left = normalize(a);
  const right = normalize(b);
  if (left.length === 0 || right.length === 0) return 0;
  if (left === right) return 1;

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  let shared = 0;
  for (const word of leftTokens) if (rightTokens.has(word)) shared += 1;

  // Every token of the shorter name appears in the longer one. Scaled by the
  // token ratio: "Arun" vs "Arun Kumar" is 1-of-2 -> 0.725, inside the ask band,
  // which is what forces spec §11's "Arun from Batore or Arun from MTTN?".
  const minTokens = Math.min(leftTokens.size, rightTokens.size);
  if (shared > 0 && shared === minTokens) {
    return 0.55 + 0.35 * (minTokens / Math.max(leftTokens.size, rightTokens.size));
  }

  // Substring but not a whole token. Character ratio, so a 1-of-6 fragment
  // ("a" in "Barkha" -> 0.15) falls well below ASK_THRESHOLD and rejects.
  if (left.includes(right) || right.includes(left)) {
    return 0.9 * (Math.min(left.length, right.length) / Math.max(left.length, right.length));
  }

  const union = new Set([...leftTokens, ...rightTokens]);
  return union.size === 0 ? 0 : shared / union.size;
}

/**
 * Stopwords stripped before comparing commitment text.
 *
 * These are the words users add when RE-referring to something they already
 * mentioned — "still need to", "that" — which is precisely when duplicate
 * detection has to fire. Counting them as evidence of difference is backwards.
 */
const OBJECT_STOPWORDS = new Set([
  "the", "a", "an", "that", "this", "these", "those", "to", "for", "of", "and",
  "still", "need", "needs", "needed", "i", "my", "me", "some", "just", "get", "got",
]);

/**
 * Commitment-text similarity: containment-weighted, not plain Jaccard.
 *
 * Jaccard divides by the UNION, so every qualifier a user adds LOWERS the score
 * — and users add qualifiers exactly when they are disambiguating. Spec §23's
 * own example failed because of it: "finish the poster" vs "still need to finish
 * that Hult poster" scored 0.250 and created the duplicate the section says
 * verbatim not to create. It now scores 0.900 and asks.
 *
 * INTERIM. This is lexical only — it cannot tell "the article" from "the piece".
 * Phase 4 replaces it with embeddings over `commitments.object_embedding`, which
 * already ships NULLable for this purpose (PHASE-1-DESIGN.md §2.4). Recorded in
 * docs/DECISIONS.md so nobody reads green tests here as evidence §23 is solved.
 */
function objectTextSimilarity(a: string, b: string): number {
  const left = contentTokens(a);
  const right = contentTokens(b);
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const word of left) if (right.has(word)) intersection += 1;
  if (intersection === 0) return 0;

  const containment = intersection / Math.min(left.size, right.size);
  const union = new Set([...left, ...right]).size;
  const jaccard = intersection / union;
  // Containment dominates so that added qualifiers do not penalise, but Jaccard
  // is retained at 0.3 so two texts that merely share one common word do not
  // reach the auto band on containment alone.
  return 0.7 * containment + 0.3 * jaccard;
}

function contentTokens(value: string): Set<string> {
  const all = normalize(value).split(" ").filter(Boolean);
  const content = all.filter((word) => !OBJECT_STOPWORDS.has(word));
  // Fall back to the raw tokens when a text is ENTIRELY stopwords, rather than
  // returning an empty set that would score 0 against an identical string.
  return new Set(content.length > 0 ? content : all);
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}
