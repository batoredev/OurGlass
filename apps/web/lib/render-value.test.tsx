/**
 * The generic renderer — six kinds, six branches, and the drift check.
 *
 * ================================ READ THIS ================================
 * The user's requirement is that a type the LLM invents displays with NO code
 * change. That holds only if two things stay true, and both are asserted here:
 *
 *   1. EVERY `field_kind` has a renderer. Tested per kind below, so a branch
 *      that is deleted or broken fails loudly.
 *   2. `FieldKind` in apps/web MATCHES the Postgres enum. The web app cannot
 *      import from packages/db (it would pull a Postgres driver into a
 *      browser bundle), so the type is declared twice — and two declarations
 *      of one fact drift silently. The last test reads migration 006 and
 *      compares.
 *
 * The exhaustiveness check itself is a COMPILE-time guarantee, so no runtime
 * test can exercise it. It is verified by mutation instead: add a seventh
 * kind to FieldKind and `pnpm typecheck` must fail.
 * ===========================================================================
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isNumericKind, renderValue, type RenderContext } from "./render-value";
import type { EntityTypeField, FieldKind, Person } from "./api";

const people: Person[] = [{ id: "aaaaaaaa-0000-4000-8000-000000000001", display_name: "Arun" }];

const ctx: RenderContext = {
  peopleById: new Map(people.map((person) => [person.id, person])),
  timeZone: "Asia/Kolkata",
};

function field(kind: FieldKind, over: Partial<EntityTypeField> = {}): EntityTypeField {
  return {
    field_key: "value",
    field_kind: kind,
    label: "Value",
    required: false,
    ordinal: 1,
    enum_options: null,
    ...over,
  };
}

describe("renderValue — one branch per field_kind", () => {
  it("renders text as-is", () => {
    expect(renderValue(field("text"), "legs day", ctx)).toBe("legs day");
  });

  it("renders a number with locale grouping", () => {
    expect(renderValue(field("number"), 1234, ctx)).toBe("1,234");
  });

  it("renders booleans as check and cross, not 'true'/'false'", () => {
    expect(renderValue(field("bool"), true, ctx)).toBe("✓");
    expect(renderValue(field("bool"), false, ctx)).toBe("✗");
  });

  it("formats a date in the VIEWER's timezone", () => {
    // A session logged at 07:00 in Kolkata must not read as 01:30 because the
    // server runs in UTC. The stored value is an ISO string (JSONB has no
    // date type), and the offset in it is what makes this unambiguous.
    const rendered = String(renderValue(field("date"), "2026-09-14T07:00:00+05:30", ctx));
    expect(rendered).toMatch(/7:00\s?AM/i);
  });

  it("renders an enum's LABEL, not its stored value", () => {
    // enum_options holds {value,label} pairs precisely so the payload can
    // store "strength" while the table shows "Strength training".
    const f = field("enum", {
      enum_options: [
        { value: "strength", label: "Strength training" },
        { value: "cardio", label: "Cardio" },
      ],
    });
    expect(renderValue(f, "strength", ctx)).toBe("Strength training");
  });

  it("falls back to the raw value for an enum option that no longer exists", () => {
    // Showing the raw value is honest; showing nothing hides that the record
    // holds something the type no longer defines.
    const f = field("enum", { enum_options: [{ value: "cardio", label: "Cardio" }] });
    expect(renderValue(f, "strength", ctx)).toBe("strength");
  });

  it("resolves a person_ref to a display name", () => {
    expect(renderValue(field("person_ref"), people[0]!.id, ctx)).toBe("Arun");
  });

  it("shows the raw id when a person_ref cannot be resolved", () => {
    // The tool layer validates person_ref against `people`, so an
    // unresolvable one here means the person was invalidated AFTER the record
    // was written. That should be visible, not silently blank.
    const orphan = "bbbbbbbb-0000-4000-8000-000000000002";
    expect(renderValue(field("person_ref"), orphan, ctx)).toBe(orphan);
  });
});

describe("absent values", () => {
  it("renders an em-dash for a missing key, never 'undefined'", () => {
    // A MISSING KEY IS NORMAL (§1.3): add_entity_field can add an optional
    // field to a populated type, and older records legitimately lack it —
    // which is exactly what schema_version records. It must not look like a
    // rendering bug.
    for (const kind of ["text", "number", "bool", "date", "enum", "person_ref"] as const) {
      expect(renderValue(field(kind), undefined, ctx)).toBe("—");
      expect(renderValue(field(kind), null, ctx)).toBe("—");
    }
  });

  it("never renders the strings 'undefined' or 'null'", () => {
    const rendered = (["text", "number", "date"] as const).map((kind) =>
      String(renderValue(field(kind), undefined, ctx)),
    );
    expect(rendered.join(" ")).not.toMatch(/undefined|null/);
  });
});

describe("alignment", () => {
  it("right-aligns only numbers", () => {
    expect(isNumericKind("number")).toBe(true);
    for (const kind of ["text", "bool", "date", "enum", "person_ref"] as const) {
      expect(isNumericKind(kind)).toBe(false);
    }
  });
});

describe("FieldKind must match the Postgres enum", () => {
  it("declares exactly the kinds migration 006 defines", () => {
    // ⚠ THE DRIFT CHECK. `apps/web` cannot import from `@ourglass/db` — that
    // would pull a Postgres driver into a browser bundle — so FieldKind is
    // declared in two places. Two declarations of one fact drift silently,
    // and the failure mode is the worst kind: a type the user invented
    // renders as "[object Object]" because the UI never learned its kind.
    //
    // So the SCHEMA is the source of truth and this reads it directly.
    const migration = readFileSync(
      fileURLToPath(
        new URL("../../../packages/db/migrations/006_entity_registry.sql", import.meta.url),
      ),
      "utf8",
    );

    const match = migration.match(/CREATE TYPE field_kind AS ENUM \(([^)]+)\)/);
    expect(match, "migration 006 no longer declares field_kind as expected").not.toBeNull();

    const fromSchema = [...match![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();

    // ⚠ THE `satisfies` IS THE POINT — an earlier version of this test used a
    // plain `FieldKind[]` literal, and a mutation proved it hollow: adding a
    // seventh kind to FieldKind left this GREEN, because a literal listing six
    // values is a perfectly valid array of a seven-value union. It checked the
    // list against the schema, never the TYPE against the schema.
    //
    // `satisfies Record<FieldKind, true>` inverts that: the object must have a
    // key for EVERY member of the union, so a seventh kind fails to compile
    // here as well as in the renderer. Now the runtime assertion (list vs
    // schema) and the compile-time one (list vs type) together pin all three
    // declarations — Postgres enum, TypeScript union, and this list.
    const declared = {
      text: true,
      number: true,
      bool: true,
      date: true,
      enum: true,
      person_ref: true,
    } satisfies Record<FieldKind, true>;

    expect(Object.keys(declared).sort()).toEqual(fromSchema);
  });
});
