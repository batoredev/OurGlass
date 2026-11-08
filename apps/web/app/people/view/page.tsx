"use client";

/**
 * One person — the person model (ROADMAP Stage 2).
 *
 * Every line is derived from what happened and says where it came from
 * (apps/api people/profile.ts). Nothing is looked up elsewhere. Corrections
 * are made in conversation ("no, Barkha handles the newsletter now"); the
 * person and everything about them can be deleted for good here.
 *
 * Static site: one page for every person, chosen by `?id=` (as /types/view).
 */
import { Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { AsyncPage } from "../../async-page";
import { DeletePermanently } from "../../delete-permanently";
import { Avatar } from "../../icons";
import { fetchPersonProfile, type OpenItem, type PersonProfile, type Sourced } from "../../../lib/api";
import { LoadFailure, PageHeader } from "../../surface";

function Source({ text }: { text: string }) {
  return <span className="profile-source"> — {text}</span>;
}

function Items({ items }: { items: readonly OpenItem[] }) {
  return (
    <ul className="profile-list">
      {items.map((item) => (
        <li key={item.id}>
          {item.what}
          {item.due ? <span className={item.overdue ? "status overdue" : "profile-due"}> due {item.due}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Facts({ title, facts }: { title: string; facts: readonly Sourced<string>[] }) {
  if (facts.length === 0) return null;
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      <ul className="profile-list">
        {facts.map((fact, index) => (
          <li key={index}>
            {fact.value}
            <Source text={fact.source} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProfileView({ profile }: { profile: PersonProfile }) {
  const record = profile.reliability;
  return (
    <section className="page page-narrow">
      <PageHeader title={profile.name} eyebrow="Person" subtitle="Everything here comes from what you told me, and says when." />
      <div className="profile-head">
        <Avatar name={profile.name} />
        <div className="profile-meta">
          {profile.organization ? <div>{profile.organization.value}</div> : null}
          {profile.email ? <div>{profile.email.value}</div> : null}
          {profile.lastInteraction ? (
            <div>
              Last: {profile.lastInteraction.value}
              <Source text={profile.lastInteraction.source} />
            </div>
          ) : null}
        </div>
      </div>

      <section className="section">
        <h2 className="section-title">Between you</h2>
        <div className="profile-columns">
          <div>
            <h3 className="profile-subtitle">Owes you</h3>
            {profile.owesYou.value.length > 0 ? <Items items={profile.owesYou.value} /> : <p className="profile-empty">Nothing open.</p>}
          </div>
          <div>
            <h3 className="profile-subtitle">You owe</h3>
            {profile.youOwe.value.length > 0 ? <Items items={profile.youOwe.value} /> : <p className="profile-empty">Nothing open.</p>}
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Their record</h2>
        {record ? (
          <p className="profile-record">
            On time {record.value.onTime} of {record.value.onTime + record.value.late}
            {record.value.late > 0 && record.value.typicalLateHours !== null
              ? `; usually ${record.value.typicalLateHours} h late when late`
              : ""}
            <Source text={record.source} />
          </p>
        ) : (
          <p className="profile-empty">No record yet — nothing they owed you with a deadline has been finished.</p>
        )}
      </section>

      <Facts title="Preferences" facts={profile.preferences} />
      <Facts title="What you've told me" facts={profile.facts} />
      <Facts title="Patterns" facts={profile.patterns} />
      <Facts title="Groups and work" facts={profile.groups} />
      <Facts title="Files" facts={profile.files} />

      <section className="section">
        <DeletePermanently
          scope="person"
          id={profile.id}
          name={profile.name}
          consequence="Every commitment between you, and every memory, reminder and link about them, goes too."
        />
      </section>
    </section>
  );
}

async function renderPerson(id: string) {
  try {
    return <ProfileView profile={await fetchPersonProfile(id)} />;
  } catch (error: unknown) {
    return (
      <section className="page page-narrow">
        <PageHeader title="Person" />
        <LoadFailure error={error} />
      </section>
    );
  }
}

export default function PersonPage() {
  return (
    <Suspense>
      <PersonWithId />
    </Suspense>
  );
}

function PersonWithId() {
  const id = useSearchParams().get("id") ?? "";
  const render = useCallback(() => renderPerson(id), [id]);
  return <AsyncPage render={render} />;
}
