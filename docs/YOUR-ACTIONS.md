# Your checklist

Everything here needs a person: an account, money, a credential, admin rights, a decision, or a
pair of eyes. Tick items off by editing this file. Rewritten 2026-11-05 for the Supabase +
Cloudflare Pages hosting (the Cloudflare Workers steps it used to hold no longer apply).

**Who does what:** 👤 you · 🔑 whoever owns the `batoredev` GitHub account (you have write
access, not admin) · 💰 costs money · 🤖 hand back to me

**Already done — don't redo:** a Supabase project with pgvector and every migration applied; the
API and reminders deployed by hand as Supabase Edge Functions and the site on Cloudflare Pages
(`https://ourglass.pages.dev`, 2026-10-19); CI green on `main`. The deployed API answered
`/api/health` with `"db":true` on 2026-11-05; signing in and sending a message there has not been
re-checked since 2026-10-20 (item 9).

**What each stage of the plan needs from you:** [`ROADMAP.md`](ROADMAP.md) → *Owner inputs*.

---

## Part 1 — Security (about 20 minutes)

- [ ] **1. Revoke the Ollama API key you pasted into a chat** 👤
  <https://ollama.com> → account settings → Keys → delete it. **Done when** it is gone from the
  list.

- [ ] **2. Rotate the Anthropic API key** 👤
  It reached a tracked file three times. It was never committed, but treat it as leaked.
  1. <https://console.anthropic.com/settings/keys> → create a new key → delete the old one.
  2. Put the new one in your local `.env` and in the deployed API:
     `supabase secrets set ANTHROPIC_API_KEY=<new key>`.
  3. Never put a key in `.env.example` (committed, and the repo is public) or in a chat.

- [ ] **3. Protect the repository** 🔑 *(send these steps to the `batoredev` owner)*
  1. GitHub → `OurGlass` → **Settings → Branches** → a rule for `main` that requires the
     `typecheck / lint / test / build` and `integration (Postgres + pgvector)` checks and
     **blocks force-pushes**. A force-push to `main` already dropped eight commits once
     (2026-10-21; they were merged back).
  2. **Settings → Code security** → **secret scanning**, **push protection**, **Dependabot
     alerts** on.
  - **Done when** a pull request into `main` shows both checks as required.

- [ ] **4. Turn on Row Level Security in Supabase** 👤
  Migration `017_row_level_security` (Stage 0) enables it on every table, makes every view run
  with the caller's rights, and revokes the Data API roles' grants. No code depends on it, so it
  can be applied as soon as the pull request merges:
  1. `pnpm db:migrate` against the **direct** connection ([`RUNBOOK.md`](RUNBOOK.md)).
  2. Run the smoke check. Pages should show your data exactly as before: the app connects as the
     tables' owner, which RLS does not restrict. If pages come back **empty**, the API connects as
     some other role — tell me, and I write the one-line compensating migration.
  3. Dashboard → **Advisors → Security Advisor**: the RLS warnings should be gone.
  4. The same `pnpm db:migrate` applies **018** (the once-a-day brief index, Stage 5): deploy
     the functions only after it, or the scheduled pass's briefs fail (reminders still fire).

## Part 2 — Models and your data (decisions, about 10 minutes)

- [ ] **5. Decide which models may see real data** 👤
  The deployed project was set to try **Groq first** (October 2026). Groq, Cerebras and
  OpenRouter free tiers may use what you send to train their models. Either accept their terms,
  or put Claude/Gemini first: `supabase secrets set AI_PROVIDER_ORDER=claude,gemini,groq,cerebras,openrouter`.
  Tell me which, and I record it in `DECISIONS.md`.

- [ ] **6. Add Anthropic credit** 👤💰
  Claude is the model the prompts were written for, and its answer quality has never been
  measured. <https://console.anthropic.com> → **Settings → Billing**. A small amount is enough
  to start.

- [ ] **7. Approve the paid measurement** 👤 → 🤖
  Tell me "run the Claude eval". It is about 99 Claude calls; the project rules require your
  go-ahead before spending. I record the results in `docs/AI_EVALS.md`. The SDK upgrade waiting
  in Dependabot #23 is confirmed the same way, and so is conversation context (Stage 1a): its
  multi-turn set is 8 calls per provider, and it is switched on (`supabase secrets set
  AI_CONVERSATION_CONTEXT=on`) only when every safety case passes.

## Part 3 — Try it (about 30 minutes)

- [ ] **8. Run the demo locally** 👤
  Follow [`DEMO-GUIDE.md`](DEMO-GUIDE.md): `pnpm db:seed-demo` gives you a ready-made week, and
  section 2 is a ten-minute script. Tests cannot judge whether a reply *sounds* right; tell me
  anything that reads wrong or looks broken.

- [ ] **9. Check the deployed app** 👤
  Sign in at `https://ourglass.pages.dev/login` with your access token, send one message, open
  **Today** and **Commitments**. Then the reminder check in [`RUNBOOK.md`](RUNBOOK.md) → *Smoke
  check*, step 4. **Done when** a reply arrives and the cron job shows `succeeded`.

