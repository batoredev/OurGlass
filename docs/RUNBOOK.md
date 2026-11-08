# Runbook

How to deploy, check, roll back and recover OurGlass. Written for whoever is on call, which may
be someone who did not build it. Commands run from the repo root unless stated. Rewritten
2026-11-05 for the Supabase + Cloudflare Pages hosting; the design and its history are in
[`DEPLOYMENT-DESIGN.md`](DEPLOYMENT-DESIGN.md).

**The shape of the system, in one line.** A static site on Cloudflare Pages calls one Supabase
Edge Function, `api`, for every `/api/*` route; `pg_cron` calls a second function, `reminders`,
once a minute; all state is in the same project's Postgres. The model providers are called per
turn and hold no state.

---

## Deploy

**Migrations first.** A deploy never changes the database. If the release adds a file to
`packages/db/migrations/`, apply it **before** deploying the code that needs it, with
`DATABASE_URL` set to the target's **direct** connection (port 5432 — never the 6543 transaction
pooler, which drops prepared statements and fails intermittently):

```sh
pnpm db:migrate        # forward-only; applies only files not yet in pgmigrations
```

**Never run `pnpm db:reset`, the integration tests, or `pnpm db:seed-demo --allow-remote`
against the owner's project.** The first drops the schema; the second truncates every table;
the third adds fictional people to real data.

**The API and reminders** (needs `supabase login` and `supabase link --project-ref <REF>` once):

```sh
pnpm run build:edge
supabase functions deploy api --use-api
supabase functions deploy reminders --use-api
```

With the `SUPABASE_ACCESS_TOKEN` secret and the project-ref variables set
([`YOUR-ACTIONS.md`](YOUR-ACTIONS.md)), the **Deploy** workflow does this on every push to
`main` (staging) and on a manual run (production), after typecheck, lint and tests. Until then
it skips and says so.

**The site** (direct upload; run wrangler from outside the repo, where npx does not trip over
the pnpm workspace):

```sh
NEXT_PUBLIC_API_URL=https://<REF>.supabase.co/functions/v1 pnpm run build:site
npx wrangler@4.136.1 pages deploy <repo>/apps/web/out --project-name ourglass --branch main
```

`NEXT_PUBLIC_API_URL` is baked into the static files at build time, and the site's CSP allows
that origin and no other. A site built without it, or for another project, cannot reach the API.

**Once per project:** run `supabase/cron/schedule-reminders.sql` in the SQL Editor (it says what
to fill in), so reminders fire.

## Smoke check after every deploy

1. `https://<REF>.supabase.co/functions/v1/api/health` answers `200` with `"db":true`. It needs
   no token. (`python tools/health_check.py --url https://<REF>.supabase.co/functions/v1` does
   the same, with retries.)
2. Sign in at `https://<site>.pages.dev/login`, send one message, and check the reply names what
   you said.
3. Open **Commitments** and **Today** — both load with no error box.
4. In the SQL Editor, `select status, start_time from cron.job_run_details order by start_time
   desc limit 3;` shows a run in the last minute with `succeeded`, and
   `select status_code from net._http_response order by created desc limit 3;` shows `200`.

If any step fails, roll back.

## Roll back

| Piece | How |
|---|---|
| Site | Cloudflare dashboard → **Workers & Pages → ourglass → Deployments** → a previous production deployment → **Rollback**. Or build and upload the previous commit's `out/` |
| API, reminders | Check out the last good commit, then `pnpm run build:edge` and the two `supabase functions deploy` commands above |
| Database | **Not rolled back.** Migrations are forward-only. Code rolled back onto a migrated schema must still work — which is why every migration so far is additive or relaxes a constraint. One that cannot coexist with the previous code needs a compensating **forward** migration, reviewed like any other |
| Secrets | **Not rolled back.** A rotated `OURGLASS_ACCESS_TOKEN` stays rotated |

## Recover data

| What went wrong | Do this |
|---|---|
| One wrong write from a conversation | **Undo** in the chat or on **Activity**, or `POST /api/undo` with the `turnId`. Every write is logged with its inverse; undo invalidates rather than deletes |
| Many bad rows, or a bad migration | Supabase backups / **point-in-time recovery**. ⚠ Confirm what the project's plan offers *before* you need it — an owner setting, not yet verified |
| Something must be gone **for good** (a person, a file, everything) | **Delete permanently** on People or Files, or **Settings → Export and delete data**; the API is `POST /api/data/delete`. It removes the rows, scrubs the action log, and deletes the file's bytes from storage first — if storage refuses, nothing is deleted and it can be run again. It cannot be undone, and backups still hold the data until they age out |
| Take a copy of everything | **Settings → Export and delete data → Export**, or `GET /api/data/export` (every table as JSON; no file bytes, no search vectors, no Google token) |

## Secrets

Function secrets are set with `supabase secrets set NAME=value` (or `--env-file <file>`, which
keeps values out of shell history) and listed by name with `supabase secrets list`. They are not
in the repo and never in a workflow a fork PR can trigger.

