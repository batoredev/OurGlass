/** Deterministic temporal resolution for Phase 2. */
import * as chrono from "chrono-node";
import type { IntentKind, TimeReference } from "@ourglass/shared";

export type ResolvedTime =
  | {
      readonly tier: "deterministic";
      readonly sourcePhrase: string;
      readonly at: string;
      /**
       * Did the user actually state a CLOCK TIME, or only a day?
       *
       * "day" means chrono resolved the date and nothing said when. The
       * instant is then end of that day by convention, and the reply must not
       * print a time — see END_OF_DAY below.
       */
      readonly precision: TimePrecision;
    }
  | { readonly tier: "relational"; readonly sourcePhrase: string; readonly relation: "before" | "after"; readonly target: string }
  | { readonly tier: "event_trigger"; readonly sourcePhrase: string; readonly event: string }
  | { readonly tier: "unresolved"; readonly sourcePhrase: string; readonly reason: string };

/**
 * Which way an ambiguous phrase points in time.
 *
 * A bare phrase like "at 11" has no direction of its own — only the intent
 * kind carries that. "Remind me at 11" means the NEXT 11; "Barkha gave the
 * article at 11" means the one that already happened. Resolving both the same
 * way is wrong for one of them, and there is no phrase-level signal that
 * distinguishes them.
 */
export type TimeDirection = "forward" | "past" | "none";

export type TimePrecision = "minute" | "day";

/**
 * What a date with no stated time means: the END of that day, local.
 *
 * ┌─ A GUESSED CLOCK TIME, PRESENTED AS FACT ──────────────────────────┐
 * │ `parsed.start.get("hour")` returns chrono's value whether it was KNOWN │
 * │ or IMPLIED, and chrono implies the CURRENT hour and minute. So "by 6   │
 * │ tomorrow" — where chrono parses the day and drops the "6" — became     │
 * │ "due Tuesday at 11:25 AM", 11:25 being simply the time the user hit    │
 * │ enter. Live, on a real turn.                                           │
 * │                                                                        │
 * │ The code already refused the mirror image of this: an implied DATE is  │
 * │ `incomplete_date`, because "silently substituting today's date is how  │
 * │ 'later' becomes a confident wrong timestamp". An implied TIME is the   │
 * │ same defect and was not checked.                                       │
 * │                                                                        │
 * │ End of day is the honest reading of "by Friday" — a deadline you have  │
 * │ all day to meet — and because `precision` travels with it, the reply   │
 * │ says "due Friday" and claims no clock time it was not given.           │
 * └───────────────────────────────────────────────────────────────────────┘
 */
const END_OF_DAY = { hour: 23, minute: 59, second: 59, millisecond: 999 } as const;

/**
 * Direction per spec §5 intent kind.
 *
 * `completion_update` is reported AFTER the fact — that is what makes it an
 * update — so its times are past. `action` and `information` describe things
 * still to happen (a reminder, a due date), so they are forward. `context`,
 * `question`, and `execution` get no bias: a question ("what happened with the
 * article?") may reference either direction and guessing one would silently
 * pick a wrong year for "in March".
 */
const DIRECTION_BY_INTENT_KIND: Readonly<Record<IntentKind, TimeDirection>> = {
  information: "forward",
  action: "forward",
  completion_update: "past",
  context: "none",
  question: "none",
  execution: "forward",
  /**
   * "none", for the same reason as `question`. An inspection may reference
   * either direction — "what was I waiting on last week" versus "what's due
   * tomorrow" — and there is no phrase-level signal distinguishing them.
   * Guessing forward would silently pick the wrong year for "in March".
   */
  inspection: "none",
};

export function timeDirectionForIntent(kind: IntentKind): TimeDirection {
  return DIRECTION_BY_INTENT_KIND[kind];
}

/**
 * Resolves only deterministic expressions. The model supplies the exact phrase,
 * not an ISO timestamp, so DST and timezone arithmetic are repeatable and auditable.
 * Event/relational references intentionally stay unresolved for the Phase 3 rule engine.
 *
 * `direction` is REQUIRED rather than defaulted. The previous signature hardcoded
 * `forwardDate: true`, which dated every past-tense completion into the future —
 * spec §5's own example ("Barkha gave the article at 11") landed on TOMORROW, and
 * "last Friday" resolved to a FUTURE Friday. A default would reintroduce that for
 * any caller who forgot the argument, and the compiler cannot warn about a default.
 * Callers with an intent in hand should pass `timeDirectionForIntent(intent.kind)`.
 */
