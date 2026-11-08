/**
 * The personal scheduler — ROADMAP Stage 3 ("the model extracts; code places
 * work"; the Machine's simulation and contingency, made deterministic).
 *
 * PURE and deterministic: the same inputs give the same plan, so a plan can
 * be tested, explained and re-run when something slips. It PROPOSES: nothing
 * here writes. Accepting a plan creates events through the tools (logged,
 * undoable), and re-checks the calendar at that moment.
 *
 * What it does, in order:
 *   1. Busy time = the day's meetings, each widened by a short buffer.
 *   2. Free gaps = the working window from now, minus busy time.
 *   3. Work YOU owe is placed first-fit, most urgent first (overdue, then the
 *      earliest deadline, then no deadline), each in the first gap it fits.
 *   4. Things OTHERS owe you get a short nudge slot when they are overdue, or
 *      due today from someone whose own record says they run late
 *      (people/profile.ts lateBufferHours) — "Barkha is usually a day late".
 *   5. What does not fit is listed, never squeezed: a plan that double-books
 *      is worse than one that says "this does not fit today".
 *
 * Not yet (ROADMAP Stage 3): constraints the owner states in words ("mornings
 * are for writing"), per-task durations learned from history, recurring tasks.
 * Until then a task is DEFAULT_TASK_MINUTES and the plan says it is an estimate.
 */

export interface Interval {
  readonly start: Date;
  readonly end: Date;
}

export interface FixedBlock extends Interval {
  readonly id: string;
  readonly title: string;
}

export interface TaskInput {
  readonly id: string;
  readonly title: string;
  readonly due: Date | null;
  /** Unknown today; the plan uses DEFAULT_TASK_MINUTES and says so. */
  readonly minutes?: number;
}

export interface IncomingInput {
  readonly id: string;
  readonly who: string;
  readonly what: string;
  readonly due: Date | null;
  /** From the person model; null when their record says nothing. */
  readonly lateBufferHours: number | null;
}

export interface PlanOptions {
  readonly dayStart: Date;
  readonly dayEnd: Date;
  readonly now: Date;
  readonly meetingBufferMinutes?: number;
  readonly defaultTaskMinutes?: number;
  readonly nudgeMinutes?: number;
}

export type BlockKind = "meeting" | "task" | "nudge";

export interface PlannedBlock extends Interval {
  readonly kind: BlockKind;
  readonly id: string;
  readonly title: string;
  /** Why it is here and why now, in words. */
  readonly reason: string;
}

export interface Unplaced {
  readonly id: string;
  readonly title: string;
  readonly reason: string;
}

export interface Plan {
  readonly blocks: readonly PlannedBlock[];
  readonly unplaced: readonly Unplaced[];
  /** The next-best thing to do, and why: the earliest placed task or nudge still ahead. */
  readonly next: PlannedBlock | null;
}

export const DEFAULT_TASK_MINUTES = 30;
export const MEETING_BUFFER_MINUTES = 10;
export const NUDGE_MINUTES = 10;
const MINUTE = 60_000;

/** Rounds up to the next 5 minutes: a plan starting at 10:03 reads like a bug. */
export function roundUp(date: Date): Date {
  const step = 5 * MINUTE;
  return new Date(Math.ceil(date.getTime() / step) * step);
}

/** Merges overlapping or touching intervals; the result is sorted and disjoint. */
export function merge(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const interval of sorted) {
    const last = out[out.length - 1];
    if (last && interval.start.getTime() <= last.end.getTime()) {
      if (interval.end > last.end) out[out.length - 1] = { start: last.start, end: interval.end };
    } else {
      out.push(interval);
    }
  }
  return out;
}

/** The free gaps in [from, to) around busy time. */
export function gaps(from: Date, to: Date, busy: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let cursor = from;
  for (const block of merge(busy)) {
    if (block.end <= cursor) continue;
    if (block.start >= to) break;
    if (block.start > cursor) out.push({ start: cursor, end: block.start });
    if (block.end > cursor) cursor = block.end;
  }
  if (cursor < to) out.push({ start: cursor, end: to });
  return out;
}

/** The first gap that fits `minutes`, at or after `notBefore`; null when none does. */
function firstFit(free: readonly Interval[], minutes: number, notBefore: Date): Interval | null {
  for (const gap of free) {
    const start = gap.start < notBefore ? notBefore : gap.start;
    const end = new Date(start.getTime() + minutes * MINUTE);
    if (end <= gap.end) return { start, end };
  }
  return null;
}

function hhmm(date: Date, timeZone: string): string {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
}

function urgency(task: TaskInput, now: Date): [number, number, string] {
  if (task.due === null) return [2, Number.MAX_SAFE_INTEGER, task.title];
  return [task.due.getTime() < now.getTime() ? 0 : 1, task.due.getTime(), task.title];
}

/** A nudge's title — shared with the planner so an accepted nudge is recognised. */
export function nudgeTitle(item: Pick<IncomingInput, "who" | "what">): string {
  return `Ask ${item.who} about ${item.what}`;
}

