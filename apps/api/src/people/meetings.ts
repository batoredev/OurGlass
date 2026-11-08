/**
 * Briefs for a set of meetings (ROADMAP Stage 2) — shared by GET /api/meetings
 * and the morning brief (Stage 5), so both say the same thing.
 */
import { people, personProfile, users, type Event } from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";
import { briefFor, peopleInMeeting, type BriefForPerson } from "./brief.js";
import { deriveProfile } from "./profile.js";

/** meeting id -> one brief per known person it names (meetings in [now, until) only). */
export async function briefsForMeetings(
  tx: DatabaseTransaction,
  meetings: readonly Event[],
  now: Date,
  until: Date,
  timeZone: string,
): Promise<Map<string, BriefForPerson[]>> {
  const everyone = await people.list(tx);
  const selfId = (await users.currentAccount(tx))?.self?.id ?? null;
  const cache = new Map<string, BriefForPerson | null>();
  const out = new Map<string, BriefForPerson[]>();
  for (const meeting of meetings) {
    if (meeting.starts_at === null || meeting.starts_at < now || meeting.starts_at >= until) continue;
    const forMeeting: BriefForPerson[] = [];
    for (const person of peopleInMeeting(meeting, everyone, selfId)) {
      if (!cache.has(person.id)) {
        const data = await personProfile.loadPersonProfile(tx, person.id);
        cache.set(person.id, data ? briefFor(deriveProfile(data, now, timeZone)) : null);
      }
      const brief = cache.get(person.id);
      if (brief) forMeeting.push(brief);
    }
    if (forMeeting.length > 0) out.set(meeting.id, forMeeting);
  }
  return out;
}
