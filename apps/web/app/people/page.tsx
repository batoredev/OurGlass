"use client";

/**
 * §29 People — who the assistant knows, and what each is carrying.
 *
 * The counts come from `commitments`, so a person with nothing open says so
 * rather than showing an invented summary line.
 */
import { AsyncPage } from "../async-page";
import { fetchCommitments, fetchDirectory } from "../../lib/api";
import Link from "next/link";
import { DeletePermanently } from "../delete-permanently";
import { Avatar } from "../icons";
import { EmptyState, LoadFailure, PageHeader } from "../surface";

const TERMINAL = new Set(["completed", "completed_late", "cancelled", "superseded"]);

async function renderPeople() {
  let directory: Awaited<ReturnType<typeof fetchDirectory>>;
  let openByPerson: Map<string, number>;
  try {
    const [people, commitments] = await Promise.all([fetchDirectory(), fetchCommitments()]);
    directory = people;
    openByPerson = new Map();
    for (const commitment of commitments) {
      if (TERMINAL.has(commitment.status)) continue;
      for (const id of [commitment.owner_id, commitment.recipient_id]) {
        if (id && id !== people.selfPersonId) {
          openByPerson.set(id, (openByPerson.get(id) ?? 0) + 1);
        }
      }
    }
  } catch (error: unknown) {
    return (
      <section className="page">
        <PageHeader title="People" />
        <LoadFailure error={error} />
      </section>
    );
  }

  const others = directory.people.filter((person) => person.id !== directory.selfPersonId);

  return (
    <section className="page">
      <PageHeader
        title="People"
        subtitle="The people in your world, understood from context."
        eyebrow="People"
      />
      {others.length === 0 ? (
        <EmptyState
          title="No one yet"
          body="Mention someone in conversation and they will appear here."
        />
      ) : (
        <div className="people-grid">
          {others.map((person) => {
            const open = openByPerson.get(person.id) ?? 0;
            return (
              <div className="person-card" key={person.id}>
                <div className="person-card-top">
                  <Avatar name={person.display_name} />
                  <div>
                    <Link className="person-name" href={`/people/view?id=${encodeURIComponent(person.id)}`}>
                      {person.display_name}
                    </Link>
                  </div>
                </div>
                <div className="person-card-stat">
                  {open === 0
                    ? "No open commitments"
                    : `${open} open commitment${open === 1 ? "" : "s"}`}
                </div>
                <DeletePermanently
                  scope="person"
                  id={person.id}
                  name={person.display_name}
                  consequence="Every commitment between you, and every memory, reminder and link about them, goes too."
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function PeoplePage() {
  return <AsyncPage render={renderPeople} />;
}
