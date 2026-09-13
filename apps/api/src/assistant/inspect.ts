/**
 * §28 inspection queries — STRUCTURED, never semantic
 * (docs/PHASE-4-DESIGN.md §5, resolving finding F11).
 *
 * ┌─ THE SCOPING DECISION THIS FILE EXISTS TO ENFORCE ─────────────────────┐
 * │ Every §28 example in the spec is a STRUCTURED-STATE QUERY:             │
 * │   "What am I waiting on?"        "What does Barkha owe me?"            │
 * │   "What do I owe Hult?"          "Show me everything pending for X"    │
 * │   "What do you know about Arun?"                                       │
 * │ Not one of them needs an embedding.                                    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Putting inspection in a phase titled "semantic memory" invites building it
 * on the retrieval layer. That would be slower, non-deterministic, and WRONG:
 * an approximate index can MISS a row a `WHERE` clause returns, and for "what
 * does Barkha owe me" a miss is a commitment silently vanishing from the one
 * surface the user relies on to catch the assistant's mistakes.
 *
 * THE RULE: semantic retrieval answers "find me things like this"; structured
 * queries answer "what is true". Never answer a §28 question with an
 * approximate index.
 *
 * This module is READ-ONLY BY CONSTRUCTION. It returns plain data and never
 * touches `executeTurn`, so an inspection turn mints no `turn_id` and writes
 * no `action_log` row — which is correct: asking a question is not a mutation,
 * and "undo that" must not undo a question.
 */
import type { DatabaseTransaction } from "@ourglass/shared";
import { commitments, memories, relationships, type CurrentCommitment } from "@ourglass/db";

/**
 * What the user is asking to see. A CLOSED set, deliberately: each variant
 * maps to one specific SQL shape, and an open-ended "search" variant would
 * reintroduce exactly the semantic path §5 rules out.
 */
export type InspectionQuery =
  | { readonly kind: "waiting_on"; readonly selfPersonId: string }
  | { readonly kind: "owed_to_me"; readonly personId: string; readonly selfPersonId: string }
  | { readonly kind: "i_owe"; readonly personId: string; readonly selfPersonId: string }
  | { readonly kind: "pending_for_project"; readonly projectId: string }
  | {
      readonly kind: "about_entity";
      readonly subjectKind: "person" | "organization" | "project";
      readonly subjectId: string;
    };

export interface CommitmentSummary {
  readonly id: string;
  readonly objectText: string;
  readonly status: string;
  readonly expectedAt: string | null;
}

export interface KnowledgeSummary {
  readonly memories: readonly { readonly body: string; readonly inferenceLevel: string }[];
  readonly relationships: readonly {
    readonly relType: string;
    readonly objectKind: string;
    readonly objectId: string;
    readonly inferenceLevel: string;
  }[];
}

export type InspectionResult =
  | { readonly kind: "commitments"; readonly rows: readonly CommitmentSummary[] }
  | { readonly kind: "knowledge"; readonly knowledge: KnowledgeSummary };

function summarise(row: CurrentCommitment): CommitmentSummary {
  return {
    id: row.id,
    objectText: row.object_text,
    status: row.status,
    expectedAt: row.expected_at === null ? null : row.expected_at.toISOString(),
  };
}

/** Statuses that mean "still outstanding" — the complement of TERMINAL_STATUSES. */
function isOpen(row: CurrentCommitment): boolean {
  return !commitments.isTerminalStatus(row.status);
}

/**
 * Run one inspection query. Read-only; nothing here can mutate.
 */
export async function runInspection(
  tx: DatabaseTransaction,
  query: InspectionQuery,
): Promise<InspectionResult> {
  switch (query.kind) {
    case "waiting_on": {
      // "What am I waiting on?" — things OTHERS owe ME. The direction is the
      // whole point of the two-column schema (§7): owner is who must act.
      const rows = await commitments.listByRecipient(tx, query.selfPersonId);
      return {
        kind: "commitments",
        rows: rows
          .filter((row) => isOpen(row) && row.owner_id !== query.selfPersonId)
          .map(summarise),
      };
    }

    case "owed_to_me": {
      // "What does Barkha owe me?" — owner = Barkha AND recipient = me. Both
      // halves matter: without the recipient filter this returns everything
      // Barkha owes ANYONE, which is a different and wrong answer.
      const rows = await commitments.listByOwner(tx, query.personId);
      return {
        kind: "commitments",
        rows: rows
          .filter((row) => isOpen(row) && row.recipient_id === query.selfPersonId)
          .map(summarise),
      };
    }

    case "i_owe": {
      // "What do I owe Hult?" — the mirror image, and genuinely a different
      // query rather than the same one read backwards.
      const rows = await commitments.listByOwner(tx, query.selfPersonId);
      return {
        kind: "commitments",
        rows: rows
          .filter((row) => isOpen(row) && row.recipient_id === query.personId)
          .map(summarise),
      };
    }

    case "pending_for_project": {
      const rows = await commitments.listCurrent(tx);
      return {
        kind: "commitments",
        rows: rows.filter((row) => isOpen(row) && row.project_id === query.projectId).map(summarise),
      };
    }

    case "about_entity": {
      // "What do you know about Arun?" — an INDEXED LOOKUP over both stores,
      // not a similarity search. §16 provenance is what makes the answer
      // correctable: the user sees the inference level and can say "no".
      const facts = await memories.listBySubject(tx, query.subjectKind, query.subjectId);
      const edges =
        query.subjectKind === "person"
          ? await relationships.listBySubject(tx, query.subjectId)
          : await relationships.listByObject(tx, query.subjectKind, query.subjectId);

      return {
        kind: "knowledge",
        knowledge: {
          memories: facts.map((memory) => ({
            body: memory.body,
            inferenceLevel: memory.inference_level,
          })),
          relationships: edges.map((edge) => ({
            relType: edge.rel_type,
            objectKind: edge.object_kind,
            objectId: edge.object_id,
            inferenceLevel: edge.inference_level,
          })),
        },
      };
    }

    default: {
      // Exhaustiveness: a sixth query kind added without a branch is a
      // compile error, not a silent empty result.
      const exhaustive: never = query;
      throw new Error(`unhandled inspection query: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Render an inspection result as one short reply (§31).
 *
 * DETERMINISTIC — no model call. These answers are FACTS read from rows, and
 * routing them through a model adds a way for the count to come out wrong
 * while adding nothing: there is no judgement to make about "you're waiting
 * on three things".
 *
 * The empty case says so plainly rather than staying silent. "Nothing" is a
 * real and useful answer to "what am I waiting on"; silence reads as failure.
 */
export function renderInspection(
  result: InspectionResult,
  formatLocal: (iso: string) => string,
): string {
  if (result.kind === "knowledge") {
    const lines = [
      ...result.knowledge.memories.map((memory) => memory.body),
      ...result.knowledge.relationships.map((edge) => edge.relType),
    ];
    if (lines.length === 0) return "I don't have anything on record about them yet.";
    return `${lines.join("; ")}.`;
  }

  if (result.rows.length === 0) return "Nothing outstanding.";

  const parts = result.rows.map((row) => {
    const when = row.expectedAt === null ? "" : `, due ${formatLocal(row.expectedAt)}`;
    return `${row.objectText}${when}`;
  });
  return `${parts.join("; ")}.`;
}
