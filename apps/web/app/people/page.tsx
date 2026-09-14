/** §29 People, read-only. */
import { fetchPeople, type Person } from "../../lib/api";
import { LoadError, Page, Table, type Column } from "../ui";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  let people: readonly Person[];
  try {
    people = await fetchPeople();
  } catch (error: unknown) {
    return (
      <Page title="People">
        <LoadError error={error} />
      </Page>
    );
  }

  const columns: Column<Person>[] = [
    { key: "name", header: "Name", render: (person) => person.display_name },
  ];

  return (
    <Page title="People">
      <Table columns={columns} rows={people} rowKey={(person) => person.id} empty="people" />
    </Page>
  );
}
