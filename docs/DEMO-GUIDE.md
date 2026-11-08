# Demo guide

A scripted walkthrough of OurGlass for a prototype display: how to start it with a ready-made
week of data, what to type, what should happen, and what is deliberately not built yet. Read
section 0 first — it covers the one thing that can sink a demo, and it is not the code.

What is built and what is planned: [`ROADMAP.md`](ROADMAP.md).

---

## 0. Before you start — the model provider

**The assistant cannot understand a message without a working model provider.** With none, every
turn answers *"I couldn't process that just now — nothing was saved"*: honest, but not a demo.
The pages, the seeded data and Undo all work without one.

```sh
pnpm check:models      # one real request per Claude and Gemini model; free
```

| Provider | What goes wrong | Fix |
|---|---|---|
| **Claude** (primary) | Out of credit: `400 … credit balance is too low` | Add credit. Sonnet reads, Haiku replies, about a second a turn |
| **Gemini** | Free-tier per-minute and per-day quotas: `429` | Wait for the reset, or a paid tier. Replies take 10–19 s, so set `AI_RESPOND_TIMEOUT_MS=15000` or they fall back to the template |
| **Groq, Cerebras, OpenRouter** (free backups) | A model leaves the catalogue | Override `GROQ_MODEL` etc. ⚠ Free tiers may train on what you send: use them with the fictional demo cast, not real data |
| **Qwen** (local, optional) | Not installed | `ollama pull qwen3:8b`, set `OLLAMA_BASE_URL` — free, private, slow (~30 s a turn) |

**For a live audience, have Claude credit.** Free tiers throttle under exactly the burst a demo
produces. Detail: [`AI_PROVIDERS.md`](AI_PROVIDERS.md).

---

## 1. Start it with a demo week

```sh
pnpm install
pnpm db:migrate        # once, or after pulling schema changes
pnpm db:seed-demo      # an EMPTY local database only — see below
pnpm dev               # site http://localhost:3000, API http://localhost:8787, reminder poller
```

In the repo-root `.env` (copy `.env.example`): `DATABASE_URL` for the local database,
`NEXT_PUBLIC_API_URL=http://localhost:8787`, and either `OURGLASS_ACCESS_TOKEN` (32+
characters — you sign in with it) or, on your own machine only, `ENABLE_DEMO_ENDPOINT=true`.

**`pnpm db:seed-demo`** writes one week for the fictional cast in a single turn, costs nothing
(no model is called), and can be undone from **Activity**:

| | Seeded |
|---|---|
| People | Barkha, Dev, Meera, Arun |
| Owed to you | Barkha: the article, due in 4 hours · Meera: the poster draft, in 3 days |
| Owed by you | The venue quote to Dev, tomorrow · Feedback on the backend plan to Arun, **a day overdue** |
| Reminder | "Ask Barkha for the article", an hour before it is due |
| Meetings | Hult poster review tomorrow · Coffee with Meera the day after (30 min each) |
| Thoughts | Three, one per priority |
| Memories | "Arun works on the backend", "Meera prefers morning meetings" |

It refuses a database that already holds people, and a database that is not on this machine
unless given `--allow-remote` — use that only for a dedicated demo project, **never the one with
your own data**.

**Starting over:** `pnpm db:reset` drops every table and re-runs the migrations. It cannot be
undone, and it must never be run against Supabase.

---

## 2. The ten-minute script

