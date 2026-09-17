/**
 * §29 Today — what is overdue, what is due, what has no date.
 *
 * THREE GROUPS RATHER THAN ONE SORTED LIST, because "overdue" and "undated"
 * are different KINDS of attention: one needs action now, the other needs a
 * decision about when.
 */
import { fetchDirectory, fetchToday, type Commitment, type Today } from "../../lib/api";
import { Icon, StatusPill } from "../icons";
import { EmptyState, LoadFailure, statusLabel, statusTone, when } from "../surface";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  let today: Today;
  let nameOf: (id: string | null) => string;
  try {
    const [data, directory] = await Promise.all([fetchToday(), fetchDirectory()]);
    today = data;
    const byId = new Map(directory.people.map((person) => [person.id, person.display_name]));
    nameOf = (id) =>
      id === null ? "Someone" : id === directory.selfPersonId ? "You" : (byId.get(id) ?? "Someone");
  } catch (error: unknown) {
    return (
      <section className="page page-narrow">
        <LoadFailure error={error} />
      </section>
    );
  }

  const now = new Date();
  const row = (commitment: Commitment, group: string) => (
    <div className="row" key={`${group}-${commitment.id}`}>
      <div>
        <div className="row-title">{commitment.object_text}</div>
        <div className="row-subtitle">
          {nameOf(commitment.owner_id)} owes {nameOf(commitment.recipient_id)} ·{" "}
          {when(commitment.expected_at)}
        </div>
      </div>
      <StatusPill label={statusLabel(commitment.status)} tone={statusTone(commitment.status)} />
    </div>
  );

  const nothing =
    today.overdue.length === 0 &&
    today.dueLater.length === 0 &&
    today.undated.length === 0 &&
    today.events.length === 0;

  return (
    <section className="page page-narrow">
      <header className="page-header day-header">
        <div>
          <div className="eyebrow">Your day story</div>
          <h1>Today</h1>
          <p className="page-subtitle">
            {now.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <div className="date-poster">
          <b>{now.getDate()}</b>
          <span>
            {now.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}
            <br />
            {now.toLocaleDateString(undefined, { month: "short" }).toUpperCase()}
          </span>
        </div>
      </header>

      {today.events.length > 0 && (
        <>
          <div className="section-title">Schedule</div>
          <div className="timeline">
            {today.events.map((event) => (
              <div className="timeline-item" key={event.id}>
                <div className="timeline-time">
                  {new Date(event.starts_at).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
                <div>
                  <div className="timeline-title">{event.title}</div>
                </div>
                <span className="meta-tag">
                  {new Date(event.starts_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {today.overdue.length > 0 && (
        <section className="section">
          <h2 className="section-title">Overdue</h2>
          <div className="rule-list">{today.overdue.map((c) => row(c, "overdue"))}</div>
        </section>
      )}

      {today.dueLater.length > 0 && (
        <section className="section">
          <h2 className="section-title">Due later</h2>
          <div className="rule-list">{today.dueLater.map((c) => row(c, "later"))}</div>
        </section>
      )}

      {today.undated.length > 0 && (
        <section className="section">
          <h2 className="section-title">No date yet</h2>
          <div className="rule-list">{today.undated.map((c) => row(c, "undated"))}</div>
        </section>
      )}

      {nothing ? (
        <EmptyState
          title="Nothing yet"
          body="Tell the assistant what is happening and it will appear here."
        />
      ) : (
        <div className="subtle-callout">
          <Icon name="check" />
          <span>That is everything on record for today.</span>
        </div>
      )}
    </section>
  );
}
