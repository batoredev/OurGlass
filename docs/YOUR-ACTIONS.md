# What you need to do

**Everything here needs a human.** These are the items I cannot do myself — they need a
credential, an account, money, a permission I do not hold, or a pair of eyes.

**Stack:** code on **GitHub**, database on **Supabase**, hosting on **Cloudflare**.

Ordered by what unblocks the most. Each says *why* it is yours rather than mine.

---

## 🔴 Blocking — nothing runs without these

### 1. Rotate the Anthropic API key

**A live key was pasted into `.env.example` three times.** That file is tracked, and this repo
is public.

Verified each time: **it was never committed** (`git log -S` finds nothing across all refs;
`HEAD:.env.example` has the line blank), and I reverted it each time. So there is no evidence of
exposure — but a key that has sat in a tracked file three times should be treated as burned.

- Rotate at <https://console.anthropic.com/settings/keys>
- Put the new one in **`.env`** (gitignored), never `.env.example`
- `.env.example` stays blank — it is the committed template

### 2. Create the Supabase project

This **removes the Docker requirement**. There is no Docker on this machine, which was
previously the hard blocker to running anything locally.

1. Create a project at <https://supabase.com/dashboard>
2. **Enable pgvector**: Database → Extensions → search `vector` → enable
3. Copy the **direct connection** URI: Project Settings → Database → Connection string

> ⚠️ **Use the DIRECT connection (port 5432, `db.[REF].supabase.co`), not the transaction
> pooler.** Verified from Supabase's docs: the 6543 pooler *"does not support prepared
> statements"*. This codebase runs `SET LOCAL` inside transactions and holds a long-lived `pg`
> pool, and migrations require direct access outright. The 6543 option is the tempting wrong
> choice because "serverless" describes Cloudflare — and it would fail *intermittently*, which
> is the worst failure shape. Details in `docs/DEPLOYMENT-DESIGN.md` §2.

Then create `.env` in the repo root:

```
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
ANTHROPIC_API_KEY=<your rotated key>
ENABLE_DEMO_ENDPOINT=true
```

### 3. Run the migrations

```bash
pnpm db:migrate
```

Ten migrations, `001`–`010`, all verified against real Postgres 17 + pgvector in CI. **They have
never run against Supabase**, which is the one environment difference that matters. If it fails,
the error names the migration.

---

## 🟠 Needed to see the product actually work

### 4. Start it and talk to it

```bash
pnpm dev     # api on :3001, web on :3000
```

```bash
curl -s localhost:3001/turn -H 'content-type: application/json' \
  -d '{"utterance":"Barkha needs to give me the article by 6. Remind me at 5 to ask her."}'
```

Then open <http://localhost:3000> and click through Today / Commitments / People / Memory /
Activity.

**Why this is yours:** every judgement in spec §5, §30 and §31 — tone, conciseness, whether a
reply sounds like a person — is **unfalsifiable by a test suite**. Someone has to read the
replies and say whether they are any good.

### 5. Approve the live eval run *(costs money)*

```bash
pnpm --filter @ourglass/evals test:live
```

**69 paid Sonnet calls.** `.claude/rules/wat.md` requires me to ask before spending on a metered
endpoint, so I have not run it.

**This is the single largest unmeasured thing in the project** — there is no recorded model
output in the repo at all, so every extraction claim is about the harness, not the model. It
matters more now: I just added six fields to the extraction contract and changed the system
prompt, so the surface this measures **grew**.

---

## 🟡 Cloudflare — needed to deploy

### 6. Cloudflare account + Wrangler login

```bash
npx wrangler login
```

### 7. Set the production secrets

**Never in `wrangler.toml`** — that file is committed.

```bash
npx wrangler secret put OURGLASS_ACCESS_TOKEN   # REQUIRED: without it every route 404s
npx wrangler secret put DATABASE_URL
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put VOYAGE_API_KEY      # optional, see §9
```

The access token must be at least 32 characters; a shorter one makes the app refuse to serve
rather than serve weakly. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Staging has its own Worker and therefore its own secrets.** Repeat each line with
`--env staging`, and point that `DATABASE_URL` at a **separate** database — a staging Worker on
the production database is production with fewer safeguards.

