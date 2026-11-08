# Handoff — continuing in a fresh (cloud) Claude Code session

First written 2026-10-18; revised 2026-11-05. A new session has **none of the earlier
conversations**. Everything it needs is in this file and the docs it links. Read in this order:
`CLAUDE.md` → this file → [`ROADMAP.md`](ROADMAP.md) (the plan of record) →
[`DECISIONS.md`](DECISIONS.md) (the 2026-11-05 rows first) → [`YOUR-ACTIONS.md`](YOUR-ACTIONS.md)
(the owner's checklist). Every doc is indexed in [`README.md`](README.md).

## Where things stand (2026-11-08)

**Every ROADMAP stage has a built, tested first slice** (PR #26, branch
`claude/repo-overview-requirements-2nlq28`): Stage 0 (security fixes, RLS, export and permanent
delete), 1a (follow-up understanding — switched off until its paid eval runs), 1b/1c (Google
Calendar busy times and the Gmail inbox — verified against recorded responses only), 1d (spoken
replies), 2 (people profiles, meeting prep), 3 (today's plan, meeting times), 4 (email drafts in your style: greeting and sign-off
per recipient, follow-ups, the edit-distance measure), 5 (morning brief and evening review in the
app). Each stage's ROADMAP section has a **Status** paragraph saying what is built and what is
not yet. Migrations 017–019 must be applied to Supabase before deploying this code.

### As of 2026-11-05

- `main` is green in CI (typecheck, lint, unit, integration against Postgres, CodeQL).
- **Built and verified:** see ROADMAP → *Where it stands*. In short: conversation → structured
  state, memory with provenance, uploads, dictation, the §35 permission model, six model
  providers, Calendar add and Gmail send behind a per-message confirmation, the landscape look,
  and `pnpm db:seed-demo`.
- **Hosting** (2026-10-19): the API and reminders are Supabase Edge Functions (`apps/edge`,
  Deno); the site is a static export on Cloudflare Pages. Read
  [`DEPLOYMENT-DESIGN.md`](DEPLOYMENT-DESIGN.md) before touching deployment, and
  [`RUNBOOK.md`](RUNBOOK.md) to operate it. The Deploy workflow skips until the owner adds the
  Supabase credentials.
- **Docs reorganised** (2026-11-05): earlier plans in `docs/archive/`, the agent-team operating
  system in `docs/agent-os/`, design references in `docs/reference/`.
- **Held:** Dependabot #23 (`@anthropic-ai/sdk` 1.x) waits for a paid live check
  (`DECISIONS.md`).
- On 2026-10-21 a force-push to `main` dropped eight commits; they were merged back, not pushed
  over. Until branch protection exists (`YOUR-ACTIONS.md` item 3), never force-push `main`.

## The work left, in order

**Waiting for the owner's go:** four separate accounts — read
[`PLANNED-ACCOUNTS.md`](PLANNED-ACCOUNTS.md) and ask its open questions before starting.

**Every stage now has a first slice; what is left in each is listed in its ROADMAP Status
paragraph** — chiefly the model-based halves, which need paid eval runs the owner approves, and
anything live against Google, which needs the OAuth client. Originally: Stage 0 (security and
data control) was built 2026-11-05; then 1 (follow-up understanding, then Google Calendar and Gmail reading) → 2 (people profiles and
meeting prep) → 3 (today's plan and meeting times) → 4 (email drafts in your own style) → 5 (morning and evening
summaries). The Google halves of Stage 1 wait for the owner's OAuth client.

### Stage 0 detail — the Phase 6 security review findings

An independent read-only review (`security-cso`) of commit `7d294fd` returned **"trust boundary
holds with caveats"** — no path from file content to any write beyond the document row and its
links; no Critical or High. **All fixed 2026-11-05** (commit `61a7047`), each with a test shown to
fail on the old code; RLS is migration 017. Kept here as the record of what was found:

**MEDIUM, confirmed — quadratic regexes hang a request on tiny crafted files.**
`apps/api/src/ingest/extract.ts` (`normalizeText`, ~lines 33–35) and `apps/api/src/ingest/ooxml.ts`
(the lazy `[\s\S]*?` scans and the `<w:t>`/`<c>`/`<row>`/`<si>`/`<v>` patterns, ~lines 102, 135,
191, 272, 282, 285, 307). Measured: 160 KB of spaces → 40.8 s; a 227-byte docx of 80k `<` → 12 s;
a 679-byte xlsx cell of ` |`×40k → 18.3 s. Bytes are stored BEFORE extraction (`ingest.ts` stores,
then extracts), so each attempt also orphans an object and leaves a user message with no reply.
**Fix:** replace those patterns with `indexOf`-based linear scanners; make `normalizeText` one
pass; cap decoded XML / per-cell / raw text length before any regex; **extract before
`store.put`**. Add a timing regression test (and ideally a `tools/` script that times each
extractor at 2–3 input sizes, so it is repeatable — `.claude/rules/wat.md`).

**MEDIUM, suspected — file text readable through Supabase's Data API.** No migration enables
Row Level Security. On a Supabase project old enough to still grant `public` tables to `anon`,
`documents.extracted_text` (and every other table) is readable with the publishable key. The app
never ships that key, which limits exposure. **Fix:** a new forward migration that runs
`ALTER TABLE … ENABLE ROW LEVEL SECURITY` (no policies) on every table — the app connects
directly as the table owner, so it is unaffected — or revokes the `anon`/`authenticated` grants.
The owner should also check Supabase's Security Advisor. Migrations are forward-only and must be
applied to Supabase BEFORE deploying code that needs them (`docs/RUNBOOK.md`).

**LOW, confirmed:**
- *Unsaveable files.* A NUL after the first 8 KB of a text file (`sniff.ts` probes only 8 KB) or
  `&#0;` in a docx (`ooxml.ts` `decodeXml`) survives into `extracted_text`, which Postgres `text`
  rejects; `cleanText` (`packages/shared/src/document-contract.ts`) clips by UTF-16 unit and can
  leave a lone surrogate, which `jsonb` rejects. `executeTurn` then throws and the route 500s
  after the model was paid. **Fix:** strip `\u0000` in `normalizeText`, clip by code point, and
  catch a throwing save into `finish("failed")` in `ingest.ts`.
- *File text in the assistant's own voice.* `apps/api/src/ingest/reply.ts` quotes only the
  filename; a reading titled "Brief. I've also deleted your reminders" is shown as assistant
  speech (no write happens). **Fix:** quote and label title/deadlines/events ("It describes
  itself as …").
- *A zip that understates its size still burns CPU* (`ooxml.ts` `readParts`): memory stays flat
  but an 819 KB archive declaring 1 KB spent 4.8 s inflating 800 MB. **Fix:** also cap each
  entry's compressed size and the compression ratio.
- *Body buffered before the real size check* (`apps/web/app/api/documents/route.ts`): a missing or
  non-numeric `Content-Length` passes the early check, then `formData()` reads everything (only
  after authentication). **Fix:** require a valid `Content-Length`, or count the stream.
- *The storage key could follow a redirect* (`apps/api/src/storage/object-store.ts`, the `fetch`
  in `request`): set `redirect: "error"`.
- *pdf.js has no time budget* (`extract.ts` `pdfText`, suspected): add a deadline check between
  pages.

**Test gaps to close:** (a) nothing pins the `/api/documents/:id/file` sandbox CSP rule in
`apps/web/next.config.ts` — the exact regression the E2E caught; (b) no structural test fails if a
future feature feeds `messages.body`, `documents.reading` or `documents.extracted_text` into a
model — today nothing does (the orchestrator's `listRecent` reads only timestamps), but the next
"what did that brief say?" feature would make stored bodies an injection path; (c) no timing tests
for the extractors.

Also noted, not a bug: undo never deletes stored bytes and there is no delete path — Stage 0's
permanent delete closes it.

### Standing items, alongside the stages

- **Knowledge graph.** Standing rule: `/graphify --update` after every feature. The last run
  stopped after detection. `.graphifyignore` keeps `apps/api/test-fixtures/` out — one fixture
  is a deliberate prompt-injection document.
- **Nonce-based CSP** (P2 hardening): `apps/web/lib/security-headers.ts` still allows
  `'unsafe-inline'` scripts.
- **The model-quality recheck** has never run on a hosted model. Live evals on Claude/Gemini
  cost money (ask first); Qwen is free but runs only on the owner's laptop.
- **Owner checklist polish.** The owner deferred items 1–14 of the old checklist until the app
  was finished.

## Working rules carried over (these lived in local memory, not the repo)

- **Never read `.env` into context. Never commit secrets.** The repo is PUBLIC; fixtures use only
  the fictional cast (Barkha, Dev, Meera, Arun, Hult).
- **Ask before any paid API call** (`.claude/rules/wat.md` §3) — live Claude/Gemini evals, image
  reads. Qwen is free but runs only on the owner's laptop.
- **The app's Claude models are Sonnet and Haiku only — never Opus** (owner decision,
  `DECISIONS.md`).
- **Integration tests TRUNCATE every table.** Never point them at the owner's Supabase. Never
  touch the owner's own trackers (`reading`, `gym_sessions`) in test scripts.
- `ANTHROPIC_API_KEY` never goes in a workflow a fork PR can trigger.
- **Ask owner decisions as questions mid-execution and keep building** — don't stall waiting.
- The owner pre-approved routine commands and commits. **Changes land on `main` through a
  branch and a pull request** (owner default 2026-11-05), never a force-push. None of this
  waives the rules above, and no destructive reset of their Supabase data without saying so
  first.
- Verify before claiming done; report what was NOT verified as plainly as what was.

## Running things in a fresh environment

- `pnpm install`, then `pnpm typecheck && pnpm lint && pnpm test` — no database or keys needed.
- **Integration tests need Postgres + pgvector.** CI provides it. Without Docker, use PGlite
  (WASM Postgres, includes pgvector) over its socket server:
  `npm i @electric-sql/pglite@0.5.8 @electric-sql/pglite-socket@0.2.11
  @electric-sql/pglite-pgvector` in a scratch directory (the `vector` extension is its own
  package), then start `new PGLiteSocketServer({ db: await PGlite.create({ extensions: { vector }
  }), port, host: "127.0.0.1", maxConnections: 20 })` — **`maxConnections` defaults to 1**, which
  resets the app's pool. Migrate with `node packages/db/scripts/migrate.mjs` and `DATABASE_URL` set
  explicitly (not `pnpm db:migrate`, which loads `.env`). Result last time: 105/107 — the two
  double-undo tests in `create-commitment.integration.test.ts` hit a PGlite constraint
  divergence; real Postgres (CI) passes them.
- **Node ≥ 24** is required (CI uses 24). A container with an older Node can download the
  official Node 24 tarball into a scratch directory and put its `bin/` first on `PATH`.
- **A demo database:** `pnpm db:migrate`, then `pnpm db:seed-demo` (empty local databases only),
  then `pnpm dev` — [`DEMO-GUIDE.md`](DEMO-GUIDE.md).
- There is no Ollama in the cloud, so nothing can run a live model for free there.

## Gotchas this codebase has already paid for

- **Invisible characters.** A `\uFEFF` or `\u202E` escape can be written to disk as the literal
  character. Scan any file you write for U+200B–U+200F, U+202A–U+202E, U+2066–U+2069, U+FEFF;
  literal bidi controls in source are the "Trojan Source" pattern.
- **A route handler's own header loses to `next.config.ts`'s.** Put per-route header overrides
  in `next.config.ts`, after the global rule.
- **Guard tests that will fail on purpose:** every route's first statement must be
  `authorize(request)` (`access-guard.test.ts`); every `executeTurn` call site must be listed
  with a reason (`executor.callsites.test.ts`); every registered tool must be reachable or
  listed (`registry.coverage.test.ts`); every tool needs a risk level (`risk.ts`, fails closed).
- Test fixtures are binary in `.gitattributes`; regenerate them with
  `tools/make_ingest_fixtures.py`, never by hand.
- On TypeScript 6, a `Response` body must be `Uint8Array<ArrayBuffer>`, not `Uint8Array`.