| Secret | Meaning |
|---|---|
| `OURGLASS_ACCESS_TOKEN` | The sign-in token, 32+ characters. Required |
| `ALLOWED_ORIGINS` | The site's origin, e.g. `https://ourglass.pages.dev` (exact matches, comma-separated). Required for the browser |
| `CRON_SECRET` | 32+ characters, the same value stored in Vault by the cron SQL. Required for reminders |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY` | Model providers; a missing key skips that provider. `AI_PROVIDER_ORDER` sets the order |
| `STORAGE_URL`, `STORAGE_SECRET_KEY` | File uploads. **Not** `SUPABASE_*`: `supabase secrets set` silently skips names with that reserved prefix |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Calendar and Gmail. Rotating the client secret also changes the key that encrypts the stored refresh token: reconnect afterwards |
| `VOYAGE_API_KEY`, `ALERT_WEBHOOK_URL`, `TURN_LIMIT_PER_MINUTE`, `TURN_LIMIT_PER_DAY` | Optional |

**Leave `DATABASE_URL` unset** in the function secrets: every Edge Function is given
`SUPABASE_DB_URL`, and the code falls back to it.

## Incidents

**Alerts.** With `ALERT_WEBHOOK_URL` set, the chat channel gets one message (at most one per kind
per 15 minutes) for the two outages nobody would otherwise notice: *the reminder timer failed*
and *every AI model failed for a message*. An alert names what failed and when, never what the
user said.

**Every reply says "I couldn't process that just now — nothing was saved."**
No model provider answered; nothing was written. The `api` function's logs (Supabase dashboard →
**Edge Functions → api → Logs**) show one `ai_request` JSON line per attempt with `provider`,
`errorCategory` and `fallbackReason`. Typical causes: an exhausted key (Anthropic "credit balance
is too low", Gemini `429`), a free model removed from a catalogue (`model_not_found`), or a
provider outage. Fix the key or the model name; the router falls back through
`AI_PROVIDER_ORDER` on its own.

**Replies all have the fixed template shape ("Noted: … — …", "Reminder set for …").**
The Respond stage is degrading; the writes are fine. `fallbackReason` says why: `timeout` means
`AI_RESPOND_TIMEOUT_MS` is too low for that model (Gemini needs ~15000); `ungrounded` means the
model claimed something the facts did not say and was correctly replaced by the template.

**A 429 "Too many messages right now".**
The spend cap (`apps/edge/app/api/_rate-limit.ts`): 10 turns a minute, 200 a day by default. If
it is legitimate use, raise `TURN_LIMIT_PER_MINUTE` / `TURN_LIMIT_PER_DAY` with
`supabase secrets set`. If it is not, treat it as a leaked token (below).

**The site loads but every page says it cannot reach the API.**
Check, in order: `/api/health` answers (above); the site was built with the right
`NEXT_PUBLIC_API_URL`; `ALLOWED_ORIGINS` names the site's exact origin (a browser request from
any other origin is refused, and a cross-site write answers 403).

**Sent back to the sign-in page after signing in.**
The API answered 401: the token in the browser does not match `OURGLASS_ACCESS_TOKEN` (it was
rotated, or the site points at another project). Sign in with the current token.

**An upload answers "File uploads aren't set up yet".**
`STORAGE_URL` or `STORAGE_SECRET_KEY` is missing, or the URL is not https. Nothing else depends
on storage.

**An upload says "I couldn't store that file just now".**
Supabase Storage refused or did not answer; nothing was saved. The logs show
`[ingest] storage failed:` with the reason — a rejected key names the secret key.

**A file is saved but "couldn't be read".** The reply says which of: no model configured, no
image-capable model (Qwen reads text only), the models failed, a scan with no text,
password-protected, damaged, or too large. The file is safe in storage either way; the reason is
`documents.read_failure`.

**The access token leaked.**
`supabase secrets set OURGLASS_ACCESS_TOKEN=<new 32+ characters>`. Every browser is signed out
at once. Generate one with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

**Reminders did not fire.**
`cron.job_run_details` (smoke check step 4) shows whether the job runs at all;
`net._http_response` shows what the function answered — `404` means the Bearer value in Vault
does not match `CRON_SECRET`, `500` "CRON_SECRET is not configured" means the secret is missing
or shorter than 32 characters. A reminder with a relational time ("after the meeting") is
deliberately never stored: the assistant asks for a clock time instead.

**Pages are empty after applying migration 017.**
017 enables Row Level Security with no policies, which hides every row from any role that is not
the tables' owner. The API connects as the owner, so this should not happen; if it does, the
function is connecting as another role. Roll forward with a migration that disables RLS
(`ALTER TABLE … DISABLE ROW LEVEL SECURITY` per table) and find out which role it uses.

**Every route answers 404.**
The access guard found no `OURGLASS_ACCESS_TOKEN`: the API is closed by design. Set the secret.
Never set `ENABLE_DEMO_ENDPOINT` on a deployed function — it opens every route without a token.

**Every route answers 500 "refusing to serve".**
`OURGLASS_ACCESS_TOKEN` is shorter than 32 characters. Set a longer one.

**The first request after a quiet spell is slow.**
A cold start. The function opens its database connection on first use; later requests reuse it.

## Where to look

| Question | Place |
|---|---|
| Is it up? | `/api/health`; the **Uptime** workflow once `PRODUCTION_URL` is set |
| What is it doing right now? | Supabase dashboard → **Edge Functions → api / reminders → Logs** |
| What did the model say, turn by turn? | `messages.trace` in Postgres — model, latency, stop reason, tokens |
| What changed, and can it be undone? | `action_log`, or the **Activity** page |
| Are reminders running? | `cron.job_run_details`, `net._http_response` |
| Which site version is live? | Cloudflare dashboard → **Workers & Pages → ourglass → Deployments** |
