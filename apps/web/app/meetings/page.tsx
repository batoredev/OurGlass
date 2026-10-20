"use client";

/**
 * Meetings — what is scheduled from today on, grouped by day.
 *
 * Meetings are made by talking: "Schedule a meeting with Moorthy at 6 pm".
 * Each one says whether it also reached Google Calendar.
 */
import Link from "next/link";
import { AsyncPage } from "../async-page";
import { fetchGoogleStatus, fetchMeetings, type GoogleStatus, type Meeting } from "../../lib/api";
import { Icon } from "../icons";
import { EmptyState, LoadFailure, PageHeader } from "../surface";

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

async function renderMeetings() {
  let meetings: readonly Meeting[];
  let google: GoogleStatus | null;
  try {
    const [data, status] = await Promise.all([fetchMeetings(), fetchGoogleStatus().catch(() => null)]);
    meetings = data.meetings;
    google = status;
  } catch (error: unknown) {
    return (
      <section className="page page-narrow">
        <PageHeader title="Meetings" />
        <LoadFailure error={error} />
      </section>
    );
  }

  const days = new Map<string, Meeting[]>();
  for (const meeting of meetings) {
    const label = dayLabel(meeting.starts_at);
    days.set(label, [...(days.get(label) ?? []), meeting]);
  }
  const now = Date.now();

  return (
    <section className="page page-narrow">
      <PageHeader
        title="Meetings"
        eyebrow="Today and ahead"
        subtitle="Say “schedule a meeting with Moorthy at 6 pm” in the chat and it lands here."
      />

      {google && !google.connected && (
        <div className="subtle-callout meetings-hint">
          <Icon name="today" />
          <span>
            {google.configured ? (
              <>
                Meetings stay in OurGlass until you <Link href="/settings">connect Google Calendar</Link>.
              </>
            ) : (
              "Google Calendar isn't set up on the server yet, so meetings stay in OurGlass."
            )}
          </span>
        </div>
      )}

      {meetings.length === 0 ? (
        <EmptyState title="No meetings scheduled" body="Ask the assistant to schedule one and it will appear here." />
      ) : (
        [...days.entries()].map(([label, items]) => (
          <section className="section" key={label}>
            <h2 className="section-title">{label}</h2>
            <div className="timeline">
              {items.map((meeting) => (
                <div className={`timeline-item ${new Date(meeting.starts_at).getTime() < now ? "is-past" : ""}`} key={meeting.id}>
                  <div className="timeline-time">
                    {new Date(meeting.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </div>
                  <div>
                    <div className="timeline-title">{meeting.title}</div>
                    {meeting.location ? <div className="timeline-context">{meeting.location}</div> : null}
                  </div>
                  {meeting.on_google_calendar ? (
                    <span className="meta-tag">Google Calendar</span>
                  ) : (
                    <span className="meta-tag meta-tag-quiet">OurGlass only</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}

export default function MeetingsPage() {
  return <AsyncPage render={renderMeetings} />;
}
