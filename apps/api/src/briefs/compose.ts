/**
 * The proactive loop's briefs — ROADMAP Stage 5 (the Machine's proactive
 * contact and minimal disclosure: enough to act on, no more).
 *
 * PURE TEMPLATES over stored facts: every line is a fact the database holds,
 * so a brief cannot claim what did not happen. No model writes them (a model
 * may phrase them later, checked against these facts like Respond's replies);
 * nothing here nags or coaches (ROADMAP principle 8) — it says what is on,
 * what is owed, and what slipped, and stops.
 */

export interface BriefMeeting {
  readonly title: string;
  readonly start: Date;
  /** First brief line per known person, e.g. "Meera owes you: the poster draft". */
  readonly people: readonly { readonly name: string; readonly line: string }[];
}

export interface BriefItem {
  readonly what: string;
  readonly who?: string;
  readonly overdue?: boolean;
}

export interface MorningInput {
  readonly timeZone: string;
  readonly meetings: readonly BriefMeeting[];
  readonly first: { readonly title: string; readonly at: Date; readonly reason: string } | null;
  readonly dueToYou: readonly BriefItem[];
  readonly youOwe: readonly BriefItem[];
  readonly reminders: readonly { readonly body: string; readonly at: Date }[];
  /** Mondays only: last week, in three numbers and a short list. */
  readonly week?: WeekInput;
}

export interface WeekInput {
  readonly finished: number;
  readonly slipped: readonly BriefItem[];
  /** People with something open and no interaction for a while. */
  readonly quiet: readonly { readonly name: string; readonly since: string }[];
}

export interface EveningInput {
  readonly timeZone: string;
  readonly done: readonly BriefItem[];
  readonly stillOpen: readonly BriefItem[];
  readonly tomorrow: readonly BriefMeeting[];
}

const MAX = 4;

function time(date: Date, timeZone: string): string {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
}

function items(list: readonly BriefItem[]): string {
  const shown = list.slice(0, MAX).map((item) => `${item.what}${item.who ? ` (${item.who})` : ""}${item.overdue ? " — overdue" : ""}`);
  return `${shown.join("; ")}${list.length > MAX ? `; and ${list.length - MAX} more` : ""}`;
}

export function composeMorning(input: MorningInput): string {
  const lines: string[] = ["Good morning. Your day:"];
  for (const meeting of input.meetings.slice(0, MAX)) {
    lines.push(`• ${time(meeting.start, input.timeZone)} ${meeting.title}`);
    for (const person of meeting.people.slice(0, 2)) lines.push(`  ${person.name}: ${person.line}`);
  }
  if (input.meetings.length > MAX) lines.push(`• and ${input.meetings.length - MAX} more meetings`);
  if (input.first) lines.push(`First: ${input.first.title} at ${time(input.first.at, input.timeZone)} — ${input.first.reason}.`);
  if (input.youOwe.length > 0) lines.push(`You owe: ${items(input.youOwe)}.`);
  if (input.dueToYou.length > 0) lines.push(`Due to you: ${items(input.dueToYou)}.`);
  if (input.reminders.length > 0) {
    lines.push(`Reminders: ${input.reminders.slice(0, MAX).map((r) => `${time(r.at, input.timeZone)} ${r.body}`).join("; ")}.`);
  }
  if (lines.length === 1) lines.push("Nothing on record for today.");
  if (input.week) {
    const week = input.week;
    lines.push(`Last week: ${week.finished} finished${week.slipped.length > 0 ? `; slipped: ${items(week.slipped)}` : ""}.`);
    if (week.quiet.length > 0) {
      lines.push(`Quiet for a while, with something open: ${week.quiet.slice(0, MAX).map((q) => `${q.name} (since ${q.since})`).join(", ")}.`);
    }
  }
  return lines.join("\n");
}

export function composeEvening(input: EveningInput): string {
  const lines: string[] = ["This evening:"];
  lines.push(input.done.length > 0 ? `Done today: ${items(input.done)}.` : "Nothing was marked done today.");
  if (input.stillOpen.length > 0) lines.push(`Still open from today: ${items(input.stillOpen)}.`);
  if (input.tomorrow.length > 0) {
    lines.push(`Tomorrow: ${input.tomorrow.slice(0, MAX).map((m) => `${time(m.start, input.timeZone)} ${m.title}`).join("; ")}.`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// When each brief is due
// ---------------------------------------------------------------------------

export type BriefKind = "morning" | "evening";

/** Quiet hours: nothing is delivered before or after these (local). */
export const DELIVERY_HOURS: Readonly<Record<BriefKind, readonly [number, number]>> = {
  morning: [8, 12],
  evening: [18, 21],
};

export interface LocalClock {
  /** YYYY-MM-DD in the owner's zone. */
  readonly date: string;
  readonly hour: number;
  /** 1 = Monday … 7 = Sunday. */
  readonly weekday: number;
}

export function localClock(now: Date, timeZone: string): LocalClock {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return {
    date: `${parts["year"]}-${parts["month"]}-${parts["day"]}`,
    hour: Number(parts["hour"]),
    weekday: weekdays.indexOf(parts["weekday"] ?? "") + 1,
  };
}

/**
 * The brief due now, if any. A brief whose window has passed is NOT sent
 * late: a morning brief at 4 pm is noise, not help.
 */
export function dueBrief(clock: LocalClock, delivered: ReadonlySet<string>): { kind: BriefKind; key: string } | null {
  for (const kind of ["morning", "evening"] as const) {
    const [from, to] = DELIVERY_HOURS[kind];
    const key = `${kind}:${clock.date}`;
    if (clock.hour >= from && clock.hour < to && !delivered.has(key)) return { kind, key };
  }
  return null;
}
