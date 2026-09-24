/**
 * Alerts to a chat webhook — Track P2 "Alerting", destination decided by the
 * owner on 2026-09-24 (docs/DECISIONS.md): a Slack or Discord channel.
 *
 * TWO EVENTS, because they are the two outages this app has that nobody would
 * otherwise notice:
 *   - the reminder cron failed (reminders silently stop firing), and
 *   - every AI model failed for a message (every reply degrades to "I couldn't
 *     process that").
 * Everything else is in the logs; an alert channel that fires on noise gets
 * muted, and then it catches nothing.
 *
 * ┌─ WHAT AN ALERT MAY CONTAIN ────────────────────────────────────────────┐
 * │ Operational facts only: provider names, error categories, a time, an   │
 * │ error's class and a redacted first line. NEVER the user's words — a    │
 * │ chat channel is a different privacy boundary from the database, and    │
 * │ the utterance is exactly what someone reading it has no business       │
 * │ seeing. Connection strings are redacted from error text.               │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * NEVER THROWS and never waits long: alerting must not break, or slow, the
 * thing it is reporting on. One per event kind per cooldown per isolate, so an
 * outage produces a message, not a flood.
 */

export type AlertKind = "cron_failed" | "ai_all_failed";

export interface AlertDeps {
  readonly webhookUrl: string | undefined;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

export const ALERT_COOLDOWN_MS = 15 * 60_000;
const ALERT_TIMEOUT_MS = 3_000;
const lastSent = new Map<AlertKind, number>();

/** Test-only. The cooldown map is per isolate by design. */
export function resetAlertCooldownsForTests(): void {
  lastSent.clear();
}

/** Slack wants `text`, Discord wants `content`; anything else gets both. */
export function alertPayload(webhookUrl: string, message: string): Record<string, string> {
  let host = "";
  try {
    host = new URL(webhookUrl).hostname;
  } catch {
    // An unparseable URL fails at fetch time, which is swallowed; the payload
    // shape does not matter then.
  }
  if (host === "hooks.slack.com") return { text: message };
  if (host === "discord.com" || host === "discordapp.com") return { content: message };
  return { text: message, content: message };
}

/** Error text with credentials removed — a pg error can quote its URL. */
export function redact(text: string): string {
  return text
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/((?:key|token|secret|password)\s*[=:]\s*)\S+/gi, "$1[redacted]")
    .slice(0, 200);
}

export async function sendAlert(kind: AlertKind, message: string, deps: AlertDeps): Promise<"sent" | "skipped"> {
  if (!deps.webhookUrl) return "skipped";
  const now = (deps.now ?? Date.now)();
  const previous = lastSent.get(kind);
  if (previous !== undefined && now - previous < ALERT_COOLDOWN_MS) return "skipped";
  lastSent.set(kind, now);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
  try {
    await (deps.fetchImpl ?? fetch)(deps.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(alertPayload(deps.webhookUrl, `OurGlass: ${message}`)),
      signal: controller.signal,
    });
    return "sent";
  } catch (error: unknown) {
    // Logged, never rethrown. The URL is a secret and stays out of the log.
    console.error("[alert] webhook failed:", error instanceof Error ? error.name : "unknown");
    return "sent";
  } finally {
    clearTimeout(timer);
  }
}

/** The reminder cron threw. */
export function cronFailedMessage(error: unknown, at: Date): string {
  const detail = error instanceof Error ? `${error.name}: ${redact(error.message)}` : "unknown error";
  return `the reminder timer failed at ${at.toISOString()} (${detail}). Reminders and rules are not firing until it recovers. See docs/RUNBOOK.md.`;
}

/**
 * Every Interpret attempt for one message failed, or null if any succeeded.
 * Built from the router's own per-attempt log records, so it reports exactly
 * what the log already says.
 */
export function allModelsFailedMessage(
  attempts: readonly { readonly stage: string; readonly ok: boolean; readonly provider: string; readonly errorCategory?: string }[],
  at: Date,
): string | null {
  const interpret = attempts.filter((attempt) => attempt.stage === "interpret");
  if (interpret.length === 0 || interpret.some((attempt) => attempt.ok)) return null;
  const why = interpret.map((attempt) => `${attempt.provider}: ${attempt.errorCategory ?? "unknown"}`).join(", ");
  return `every AI model failed for a message at ${at.toISOString()} (${why}). Nothing was saved for it; the user was told to try again. Check provider credit and quota.`;
}
