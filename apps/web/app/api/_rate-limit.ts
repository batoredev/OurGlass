/**
 * The spend cap on /api/turn — Track P2 of docs/REMAINING-EXECUTION-PLAN.md.
 *
 * Every turn asks a model to spend tokens, and until this file there was no
 * cap of any kind: one leaked access token was unbounded spend. Pure, like
 * `_http.ts`, so the tests run the real logic without a Postgres pool — the
 * route passes in the counter.
 *
 * METERED FROM `messages`, NOT FROM MEMORY. A Worker isolate is short-lived
 * and there can be many at once, so an in-process counter would reset and
 * split. Every turn writes its user message before Interpret, so counting
 * those rows counts exactly what was spent, across every isolate.
 *
 * A SOFT cap: two requests racing at the boundary can both pass. For a cost
 * ceiling that is fine — it bounds spend to the limit plus the concurrency,
 * not to infinity.
 *
 * ⚠ THE DEFAULTS ARE A PLACEHOLDER FOR AN OWNER DECISION. The cost budget per
 * message is Track D, still unstated. 20/minute is well above any human
 * typing; 500/day bounds a runaway script to a known daily worst case. Set
 * TURN_LIMIT_PER_MINUTE / TURN_LIMIT_PER_DAY to the real budget; 0 disables
 * one window (local evals, say) — deliberately explicit, never the default.
 */

export interface TurnLimits {
  readonly perMinute: number;
  readonly perDay: number;
}

export const DEFAULT_TURN_LIMITS: TurnLimits = { perMinute: 20, perDay: 500 };

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function readLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  // A typo must not silently remove the cap: anything that is not a
  // non-negative integer keeps the default.
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function turnLimits(env: Record<string, string | undefined>): TurnLimits {
  return {
    perMinute: readLimit(env["TURN_LIMIT_PER_MINUTE"], DEFAULT_TURN_LIMITS.perMinute),
    perDay: readLimit(env["TURN_LIMIT_PER_DAY"], DEFAULT_TURN_LIMITS.perDay),
  };
}

/**
 * A 429 when a window is full, or null to proceed. Checked BEFORE the turn
 * starts, so a refused request writes nothing and spends nothing.
 */
export async function rejectOverLimit(
  countSince: (since: Date) => Promise<number>,
  limits: TurnLimits,
  now: Date = new Date(),
): Promise<Response | null> {
  const windows = [
    { limit: limits.perMinute, ms: MINUTE_MS, retryAfter: 60, wait: "a minute" },
    { limit: limits.perDay, ms: DAY_MS, retryAfter: 3600, wait: "a while" },
  ] as const;

  for (const window of windows) {
    if (window.limit === 0) continue;
    const used = await countSince(new Date(now.getTime() - window.ms));
    if (used >= window.limit) {
      return Response.json(
        { error: `Too many messages right now — nothing was saved. Try again in ${window.wait}.` },
        { status: 429, headers: { "Retry-After": String(window.retryAfter) } },
      );
    }
  }
  return null;
}
