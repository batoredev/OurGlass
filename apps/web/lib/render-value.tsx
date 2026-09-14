/**
 * The generic field renderer (docs/PHASE-5-DESIGN.md §3.1).
 *
 * ┌─ THIS FILE IS THE USER'S EXPLICIT REQUIREMENT, IN CODE ────────────────┐
 * │ "make sure that when new tables are created by the llm, the link to it │
 * │  and display of it in the frontend must be also managed accordingly"   │
 * │                                                                        │
 * │ There is NO hardcoded list of entity types anywhere in this app. A     │
 * │ type the assistant invented thirty seconds ago renders here from its   │
 * │ `field_kind`s alone — no deploy, no migration, no code change.         │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * That works ONLY because `field_kind` is a closed six-value enum. The LLM
 * invents TYPES freely and never KINDS (DECISIONS.md), so every field that
 * can ever arrive has a branch below. An open kind space would let a type
 * arrive the UI cannot display — exactly the failure the requirement rules
 * out — which is why the exhaustiveness check at the bottom is load-bearing
 * rather than defensive: a seventh kind added to the Postgres enum FAILS THE
 * BUILD instead of rendering "[object Object]" to a user.
 */
import type { ReactNode } from "react";
import type { EntityTypeField, FieldKind, Person } from "./api";

export interface RenderContext {
  /** For `person_ref`: id -> person. A missing id renders as the raw id. */
  readonly peopleById: ReadonlyMap<string, Person>;
  /** The viewer's timezone, for `date`. */
  readonly timeZone: string;
}

/**
 * The em-dash for an absent value.
 *
 * A MISSING KEY IS NORMAL, not an error (§1.3). `add_entity_field` can add an
 * optional field to a populated type, and records written before that
 * legitimately lack the key — which is what `schema_version` records. So this
 * renders as a quiet placeholder, never "undefined", never a blank cell that
 * looks like a rendering bug.
 */
const ABSENT = "—";

export function renderValue(field: EntityTypeField, value: unknown, ctx: RenderContext): ReactNode {
  if (value === null || value === undefined) return ABSENT;

  switch (field.field_kind) {
    case "text":
      return typeof value === "string" ? value : String(value);

    case "number":
      // Rendered as-is. The tool layer already rejected NaN and Infinity, so
      // anything arriving here is a finite number.
      return typeof value === "number" ? value.toLocaleString() : String(value);

    case "bool":
      return value === true ? "✓" : "✗";

    case "date": {
      // Stored as an ISO string (JSONB has no date type — §1.2). Formatted in
      // the VIEWER's timezone rather than the server's: a gym session logged
      // at 07:00 local must not read as 01:30 because the server runs in UTC.
      const parsed = new Date(String(value));
      if (Number.isNaN(parsed.getTime())) return String(value);
      return new Intl.DateTimeFormat("en-US", {
        timeZone: ctx.timeZone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(parsed);
    }

    case "enum": {
      // The option's LABEL, not its stored value. `enum_options` holds
      // {value,label} pairs precisely so the UI can show "Strength training"
      // where the payload stores "strength".
      const option = field.enum_options?.find((candidate) => candidate.value === value);
      return option ? option.label : String(value);
    }

    case "person_ref": {
      // Resolved to a display name. Falls back to the raw id rather than
      // rendering nothing: an unresolvable reference should be VISIBLE, since
      // the tool layer validates against `people` and one appearing here means
      // the person was invalidated after the record was written.
      const person = ctx.peopleById.get(String(value));
      return person ? person.display_name : String(value);
    }

    default: {
      // ⚠ THE EXHAUSTIVENESS CHECK, and it is the whole safety argument for
      // schema-driven rendering. Add a seventh value to the `field_kind`
      // Postgres enum without a branch above and THIS FAILS TO COMPILE —
      // rather than shipping a page that renders an unknown kind as
      // "[object Object]" to a user who invented a perfectly reasonable type.
      //
      // Verified by mutation: adding a seventh kind to FieldKind must break
      // the build. If it does not, this check has been defeated and the
      // requirement is no longer enforced.
      const exhaustive: never = field.field_kind;
      throw new Error(`unhandled field_kind: ${String(exhaustive)}`);
    }
  }
}

/**
 * Is this kind right-aligned in a table?
 *
 * Numbers only. Right-aligning numerals makes magnitudes comparable down a
 * column; doing it to text makes a table harder to scan.
 */
export function isNumericKind(kind: FieldKind): boolean {
  return kind === "number";
}