export function resolveTime(
  reference: TimeReference,
  now: Date,
  timezone: string,
  direction: TimeDirection,
): ResolvedTime {
  const phrase = reference.sourcePhrase.trim();
  if (phrase.length === 0) return { tier: "unresolved", sourcePhrase: phrase, reason: "empty_phrase" };

  if (reference.kind === "event_trigger") {
    return { tier: "event_trigger", sourcePhrase: phrase, event: phrase };
  }

  const relation = /^(before|after)\s+(.+)$/i.exec(phrase);
  if (reference.kind === "relational" || relation) {
    if (!relation) {
      return { tier: "unresolved", sourcePhrase: phrase, reason: "missing_relation" };
    }
    return {
      tier: "relational",
      sourcePhrase: phrase,
      relation: relation[1]!.toLowerCase() as "before" | "after",
      target: relation[2]!,
    };
  }

  // chrono needs SOME offset to establish "now" in the user's local terms. The
  // offset at `now` is correct for that purpose — `now` is by definition the
  // instant we are sampling. It is only wrong as the offset of the TARGET, which
  // is why we discard chrono's computed instant below and keep its civil fields.
  const referenceOffset = offsetMinutesAt(now, timezone);
  const options = direction === "none" ? {} : { forwardDate: direction === "forward" };
  const chronoReference = { instant: now, timezone: referenceOffset };

  let results = chrono.casual.parse(phrase, chronoReference, options);

  if (results.length === 0) {
    // ┌─ "by 6" — THE SPEC'S OWN HEADLINE SENTENCE ─────────────────────────┐
    // │ chrono parses "at 6" and does NOT parse "by 6", or bare "6". So     │
    // │ *"Barkha needs to give me the article by 6"* — the sentence the     │
    // │ product is specified around, and a Phase 2 fixture since — resolved │
    // │ to `unresolved` and the assistant answered "When is 'by 6'?".       │
    // │                                                                     │
    // │ Nothing caught it: the eval fixtures assert the LABEL the model     │
    // │ emits and never run the resolver, and time.test.ts happened to use  │
    // │ phrases chrono likes. Two declarations of one capability with no    │
    // │ cross-check — see resolution.test.ts, which is now that check.      │
    // │                                                                     │
    // │ ONLY A RETRY, never a rewrite of a phrase chrono already            │
    // │ understands: "by Friday" parses fine and must not be touched. And   │
    // │ `sourcePhrase` keeps the user's ORIGINAL words, so the resolution   │
    // │ stays auditable.                                                    │
    // └─────────────────────────────────────────────────────────────────────┘
    const deadlineRetry = phrase.replace(/^(?:by|due(?:\s+by)?)\s+/i, "at ");
    if (deadlineRetry !== phrase) {
      results = chrono.casual.parse(deadlineRetry, chronoReference, options);
    }
  }

  const parsed = results[0];
  if (!parsed) return { tier: "unresolved", sourcePhrase: phrase, reason: "unparseable" };

  // THE DST FIX. chrono resolves the CIVIL date/time correctly (it reports
  // {weekday, hour} as known and {day, month, year} as implied), but converts it
  // to an instant using the single fixed offset we passed — the offset at `now`.
  // Any phrase that crosses a DST boundary is then off by exactly one hour.
  //
  // Passing the IANA name straight to chrono does NOT fix this; it produces a
  // worse answer. So we take chrono's civil components and do the conversion
  // ourselves, sampling the zone offset AT THE TARGET DATE.
  //
  // `isCertain` distinguishes what the user SAID from what chrono filled in.
  // Only an hour the user actually stated makes this a clock time.
  const statedClockTime = parsed.start.isCertain("hour");
  const civil = {
    year: parsed.start.get("year"),
    month: parsed.start.get("month"),
    day: parsed.start.get("day"),
    hour: statedClockTime ? (parsed.start.get("hour") ?? 0) : END_OF_DAY.hour,
    minute: statedClockTime ? (parsed.start.get("minute") ?? 0) : END_OF_DAY.minute,
    second: statedClockTime ? (parsed.start.get("second") ?? 0) : END_OF_DAY.second,
    millisecond: statedClockTime
      ? (parsed.start.get("millisecond") ?? 0)
      : END_OF_DAY.millisecond,
  };
  if (civil.year === null || civil.month === null || civil.day === null) {
    // chrono parsed something without a resolvable calendar date. Refusing is
    // correct: silently substituting today's date is how "later" becomes a
    // confident wrong timestamp.
    return { tier: "unresolved", sourcePhrase: phrase, reason: "incomplete_date" };
  }

  // ┌─ "AT 5", SAID AT 4 PM, IS 5 PM TODAY ──────────────────────────────────┐
  // │ chrono reads a bare hour as AM. With forwardDate it then moves a past  │
  // │ 5 AM to TOMORROW — so "remind me at 5", typed at 4:20 PM, was saved   │
  // │ for Tue 5:00 AM. Live, on the first Gemini turn (2026-10-19), and an   │
  // │ older "at 5" reminder in the data had fired at 5 AM the same way.      │
  // │                                                                        │
  // │ When the user gave an hour with NO am/pm and NO day, both 5:00 and     │
  // │ 17:00 are readings of what they said, so take the one the direction    │
  // │ points at: the next such clock time for a reminder or deadline, the    │
  // │ most recent for a completion ("gave it at 11", said at 11:30 PM, is    │
  // │ 11 PM). A stated am/pm, a 24-hour time or a named day ("tomorrow at    │
  // │ 5") is left to chrono — this only chooses between two readings the     │
  // │ words genuinely allow.                                                 │
  // └────────────────────────────────────────────────────────────────────────┘
  const bareHour =
    statedClockTime &&
    direction !== "none" &&
    !parsed.start.isCertain("meridiem") &&
    !parsed.start.isCertain("day") &&
    !parsed.start.isCertain("weekday") &&
    civil.hour >= 1 &&
    civil.hour <= 12;
  const at = bareHour
    ? nearestClockTime(civil as CivilDateTime, now, timezone, direction)
    : civilToUtc(civil as CivilDateTime, timezone);

  // A PAST phrase must never resolve into the future. End of day would do
  // exactly that for "today" or "this morning", and a completion recorded
  // ahead of `now` makes lateness arithmetic nonsense. The latest instant
  // consistent with what was said, and no later than the present.
  const bounded =
    !statedClockTime && direction === "past" && at.getTime() > now.getTime() ? now : at;

  return {
    tier: "deterministic",
    sourcePhrase: phrase,
    at: bounded.toISOString(),
    precision: statedClockTime ? "minute" : "day",
  };
}

