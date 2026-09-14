/**
 * The dynamic-type index — every type the assistant has been asked to track.
 *
 * Listed from the REGISTRY, never from a hardcoded array. This page has no
 * knowledge of what types exist; it asks.
 */
import Link from "next/link";
import { fetchEntityTypes, type EntityTypeWithFields } from "../../lib/api";
import { LoadError, Page, Table, type Column } from "../ui";

export const dynamic = "force-dynamic";

export default async function TypesPage() {
  let types: readonly EntityTypeWithFields[];
  try {
    types = await fetchEntityTypes();
  } catch (error: unknown) {
    return (
      <Page title="Types">
        <LoadError error={error} />
      </Page>
    );
  }

  const columns: Column<EntityTypeWithFields>[] = [
    {
      key: "name",
      header: "Type",
      render: (type) => (
        <Link href={`/types/${encodeURIComponent(type.type_key)}`}>{type.display_name}</Link>
      ),
    },
    { key: "key", header: "Key", render: (type) => type.type_key },
    {
      key: "fields",
      header: "Fields",
      render: (type) => type.fields.map((field) => field.label).join(", ") || "—",
    },
    {
      key: "version",
      header: "Schema",
      numeric: true,
      render: (type) => `v${type.current_version}`,
    },
  ];

  return (
    <Page title="Types">
      <p style={{ color: "#666", fontSize: "0.85rem", marginBottom: "1rem" }}>
        Types you have asked the assistant to track. Say &ldquo;track my gym sessions with a date
        and a duration&rdquo; and the new type appears here — no deploy.
      </p>
      <Table columns={columns} rows={types} rowKey={(type) => type.id} empty="types defined" />
    </Page>
  );
}