export function planDay(
  fixed: readonly FixedBlock[],
  tasks: readonly TaskInput[],
  incoming: readonly IncomingInput[],
  options: PlanOptions,
  timeZone = "UTC",
): Plan {
  const bufferMs = (options.meetingBufferMinutes ?? MEETING_BUFFER_MINUTES) * MINUTE;
  const taskMinutes = options.defaultTaskMinutes ?? DEFAULT_TASK_MINUTES;
  const nudgeMinutes = options.nudgeMinutes ?? NUDGE_MINUTES;
  const from = roundUp(options.now > options.dayStart ? options.now : options.dayStart);
  const to = options.dayEnd;

  const meetings: PlannedBlock[] = fixed
    .filter((block) => block.end > options.dayStart && block.start < options.dayEnd)
    .map((block) => ({ ...block, kind: "meeting" as const, reason: "on your calendar" }));
  const busy: Interval[] = meetings.map((m) => ({
    start: new Date(m.start.getTime() - bufferMs),
    end: new Date(m.end.getTime() + bufferMs),
  }));
  const placed: PlannedBlock[] = [];
  const unplaced: Unplaced[] = [];

  const place = (minutes: number, notBefore: Date): Interval | null => {
    const slot = firstFit(gaps(from, to, busy), minutes, notBefore);
    if (slot) busy.push(slot);
    return slot;
  };

  // 4 first: a nudge is short and must land BEFORE the deadline it guards.
  for (const item of [...incoming].sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity))) {
    if (item.due === null) continue;
    const overdue = item.due.getTime() < options.now.getTime();
    const dueToday = item.due >= options.dayStart && item.due < options.dayEnd;
    if (!overdue && !(dueToday && item.lateBufferHours !== null)) continue;
    const slot = place(nudgeMinutes, from);
    const title = nudgeTitle(item);
    const reason = overdue
      ? `overdue since ${item.due.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone })}`
      : `due ${hhmm(item.due, timeZone)}; ${item.who} is usually ${item.lateBufferHours} h late`;
    if (slot) placed.push({ ...slot, kind: "nudge", id: item.id, title, reason });
    else unplaced.push({ id: item.id, title, reason: "no free time left today" });
  }

  for (const task of [...tasks].sort((a, b) => {
    const [ua, ub] = [urgency(a, options.now), urgency(b, options.now)];
    return ua[0] - ub[0] || ua[1] - ub[1] || ua[2].localeCompare(ub[2]);
  })) {
    const minutes = task.minutes ?? taskMinutes;
    const slot = place(minutes, from);
    const estimate = task.minutes === undefined ? ` · ${minutes} min, estimated` : ` · ${minutes} min`;
    const why =
      task.due === null
        ? "no deadline"
        : task.due.getTime() < options.now.getTime()
          ? `overdue since ${task.due.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone })}`
          : `due ${task.due.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone })}`;
    if (!slot) {
      unplaced.push({ id: task.id, title: task.title, reason: `does not fit today (${why})` });
      continue;
    }
    const late = task.due !== null && slot.end > task.due && task.due.getTime() >= options.now.getTime();
    placed.push({
      ...slot,
      kind: "task",
      id: task.id,
      title: task.title,
      reason: `${why}${late ? " — this slot ends after it" : ""}${estimate}`,
    });
  }

  const blocks = [...meetings, ...placed].sort((a, b) => a.start.getTime() - b.start.getTime());
  const next = placed.filter((block) => block.end > options.now).sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null;
  return { blocks, unplaced, next };
}

// ---------------------------------------------------------------------------
// Meeting slots that suit the other person
// ---------------------------------------------------------------------------

export type TimeOfDay = "morning" | "afternoon" | "evening";

/** Hours (local) a time of day means. */
export const TIME_OF_DAY_HOURS: Readonly<Record<TimeOfDay, readonly [number, number]>> = {
  morning: [9, 12],
  afternoon: [12, 17],
  evening: [17, 20],
};

/**
 * A time-of-day preference read from what you were told ("Meera prefers
 * morning meetings"), by keyword — never a model. Null when none is stated
 * or when two are (a contradiction is not a preference).
 */
export function timeOfDayPreference(preferences: readonly string[]): TimeOfDay | null {
  const found = new Set<TimeOfDay>();
  for (const text of preferences) {
    const lower = text.toLowerCase();
    if (!/\b(meet|meeting|meetings|call|calls|catch up)\b/.test(lower)) continue;
    if (/\bmornings?\b/.test(lower)) found.add("morning");
    if (/\bafternoons?\b/.test(lower)) found.add("afternoon");
    if (/\bevenings?\b/.test(lower)) found.add("evening");
  }
  return found.size === 1 ? [...found][0]! : null;
}

export interface DayWindow {
  /** Local midnight, as an instant. */
  readonly dayStart: Date;
}

export interface SlotOptions {
  readonly days: readonly DayWindow[];
  readonly now: Date;
  readonly minutes: number;
  readonly workStartHour?: number;
  readonly workEndHour?: number;
  readonly preference: TimeOfDay | null;
  readonly count?: number;
}

/**
 * Up to `count` free slots of `minutes`, earliest first, one per day, inside
 * working hours and — when the person has a stated time of day — inside it.
 */
export function suggestSlots(fixed: readonly Interval[], options: SlotOptions): Interval[] {
  const [startHour, endHour] = options.preference
    ? TIME_OF_DAY_HOURS[options.preference]
    : [options.workStartHour ?? 9, options.workEndHour ?? 18];
  const busy = fixed.map((block) => ({
    start: new Date(block.start.getTime() - MEETING_BUFFER_MINUTES * MINUTE),
    end: new Date(block.end.getTime() + MEETING_BUFFER_MINUTES * MINUTE),
  }));
  const out: Interval[] = [];
  for (const day of options.days) {
    const windowStart = new Date(day.dayStart.getTime() + startHour * 60 * MINUTE);
    const windowEnd = new Date(day.dayStart.getTime() + endHour * 60 * MINUTE);
    const from = roundUp(options.now > windowStart ? options.now : windowStart);
    if (from >= windowEnd) continue;
    const slot = firstFit(gaps(from, windowEnd, busy), options.minutes, from);
    if (slot) out.push(slot);
    if (out.length >= (options.count ?? 3)) break;
  }
  return out;
}