interface CivilDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

/**
 * The next (forward) or most recent (past) instant at which the local clock
 * in `timezone` reads `civil`'s hour — taken as either am or pm — and minute.
 *
 * Candidates are yesterday, today and tomorrow (local) at both readings; six
 * instants always contain the answer, because any clock time recurs within
 * 12 hours. Each goes through `civilToUtc`, so DST is handled per candidate.
 */
function nearestClockTime(
  civil: CivilDateTime,
  now: Date,
  timezone: string,
  direction: Exclude<TimeDirection, "none">,
): Date {
  const today = civilDateAt(now, timezone);
  const base = civil.hour % 12;
  const candidates: Date[] = [];
  for (const dayOffset of [-1, 0, 1]) {
    // Date.UTC normalises day 0 / day 32, rolling the month and year.
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset));
    for (const hour of [base, base + 12]) {
      candidates.push(
        civilToUtc(
          {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate(),
            hour,
            minute: civil.minute,
            second: civil.second,
            millisecond: civil.millisecond,
          },
          timezone,
        ),
      );
    }
  }
  const t = now.getTime();
  const sorted = candidates.sort((a, b) => a.getTime() - b.getTime());
  const pick =
    direction === "forward"
      ? sorted.find((candidate) => candidate.getTime() > t)
      : sorted.filter((candidate) => candidate.getTime() <= t).at(-1);
  // Unreachable with the six candidates above; chrono's reading is the fallback.
  return pick ?? civilToUtc(civil, timezone);
}

/** The calendar date `instant` falls on in `timezone`. */
function civilDateAt(instant: Date, timezone: string): { year: number; month: number; day: number } {
  const local = new Date(instant.getTime() + offsetMinutesAt(instant, timezone) * 60_000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

/**
 * Convert wall-clock components in `timezone` to a UTC instant.
 *
 * Two-pass, because the offset depends on the instant we are trying to compute:
 * guess using the offset at the naive instant, then re-sample the offset AT THAT
 * CANDIDATE and correct. The second sample lands on the correct side of a DST
 * transition, which is the whole point. Iterating twice is enough for every real
 * zone (offsets change by at most a couple of hours); the loop exits early once
 * it stops moving.
 *
 * Times inside a spring-forward gap (which do not exist) resolve to the instant
 * the offset change implies rather than throwing — a reminder set for a
 * nonexistent 2:30am should still fire, not fail.
 */
function civilToUtc(civil: CivilDateTime, timezone: string): Date {
  const naive = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
    civil.millisecond,
  );
  let utc = naive - offsetMinutesAt(new Date(naive), timezone) * 60_000;
  for (let pass = 0; pass < 2; pass += 1) {
    const corrected = naive - offsetMinutesAt(new Date(utc), timezone) * 60_000;
    if (corrected === utc) break;
    utc = corrected;
  }
  return new Date(utc);
}

/** Convert an IANA zone to chrono-node's offset-at-reference-time representation. */
function offsetMinutesAt(instant: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const values = formatter.formatToParts(instant);
    const parts = Object.fromEntries(values.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const localMs = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return Math.round((localMs - instant.getTime()) / 60_000);
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}
