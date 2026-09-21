# Demo guide

A scripted walkthrough of OurGlass: what to type, what should happen, and what is
deliberately not built yet. Read section 0 before demoing to anyone — it covers the one
thing that can make the whole demo fail, and it is not the code.

---

## 0. Before you start — the model provider

**The assistant cannot understand a single message without a working model provider.** If
none is available, every turn answers *"I couldn't process that just now — nothing was
saved"*, which is honest but is not a demo.

Check it in ten seconds:

```sh
pnpm check:models
```

That sends one real request per configured model and fails loudly if a model is missing,
unavailable, or out of quota. It is free.

| Provider | What goes wrong | Fix |
|---|---|---|
| **Claude** (primary) | Account out of credit — the API answers `400 … credit balance is too low` | Add credit. This is the most reliable option: Sonnet reads the message, Haiku writes the reply, and both answer in about a second |
| **Gemini** (fallback) | Free tier has per-minute *and* per-day quotas. Past them: `429 … exceeded your current quota` | Wait for the daily reset, or move the key to a paid tier |
| **Qwen** (local, optional) | Not installed by default | `ollama pull qwen3:8b`, set `OLLAMA_BASE_URL` — free and quota-free, but slow on CPU |

**Recommendation for a live demo: have Claude credit available.** Gemini alone works, but
its free tier throttles under exactly the kind of burst a demo produces, and a 503 from
Google looks like a broken product.

Full detail: [`AI_PROVIDERS.md`](AI_PROVIDERS.md).

---

## 1. Start it

```sh
pnpm install
pnpm db:migrate        # once, or after pulling schema changes
pnpm dev               # http://localhost:3000
```

`pnpm dev` builds the shared libraries, starts the app on port 3000, and starts the reminder
poller. Give it about fifteen seconds.

**Starting from a clean slate.** A demo database carrying earlier experiments looks
confusing — old failures and half-finished sentences are the first thing a visitor reads.
To wipe everything and start empty:

```sh
pnpm db:reset          # DESTRUCTIVE: drops every table, re-runs all migrations
```

That deletes all people, commitments, memories, and conversation history. There is no undo
for it — this is the one operation in the product that is not reversible.

---

## 2. The five-minute script

Type these in the chat, one at a time. Wait for each reply: a turn takes roughly one second
on Claude, five to fifteen on Gemini.

| # | Type this | What should happen |
|---|---|---|
| 1 | `Barkha needs to give me the article by 6 PM tomorrow.` | Reply: *"Noted: Barkha owes you the article, due Tue 6:00 PM"* (wording varies — the reply is written by a model). A **Saved** card appears listing `Create person` and `Create commitment` |
| 2 | Open **People** | Barkha is there. Nobody created her: she was learned from the sentence |
| 3 | Open **Commitments** | The article, marked **OWES YOU**, due Tuesday 6:00 PM |
| 4 | `Remind me at 5 PM tomorrow to ask her about it.` | *"Reminder set for Tue 5:00 PM."* |
| 5 | `Remember that Barkha prefers morning meetings.` | *"Noted: Barkha prefers morning meetings."* → visible under **Memories** |
| 6 | `What does Barkha owe me?` | It answers from the database, not from the conversation: the article, with its deadline |
| 7 | `Barkha gave me the article at 11.` | It **asks** which commitment — see "Why it asks" below |
| 8 | Back in **Chat**, press **Undo** on any Saved card | The card empties and the row disappears from Commitments |
| 9 | `Track my gym sessions with a date and a duration.` | *"Tracking Gym Sessions now, with 2 fields."* A new type exists, with no code change and no deploy |

### Two things worth pointing out while demoing

**Direction is structural.** "Barkha owes you" and "you owe Barkha" are different columns in
the database, not different phrasings. The Commitments page has separate **Owed to me** and
**Owed by me** tabs for that reason.

**Nothing is a form.** No task was created, no category chosen, no date picked. Every row on
every page arrived as a sentence.

---

## 3. Things that look like bugs and are not

**It asks which commitment you completed (step 7).** Completion only auto-matches when the
words match closely. *"give me the article"* against *"the article"* scores 0.850 against a
0.92 threshold, so it asks. Marking the wrong commitment complete is both a real mistake and
an invisible one, so the product asks instead of guessing. Answer by repeating the sentence
with the stored wording.

**Answer questions with a whole sentence, never "yes".** Every message is understood on its
own — the model is never shown the conversation so far. "Yes" carries no meaning by itself.
Say *"Barkha gave me the article at 11"* rather than *"yes"*. This is a real limitation, not
a preference: multi-turn context is not built.

**A deadline with no time shows as a date.** *"by Friday"* stores end of Friday and displays
*"Fri, 25 Sept"* with no clock time, because you never said one. *"by 6 PM Friday"* shows the
time. Say the time when you want one — *"by 6 tomorrow"* is ambiguous enough that the
resolver treats it as the day.

**Some replies carry "Written from the template".** The reply model was too slow or
unavailable, so the deterministic fallback wrote the sentence instead. The data was still
saved correctly — only the prose is canned. It is labelled rather than hidden.

**"I couldn't process that just now — nothing was saved."** No provider answered. Nothing was
written, so retyping is safe. See section 0.

---

## 4. What is not built

Do not promise these in a demo.

| Not built | Detail |
|---|---|
| **Multi-turn conversation** | Each message is interpreted alone. No "yes", no "that one", no pronouns pointing at earlier turns |
| **Documents and images** | Phase 6. No screenshots, PDFs, or attachments |
| **Gmail / Calendar / Drive** | Phase 7. The assistant declines external actions honestly rather than pretending |
| **Voice** | Phase 8 |
| **More than one user** | There is no tenant boundary and no per-user login — one shared access token, one person's data. Do not put a second organisation's data in it |
| **Detail pages** | People, projects, and memories have list pages; individual detail pages are not built |

---

## 5. If something goes wrong mid-demo

| Symptom | Cause | What to do |
|---|---|---|
| Every message fails | No provider has capacity | `pnpm check:models`; see section 0 |
| Turns take 15+ seconds | Gemini is answering, Claude is not | Expected. Claude credit makes it about a second |
| A page shows "Cannot reach the API" | The app was started without a database | Check `DATABASE_URL`, then `pnpm db:migrate` |
| A reminder did not fire | The poller ticks every 30 seconds against real time | Set one a minute out and wait; confirm `pnpm dev` printed `[poller] running` |
| It asks "Who's X?" | The name did not look like a name — a description ("the plumber") is deliberately not turned into a person | Use a name |

To see which provider answered and why one failed, the app logs one line per attempt:

```sh
grep ai_request scratchpad/dev.log | tail -5
```

Each line names the stage, the provider, the attempt, and the failure category or fallback
reason — a timeout, a refusal and an exhausted quota are distinguishable.
