# Runbook

How to deploy, check, roll back and recover the Batore Personal Assistant. Written for whoever is
on call, which may be someone who did not build it. Commands run from `apps/web` unless stated.

**The shape of the system, in one line.** One Cloudflare Worker serves the UI and every `/api`
route; a cron trigger on the same Worker fires reminders every minute; all state is in one
Supabase Postgres. The model providers (Claude, Gemini, local Qwen) are called per turn and hold
no state.

---

## Deploy

Always staging first. `wrangler.toml` defines both environments.

```sh
pnpm --filter @ourglass/web run deploy:staging   # builds, then deploys ourglass-staging
# smoke check it (below), then:
pnpm --filter @ourglass/web run deploy           # production
```

Each script runs the Cloudflare build first (`scripts/build-worker.mjs`), so a deploy cannot ship
a stale bundle. Pushing to `main` deploys **staging** automatically; production is the manual
`Deploy` workflow dispatch, or the command above. To see what would be uploaded without
uploading anything: `npx wrangler deploy --dry-run --outdir=.open-next/dry-run`.

A deploy never changes the database. If the release includes a new file in
`packages/db/migrations/`, apply it **before** deploying the code that needs it, from the repo
root with `DATABASE_URL` pointing at the target database's **direct** connection (port 5432 —
never Supabase's 6543 transaction pooler, see `docs/YOUR-ACTIONS.md` item 9):

```sh
pnpm db:migrate        # forward-only; applies only files not yet in pgmigrations
```

**Never run `pnpm db:reset` against Supabase.** It drops the schema. It exists for disposable
local databases only.

## Smoke check after every deploy

1. `curl https://<host>/api/health` answers `200` with `"db": true`. It needs no token.
2. Sign in at `/login`, send one message, and check the reply names what you said.
3. Open **Commitments** and **Today** — both load with no error box.
4. Within two minutes, `npx wrangler tail` shows a `scheduled` event (the reminder cron).

If any step fails, roll back.

## Roll back

```sh
npx wrangler deployments list          # the 10 most recent deployments
npx wrangler rollback                  # to the version before the latest
npx wrangler rollback <VERSION_ID>     # to a specific one
```

Verified against Cloudflare's docs (2026-09-22). What a rollback does **not** do:

- **It does not touch the database.** Migrations are forward-only (`packages/db/scripts/migrate.mjs`).
  Code rolled back onto a migrated schema must still work — which is why every migration so far is
  additive or relaxes a constraint. A migration that cannot coexist with the previous code needs a
  compensating **forward** migration, written and reviewed like any other.
- **It does not change secrets or bindings.** A rotated `OURGLASS_ACCESS_TOKEN` stays rotated.

## Recover data

| What went wrong | Do this |
|---|---|
| One wrong write from a conversation | **Undo** in the chat, or `POST /api/undo` with the `turnId`. Every write is logged with its inverse; nothing is deleted, only invalidated |
| Many bad rows, or a bad migration | Supabase **point-in-time recovery**. ⚠ Confirm PITR is enabled on the project *before* you need it — it is an owner setting and has not been verified (plan, Track P2 "Backups") |

## Incidents

**Every reply says "I couldn't process that just now — nothing was saved."**
No model provider answered. Nothing was written. `npx wrangler tail --search ai_request` shows one
JSON line per attempt with `provider`, `errorCategory` and `fallbackReason`. Typical causes: an
exhausted key (Anthropic "credit balance is too low", Gemini `429`), a provider outage (`503`), or
`OLLAMA_BASE_URL` pointing at a host the Worker cannot reach. Fix the key or add capacity; the
router falls back through `AI_PROVIDER_ORDER` on its own.

**Replies all have the fixed template shape ("Noted: … — …", "Reminder set for …").**
The Respond stage is degrading; the writes are fine. `fallbackReason` in the same log says why:
`timeout` means `AI_RESPOND_TIMEOUT_MS` is too low for that model; `ungrounded` means the model
claimed something the facts did not say and was correctly replaced by the template.

**A 429 "Too many messages right now".**
The spend cap (`apps/web/app/api/_rate-limit.ts`) — 20 turns a minute, 500 a day by default. If
it is legitimate use, raise `TURN_LIMIT_PER_MINUTE` / `TURN_LIMIT_PER_DAY` in `wrangler.toml`
`[vars]` and redeploy. If it is not, treat it as a leaked token (below).

**The access token leaked.**
`npx wrangler secret put OURGLASS_ACCESS_TOKEN` with a new value of at least 32 characters. This
signs every browser out at once. Generate one with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

**Reminders did not fire.**
Cron expressions are UTC, and trigger changes take up to 15 minutes to propagate. `wrangler tail`
shows whether `scheduled` runs at all. Reminders are stored with `fire_at`; a reminder with a
relational time ("after the meeting") is deliberately never stored — the assistant asks for a
clock time instead.

**Every route answers 404.**
The access guard found no `OURGLASS_ACCESS_TOKEN` and no demo flag: the API is closed by design.
Set the secret. Never set `ENABLE_DEMO_ENDPOINT` on a Worker — `wrangler.toml` explains why.

**Every route answers 500 "refusing to serve".**
`OURGLASS_ACCESS_TOKEN` is shorter than 32 characters. Set a longer one.

## Where to look

| Question | Place |
|---|---|
| Is it up? | `/api/health` |
| What is it doing right now? | `npx wrangler tail` (add `--search ai_request` for model calls) |
| What did the model say, turn by turn? | `messages.trace` in Postgres — model, latency, stop reason, tokens |
| What changed, and can it be undone? | `action_log`, or the **Activity** page |
| Which versions are live? | `npx wrangler deployments list` |
