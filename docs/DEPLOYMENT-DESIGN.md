# Deployment — GitHub + Supabase + Cloudflare Pages

**Importers: none.** Read before touching `apps/edge`, `supabase/`,
`apps/api/src/reminders/poller.ts`, or anything in `apps/web`.

## Current hosting (decided 2026-10-19)

| Piece | Where | Built from |
|---|---|---|
| Database | Supabase Postgres + pgvector | `packages/db/migrations` via `pnpm db:migrate` (unchanged) |
| API (every `/api/*` route) | Supabase Edge Function **`api`** | `apps/edge` → `pnpm run build:edge` → `supabase/functions/api/ourglass.js` |
| Reminders + conditional rules | Supabase Edge Function **`reminders`**, called each minute by `pg_cron` + `pg_net` | `apps/edge/src/reminders.ts`; schedule in `supabase/cron/schedule-reminders.sql` |
| Frontend | **Cloudflare Pages**, static files | `apps/web` → `next build` (`output: "export"`) → `apps/web/out` |

**Why it changed.** The first Workers deploy uploaded but answered 500 on every request:
`Dynamic require of "/.next/server/middleware-manifest.json" is not supported`. The bundle had
been built on Windows and carried backslash paths (`.next\\server\\…`), and the OpenNext adapter
documents Windows support as limited. The owner chose to drop server-side Next.js hosting rather
than move the build to Linux. Recorded in `docs/DECISIONS.md`.

**What did not change.** The route files moved from `apps/web/app/api` to `apps/edge/app/api`
byte-for-byte apart from comments and the cross-site check. `src/router.ts` dispatches to them;
`next/server` resolves to `src/next-server-shim.ts` (a `Response` subclass). The orchestrator,
tools, repositories and `pollOnce` are untouched — the same portability §0 below credits to
PHASE-1-DESIGN §5.

**What did change, and the trade-offs taken:**

- **Pages load in the browser.** Each server-rendered page's body became an async `render()`
  run by `app/async-page.tsx`; `refreshData()` replaces `router.refresh()`.
  `/types/[key]` became `/types/view?key=…`: a static site cannot have runtime path segments.
- **Sign-in is a bearer token held by the browser** (`apps/web/lib/session.ts`). The API is on
  another origin, where a session cookie would be a third-party cookie. The site's CSP allows
  scripts from `'self'` only, and `connect-src` names the API origin and nothing else.
- **Uploads download, never open inline.** The API's sandbox CSP protected the inline view; a
  `blob:` URL would run an uploaded HTML/SVG file as the site itself.
- **CORS.** The API answers browsers only from its own origin and `ALLOWED_ORIGINS` (exact
  matches). `rejectCrossSite` uses the same list.
- **Edge Function JWT verification is off** (`supabase/config.toml`): the API checks
  `OURGLASS_ACCESS_TOKEN`, the reminders function checks `CRON_SECRET`.
- **The bundle is self-contained** (esbuild, every dependency inside). Its banner supplies what
  Node code expects under Deno: `require`, `process`, `Buffer`, `global`; bare built-ins are
  rewritten to `node:` imports. Verified by loading the bundle in Deno 2.1 against the real
  Supabase database before any deploy.

### Deploying

One-time, for each Supabase project:

```bash
supabase login
supabase link --project-ref <PROJECT-REF>
supabase secrets set OURGLASS_ACCESS_TOKEN=<32+ chars> ALLOWED_ORIGINS=https://<site>.pages.dev \
  CRON_SECRET=<32+ chars> STORAGE_URL=https://<PROJECT-REF>.supabase.co STORAGE_SECRET_KEY=<sb_secret_…>
# optional: ANTHROPIC_API_KEY, GEMINI_API_KEY, VOYAGE_API_KEY, ALERT_WEBHOOK_URL
```

**`STORAGE_*`, not `SUPABASE_*`:** `supabase secrets set` silently skips names starting with
`SUPABASE_` (reserved), so file storage reads `STORAGE_URL` / `STORAGE_SECRET_KEY` first and
falls back to the `SUPABASE_*` names used locally (`apps/api/src/storage/object-store.ts`).
Passing values with `--env-file` rather than on the command line keeps them out of shell
history.

