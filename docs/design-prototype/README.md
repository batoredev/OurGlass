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
| `styles.css` | `apps/web/app/prototype.css` — the live copy | — |
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
| Person, project and memory **detail** pages | No endpoint serves one person's history yet; inventing one would mean inventing the data on it |
| **Conflict** screen | Real conflicts surface as a question inside the conversation (§24) — the assistant asks rather than opening a chooser |
| **Reminder confirmation** screen | The reminder is confirmed in the reply, from the tool's own result |
| Google Calendar / Email / Drive **toggles** | Those integrations do not exist until master plan stage 14. Settings shows the permission rules that are actually enforced instead |
| Dark mode toggle | The stylesheet has no dark palette yet |
| Attach and voice buttons | Ingestion is stage 13; voice is stage 15 |

When one of those lands, the prototype here is the reference for how it should look.
