/**
 * §29 Today — what is overdue, what is due, what has no date.
 *
 * THREE GROUPS RATHER THAN ONE SORTED LIST, because "overdue" and "undated"
 * are different KINDS of attention: one needs action now, the other needs a
 * decision about when. Sorting them together buries the first among the third.
 */
import { fetchToday, type Commitment, type Today, type TodayEvent } from "../../lib/api";
import { Empty, LoadError, Page, Table, formatWhen, type Column } from "../ui";

export const dynamic = "force-dynamic";

const commitmentColumns: Column<Commitment>[] = [
  { key: "object", header: "What", render: (row) => row.object_text },
  { key: "status", header: "Status", render: (row) => row.status },
  { key: "due", header: "Due", render: (row) => formatWhen(row.expected_at) },
];

const eventColumns: Column<TodayEvent>[] = [
  { key: "title", header: "Event", render: (event) => event.title },
  { key: "when", header: "Starts", render: (event) => formatWhen(event.starts_at) },
];

export default async function TodayPage() {
  let today: Today;
  try {
    today = await fetchToday();
  } catch (error: unknown) {
    return (
      <Page title="Today">
        <LoadError error={error} />
      </Page>
    );
  }

  const nothing =
    today.overdue.length === 0 &&
    today.dueLater.length === 0 &&
    today.undated.length === 0 &&
    today.events.length === 0;

  if (nothing) {
    return (
      <Page title="Today">
        <Empty what="commitments or events" />
      </Page>
    );
  }

  return (
    <Page title="Today">
      {today.overdue.length > 0 && (
        <section style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem" }}>Overdue</h2>
          <Table
            columns={commitmentColumns}
            rows={today.overdue}
            rowKey={(row) => row.id}
            empty="overdue"
          />
        </section>
      )}
      {today.dueLater.length > 0 && (
        <section style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem" }}>Coming up</h2>
          <Table
            columns={commitmentColumns}
            rows={today.dueLater}
            rowKey={(row) => row.id}
            empty="upcoming"
          />
        </section>
      )}
      {today.undated.length > 0 && (
        <section style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem" }}>No date</h2>
          <Table
            columns={commitmentColumns}
            rows={today.undated}
            rowKey={(row) => row.id}
            empty="undated"
          />
        </section>
      )}
      {today.events.length > 0 && (
        <section>
          <h2 style={{ fontSize: "1rem" }}>Events</h2>
          <Table
            columns={eventColumns}
            rows={today.events}
            rowKey={(event) => event.id}
            empty="events"
          />
        </section>
      )}
    </Page>
  );
}
