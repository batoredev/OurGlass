/**
 * §29 Commitments — the primary abstraction (spec §6), read-only.
 *
 * Ownership direction is shown in both directions because it is STORED in
 * both directions (§7): `owner_id` delivers, `recipient_id` receives. The
 * filter is a query parameter rather than client state, so a filtered view is
 * a link you can share and reload.
 */
import Link from "next/link";
import {
  fetchCommitments,
  fetchDirectory,
  type Commitment,
} from "../../lib/api";
import { Avatar, StatusPill } from "../icons";
import { EmptyState, LoadFailure, PageHeader, statusLabel, statusTone, when } from "../surface";

export const dynamic = "force-dynamic";

const TABS = [
  ["all", "All"],
  ["to-me", "Owed to me"],
  ["by-me", "Owed by me"],
  ["completed", "Completed"],
] as const;

const TERMINAL = new Set(["completed", "completed_late", "cancelled", "superseded"]);

export default async function CommitmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter = "all" } = await searchParams;

  let rows: readonly Commitment[];
  let selfPersonId: string | null;
  let byId: Map<string, string>;
  try {
    const [commitments, directory] = await Promise.all([fetchCommitments(), fetchDirectory()]);
    rows = commitments;
    selfPersonId = directory.selfPersonId;
    byId = new Map(directory.people.map((person) => [person.id, person.display_name]));
  } catch (error: unknown) {
    return (
      <section className="page">
        <PageHeader title="Commitments" />
        <LoadFailure error={error} />
      </section>
    );
  }

  const nameOf = (id: string | null) =>
    id === null ? "Someone" : id === selfPersonId ? "You" : (byId.get(id) ?? "Someone");

  const visible = rows.filter((commitment) => {
    if (filter === "completed") return TERMINAL.has(commitment.status);
    if (filter === "to-me") return commitment.recipient_id === selfPersonId;
    if (filter === "by-me") return commitment.owner_id === selfPersonId;
    return true;
  });

  return (
    <section className="page">
      <PageHeader
        title="Commitments"
        subtitle="What people are counting on, in both directions."
        eyebrow="Understood from conversation"
      />

      <div className="tabs">
        {TABS.map(([id, label]) => (
          <Link
            key={id}
            className={`tab ${filter === id ? "active" : ""}`}
            href={id === "all" ? "/commitments" : `/commitments?filter=${id}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="rule-list">
        {visible.length === 0 ? (
          <EmptyState
            title="Nothing here"
            body="When you mention a commitment, it will appear automatically."
          />
        ) : (
          visible.map((commitment) => {
            const owner = nameOf(commitment.owner_id);
            const mine = commitment.owner_id === selfPersonId;
            return (
              <div
                className={`row commitment-row ${TERMINAL.has(commitment.status) ? "completed-row" : ""}`}
                key={commitment.id}
              >
                <div className="person-cell">
                  <Avatar name={mine ? "Me" : owner} />
                  <div>
                    <div className="row-title">{owner}</div>
                    <div className="relation-label">{mine ? "You owe" : "Owes you"}</div>
                  </div>
                </div>
                <div>
                  <div className="row-title">{commitment.object_text}</div>
                  <div className="row-subtitle">to {nameOf(commitment.recipient_id)}</div>
                </div>
                <div className="due-cell">{when(commitment.expected_at)}</div>
                <StatusPill
                  label={statusLabel(commitment.status)}
                  tone={statusTone(commitment.status)}
                />
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
