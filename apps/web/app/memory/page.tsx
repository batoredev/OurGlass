/**
 * §29 Memory — what the assistant believes, and how confidently.
 *
 * `inference_level` is shown because §28's "inspect and correct what the
 * assistant believes" is impossible without it: CONFIRMED and INFERRED
 * deserve different scrutiny from the reader, and hiding the difference makes
 * every memory look equally authoritative.
 */
import { fetchMemories, type Memory } from "../../lib/api";
import { LoadError, Page, Table, formatWhen, type Column } from "../ui";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  let memories: readonly Memory[];
  try {
    memories = await fetchMemories();
  } catch (error: unknown) {
    return (
      <Page title="Memory">
        <LoadError error={error} />
      </Page>
    );
  }

  const columns: Column<Memory>[] = [
    { key: "body", header: "Memory", render: (memory) => memory.body },
    { key: "kind", header: "Kind", render: (memory) => memory.kind },
    { key: "level", header: "Confidence", render: (memory) => memory.inference_level },
    { key: "when", header: "Recorded", render: (memory) => formatWhen(memory.t_created) },
  ];

  return (
    <Page title="Memory">
      <p style={{ color: "#666", fontSize: "0.85rem", marginBottom: "1rem" }}>
        Say &ldquo;forget that &hellip;&rdquo; to correct anything here. Nothing is deleted &mdash;
        it stops being current, and the change is undoable.
      </p>
      <Table columns={columns} rows={memories} rowKey={(memory) => memory.id} empty="memories" />
    </Page>
  );
}
