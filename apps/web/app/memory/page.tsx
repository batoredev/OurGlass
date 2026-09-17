/**
 * §29 Memory — what the assistant believes, with its provenance.
 *
 * §28 is explicit that the user must be able to inspect and correct this. The
 * correction itself happens in conversation ("forget that ..."), which is why
 * there is no edit control here: a second write path would bypass the tool
 * layer, `action_log` and undo.
 */
import { fetchMemories, type Memory } from "../../lib/api";
import { EmptyState, LoadFailure, PageHeader } from "../surface";

export const dynamic = "force-dynamic";

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;

  let memories: readonly Memory[];
  try {
    memories = await fetchMemories();
  } catch (error: unknown) {
    return (
      <section className="page page-narrow">
        <PageHeader title="Memories" />
        <LoadFailure error={error} />
      </section>
    );
  }

  const needle = q.trim().toLowerCase();
  const results = needle
    ? memories.filter((memory) => memory.body.toLowerCase().includes(needle))
    : memories;

  return (
    <section className="page page-narrow">
      <PageHeader
        title="Memories"
        subtitle="What OurGlass understands, with a clear source for every detail."
        eyebrow="Memory"
      />

      <form className="search" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search memories..."
          aria-label="Search memories"
        />
      </form>

      <section className="section">
        <h2 className="section-title">
          {needle ? `${results.length} found` : `${memories.length} remembered`}
        </h2>
        <div className="rule-list">
          {results.length === 0 ? (
            <EmptyState
              title={needle ? "No matching memories" : "Nothing remembered yet"}
              body={
                needle
                  ? "Try a person, project, or phrase you remember using."
                  : "Tell the assistant something worth keeping and it will appear here."
              }
            />
          ) : (
            results.map((memory) => (
              <div className="row memory-row" key={memory.id}>
                <div>
                  <div className="memory-text">{memory.body}</div>
                  <div className="memory-tags">
                    <span className="meta-tag">{memory.kind}</span>
                    <span className="meta-tag">{memory.inference_level}</span>
                  </div>
                </div>
                <div className="memory-date">
                  {new Date(memory.t_created).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