### 8. GitHub Actions deploy secrets

For CI to deploy on push to `main`, add as **repository secrets**:

- `CLOUDFLARE_API_TOKEN` — create at <https://dash.cloudflare.com/profile/api-tokens>, "Edit
  Cloudflare Workers" template
- `CLOUDFLARE_ACCOUNT_ID`

Until both exist the `Deploy` workflow **skips with a notice** instead of failing, so `main` stays
green while this is outstanding. A push to `main` then deploys staging; production is a manual
run of that workflow.

Optionally add the deployed URLs as repository **variables** — `STAGING_URL` and
`PRODUCTION_URL` (e.g. `https://ourglass-staging.<your-subdomain>.workers.dev`). With them the
workflow smoke-checks `/api/health` after each deploy and fails loudly if the database is
unreachable; without them it says it skipped.

> **`ANTHROPIC_API_KEY` must never go in a workflow a fork PR can trigger.** The live eval lane
> is `workflow_dispatch`-only for exactly this reason.

---

## 🟢 Optional — enables built-but-idle features

### 9. A Voyage API key, for semantic memory

Phase 4's embedding layer is built, indexed, and integration-tested — and **has never been
called with a real key**. Without one the app runs fine: memories store with a NULL embedding and
stay fully visible to structured queries. They are only invisible to *semantic* search.

Get one at <https://dash.voyageai.com>, then `VOYAGE_API_KEY=...` in `.env`.

**Unverified until you do:** the `input_type` asymmetry (document vs query), the 1024-dimension
match, and recall quality. All three fail **silently** — a wrong `input_type` returns 1024
perfectly valid floats and simply worse recall.

### 10. Authorise the Supabase MCP connector *(optional)*

It is configured in this session but **not authorised**, so I cannot query your project
directly. Authorise via your claude.ai connector settings, or `claude mcp` / `/mcp` in an
interactive session. Nothing depends on it — it would only save you pasting output.

---

## 🔵 Owner permissions — I hold WRITE, not ADMIN

Verified: `gh api repos/batoredev/OurGlass --jq .permissions` →
`{"admin":false,"maintain":false,"pull":true,"push":true,"triage":true}`

Whoever owns `batoredev` needs to:

- **Turn on branch protection** for `main` (require CI before merge)
- **Confirm secret scanning + push protection** — I cannot even *read* their state without
  admin, so their status is assumed, not verified. Given a live key reached a tracked file three
  times, push protection is worth confirming specifically.
- **Confirm Dependabot alerts** are on

---

## Per phase — what is yours, including the finished ones

| Phase | Status | Your action |
|---|---|---|
| **0 — Foundation** | done | Branch protection, secret scanning, Dependabot *(needs ADMIN)*. Later: Cloudflare + GitHub deploy secrets (§6–8) |
| **1 — State + tools** | done | **Nothing.** `add_entity_field` is unbuilt, but that is my work |
| **2 — Interpret + Resolve** | done | **Run `test:live`** (§5). Still zero recorded model output |
| **3 — Loop + reminders** | done | **Run the demo and read the replies** (§4) — the only way to judge tone |
| **4 — Understanding over time** | done | **Voyage key** (§9), if you want semantic recall |
| **5 — Dynamic entities + UI** | done | **Open the UI in a browser.** Nine routes build and unit-test; nobody has looked at them, so every visual judgement is unverified |
| **6 — Ingestion** | not started | Nothing yet |
| **7 — Integrations** | not started | Google OAuth credentials, when we reach it |
| **8 — Voice** | deferred | — |

---

## What is mine, not yours

So the split is unambiguous — these need no decision from you:

- **The Cloudflare port**: Fastify → Next.js Route Handlers, poller → Cron Trigger, pin `pg`
  (`docs/DEPLOYMENT-DESIGN.md`)
- Wiring the seven built-but-unreachable tools into the planner *(in progress)*
- Phase 4's demo: `create_event` plus two call sites for §24/§26
- `add_entity_field` (Phase 1), duplicate detection (Phase 2), conditional-rule creation (Phase 3)
- The conversation view (Phase 5)
- Phases 6–8

Full technical detail: `docs/EXECUTION-PLAN.md`'s outstanding-work section.