**The `api` bundle is minified** (`scripts/build-edge.mjs`): unminified at 5.2 MB, Supabase's
deploy endpoint refused it with 413; minified it is 2.9 MB.

**Leave `DATABASE_URL` unset in the function secrets.** Every Edge Function is given
`SUPABASE_DB_URL`, and `_lib.ts` and `reminders.ts` fall back to it. Measured from a Windows
machine under Deno 2.1, the first connection through the direct `db.<ref>.supabase.co` string
took ~55 s (later ones ~36 ms), while Node connected at once — so the platform-provided URL is
the path to use, and the first deployed `/api/health` timing is worth checking.

Each deploy of the API:

```bash
pnpm run build:edge
supabase functions deploy api --use-api
supabase functions deploy reminders --use-api
```

Then run `supabase/cron/schedule-reminders.sql` once in the SQL Editor (it says what to fill in).

Cloudflare Pages — **direct upload** (what the first deploy used; no GitHub connection needed):

```bash
NEXT_PUBLIC_API_URL=https://<PROJECT-REF>.supabase.co/functions/v1 pnpm run build:site
# Run wrangler from OUTSIDE the repo: inside it, npx tries to install into the pnpm
# workspace and fails on `workspace:*`.
npx wrangler@4.136.1 pages project create ourglass --production-branch main --force   # once
npx wrangler@4.136.1 pages deploy <repo>/apps/web/out --project-name ourglass --branch main
```

`--force` is needed on `project create` only: current wrangler otherwise redirects Pages
commands to static assets on Workers, and that redirect failed to find the folder.

Or, connected to the GitHub repository (builds on every push):

| Setting | Value |
|---|---|
| Build command | `npx pnpm@10.15.1 install --frozen-lockfile && npx pnpm@10.15.1 run build:site` |
| Build output directory | `apps/web/out` |
| Environment variable | `NEXT_PUBLIC_API_URL=https://<PROJECT-REF>.supabase.co/functions/v1` |
| Environment variable | `NODE_VERSION=24` (the repo requires Node ≥ 24; confirm the Pages build image offers it — not verified here) |

`build:site` builds `@ourglass/shared` first: the site imports it from its built `dist/`.

Check: `https://<PROJECT-REF>.supabase.co/functions/v1/api/health` answers `"db":true`, then sign
in at `https://<site>.pages.dev/login`.

---

## History: the Cloudflare Workers design (2026-09, superseded above)

Kept because §0–§4 explain why the code ports at all. Workers-specific instructions below no
longer apply.

**Target, as chosen by the owner at the time:** code on **GitHub**, database on **Supabase**,
hosting on **Cloudflare Workers**.

This is not a configuration change. **Cloudflare Workers are V8 isolates, not Node**, and three
things this codebase does today cannot run there. All four findings below were verified against
Cloudflare's and Supabase's own documentation, not recalled.

---

## 0. What breaks, and what does not

| Component | Runs on Cloudflare? | Why |
|---|---|---|
| `packages/db` (repositories) | ✅ | Plain TypeScript over `pg`. `pg` is supported with `nodejs_compat`. |
| `apps/api/src/tools/**` | ✅ | Plain TypeScript. No framework import anywhere. |
| `apps/api/src/assistant/**` | ✅ | Same. Takes a `DatabaseTransaction`, returns data. |
| `apps/web` (Next.js) | ✅ | Via the Cloudflare Next.js adapter. |
| **`apps/api/src/server.ts` (Fastify)** | ❌ | **Architecture mismatch** — see §1. |
| **`startReminderPoller` (`setInterval`)** | ❌ | **No long-running processes** — see §3. |

> **The good news is not luck.** `PHASE-1-DESIGN.md` §5 put the tool layer and repositories
> behind framework-agnostic interfaces (`Queryable`, `DatabaseTransaction`) so the database
> package would not depend on a web framework. That decision, made for testability, is what
> makes ~90% of this codebase portable to a runtime nobody had considered at the time.
> **Only the two files that touch a framework or a clock need to change.**

---

## 1. Fastify cannot host the API on Workers

Cloudflare's own Node-compatibility documentation is explicit that Node HTTP frameworks face
*"practical challenges"* on Workers, for two reasons no polyfill fixes:

- **Workers are request/response and then terminate.** Fastify expects a persistent server
  instance that owns a socket.
