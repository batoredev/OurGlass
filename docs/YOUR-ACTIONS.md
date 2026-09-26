# Your checklist

Everything here needs a person: an account, money, a credential, admin rights, or a pair of
eyes. Tick items off by editing this file. Rewritten 2026-09-24; the previous version was out
of date (it still listed Supabase setup, which is done, and an old dev-server port).

**Who does what:** 👤 you · 🔑 whoever owns the `batoredev` GitHub account (you have write
access, not admin) · 💰 costs money · 🤖 hand back to me

**Already done — don't redo:** Supabase project with pgvector, all 12 migrations applied, a
working local `.env`, Ollama with `qwen3:8b` so the app runs with no key, everything on GitHub
with CI green.

**Fastest route to a live URL:** items 1, 2, 4, 8, 9, 10, 11, 12. Item 3 can run in parallel.

---

## Part 1 — Security (today, about 15 minutes)

- [ ] **1. Revoke the Ollama API key you pasted into the chat** 👤
  1. Sign in at <https://ollama.com> and open your account settings → Keys.
  2. Delete the key you pasted.
  - **Done when:** it no longer appears in the list.

- [ ] **2. Rotate the Anthropic API key** 👤
  It reached a tracked file three times. It was never committed, but treat it as leaked.
  1. Open <https://console.anthropic.com/settings/keys>.
  2. Create a new key and copy it.
  3. Delete the old key.
  4. In the repo root, open `.env` and set `ANTHROPIC_API_KEY=<the new key>`.
  5. Never put a key in `.env.example` (it is committed and the repo is public) or in a chat.
  - **Done when:** the old key shows as deleted and `.env` holds the new one.

- [ ] **3. Protect the repository** 🔑 *(send these steps to the `batoredev` owner)*
  1. GitHub → the `OurGlass` repo → **Settings → Branches** → add a rule for `main` that
     requires these status checks to pass: `typecheck / lint / test / build` and
     `integration (Postgres + pgvector)`.
  2. **Settings → Code security** → turn on **secret scanning** and **push protection**.
  3. Same page → turn on **Dependabot alerts**.
  - **Done when:** a pull request into `main` shows both checks as required.

## Part 2 — Give the app a real model (about 10 minutes)

- [ ] **4. Add Anthropic credit** 👤💰
  Local Qwen gets 34 of 99 test sentences fully right. Claude is the model the app was built
  for, and it has never been measured.
  1. <https://console.anthropic.com> → **Settings → Billing** → add credit. A small amount is
     enough to start.
  2. In `.env`, change `AI_PROVIDER_ORDER=qwen` to `AI_PROVIDER_ORDER=claude,gemini,qwen`.
  3. Stop and restart `pnpm dev`.
  4. Send any message.
  - **Done when:** replies arrive in a few seconds rather than about 30, and none says
    "I couldn't process that".

- [ ] **5. Approve the paid measurement** 👤 → 🤖
  Tell me "run the Claude eval". It is about 99 Claude calls; the project rules require your
  go-ahead before spending. I record the results in `docs/AI_EVALS.md`.

## Part 3 — Try it yourself (about 30 minutes)

- [ ] **6. Use the app locally** 👤
  Tests cannot judge whether a reply sounds right. Only a person can.
  1. In a terminal at the repo root: `pnpm dev`
  2. Open <http://localhost:3000>. No sign-in is needed locally.
  3. Send these one at a time:
     - `Barkha needs to give me the article by 6. Remind me at 5 to ask her.`
     - `What does Barkha owe me?`
     - `Track my reading with a book title and pages read.`
     - `Barkha sent me the article.`
  4. After each, check the reply is short, correct, and says who owes what to whom.
  5. Press **Undo** on one turn and check it disappears from **Commitments**.
  6. Open **Today, Commitments, People, Memories** and **Settings**.
  - **Done when:** you have told me anything that reads wrong or looks broken.

