# The design prototype

`index.html`, `app.js` and `styles.css` as supplied — the visual reference for the app's
interface. They are kept here as supplied, with ONE addition: a `/* global ... */` line at the top of
`app.js`, so the repository linter knows it is browser code and does not fail the build on it.
The only other change is one unused variable dropped from a destructuring in `peoplePage`,
which the linter flagged. No markup, styling or behaviour was altered.

**They are not what runs.** Opening `index.html` shows the design with invented data: the
prototype has no network calls at all, and its people (Arun, Barkha, Karthik) and commitments are
hardcoded. What runs is `apps/web`, where the same markup and classes were ported to React and
wired to the real API.

| Prototype | Where it lives now | Data |
|---|---|---|
| `styles.css` | `apps/web/app/prototype.css` — the live copy, restyled by `theme.css` (below) | — |
| Chat | `app/page.tsx` + `app/conversation.tsx` | `/api/messages`, `/api/turn`, `/api/undo` |
| Today | `app/today/page.tsx` | `/api/today` |
| Commitments | `app/commitments/page.tsx` | `/api/commitments`, `/api/people` |
| People | `app/people/page.tsx` | `/api/people`, `/api/commitments` |
| Projects | `app/projects/page.tsx` | `/api/projects` |
| Memories | `app/memory/page.tsx` | `/api/memories` |
| Settings | `app/settings/page.tsx` | `/api/permissions` |

## Not ported, and why

| Prototype screen | Why |
|---|---|
| Person, project and memory **detail** pages | No endpoint serves one person's history yet; inventing one would mean inventing the data on it. The person page arrives with Stage 2's person model (`../ROADMAP.md`) |
| **Conflict** screen | Real conflicts surface as a question inside the conversation (§24) — the assistant asks rather than opening a chooser |
| **Reminder confirmation** screen | The reminder is confirmed in the reply, from the tool's own result |
| Google Calendar / Email / Drive **toggles** | Calendar add and Gmail send are built behind a Google connection in Settings, next to the permission rules actually enforced; reading both is Stage 1, Drive later |
| Dark mode toggle | The stylesheet has no dark palette yet |

The attach (📎) and voice buttons, once listed here, are built: uploads in Phase 6, dictation in
Phase 8.

When one of those lands, the prototype here is the reference for how it should look.

## The landscape theme (2026-11-05)

The prototype display uses the owner's suggested look: an ultramarine halftone sky, serif
headlines (Fraunces), cream pill buttons and an illustrated landscape.

- `apps/web/app/theme.css`, imported in `layout.tsx` **after** `prototype.css`, redefines the
  tokens and restyles the sidebar, cards, buttons and headings. Deleting that one import restores
  the prototype's own look; nothing else depends on it.
- `apps/web/app/landscape.tsx` is the artwork: an original SVG (clouds, mountains, a lake, a hill
  with a house), `aria-hidden`, drawn for this app rather than copied from the reference image.
- It appears on the sign-in page and the chat's greeting panel. A navy overlay keeps every word
  over it at a contrast of at least 6.8:1; axe reports no violations on 14 pages at desktop and
  phone widths. Orange is used for accents only, never for text on cream (2.89:1).
