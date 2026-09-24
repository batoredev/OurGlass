/**
 * The prototype's icon set, as React.
 *
 * Copied verbatim from the design's `app.js` so the drawn shapes are the
 * designer's, not an approximation. Only the delivery changed: template
 * strings became components.
 */
import type { ReactElement } from "react";

// aria-hidden on every icon: each one sits beside a visible label or inside a
// button that carries an aria-label, so reading the drawing too would only add
// noise ("image, image, Chat") to a screen reader.
const S = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "aria-hidden": true,
  focusable: "false",
} as const;

export const ICONS: Record<string, ReactElement> = {
  chat: (
    <svg {...S}>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </svg>
  ),
  today: (
    <svg {...S}>
      <path d="M6 2v3M18 2v3M3.5 9h17M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    </svg>
  ),
  commitments: (
    <svg {...S}>
      <path d="m8 12 2.5 2.5L16 9M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    </svg>
  ),
  people: (
    <svg {...S}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  projects: (
    <svg {...S}>
      <path d="M3 7.5h7l2-3h9v15H3z" />
    </svg>
  ),
  memories: (
    <svg {...S}>
      <path d="M12 21a9 9 0 1 0-9-9v7l3-2M8 11h8M8 7h5M8 15h6" />
    </svg>
  ),
  settings: (
    <svg {...S}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3h4v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 9c.12.6.66 1.02 1.27 1.02H21v4h-.09A1.65 1.65 0 0 0 19.4 15z" />
    </svg>
  ),
  plus: (
    <svg {...S}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  mic: (
    <svg {...S}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  ),
  send: (
    <svg {...S}>
      <path d="m5 12 14-7-5 14-2-6zM12 13l7-8" />
    </svg>
  ),
  conflict: (
    <svg {...S}>
      <path d="M12 8v5M12 17h.01M10.3 3.6 2.6 18a2 2 0 0 0 1.8 3h15.2a2 2 0 0 0 1.8-3L13.7 3.6a2 2 0 0 0-3.4 0z" />
    </svg>
  ),
  search: (
    <svg {...S}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  ),
  arrowLeft: (
    <svg {...S}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  ),
  arrowRight: (
    <svg {...S}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
  check: (
    <svg {...S}>
      <path d="m5 12 4 4L19 6" />
    </svg>
  ),
  more: (
    <svg {...S}>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
};

export function Icon({ name }: { name: string }) {
  return ICONS[name] ?? null;
}

/** The design's initials avatar. "Me" for the account holder, as in the prototype. */
export function Avatar({ name }: { name: string }) {
  return <span className={`avatar ${name.toLowerCase()}`}>{name.slice(0, 2).toUpperCase()}</span>;
}

export function StatusPill({ label, tone = "pending" }: { label: string; tone?: string }) {
  return <span className={`status ${tone}`}>{label}</span>;
}