- Individual Node APIs (`net`, `http`, `fs`) are supported, but *"full framework migration
  requires architectural adaptation for the serverless model."*

**Decision: move the routes into Next.js Route Handlers and retire the Fastify server.**

```
apps/web/app/api/turn/route.ts          POST  — the conversational entry point
apps/web/app/api/undo/route.ts          POST
apps/web/app/api/entity-types/route.ts  GET   — the eight §29 read surfaces
...
```

**Why Route Handlers rather than a second Worker:** there is already a Next.js app that must be
hosted, and Route Handlers are server-side only — they never ship to the browser. One Worker
serves the UI and the API: one deploy, one set of secrets, no CORS. A separate API Worker would
be a second deployment target for no capability gain.

> **Rejected: keep Fastify and host the API elsewhere** (Fly, Railway, a container). Legitimate,
> and it would need no code change at all. Rejected because it contradicts the stated target —
> hosting on Cloudflare — and splits the system across two providers for the sake of one file.
>
> **Rejected: Cloudflare Containers.** They can run Node and therefore Fastify. Still beta, and
> it keeps a whole framework to serve eleven routes Next.js serves natively.

### 1.1 What this does NOT change

`runTurn`, `executeTurn`, `undoTurn`, every tool, every repository, the orchestrator, the
resolver, and the poller's `pollOnce`. They take plain arguments and return plain data. The
Route Handler is a thin adapter — parse the body, call `runTurn`, return JSON — which is all
`server.ts` ever was.

### 1.2 The `apps/web` import rule needs nuancing, not reversing

`render-value.test.tsx` says *"apps/web cannot import from `@ourglass/db` — it would pull a
Postgres driver into a browser bundle."* **That stays true for client components and is now
false for Route Handlers**, which are server-only. The comment must say which it means, or the
next person either breaks the browser bundle or duplicates types they did not need to.

---

## 2. Supabase: use the DIRECT connection, never the transaction pooler

Verified from Supabase's connection documentation:

| Mode | Port | Prepared statements | Use for |
|---|---|---|---|
| **Direct** (`db.[REF].supabase.co`) | 5432 | ✅ | **Persistent backends. Migrations.** |
| Session pooler (pooler host) | 5432 | ✅ | IPv4-only fallback |
| Transaction pooler | 6543 | ❌ **No** | Serverless with many short connections |

The transaction pooler *"does not support prepared statements"* and does not persist session
state between transactions.

**This codebase runs `SET LOCAL hnsw.iterative_scan` inside a transaction** (Phase 4 §2.1).
`SET LOCAL` is transaction-scoped, so it survives transaction-mode pooling in principle — but
prepared statements do not, and Supabase names migrations as requiring direct access outright.
**Use direct; fall back to the session pooler only if IPv4 forces it.**

> ⚠️ **The tempting wrong choice is 6543**, because "serverless" describes Workers and that
> pooler is advertised for serverless. The prepared-statement loss rules it out, and it would
> fail *intermittently* rather than immediately — the worst failure shape.

**pgvector on Supabase:** HNSW is supported and iterative search is available. Enable the
extension before migrating: Database → Extensions → `vector`.

---

## 3. The reminder poller must become a Cron Trigger

`startReminderPoller` calls `setInterval` every 30 seconds. Cloudflare's docs: timers are
supported, but *"they don't persist across requests in the serverless context."* A Worker has no
process to hold an interval.

**Decision: a `scheduled()` handler on a Cron Trigger, calling the existing `pollOnce`.**

```ts
export default {
  async scheduled(controller, env, ctx) {
    await pollOnce({ ...deps, clock: systemClock });
  },
};
```

**`pollOnce` needs no change whatsoever**, and that is entirely because of Phase 3's injected
clock. `PHASE-3-DESIGN.md` §6.4 made the clock a parameter so tests would not have to sleep; the
same decision makes the function callable from a cron handler with no loop of its own.
`startReminderPoller` becomes unused in the Cloudflare deployment and stays for local `pnpm dev`.

- Cron expressions are **UTC**, minimum granularity one minute (`*/1 * * * *`).
- Changes take **up to 15 minutes to propagate** — worth knowing before concluding a trigger is
  broken.
- Testable locally: `wrangler dev` exposes `/cdn-cgi/local/scheduled`.

