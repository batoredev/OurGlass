/**
 * Which existing rows an uploaded file belongs to (docs/PHASE-6-DESIGN.md §6).
 *
 * CODE, NEVER A MODEL DECISION, and it never creates anything. A name links
 * a document to a row only when EXACTLY ONE current row of that kind matches:
 * two Aruns produce no link rather than a guess — the spec's own two-Aruns
 * example, and PHASE-2's rule that a wrong merge is worse than a missed one.
 *
 * Two sources, two trust levels:
 *   - the user's NOTE ("this is the final Hult brief") — their own words, so
 *     a match is CONFIRMED;
 *   - the READING's names — the file's words, relayed by a model, so a match
 *     is INFERRED. A hostile file can at most get itself linked to a person
 *     it names, which is visible, labelled and undoable.
 */
import type { DocumentReading } from "@ourglass/shared";

export type LinkKind = "person" | "organization" | "project";

export interface NamedRow {
  readonly kind: LinkKind;
  readonly id: string;
  readonly name: string;
}

export interface LinkCandidate extends NamedRow {
  readonly inference: "CONFIRMED" | "INFERRED";
}

/** A document is about a handful of things; more than this is a list, not an association. */
export const MAX_LINKS = 10;
/** "Al", "HR": short names match inside too many unrelated notes. */
const MIN_NAME_LENGTH = 3;

/** Case-, accent- and punctuation-insensitive, words separated by single spaces. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Rows grouped by normalized name within a kind; a group of two is ambiguous. */
function groups(rows: readonly NamedRow[]): Map<string, NamedRow[]> {
  const byKey = new Map<string, NamedRow[]>();
  for (const row of rows) {
    const key = `${row.kind}:${normalizeName(row.name)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  return byKey;
}

/** Rows whose WHOLE name appears in the note as whole words, unambiguous within their kind. */
export function namedInNote(note: string, rows: readonly NamedRow[]): NamedRow[] {
  const text = ` ${normalizeName(note)} `;
  if (text.trim() === "") return [];
  const matched: NamedRow[] = [];
  for (const group of groups(rows).values()) {
    const name = normalizeName(group[0]!.name);
    if (name.length < MIN_NAME_LENGTH || !text.includes(` ${name} `)) continue;
    if (group.length === 1) matched.push(group[0]!);
  }
  return matched;
}

/**
 * The one row a mention names, or null.
 *
 * Exact name first. Failing that, a word-prefix match — "Barkha" in the file
 * and "Barkha Sharma" in People, or the reverse — but only when it is the
 * ONLY such row. Anything looser is a guess.
 */
export function matchMention(mention: string, rows: readonly NamedRow[]): NamedRow | null {
  const wanted = normalizeName(mention);
  if (wanted.length < MIN_NAME_LENGTH) return null;

  const exact = rows.filter((row) => normalizeName(row.name) === wanted);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;

  const prefix = rows.filter((row) => {
    const name = normalizeName(row.name);
    return name.startsWith(`${wanted} `) || wanted.startsWith(`${name} `);
  });
  return prefix.length === 1 ? prefix[0]! : null;
}

/**
 * The links for one upload, CONFIRMED first, at most MAX_LINKS.
 *
 * `selfPersonId` is excluded: a document that mentions its own reader is not
 * "about" them in any way worth a link.
 */
export function associate(
  note: string,
  reading: DocumentReading | null,
  rows: readonly NamedRow[],
  selfPersonId: string | null,
): LinkCandidate[] {
  const eligible = rows.filter((row) => !(row.kind === "person" && row.id === selfPersonId));
  const links = new Map<string, LinkCandidate>();
  const add = (row: NamedRow, inference: LinkCandidate["inference"]) => {
    const key = `${row.kind}:${row.id}`;
    // CONFIRMED wins: the user's word outranks the file's.
    if (!links.has(key)) links.set(key, { ...row, inference });
  };

  for (const row of namedInNote(note, eligible)) add(row, "CONFIRMED");

  if (reading) {
    const people = eligible.filter((row) => row.kind === "person");
    // A model may file "Hult" under organizations while the user tracks it as
    // a project; organisations and projects are one pool for matching.
    const things = eligible.filter((row) => row.kind !== "person");
    for (const name of reading.people) {
      const row = matchMention(name, people);
      if (row) add(row, "INFERRED");
    }
    for (const name of [...reading.organizations, ...reading.projects]) {
      const row = matchMention(name, things);
      if (row) add(row, "INFERRED");
    }
  }

  return [...links.values()]
    .sort((a, b) => (a.inference === b.inference ? 0 : a.inference === "CONFIRMED" ? -1 : 1))
    .slice(0, MAX_LINKS);
}
