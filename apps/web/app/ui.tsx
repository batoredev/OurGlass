/**
 * The shared bits of the §29 inspection surfaces.
 *
 * DELIBERATELY UNSTYLED, and that is a plan decision rather than neglect:
 * `docs/EXECUTION-PLAN.md` puts UI last, and these pages exist to make state
 * INSPECTABLE, not attractive. A design pass belongs in a later phase, and
 * spending it now would be effort invested before anyone has looked at real
 * data through these tables.
 *
 * What they do owe the reader is honesty, which is most of the code here:
 * distinguishing "empty" from "broken", and never rendering a value the
 * system does not actually hold.
 */
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The navigation. Read from ONE list so a new surface cannot be added to the
 * app and forgotten in the nav.
 */
export const SURFACES = [
  { href: "/", label: "Conversation" },
  { href: "/today", label: "Today" },
  { href: "/commitments", label: "Commitments" },
  { href: "/people", label: "People" },
  { href: "/projects", label: "Projects" },
  { href: "/memory", label: "Memory" },
  { href: "/activity", label: "Activity" },
  { href: "/types", label: "Types" },
  { href: "/permissions", label: "Permissions" },
] as const;

export function Nav() {
  return (
    <nav style={{ marginBottom: "1.5rem", fontSize: "0.9rem" }}>
      {SURFACES.map((surface, index) => (
        <span key={surface.href}>
          {index > 0 && " · "}
          <Link href={surface.href}>{surface.label}</Link>
        </span>
      ))}
    </nav>
  );
}

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "1.5rem", maxWidth: "60rem" }}>
      <Nav />
      <h1 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>{title}</h1>
      {children}
    </main>
  );
}

/**
 * An error, shown rather than swallowed.
 *
 * .claude/rules/ai-systems.md's "degrade honestly" applied to a read surface.
 * The overwhelmingly likely failure in development is a 404 because the API
 * is not signed in or the API is closed — and rendering an empty
 * table there would tell the user their data is gone, which is both alarming
 * and false.
 */
export function LoadError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <p style={{ color: "#b00", whiteSpace: "pre-wrap" }}>
      <strong>Could not load.</strong> {message}
    </p>
  );
}

/**
 * The empty state, which is a real answer and not a failure.
 *
 * "Nothing outstanding" is genuinely useful information for "what am I
 * waiting on". Silence, or a bare table with headers and no rows, reads as a
 * malfunction.
 */
export function Empty({ what }: { what: string }) {
  return <p style={{ color: "#666" }}>No {what} yet.</p>;
}

export interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  readonly numeric?: boolean;
}

/**
 * A read-only table.
 *
 * There is no sort, no filter, and no pagination. Each is a real feature with
 * real state, and adding them before anyone has used these surfaces would be
 * building for an imagined problem — the speculative work CLAUDE.md §1 rules
 * out. The API already bounds every list.
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  empty,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  empty: string;
}) {
  if (rows.length === 0) return <Empty what={empty} />;

  return (
    <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              style={{
                textAlign: column.numeric ? "right" : "left",
                borderBottom: "1px solid #ccc",
                padding: "0.35rem 0.6rem",
                fontWeight: 600,
              }}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((column) => (
              <td
                key={column.key}
                style={{
                  textAlign: column.numeric ? "right" : "left",
                  borderBottom: "1px solid #eee",
                  padding: "0.35rem 0.6rem",
                }}
              >
                {column.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** An ISO instant as a short local string. Invalid input renders verbatim. */
export function formatWhen(iso: string | null, timeZone = "Asia/Kolkata"): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}