**One behaviour changes and should be stated:** 30-second polling becomes 1-minute at best.
Phase 3 §6.4 already recorded the interval as *"deliberately coarse… a tunable, not a constant
of nature"*, because reminders are set at human granularity. A minute is still invisible.

---

## 4. `pg` must be pinned to ≥ 8.16.3

Cloudflare's Postgres tutorial: *"Ensure you're using pg version 8.16.3 or higher."* Both
packages declare `"pg": "^8.13.0"` — the caret permits 8.16.3 but does not require it, so a
fresh lockfile resolve could produce a version that fails **only on Workers** while working
locally. Pin it.

Also: `nodejs_compat` is required for compatibility dates before **2026-08-04**; on or after that
date Workers enable `nodejs_compat` and `nodejs_compat_v2` by default.

---

## 5. Which finished phases need changes

The owner asked whether completed phases need revisiting. Checked; the answer is narrow.

| Phase | Change needed |
|---|---|
| 0 — Foundation | **CI gains a deploy step**, and `docker-compose.yml` becomes local-dev-only. CI can keep the Docker service for integration tests — it costs nothing and is more hermetic than pointing CI at a shared Supabase project. |
| 1 — State + tools | **None.** The framework-agnostic boundary is exactly why. |
| 2 — Interpret + Resolve | **None.** No Node-specific API. |
| 3 — Loop + reminders | **Poller → Cron Trigger** (§3). `pollOnce` unchanged. |
| 4 — Understanding over time | **None.** `fetch` for Voyage is native on Workers — the decision not to add an SDK pays off again. |
| 5 — Dynamic entities + UI | **Routes move from Fastify to Route Handlers** (§1). Pages, client and renderer unchanged. |

**Nothing in the data model, the tool layer, or the assistant changes.** The port is the two
framework-touching files plus configuration.

---

## 6. Order of work

| # | Task | Blocks | State (2026-09-24) |
|---|---|---|---|
| 1 | Pin `pg` ≥ 8.16.3 in both packages | deploy | ✅ |
| 2 | Move the 11 routes to `apps/web/app/api/**` Route Handlers | 3 | ✅ thirteen route handlers |
| 3 | Retire Fastify from `apps/api`; keep the tool/assistant source | 4 | ✅ not a dependency anywhere |
| 4 | `wrangler.toml` + the Cloudflare Next.js adapter | 5 | ✅ `@opennextjs/cloudflare` 1.20.6; `build:worker` exits 0 and `wrangler deploy --dry-run` bundles at 2.03 MiB gzipped |
| 5 | `scheduled()` cron handler calling `pollOnce` | — | ✅ wired through `worker/index.ts`, and the poller's log line is present in the bundled output |
| 6 | CI deploy step on push to `main` | — | ✅ `.github/workflows/deploy.yml` — staging on push, production on manual dispatch; **skips** until the Cloudflare secrets exist |

**Still not done, and it is the part that matters:** nothing has been deployed. A real request
served by a real Worker needs the owner's Cloudflare account, `wrangler secret put` for each
secret, and the CI secrets — `docs/YOUR-ACTIONS.md` items 8–14. Everything above is "the artifact
builds and contains what it should", which this project has learned is not the same thing.

**Two build failures worth knowing about before touching the adapter.** Both are upstream
([opennextjs-cloudflare#1394](https://github.com/opennextjs/opennextjs-cloudflare/issues/1394)),
both fixed by the pinned patch recorded in `pnpm-workspace.yaml`: esbuild cannot bundle `sharp`'s
native `.node` binaries, and `pg`'s workerd entry imports `cloudflare:sockets`, which esbuild
resolves as a directory. Delete the patch when the adapter ships a fix, and re-run the build.

### Definition of done

- `pnpm typecheck && lint && test` green, integration lane green.
- **The eleven routes respond from a Worker**, not just from Fastify — verified by a real
  request, because "it compiled" has never been sufficient in this project.
- **The cron handler fires and `pollOnce` runs**, verified via `wrangler dev`'s scheduled
  endpoint.
- Migrations applied to Supabase over the **direct** connection.

**Secrets never enter the repo.** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` and `DATABASE_URL` go
into Cloudflare via `wrangler secret put`, and into GitHub Actions as repository secrets — never
into `wrangler.toml`, which is committed.