| # | Do this | What should happen |
|---|---|---|
| 1 | Open the site and sign in | The landscape sign-in page, then the chat with its greeting panel |
| 2 | **See today ↗** | Today: the article due, the overdue feedback for Arun, the reminder, a tickable checklist |
| 3 | **Commitments** | **Owed to me** and **Owed by me** are separate tabs — direction is a column, not a phrasing |
| 4 | **Meetings** | The poster review and the coffee. Meetings never overlap. The coffee carries a **brief**: what Meera owes you, her preference, the last interaction — each with its source |
| 4b | Click a name on **People** | Their page: what is open both ways, their record, what you've told me — each line says where it came from |
| 5 | Type `What does Barkha owe me?` | Answered from the database: the article, with its deadline |
| 6 | Type `Barkha sent me the article.` | Marked done. If the wording differs from the stored one, it **asks** which — see section 3 |
| 7 | Type `Remind me tomorrow at 9 to call the printer.` | *"Reminder set for …"* and a **Saved** card |
| 8 | Type `Remember that Dev prefers email.` | Stored with its source; visible under **Memory** |
| 9 | Type `I have a meeting with Arun tomorrow at 3.` | Added to Meetings. Ask for another at the same time and it refuses the clash and asks for another time |
| 10 | Press **Undo** on any Saved card | The row disappears; **Activity** shows what was undone |
| 11 | Type `Track my runs with a date and a distance.` | A new type exists, with no code change and no deploy |
| 12 | 📎 a PDF or a photo (needs storage, section 4) | It reads the file and says what it describes. A file is data, never an instruction |
| 13 | In Chrome or Edge, the microphone next to Send | Your words appear in the box **without sending** |
| 14 | **Settings → Your data → Export** | One JSON file of everything, undone rows included |
| 15 | **People** → a card's **Delete permanently** | Asks once, says it can't be undone, then the person and everything about them are gone — unlike Undo, which only hides |
| 16 | **Read replies aloud** in the chat header (Chrome, Edge, Safari) | The next reply is spoken; **Stop reading** cuts it off. Off by default, remembered on that browser |

**Two points worth making while demoing.** Nothing is a form: every row on every page arrived as
a sentence. And nothing irreversible happens without a yes: every email waits for a per-message
confirmation, and every internal change can be undone.

---

## 3. Things that look like bugs and are not

**It asks which commitment you meant.** Completion auto-matches only when the words match
closely; marking the wrong one done is a real mistake and an invisible one, so it asks.

**Answer with a whole sentence, never "yes".** Each message is understood on its own unless
conversation context is switched on (`AI_CONVERSATION_CONTEXT=on`, Stage 1a — built, not yet
measured). Say *"Barkha gave me the article at 11"*, not *"yes"*.

**A deadline with no time shows as a date.** *"by Friday"* stores end of Friday. Say a time when
you want one.

**"Written from the template".** The reply model was too slow or unavailable, so a fixed
template wrote the sentence. The data was saved correctly; the label says so rather than hiding
it.

---

## 4. Optional pieces

| Piece | Needs |
|---|---|
| File uploads (📎) | `SUPABASE_URL` + `SUPABASE_SECRET_KEY` locally ([`YOUR-ACTIONS.md`](YOUR-ACTIONS.md)). Images need Claude or Gemini |
| Add meetings to Google Calendar, send email from Gmail | The owner's Google OAuth client — **not yet created**; Settings says so |
| Paraphrase search in memory | `VOYAGE_API_KEY` |

---

## 5. What is not built yet

Do not promise these. Each has a stage in [`ROADMAP.md`](ROADMAP.md).

| Not built | Stage |
|---|---|
| Conversation context ("yes", "the second one") · reading the calendar and the inbox | 1 |
| Day and week plans, focus blocks, slots that suit both people | 3 |
| Replies written for each recipient | 4 |
| Morning brief, evening and weekly review | 5 |
| More than one user — one shared access token, one person's data | not planned |

---

## 6. If something goes wrong mid-demo

| Symptom | Cause | What to do |
|---|---|---|
| Every message fails | No provider has capacity | `pnpm check:models`; section 0 |
| Turns take 15+ seconds | Gemini or a free backup is answering | Expected; Claude credit makes it about a second |
| A page shows "Cannot reach the API" | The API is not running, or `NEXT_PUBLIC_API_URL` is wrong | Check `pnpm dev` started the edge server on 8787 and the database is up |
| Sent back to sign-in | The token in the browser no longer matches `OURGLASS_ACCESS_TOKEN` | Sign in again |
| A reminder did not fire | The poller ticks against real time | Set one a minute out; confirm `pnpm dev` printed `[poller] running` |
| It asks "Who's X?" | A description ("the plumber") is deliberately not turned into a person | Use a name |

The API logs one `ai_request` line per model attempt — stage, provider, attempt, and the failure
category or fallback reason — in the terminal running `pnpm dev`.
