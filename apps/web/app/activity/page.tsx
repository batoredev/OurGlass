/**
 * §29 Activity — every mutation, with who caused it.
 *
 * `actorKind` is the column that earns this page: it distinguishes what YOU
 * did from what a scheduled job did while you were away. Undo filters to
 * `user_turn` because a clock tick is not undoable — but this surface shows
 * both, because "why did it message me at 5?" is answerable only if the
 * scheduled work is visible.
 */
import { fetchActivity, type ActivityEntry } from "../../lib/api";
import { LoadError, Page, Table, formatWhen, type Column } from "../ui";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  let activity: readonly ActivityEntry[];
  try {
    activity = await fetchActivity();
  } catch (error: unknown) {
    return (
      <Page title="Activity">
        <LoadError error={error} />
      </Page>
    );
  }

  const columns: Column<ActivityEntry>[] = [
    { key: "when", header: "When", render: (entry) => formatWhen(entry.createdAt) },
    { key: "tool", header: "Action", render: (entry) => entry.toolName },
    { key: "actor", header: "Actor", render: (entry) => entry.actorKind },
    { key: "table", header: "Target", render: (entry) => entry.targetTable },
  ];

  return (
    <Page title="Activity">
      <Table columns={columns} rows={activity} rowKey={(entry) => entry.id} empty="activity" />
    </Page>
  );
}
