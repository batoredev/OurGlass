"use client";

/**
 * One user-defined entity type, rendered generically.
 *
 * ┌─ THE PAGE THE DYNAMIC-ENTITY REQUIREMENT LIVES OR DIES ON ─────────────┐
 * │ There is no `gym_session` anywhere in this file. No import, no switch, │
 * │ no per-type component. The columns come from the type's own            │
 * │ `entity_type_fields` and the cells from `renderValue`, so a type the   │
 * │ assistant invented thirty seconds ago renders here on the next page    │
 * │ load — no deploy, no migration, no code change.                        │
 * │                                                                        │
 * │ If you ever find yourself adding `if (typeKey === ...)` here, the      │
 * │ requirement has been broken and the right fix is upstream: either a    │
 * │ new `field_kind` (a schema change, deliberately hard) or a better      │
 * │ generic renderer.                                                      │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { fetchEntityRecords, fetchPeople, type EntityRecord, type Person } from "../../../lib/api";
import { isNumericKind, renderValue } from "../../../lib/render-value";
import { LoadError, Page, Table, formatWhen, type Column } from "../../ui";
import { AsyncPage } from "../../async-page";

async function renderEntityType(key: string) {

  let data: Awaited<ReturnType<typeof fetchEntityRecords>>;
  let peopleById: Map<string, Person>;
  try {
    // People are fetched alongside so `person_ref` fields resolve to names.
    // One extra request rather than an API that pre-joins: the registry
    // response stays generic, which is what keeps this page type-agnostic.
    const [records, people] = await Promise.all([fetchEntityRecords(key), fetchPeople()]);
    data = records;
    peopleById = new Map(people.map((person) => [person.id, person]));
  } catch (error: unknown) {
    return (
      <Page title={key}>
        <LoadError error={error} />
      </Page>
    );
  }

  const ctx = { peopleById, timeZone: "Asia/Kolkata" };

  // THE COLUMNS ARE THE TYPE'S OWN FIELDS, in `ordinal` order — which is why
  // the ordinal exists at all (migration 006): JSONB has no key order, so
  // without it the columns would reshuffle between requests.
  const columns: Column<EntityRecord>[] = [
    ...data.type.fields.map((field) => ({
      key: field.field_key,
      header: field.label,
      numeric: isNumericKind(field.field_kind),
      render: (record: EntityRecord) => renderValue(field, record.payload[field.field_key], ctx),
    })),
    {
      key: "_recorded",
      header: "Recorded",
      render: (record: EntityRecord) => formatWhen(record.t_created),
    },
  ];

  return (
    <Page title={data.type.display_name}>
      <p style={{ color: "#666", fontSize: "0.85rem", marginBottom: "1rem" }}>
        {data.type.type_key} · schema v{data.type.current_version} · {data.records.length}{" "}
        {data.records.length === 1 ? "record" : "records"}
      </p>
      <Table
        columns={columns}
        rows={data.records}
        rowKey={(record) => record.id}
        empty={`${data.type.display_name.toLowerCase()} records`}
      />
    </Page>
  );
}

// Static site: one page for every type, chosen by `?key=`. A dynamic path
// segment (/types/[key]) would need every key known at build time, and the
// whole point of the registry is that new types appear at runtime.
export default function EntityTypePage() {
  return (
    <Suspense>
      <EntityTypeWithKey />
    </Suspense>
  );
}

function EntityTypeWithKey() {
  const key = useSearchParams().get("key") ?? "";
  const render = useCallback(() => renderEntityType(key), [key]);
  return <AsyncPage render={render} />;
}
