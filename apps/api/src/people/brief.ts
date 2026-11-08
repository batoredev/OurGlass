/**
 * A brief before each meeting — ROADMAP Stage 2 ("who, what is open between
 * you, what was said last time").
 *
 * WHO is found by code, never a model: a person whose whole name appears in
 * the meeting's title or notes, unambiguous among the people you know
 * (the same exact rule that links uploads, ingest/associate.ts). Two people
 * with one name means neither is named — a wrong brief is worse than none.
 */
import { namedInNote, type NamedRow } from "../ingest/associate.js";
import type { PersonProfile } from "./profile.js";

export interface MeetingLike {
  readonly title: string;
  readonly notes?: string | null;
}

/** The known people a meeting names, never yourself. */
export function peopleInMeeting(
  meeting: MeetingLike,
  people: readonly { readonly id: string; readonly display_name: string }[],
  selfPersonId: string | null,
): { id: string; name: string }[] {
  const rows: NamedRow[] = people
    .filter((person) => person.id !== selfPersonId)
    .map((person) => ({ kind: "person", id: person.id, name: person.display_name }));
  return namedInNote(`${meeting.title} ${meeting.notes ?? ""}`, rows).map((row) => ({ id: row.id, name: row.name }));
}

export interface BriefForPerson {
  readonly id: string;
  readonly name: string;
  /** Short lines, most useful first; each carries what it is drawn from. */
  readonly lines: readonly string[];
}

const MAX_ITEMS = 3;

function list(items: readonly { what: string; due: string | null; overdue: boolean }[]): string {
  const shown = items.slice(0, MAX_ITEMS).map((item) => `${item.what}${item.due ? ` (due ${item.due}${item.overdue ? ", overdue" : ""})` : ""}`);
  const more = items.length > MAX_ITEMS ? ` and ${items.length - MAX_ITEMS} more` : "";
  return `${shown.join("; ")}${more}`;
}

export function briefFor(profile: PersonProfile): BriefForPerson {
  const lines: string[] = [];
  if (profile.owesYou.value.length > 0) lines.push(`Owes you: ${list(profile.owesYou.value)}.`);
  if (profile.youOwe.value.length > 0) lines.push(`You owe them: ${list(profile.youOwe.value)}.`);
  if (profile.owesYou.value.length === 0 && profile.youOwe.value.length === 0) lines.push("No open commitments between you.");
  if (profile.reliability) {
    const { onTime, late, typicalLateHours } = profile.reliability.value;
    lines.push(
      `On time ${onTime} of ${onTime + late}${typicalLateHours !== null && late > 0 ? `; usually ${typicalLateHours} h late when late` : ""} (${profile.reliability.source}).`,
    );
  }
  for (const preference of profile.preferences.slice(0, 2)) lines.push(`${preference.value} (${preference.source}).`);
  if (profile.lastInteraction) lines.push(`Last: ${profile.lastInteraction.value} — ${profile.lastInteraction.source}.`);
  return { id: profile.id, name: profile.name, lines };
}
