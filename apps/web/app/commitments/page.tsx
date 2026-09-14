/**
 * §29 Commitments — the primary abstraction (spec §6), read-only.
 *
 * Ownership direction is shown as TWO columns because it is stored as two
 * columns (§7). That is the product's stated differentiator, and collapsing
 * it into one "who" column here would hide the distinction the schema exists
 * to preserve.
 */
import { fetchCommitments, fetchPeople, type Commitment, type Person } from "../../lib/api";
import { LoadError, Page, Table, formatWhen, type Column } from "../ui";

export const dynamic = "force-dynamic";

export default async function CommitmentsPage() {
  let commitments: readonly Commitment[];
  let peopleById: Map<string, Person>;
  try {
    const [rows, people] = await Promise.all([fetchCommitments(), fetchPeople()]);
    commitments = rows;
    peopleById = new Map(people.map((person) => [person.id, person]));
  } catch (error: unknown) {
    return (
      <Page title="Commitments">
        <LoadError error={error} />
      </Page>
    );
  }

  // Falls back to the raw id rather than blank: an unresolvable owner means
  // the person row was invalidated, which should be visible.
  const name = (id: string | null): string =>
    id === null ? "\u2014" : (peopleById.get(id)?.display_name ?? id);

  const columns: Column<Commitment>[] = [
    { key: "owner", header: "Owner", render: (row) => name(row.owner_id) },
    { key: "recipient", header: "Recipient", render: (row) => name(row.recipient_id) },
    { key: "object", header: "What", render: (row) => row.object_text },
    { key: "status", header: "Status", render: (row) => row.status },
    { key: "due", header: "Due", render: (row) => formatWhen(row.expected_at) },
  ];

  return (
    <Page title="Commitments">
      <Table columns={columns} rows={commitments} rowKey={(row) => row.id} empty="commitments" />
    </Page>
  );
}
