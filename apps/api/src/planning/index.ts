/**
 * The day plan and meeting slots (ROADMAP Stage 3): the scheduler's inputs,
 * gathered from what is stored. Read only — accepting a plan is the route's
 * job, through the tools.
 */
import { commitments, events, personProfile, users } from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";
import { deriveProfile, lateBufferHours } from "../people/profile.js";
import {
  planDay,
  suggestSlots,
  timeOfDayPreference,
  type FixedBlock,
  type IncomingInput,
  type Interval,
  type Plan,
  type TaskInput,
  type TimeOfDay,
} from "./scheduler.js";

export * from "./scheduler.js";
export { localDayWindow } from "./local-day.js";
import { nudgeTitle } from "./scheduler.js";

/** How an accepted block is titled on the calendar (POST /api/plan/accept). */
export const PLAN_PREFIX = { task: "Focus", nudge: "Nudge" } as const;

/** Working hours, local. Until the owner states their own (ROADMAP Stage 3, not yet). */
export const WORK_START_HOUR = 9;
export const WORK_END_HOUR = 18;
const OPEN = new Set(["pending", "in_progress", "waiting", "waiting_on_someone", "blocked"]);
const HOUR = 3_600_000;

export interface DayPlan extends Plan {
  readonly dayStart: Date;
  readonly dayEnd: Date;
}

/**
 * Today's plan. `localMidnight` is the start of the owner's day as an
 * instant (the edge `localDayWindow`); working hours are offsets from it.
 */
export async function loadDayPlan(
  tx: DatabaseTransaction,
  now: Date,
  localMidnight: Date,
  timeZone: string,
): Promise<DayPlan> {
  const dayStart = new Date(localMidnight.getTime() + WORK_START_HOUR * HOUR);
  const dayEnd = new Date(localMidnight.getTime() + WORK_END_HOUR * HOUR);
  const selfId = (await users.currentAccount(tx))?.self?.id ?? null;

  const fixed: FixedBlock[] = (await events.listBetween(tx, localMidnight, new Date(localMidnight.getTime() + 24 * HOUR)))
    .filter((row) => row.starts_at !== null)
    .map((row) => ({
      id: row.id,
      title: row.title,
      start: row.starts_at!,
      // A meeting with no end is held for 30 minutes, as the calendar shows it.
      end: row.ends_at ?? new Date(row.starts_at!.getTime() + 30 * 60_000),
    }));

  // Work already given a block today (an accepted plan) is not planned again:
  // re-planning it would book it twice. The block shows as a calendar entry.
  const booked = new Set(fixed.map((block) => block.title));
  const open = (await commitments.listCurrent(tx)).filter((row) => OPEN.has(row.status));
  const tasks: TaskInput[] = open
    .filter((row) => selfId !== null && row.owner_id === selfId)
    .filter((row) => !booked.has(`${PLAN_PREFIX.task}: ${row.object_text}`))
    .map((row) => ({ id: row.id, title: row.object_text, due: row.expected_at }));

  const names = new Map<string, string>();
  const buffers = new Map<string, number | null>();
  const incoming: IncomingInput[] = [];
  for (const row of open.filter((row) => row.owner_id !== null && row.owner_id !== selfId)) {
    const owner = row.owner_id!;
    if (!buffers.has(owner)) {
      const data = await personProfile.loadPersonProfile(tx, owner);
      const profile = data ? deriveProfile(data, now, timeZone) : null;
      names.set(owner, profile?.name ?? "them");
      buffers.set(owner, profile?.reliability ? lateBufferHours(profile.reliability.value) : null);
    }
    incoming.push({
      id: row.id,
      who: names.get(owner)!,
      what: row.object_text,
      due: row.expected_at,
      lateBufferHours: buffers.get(owner) ?? null,
    });
  }

  const notYetNudged = incoming.filter((item) => !booked.has(`${PLAN_PREFIX.nudge}: ${nudgeTitle(item)}`));
  return { ...planDay(fixed, tasks, notYetNudged, { dayStart, dayEnd, now }, timeZone), dayStart, dayEnd };
}

export interface SlotSuggestion {
  readonly person: string;
  readonly preference: TimeOfDay | null;
  /** Where the preference came from, or why there is none. */
  readonly basis: string;
  readonly slots: readonly Interval[];
}

/** Up to three times in the next week to meet one person, inside their stated time of day if any. */
export async function suggestMeetingSlots(
  tx: DatabaseTransaction,
  personId: string,
  minutes: number,
  now: Date,
  localMidnight: Date,
  timeZone: string,
): Promise<SlotSuggestion | null> {
  const data = await personProfile.loadPersonProfile(tx, personId);
  if (!data) return null;
  const profile = deriveProfile(data, now, timeZone);
  const preference = timeOfDayPreference(profile.preferences.map((fact) => fact.value));
  const days = Array.from({ length: 7 }, (_, d) => ({ dayStart: new Date(localMidnight.getTime() + d * 24 * HOUR) }));
  const fixed = (await events.listBetween(tx, localMidnight, new Date(localMidnight.getTime() + 8 * 24 * HOUR)))
    .filter((row) => row.starts_at !== null)
    .map((row) => ({ start: row.starts_at!, end: row.ends_at ?? new Date(row.starts_at!.getTime() + 30 * 60_000) }));
  const source = profile.preferences.find((fact) => timeOfDayPreference([fact.value]) === preference);
  return {
    person: profile.name,
    preference,
    basis: preference && source ? `${source.value} (${source.source})` : "no stated time of day — working hours",
    slots: suggestSlots(fixed, { days, now, minutes, preference, workStartHour: WORK_START_HOUR, workEndHour: WORK_END_HOUR }),
  };
}