- [ ] **10. Try dictation** 👤
  In Chrome or Edge (Firefox has no speech API), the microphone next to Send: say "Remind me
  tomorrow at nine to call the printer." The words should appear **without sending**. Nobody has
  tried this with a real microphone yet.

## Part 4 — Make deploys repeatable (about 30 minutes)

- [ ] **11. Turn on backups** 👤💰
  Supabase → **Database → Backups**; turn on **point-in-time recovery** if your plan offers it.
  **Done when** you know how far back you could restore. Without backups, a bad write or
  migration cannot be recovered.

- [ ] **12. Deploy credentials for the Deploy workflow** 🔑
  For a personal-account repository, only the owner can add Actions secrets.
  1. Supabase → **Account → Access Tokens** → generate a token.
  2. GitHub repo → **Settings → Secrets and variables → Actions** → secret
     `SUPABASE_ACCESS_TOKEN`.
  3. **Variables** tab → `SUPABASE_PROJECT_REF` (production) and `SUPABASE_STAGING_PROJECT_REF`.
     ⚠ Pushes to `main` deploy whatever `SUPABASE_STAGING_PROJECT_REF` names. With only one
     project, leave it unset (deploy production by a manual run) or accept that every merge
     deploys production.
  - **Done when** the next push's **Deploy** run shows steps running instead of skipped.

- [ ] **13. Turn on the uptime and post-deploy checks** 🔑
  **Variables** tab → `PRODUCTION_URL` = `https://<project-ref>.supabase.co/functions/v1` (no
  `/api/health`; the check adds it), and `STAGING_URL` if you have staging. The **Uptime**
  workflow then checks every 15 minutes.

- [ ] **14. Rebuild the site on every push** 👤 *(optional)*
  Cloudflare → **Workers & Pages → ourglass** → connect the GitHub repository with the settings
  in [`DEPLOYMENT-DESIGN.md`](DEPLOYMENT-DESIGN.md) (`NEXT_PUBLIC_API_URL`, `NODE_VERSION=24`).
  Until then the site changes only when someone uploads it by hand — the new look and the
  sign-in fix are not live until it is rebuilt.

- [ ] **15. Staging** 👤 *(optional)*
  A second Supabase project, migrated, with its own secrets and a **different** access token;
  then item 12's staging variable.

## Part 5 — Google (unblocks Stage 1)

- [ ] **16. A Google Cloud project and OAuth client** 👤
  Start early: Google's consent-screen review takes days to weeks.
  1. <https://console.cloud.google.com> → new project → enable the **Google Calendar API** and
     the **Gmail API**.
  2. **OAuth consent screen** → External → scopes `…/auth/calendar.events`,
     `…/auth/gmail.send`, and `…/auth/gmail.readonly` (reading, decided 2026-11-05); add yourself
     as a test user. In testing mode Google expires the grant every 7 days — reconnect in
     Settings.
  3. **Credentials → OAuth client ID → Web application**, redirect URI
     `https://<project-ref>.supabase.co/functions/v1/api/google/callback`.
  4. `supabase secrets set GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… GOOGLE_REDIRECT_URI=…`
     (the same three in `.env` locally, with a localhost redirect URI).
  - **Done when** Settings → Google shows *connected*. Then tell me, and I verify the calendar
    round trip and a real send.

## Part 6 — Decisions only you can make (reply to me)

- [x] **Cost budget per message** → 10 per minute, 200 per day (2026-09-24).
- [x] **Where uploaded files live** → Supabase Storage (2026-09-24).
- [x] **Email power** → send, after confirming each one (2026-09-24).
- [x] **Scope and the nine defaults** → the 13 categories and the defaults recorded in
      `DECISIONS.md` (2026-11-05).
- [ ] **17. Will there be a second customer?** Only a yes makes multi-user work worth doing.
- [ ] **18. Terms of service and a privacy policy** before anyone outside your team uses it. The
      app stores commitments and facts about real people.
- [ ] **19. The daily digest (Stage 5):** which address it is sent from, and your quiet hours.

## Part 7 — Optional

- [ ] **20. Alert webhook** (decided: a chat webhook). Slack **Incoming Webhooks** or a Discord
  channel webhook → `ALERT_WEBHOOK_URL` in `.env`, and `supabase secrets set ALERT_WEBHOOK_URL=…`.
  One message when reminders stop firing or every AI model fails — never your words.
- [ ] **21. File uploads** (the 📎 button). Supabase → **Project Settings → API Keys** → a secret
  key (`sb_secret_…`).
  - Locally: `SUPABASE_URL=https://<project-ref>.supabase.co` and `SUPABASE_SECRET_KEY=…`.
  - Deployed: `supabase secrets set STORAGE_URL=… STORAGE_SECRET_KEY=…` — **not** `SUPABASE_*`,
    which `supabase secrets set` silently skips.
  - The private `documents` bucket creates itself on the first upload. ⚠ The secret key
    bypasses every access rule: it stays on the server, like the database password.
  - Images are read only by Claude or Gemini. Cost on Claude: about $0.04 per long document and
    $0.015 per image.
- [ ] **22. Voyage API key** (<https://dash.voyageai.com>) → `VOYAGE_API_KEY`. Memory search then
  finds paraphrases, not only exact words.
