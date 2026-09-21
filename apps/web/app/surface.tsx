/**
 * Shared pieces of the read surfaces, in the supplied design's vocabulary.
 *
 * Every one of them is about telling the truth on screen: an empty list that
 * says it is empty, an error that says what failed, and a status pill whose
 * colour comes from the stored status rather than from a guess.
 */
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
    </header>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

/**
 * Shown rather than swallowed. The likeliest failure is a 401 (not signed in)
 * or a 404 (the API is closed), and an empty table would tell the user their
 * data is gone — alarming, and false.
 */
export function LoadFailure({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="empty-state">
      <h3>Could not load</h3>
      <p>{message}</p>
    </div>
  );
}

export function Surface({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="page">
      <PageHeader title={title} />
      {children}
    </section>
  );
}

/** The stored commitment status, mapped onto the design's four pill tones. */
export function statusTone(status: string): string {
  if (status === "completed" || status === "completed_late") return "done";
  if (status === "overdue") return "overdue";
  if (status === "waiting" || status === "waiting_on_someone" || status === "blocked") {
    return "waiting";
  }
  return "pending";
}

export function statusLabel(status: string): string {
  const spaced = status.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The last millisecond of a local day — what the resolver stores when the
 * user named a DAY and no clock time ("by Friday").
 *
 * See END_OF_DAY in apps/api/src/assistant/time.ts. It is a convention, not
 * something anyone said, so these surfaces print the date alone: the reply in
 * chat says "by Friday, September 25", and a card reading "Fri, 25 Sept,
 * 11:59 pm" beside it invents a precision the conversation never had.
 */
function isEndOfLocalDay(date: Date): boolean {
  return (
    date.getHours() === 23 &&
    date.getMinutes() === 59 &&
    date.getSeconds() === 59 &&
    date.getMilliseconds() === 999
  );
}

/** A date a person can read, or "No date" — never an empty cell. */
export function when(value: string | null): string {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  const dayOnly = isEndOfLocalDay(date);
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(dayOnly ? {} : { hour: "numeric" as const, minute: "2-digit" as const }),
  });
}
