/**
 * The person model — ROADMAP Stage 2 ("a profile per person, derived from
 * what happened, every field with its source").
 *
 * PURE: rows in (packages/db person-profile.ts), a profile out. Nothing here
 * guesses: each field is computed from stored rows and says which ones, and a
 * field with no evidence is absent rather than estimated. The Machine's world
 * model, over the owner's own data only (docs/reference/THE-MACHINE.md).
 */
import type { PersonProfileData } from "@ourglass/db";

export interface Sourced<T> {
  readonly value: T;
  /** Where it came from, in words a person can check. */
  readonly source: string;
}

export interface OpenItem {
  readonly id: string;
  readonly what: string;
  readonly due: string | null;
  readonly overdue: boolean;
}

export interface Reliability {
  readonly onTime: number;
  readonly late: number;
  /** Median lateness of the late ones, in hours; null when none was late or none had both times. */
  readonly typicalLateHours: number | null;
}

export interface PersonProfile {
  readonly id: string;
  readonly name: string;
  readonly owesYou: Sourced<readonly OpenItem[]>;
  readonly youOwe: Sourced<readonly OpenItem[]>;
  /** Null when they have finished nothing they owed you with a deadline: no record, no number. */
  readonly reliability: Sourced<Reliability> | null;
  readonly preferences: readonly Sourced<string>[];
  readonly facts: readonly Sourced<string>[];
  readonly patterns: readonly Sourced<string>[];
  readonly email: Sourced<string> | null;
  readonly organization: Sourced<string> | null;
  readonly groups: readonly Sourced<string>[];
  readonly files: readonly Sourced<string>[];
  readonly lastInteraction: Sourced<string> | null;
}

const OPEN = new Set(["pending", "in_progress", "waiting", "waiting_on_someone", "blocked"]);

function day(date: Date, timeZone: string): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const RELATION_WORDS: Readonly<Record<string, string>> = {
  works_on: "works on",
  handles: "handles",
  works_with: "works with",
  works_at: "works at",
  member_of: "is part of",
};

export function deriveProfile(data: PersonProfileData, now: Date, timeZone = "UTC"): PersonProfile {
  const ids = new Set(data.ids);
  const theirs = (id: string | null) => id !== null && ids.has(id);

  const open = (rows: typeof data.commitments) =>
    rows
      .filter((row) => OPEN.has(row.status))
      .map((row) => ({
        id: row.id,
        what: row.object_text,
        due: row.expected_at ? day(row.expected_at, timeZone) : null,
        overdue: row.expected_at !== null && row.expected_at.getTime() < now.getTime(),
      }));
  const owedByThem = data.commitments.filter((row) => theirs(row.owner_id));
  const owedToThem = data.commitments.filter((row) => theirs(row.recipient_id) && !theirs(row.owner_id));
  const owesYou = open(owedByThem);
  const youOwe = open(owedToThem);

  // Reliability: only what they FINISHED, that had a deadline. Status is the
  // record (completed vs completed_late); the hours come from the two times.
  const finished = owedByThem.filter(
    (row) => (row.status === "completed" || row.status === "completed_late") && row.expected_at !== null,
  );
  const lateHours = finished
    .filter((row) => row.status === "completed_late" && row.completed_at !== null)
    .map((row) => (row.completed_at!.getTime() - row.expected_at!.getTime()) / 3_600_000)
    .filter((hours) => hours > 0);
  const late = finished.filter((row) => row.status === "completed_late").length;
  const reliability: Sourced<Reliability> | null =
    finished.length === 0
      ? null
      : {
          value: {
            onTime: finished.length - late,
            late,
            typicalLateHours: median(lateHours) === null ? null : Math.round(median(lateHours)! * 10) / 10,
          },
          source: `from ${finished.length} finished commitment${finished.length === 1 ? "" : "s"} with a deadline`,
        };

  const memory = (kind: "fact" | "preference" | "pattern") =>
    data.memories
      .filter((row) => row.kind === kind)
      .map((row) => ({
        value: row.body,
        source: `${row.inference_level === "CONFIRMED" ? "you said so" : "inferred"} on ${day(row.t_created, timeZone)}`,
      }));

  const groups = data.relationships
    .filter((row) => row.object_name !== null)
    .map((row) => ({
      value: `${RELATION_WORDS[row.rel_type] ?? row.rel_type.replace(/_/g, " ")} ${row.object_name}`,
      source: `${row.inference_level === "CONFIRMED" ? "you said so" : "inferred"} on ${day(row.t_created, timeZone)}`,
    }));

  // Last interaction: the newest thing that happened with them, by kind.
  const moments: { at: Date; what: string }[] = [
    ...data.commitments.map((row) => ({ at: row.t_created, what: `a commitment: ${row.object_text}` })),
    ...data.commitments
      .filter((row) => row.completed_at !== null)
      .map((row) => ({ at: row.completed_at!, what: `finished: ${row.object_text}` })),
    ...data.memories.map((row) => ({ at: row.t_created, what: "something you told me about them" })),
    ...data.emails.map((row) => ({ at: row.sent_at, what: `an email: ${row.subject}` })),
    ...data.files.map((row) => ({ at: row.t_created, what: `a file: ${row.filename}` })),
  ].filter((moment) => moment.at.getTime() <= now.getTime());
  const latest = moments.sort((a, b) => b.at.getTime() - a.at.getTime())[0];

  return {
    id: data.person.id,
    name: data.person.display_name,
    owesYou: { value: owesYou, source: `open commitments they owe you (${owesYou.length})` },
    youOwe: { value: youOwe, source: `open commitments you owe them (${youOwe.length})` },
    reliability,
    preferences: memory("preference"),
    facts: memory("fact"),
    patterns: memory("pattern"),
    email: data.person.email ? { value: data.person.email, source: "saved when you gave it" } : null,
    organization: data.person.organization_name
      ? { value: data.person.organization_name, source: "on their record" }
      : null,
    groups,
    files: data.files.map((row) => ({ value: row.filename, source: `linked on ${day(row.t_created, timeZone)}` })),
    lastInteraction: latest ? { value: latest.what, source: day(latest.at, timeZone) } : null,
  };
}

/**
 * The buffer a deadline from this person should get, from their own record —
 * what Stage 3's scheduler uses ("Barkha is usually a day late"). Null when
 * the record is too thin to say: fewer than three finished commitments, or
 * fewer than half of them late.
 */
export function lateBufferHours(reliability: Reliability | null): number | null {
  if (reliability === null) return null;
  const total = reliability.onTime + reliability.late;
  if (total < 3 || reliability.late * 2 < total || reliability.typicalLateHours === null) return null;
  return reliability.typicalLateHours;
}