- [ ] **7. Try dictation** 👤
  1. Open <http://localhost:3000> in **Chrome or Edge**. Firefox shows no microphone; that is
     expected, because it has no speech API.
  2. Click the **microphone** next to Send and allow microphone access.
  3. Say: "Remind me tomorrow at nine to call the printer."
  4. The words should appear in the message box **without sending**. Then press Send.
  - **Done when:** the text appears correctly. Nobody has tried this with a real microphone yet.

## Part 4 — Put it on the internet (about an hour)

- [ ] **8. Create a Cloudflare account and log in** 👤
  1. Sign up at <https://dash.cloudflare.com>. The free plan is enough; the app fits its limit.
  2. In a terminal: `cd apps/web`, then `npx wrangler login`, and approve in the browser.
  3. Check: `npx wrangler whoami` shows your account.

- [ ] **9. Create the production database** 👤
  Your current Supabase project holds test and demo data, so use a clean one for production.
  1. Supabase dashboard → **New project** (e.g. `ourglass-prod`). Save the database password.
  2. **Database → Extensions** → search `vector` → enable it.
  3. **Project Settings → Database → Connection string** → copy the **direct** connection
     (port **5432**, host `db.<ref>.supabase.co`). Not the 6543 pooler — it breaks this app
     intermittently.
  4. From the repo root, in PowerShell:
     ```powershell
     $env:DATABASE_URL="postgresql://postgres:PASSWORD@db.REF.supabase.co:5432/postgres"; pnpm db:migrate; Remove-Item Env:DATABASE_URL
     ```
  - **Done when:** the output ends `applied 12 migration(s)`.

- [ ] **10. Turn on backups** 👤💰
  1. In the production project: **Database → Backups**.
  2. Turn on **point-in-time recovery** if your plan offers it (it may need a paid plan).
  - **Done when:** you know how far back you could restore. Without backups, a bad write or
    migration cannot be recovered.

- [ ] **11. Set the production secrets** 👤
  Run these in `apps/web`. Each one asks you to paste a value. If it offers to create the
  Worker, answer yes.
  1. Generate the sign-in token (your password to the live app) and save it in a password
     manager:
     ```
     node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
     ```
  2. `npx wrangler secret put OURGLASS_ACCESS_TOKEN` → paste the token.
  3. `npx wrangler secret put DATABASE_URL` → paste the production connection string.
  4. `npx wrangler secret put ANTHROPIC_API_KEY` → paste the key.
  5. Optional: `GEMINI_API_KEY` as a backup model, `VOYAGE_API_KEY` for memory search,
     `SUPABASE_URL` + `SUPABASE_SECRET_KEY` for file uploads (item 19c).
  - The live app cannot reach the Ollama on your laptop, so it **needs item 4**.

- [ ] **12. Deploy and check** 👤
  1. From the repo root: `pnpm --filter @ourglass/web run deploy`
  2. Note the address printed at the end: `https://ourglass.<your-subdomain>.workers.dev`
  3. Open `<address>/api/health`. It must show `"db":true`.
  4. Open `<address>/login`, paste the token from item 11, and sign in.
  5. Send one message and check the reply.
  6. In `apps/web`, run `npx wrangler tail`. Within two minutes a `scheduled` event should
     appear — that is the reminder timer running.
  - **If anything fails:** `docs/RUNBOOK.md` → *Roll back*.

- [ ] **13. Staging** 👤 *(optional, but do it before item 14)*
  Automatic deploys go to staging first, so set it up before turning them on.
  1. Create another Supabase project (e.g. `ourglass-staging`) and repeat item 9 for it.
  2. Repeat item 11 with `--env staging` on every command, and a **different** access token.
  3. `pnpm --filter @ourglass/web run deploy:staging`
  4. Check `https://ourglass-staging.<your-subdomain>.workers.dev/api/health`.

