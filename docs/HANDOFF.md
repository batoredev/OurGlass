# Handoff — continuing in a fresh (cloud) Claude Code session

Written 2026-10-18 at the end of the local session that built Phases 6 and 8 and alerting. A new
session has **none of that conversation**. Everything it needs is in this file and the docs it
links. Read in this order: `CLAUDE.md` → this file → `docs/REMAINING-EXECUTION-PLAN.md` →
`docs/PHASE-6-DESIGN.md` → `docs/YOUR-ACTIONS.md` (the owner's checklist).

## Where things stand

- `main` is green in CI (typecheck, lint, unit, integration against Postgres, CodeQL).
- Built and verified: everything through Phase 5, the §35 permission model, multi-provider AI
  (Claude / Gemini / local Qwen), alerting to a chat webhook, voice dictation (Phase 8), and
  **file uploads (Phase 6)** — see `PHASE-6-DESIGN.md` §9a for what was verified and how.
- **Hosting changed on 2026-10-19:** the API and reminders now run as Supabase Edge Functions
  (`apps/edge`, Deno) and the site is a static export on Cloudflare Pages; the Cloudflare Worker
  is gone. Read `DEPLOYMENT-DESIGN.md` before touching deployment.
- **Phase 7, partly built** (arjunamar, 2026-10-19/20): Google Calendar sync, and email drafted in
  chat and sent from Gmail after a per-message confirmation. Drive is not started. Not
  re-verified live in the session that wrote this.
- On 2026-10-21 a force-push to `main` dropped eight commits; they were merged back, not pushed
  over. Until branch protection exists (`YOUR-ACTIONS.md` item 3), never force-push `main`.

## The work left, in order

### 1. Fix the Phase 6 security review findings (start here)

An independent read-only review (`security-cso`) of commit `7d294fd` returned **"trust boundary
holds with caveats"** — no path from file content to any write beyond the document row and its
links; no Critical or High. These are its findings, none fixed yet:

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

Also noted, not a bug: undo never deletes stored bytes and there is no delete path.

### 1a. ~~The Worker build fails on Linux~~ — obsolete
The Worker it described was replaced by Supabase Edge Functions + Cloudflare Pages on 2026-10-19.
On 2026-10-21 the replacement was checked locally: the `api` and `reminders` bundles ran under
Deno 2.1.4 against a migrated database (auth, every read route, CORS, a due reminder fired
once), and the static site built and served. Nothing has been checked on a deployed project.

### 2. Finish the knowledge-graph refresh
Standing rule: `/graphify --update` after every feature. The last run stopped after detection
(84 changed files: 75 code, 9 docs). `.graphifyignore` keeps `apps/api/test-fixtures/` out — one
fixture is a deliberate prompt-injection document. Commit `graphify-out/` (except what
`.gitignore` excludes).

### 3. Nonce-based CSP (P2 hardening)
`apps/web/lib/security-headers.ts` still allows `'unsafe-inline'` scripts.

### 4. Stage 16 — full recheck
The model-quality half has never run. Live evals on Qwen take hours; on Claude/Gemini they cost
money (ask first, see below).

### 5. Phase 7 — Gmail, then Calendar, then Drive (`REMAINING-EXECUTION-PLAN.md` Stage 14)
Blocked on the owner's Google Cloud project (`YOUR-ACTIONS.md` item 17). Owner decision: email is
**send, after confirming each one** — every send goes through the existing `pending_actions`
hold-and-confirm path, never a standing grant. Permission model: `docs/PHASE-7-PERMISSIONS-DESIGN.md`.
One mission per surface.

### 6. Polish owner checklist items 1–14
The owner deferred this until the app was finished ("up to 14 it is working somewhat, we have to
improve, let's do that after finishing the entire app").

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
- The owner pre-approved routine commands, commits and pushes to `main` of `batoredev/OurGlass`.
  That does not waive the rules above, and no destructive reset of their Supabase data without
  saying so first.
- Verify before claiming done; report what was NOT verified as plainly as what was.

## Running things in a fresh environment

- `pnpm install`, then `pnpm typecheck && pnpm lint && pnpm test` — no database or keys needed.
- **Integration tests need Postgres + pgvector.** CI provides it. Without Docker, use PGlite
  (WASM Postgres, includes pgvector) over its socket server:
  `npm i @electric-sql/pglite@0.5.8 @electric-sql/pglite-socket@0.2.11` in a scratch directory,
  then start `new PGLiteSocketServer({ db: await PGlite.create({ extensions: { vector } }), port,
  host: "127.0.0.1", maxConnections: 20 })` — **`maxConnections` defaults to 1**, which resets the
  app's pool. Migrate with `node packages/db/scripts/migrate.mjs` and `DATABASE_URL` set
  explicitly (not `pnpm db:migrate`, which loads `.env`). Result last time: 105/107 — the two
  double-undo tests in `create-commitment.integration.test.ts` hit a PGlite constraint
  divergence; real Postgres (CI) passes them.
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