- [ ] **14. Turn on automatic deploys** 🔑
  For a repository owned by a personal account, only the owner can add Actions secrets.
  1. Cloudflare → **My Profile → API Tokens → Create Token** → the **Edit Cloudflare Workers**
     template → copy the token.
  2. Cloudflare → **Workers & Pages** → copy the **Account ID** shown on the right.
  3. GitHub repo → **Settings → Secrets and variables → Actions** → **New repository secret**:
     `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
  4. **Variables** tab → add `PRODUCTION_URL` (and `STAGING_URL` if you did item 13). These
     switch on the post-deploy check and the 15-minute uptime check.
  - **Done when:** the next push's **Deploy** run shows steps running instead of skipped.
    Pushes deploy staging; production stays a manual run of the Deploy workflow.

## Part 5 — Decisions only you can make (reply to me)

- [x] **15. Cost budget per message** → **10 per minute, 200 per day** (answered 2026-09-24,
      now the defaults).
- [x] **16. Where uploaded files live** → **Supabase Storage** (answered 2026-09-24). Phase 6
      builds on it.
- [ ] **17. A Google Cloud project** for Gmail, Calendar and Drive (Phase 7). Start early:
      Google's consent-screen review takes days to weeks. Email power is decided: **send, after
      confirming each one** (2026-09-24). The Google Cloud project itself is still yours to create.
- [ ] **18. Will there be a second customer?** Only a yes makes the multi-customer work
      (6–9 sessions) worth doing.
- [ ] **19. Terms of service and a privacy policy** before anyone outside your team uses it.
      The app stores commitments and facts about real people.

## Part 6 — Optional

- [ ] **19b. Alert webhook** (decided: a chat webhook) — so outages reach you instead of waiting to be noticed.
  1. Slack: create an app → **Incoming Webhooks** → add to a channel → copy the URL. Discord: channel
     settings → **Integrations → Webhooks → New Webhook** → copy the URL.
  2. Locally: `ALERT_WEBHOOK_URL=<url>` in `.env`. Deployed, in `apps/web`:
     `npx wrangler secret put ALERT_WEBHOOK_URL` (and again with `--env staging` if you use staging).
  - You get one message when reminders stop firing or every AI model fails — never the user's words.
- [ ] **19c. Turn on file uploads** (decided: Supabase Storage) — the 📎 button in the chat.
  1. Supabase dashboard → **Project Settings → API Keys** → copy a **secret key**
     (`sb_secret_…`; the legacy `service_role` key also works). The project URL is on the same
     page: `https://<project-ref>.supabase.co`.
  2. Locally, in `.env`: `SUPABASE_URL=https://<project-ref>.supabase.co` and
     `SUPABASE_SECRET_KEY=sb_secret_…`. Deployed, in `apps/web`:
     `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_SECRET_KEY`.
  3. Nothing to create: the private `documents` bucket makes itself on the first upload.
  - ⚠ The secret key bypasses every access rule in your database. It stays on the server; the
    app never sends it to a browser. Treat it like the database password.
  - **Images** are read only by Claude or Gemini (item 4); your local Qwen reads text, Word,
    Excel and PDF files. Cost: about $0.04 per long document and $0.015 per image on Claude.
  - ⚠ **Deployed PDFs need Cloudflare Workers Paid** ($5/month): reading a PDF takes more than
    the free plan's 10 ms of CPU per request. The app bundle is 2.61 MB of the free plan's
    3 MB limit, so that fits either way.
- [ ] **20. Voyage API key** (<https://dash.voyageai.com>) → `VOYAGE_API_KEY=` in `.env`. Lets
      memory search find paraphrases, not only exact words.
- [ ] **21. Reconnect the Claude Code connectors.** The GitHub one fails to connect
      ("Authorization header is badly formatted"); Supabase and Vercel need authorising via
      `/mcp`. Nothing depends on them.

---

## What I'm doing meanwhile — no action from you

The accessibility audit, a stricter content security policy, and alerting once the app is
deployed. Progress is tracked in `docs/REMAINING-EXECUTION-PLAN.md`.
