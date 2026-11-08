# Roadmap — the plan of record

Written 2026-11-05 from the owner's three references: the capability checklist (and the
categories chosen from it), the projected path for "what general assistants can't do", and the
Machine from *Person of Interest* ([`reference/THE-MACHINE.md`](reference/THE-MACHINE.md)).
It replaces the four earlier plans, kept in [`archive/`](archive/) as history. Status lines are
updated as each stage lands; a stage is done when its definition of done holds **and CI is green
on it**.

## The vision

General assistants (Claude, ChatGPT) already converse well. OurGlass does what they cannot: it
holds a **structured model of one person's life and of every person in it** — who owes whom
what, by when, how reliable each person is, when they prefer to meet — and uses it to
**plan that person's days around them and the people they meet**, and to **write each reply the
way that particular recipient should get it**.

The model is interchangeable (OurGlass already switches between Claude, Gemini, Groq, Cerebras,
OpenRouter and Qwen). The product is the data model, the person-level learning, and actions that
are reliable, logged and undoable.

## Principles (they bind every stage)

1. **Answer → remember → act with permission → anticipate.** Autonomy grows only as verification
   and the owner's control grow (the checklist's last line; the Machine's lesson).
2. **The model extracts; code decides and writes.** Plans, clash checks and writes are
   deterministic code over validated tool calls (spec §37). A model never edits the database.
3. **Never guess where a guess can do harm — ask** (spec §27). Two Aruns → a question.
4. **Every fact shows where it came from**, and the owner can correct, export or delete it.
5. **Only the owner's own data**, with consent. Never gather information about the people the
   owner meets from anywhere else.
6. **Nothing irreversible without a yes.** Every email is confirmed (DECISIONS: email power).
7. **Every AI feature ships with an eval set** and a stated cost per request
   (`.claude/rules/ai-systems.md`).
8. **Still not a productivity app, still not a life coach** (spec §2, §4): planning features
   propose; they never nag, gamify, or reorganise the owner's life unasked.

## Scope

| | Categories (from the checklist) |
|---|---|
| **In scope** | 1 Tasks · 2 Calendar · 3 Communication · 4 Voice & conversation · 5 Memory · 8 Workflow automation · 14 Files · 15 Contacts · 17 Notifications & proactive · 24 Security & privacy · 25 Personalization · 27 Integrations · 28 Context awareness |
| **Later ("potential")** | 20 Work & professional · 21 Meeting intelligence · 26 Autonomous agent |
| **Out of scope** | 6 Research · 7 Browser automation · 9 Finance · 10 Shopping · 11 Travel · 12 Health · 13 Learning · 16 Smart home · 18 Decision support · 19 Goals & habits · 22 Content creation · 23 Entertainment |

Integrations (27) are only those serving in-scope categories. General question-answering is left
to general assistants on purpose: keeping up with them is not the product.

## Where it stands (2026-11-05)

**Built and CI-verified:** conversation → structured state (commitments with direction, people,
projects, reminders, conditional rules); memory with provenance, correction and hybrid search;
dynamic trackers; inspection pages; multi-provider AI with a measured fallback chain; the §35
permission model; file uploads read as data, never instructions; voice dictation; alerting;
Meetings that never overlap, a tickable Today checklist, a Thoughts board; Google Calendar add
and Gmail send after a per-message confirmation; hosting on Supabase Edge Functions + Cloudflare
Pages (deployed by hand 2026-10-19); the landscape editorial look; `pnpm db:seed-demo`;
**Stage 0** — the Phase 6 security fixes, Row Level Security, export and permanent delete.

**Not verified:** answer quality on any hosted model (only local Qwen is measured,
[`AI_EVALS.md`](AI_EVALS.md)); the Google Calendar round trip and a real Gmail send (need the
owner's Google OAuth client); the deployed app since 2026-10-20.

## The stages, in build order

Stages that need no owner input are built first; the Google-dependent halves follow as soon as
the OAuth client exists. Each stage is its own pull request.

### Stage 0 — Safe to hold this data

*Why first: everything after it stores more about more people.*

**Status: built 2026-11-05** (on the branch of PR #26). The owner applies migration 017 to
Supabase ([`YOUR-ACTIONS.md`](YOUR-ACTIONS.md) item 4).

- The eight Phase 6 security-review findings and three test gaps
  ([`HANDOFF.md`](HANDOFF.md) → *Stage 0 detail*): linear scanners instead of quadratic regexes, extract
  before storing, no NUL or lone surrogate reaching Postgres, the file's own text quoted in the
  upload reply, a zip compression-ratio cap, a required `Content-Length`, `redirect: "error"` on
  storage calls, a PDF time budget; plus tests pinning the sandbox CSP, that stored bodies never
  reach a model, and extractor timing.
- **Row Level Security** enabled on every table (a forward migration, no policies — the app
  connects as the table owner).
- **Export** everything as JSON, and **permanent delete** (a purge distinct from undo, which
  invalidates): of one person and their facts, of one upload's bytes, and of all data.
- **Done when:** each fix has a test that fails without it; the migration is applied in CI;
  export/delete are integration-tested, including that a purge leaves no row and no stored
  object behind.

### Stage 1 — Remembers the conversation, then sees the calendar and the inbox

- **1a Conversation context** (category 4): the last few turns go to Interpret as context, so
  "yes", "the second one" and follow-ups work; temporary instructions ("for today…") are kept
  apart from lasting preferences. Stored message bodies stay out of every prompt except as
  quoted conversation, and the injection tests cover that path. **Built 2026-11-08, switched
  off** (`AI_CONVERSATION_CONTEXT=on` turns it on): the last four messages of the last 30 minutes
  are quoted, uploads never; any intent that does not quote the current message is dropped.
  An 8-case multi-turn eval set exists (`packages/evals/src/multi-turn.fixtures.ts`) and needs
  a paid run before it is switched on. Temporary instructions are not built yet.
- **1b Calendar reading** (2): busy times from Google Calendar (the `calendar.events` scope
  already granted), edit and cancel events, recurring events, more than one calendar.
- **1c Email reading** (3, 24; owner default 2026-11-05: read-only Gmail): summaries, threads,
  "needs a reply", suspicious-message flags. **Email text is data, never instructions** — the
  same boundary as uploads (a reading stage with a descriptive-only output).
- **1d Spoken replies** (4; opt-in): the browser reads replies aloud, can be stopped. **Built
  2026-11-08** (`apps/web/app/speech.ts`): off until turned on in the chat header, remembered on
  that browser, never reads an upload's reply.
- **1b and 1c built 2026-11-08, verified against recorded API responses only**
  (`apps/api/src/integrations/google-read.ts`): the day plan and meeting slots plan around
  Google Calendar's busy times (recurring events expanded; all-day, free and cancelled events
  are not busy; OurGlass's own synced events counted once). **Today → Inbox** shows who is
  waiting on your reply and what looks suspicious (a known name from a stranger's address, a
  reply-to on another domain, look-alike domains, an unknown sender pressing for urgency) —
  sender, subject and Gmail's snippet as quoted data, decided by code, never a model.
  **Not yet:** editing or cancelling Google events, more than one calendar, summaries by a model,
  thread-level "needs a reply".
- **Needs:** 1b–1c the owner's Google OAuth client and a re-consent for `gmail.readonly` (now
  in the consent request).
- **Done when:** a multi-turn eval set passes; calendar and email adapters are tested against
  recorded API responses and, once the client exists, live.

### Stage 2 — The person model and meeting briefs

*The Machine's identity resolution and world model, over the owner's own data only.*

**Status: built 2026-11-08** — a page per person (`/people/view?id=`): what is open both ways,
their on-time record and typical lateness, preferences, facts, patterns, groups, files and the
last interaction, every line with its source; and a brief on each meeting in the next 7 days
that names a known person. **Not yet:** important dates, per-person time zone and preferred
channel beyond a saved email, and searching document contents.

- A profile per person, **derived from what happened**, every field with its source: what they
  owe and are owed, an on-time record from completed commitments, typical lateness, preferred
  meeting times and channel, time zone, important dates, groups, last interaction.
- Editable and deletable on the person's page; nothing is inferred from outside data.
- **A brief before each meeting**: who, what is open between you, what was said last time.
- **Done when:** derivations are unit-tested on fixtures; a profile never shows a fact without a
  source; the brief appears for every meeting with a known person.

### Stage 3 — The personal scheduler

*The Machine's simulation and contingency, made deterministic.*

**Status: built 2026-11-08** — `apps/api/src/planning/scheduler.ts`. **Today → Your day,
planned**: your work placed around meetings (with a 10-minute buffer) most urgent first, a
next-best task with its reason, nudges for anyone overdue or due today with a late record, and
what does not fit. **Put it on my calendar** adds the blocks as events in one undoable turn,
re-checked against the calendar first; booked work is not planned twice. A person's page
**finds a time to meet** inside their stated time of day. Property-tested over 500 random days:
no double-booking, nothing outside working hours, every task accounted for. **Not yet:**
constraints stated in words, learned durations, recurring tasks, subtasks, a week view, and
the acceptance-rate eval.

- The model extracts constraints ("mornings are for writing", "Dev only after 3"); **code places
  work**: a day and week plan around fixed meetings and deadlines, focus blocks, estimated
  durations, recurring tasks and subtasks, a next-best-task suggestion with its reason,
  re-planning when something slips, and meeting slots that suit both people's known preferences.
- Buffers learned from the person model ("Barkha is usually a day late").
- Plans are **proposals**: accepting one writes through the tools, so it is logged and undoable.
- **Done when:** property tests prove no plan double-books or breaks a hard constraint; an eval
  set measures how often proposed plans are accepted unchanged.

### Stage 4 — Replies tailored to each person

**Status: the deterministic half built 2026-11-08** (`apps/api/src/replies/`): a drafted email
takes the greeting and sign-off you use with that person (or with everyone), learned by counting
your own sent emails and added only where the draft has none; a person's page suggests a
follow-up about what is open between you, in that style, to copy; and every send records how
many words you changed in the draft (migration 019) — the measure this stage is judged by.
**Not yet:** tone and wording adjusted by a model, invitations and letters, translation — they
need an eval set scored against drafts you approve, and paid runs.

- Drafts in the owner's voice, adjusted to the recipient — relationship, the tone of past
  exchanges, what is still open between them; follow-ups, invitations and letters; translation.
- Every send confirmed, as today.
- **Done when:** an eval set scores drafts against owner-approved examples; the edit distance
  before sending is recorded.

### Stage 5 — The proactive loop

*The Machine's proactive contact and minimal disclosure.*

**Status: built in the app 2026-11-08** (`apps/api/src/briefs/`) — every scheduled pass may
deliver one brief into the conversation: a **morning brief** (08:00–12:00 local: meetings with
who and what is open, the first thing to do, what is owed today, reminders; on Mondays last week
and who has gone quiet with something open) and an **evening review** (18:00–21:00: done today,
still open, tomorrow's meetings). Facts only, from stored rows, by template; once per day by a
unique index (migration 018), even when passes race; never sent late. **Not yet:** the email
digest (needs the owner's sender and quiet-hours decision), browser push, missed-notification
summaries, pending-reply nudges (need Stage 1c), priority rules.

- A morning brief (the plan, who you meet, what is owed), an evening review, a weekly review;
  missed-notification summaries, pending-reply and reconnect nudges, quiet hours and priority
  rules.
- **In the app first.** An email digest to the owner's own address comes second, behind a
  setting (owner default 2026-11-05: email digest first among outside channels; browser push
  later).
- **Done when:** briefs are generated from stored data by tested code (a model only phrases
  them, and its phrasing is checked against the facts like Respond's today); delivery is
  idempotent per day.

### Later (potential, not scheduled)

| Category | Precondition |
|---|---|
| 20 Work & professional (project plans, status reports, proposals) | Stages 2–4 stable |
| 21 Meeting intelligence (recording, transcripts, action items) | Consent design; Stage 2 |
| 26 Autonomous multi-step agent | Stage 3's proposal-and-accept loop proven; every step through the permission gate |

## Capability matrix

Status: ✅ built · **S0–S5** the stage that builds it · **L** later (needs an integration not yet
planned) · — not planned, with the reason.

### 1. Daily planning & tasks
| Capability | Status |
|---|---|
| Create, edit, complete, organise tasks (commitments, from conversation) | ✅ |
| Delete permanently | ✅ a person, a file, or everything (undo still only invalidates) |
| Subtasks / checklists | ✅ Today checklist · subtasks S3 |
| Deadlines · reminders | ✅ |
| Priorities | ✅ Thoughts board · commitments S3 |
| Recurring tasks | S3 (not yet) |
| Daily plan · re-planned on every visit | ✅ |
| Weekly / monthly plans | S3 (not yet) |
| Daily agenda | ✅ Today page · generated plan S3 |
| Track completion · identify overdue | ✅ |
| Focus blocks · next best task with its reason | ✅ |
| Estimated durations (fixed 30 min today) | S3 (not yet learned) |
| Detect conflicting commitments | ✅ meetings · tasks S3 |
| Convert messages into tasks | ✅ |
| Break large goals into smaller tasks | S3 (proposed, confirmed) |

### 2. Calendar & scheduling
| Capability | Status |
|---|---|
| Create events · refuse clashes · time zones (owner) | ✅ |
| Add to Google Calendar | ✅ (round trip unverified live) |
| Read busy times · recurring events (expanded) | ✅ built, verified against recorded responses |
| Edit / cancel Google events · multiple calendars | S1 (not yet) |
| Event reminders | S1 |
| Birthdays and important dates | S2 |
| Meeting briefs | ✅ for meetings in the next 7 days |
| Find slots that suit the other person · schedule tasks around meetings | ✅ |
| Reschedule clashes automatically | S3 (not yet) |
| Daily and weekly summaries | ✅ in the app |
| Travel time between appointments | L (needs a maps integration) |

### 3. Communication
| Capability | Status |
|---|---|
| Draft an email · send after a yes · remember addresses | ✅ |
| Read the inbox · needs a reply · suspicious flags | ✅ built, verified against recorded responses |
| Summaries · thread summaries | S1 (not yet — a model reading email needs the Read-stage boundary) |
| Communication history per person | S1 → S2 |
| Greeting and sign-off per recipient · suggested follow-ups · edit distance recorded | ✅ |
| Tone per recipient by a model · invitations, letters · translation | S4 (not yet) |
| Messaging apps · voice-message transcription | L |

### 4. Voice & conversation
| Capability | Status |
|---|---|
| Natural-language commands · questions about your own data · confirmations | ✅ |
| Voice input (dictation) | ✅ |
| Text, voice, images and files as input | ✅ |
| Conversational context · follow-ups | ✅ built, off until the multi-turn eval runs |
| Temporary vs lasting instructions | S1 |
| Spoken replies, stoppable | ✅ opt-in, the browser's own voice |
| Notifications read aloud | S5 |
| Hands-free use · multilingual conversation | L |
| General knowledge questions | — left to general assistants |

### 5. Memory & knowledge
| Capability | Status |
|---|---|
| Facts, preferences, commitments, notes, with provenance | ✅ |
| Natural-language search · corrections · inspection | ✅ |
| Export · permanent delete | ✅ |
| Summaries per person · patterns | ✅ the person page |
| Important dates · decisions · routines · saved instructions | S2 (not yet) |

### 8. Workflow automation
| Capability | Status |
|---|---|
| Rules in plain language ("if Barkha hasn't sent it by 5, remind me") | ✅ |
| Scheduled jobs · failure alerts · safe retries · action log · approval gates | ✅ |
| Extract data from documents | ✅ |
| Sync between apps (calendar two-way) | S1 |
| Generated reports (briefs, reviews) · suggested automations | S5 |
| Organise, rename, convert files | L (needs Drive) |
| Automating the owner's computer | — connected apps only (owner default 2026-11-05) |

### 14. Files & documents
| Capability | Status |
|---|---|
| Upload and read PDF, Word, Excel, text, images · duplicates detected · metadata | ✅ |
| Access control on stored files | ✅ sandboxed download · Row Level Security |
| Search document contents (lexical, no model) | S2 |
| Draft reports | S5 |
| Drive search, folders, versions, templates, spreadsheets, presentations, archive, OCR of scans | L |

### 15. Contacts & relationships
| Capability | Status |
|---|---|
| Contact records · relationship notes · promised follow-ups | ✅ |
| Context before meetings · last interaction · groups (from what you said) | ✅ |
| Important dates · full interaction history | S2 (not yet) |
| Invitations | S4 |
| Reconnect (quiet with something open, in the weekly review) | ✅ |
| Follow-up timing | S5 (not yet) |

### 17. Notifications & proactive help
| Capability | Status |
|---|---|
| Reminders on time · overdue and upcoming in the chat | ✅ |
| Meeting changes | S1 → S5 |
| Morning brief · evening review · weekly review (Mondays) · quiet hours | ✅ in the app |
| Email digest · browser push · missed summaries · priority rules · pending replies | S5 (not yet) |
| Travel disruptions | — travel is out of scope |

### 24. Security, privacy & digital safety
| Capability | Status |
|---|---|
| Approval for sensitive actions · audit log · permissions explained | ✅ |
| Delete personal data (a person, a file, everything) · export | ✅ |
| Retention preferences · privacy settings · sensitive memories kept out of prompts | S2 |
| Suspicious email flags | ✅ by code, from headers |
| Account security alerts · emergency access | L |
| Software updates · password managers · exposed-data searches | — outside the product (and the last would mean looking people up) |

### 25. Personalisation
| Capability | Status |
|---|---|
| Ask when unsure · remember corrections | ✅ |
| Context across sessions · temporary vs lasting instructions | S1 |
| Review learned preferences | ✅ person page · reset by correcting in conversation or deleting |
| Scheduling patterns · personalised priorities · learn accepted suggestions · explain a suggestion | S3 |
| Response style per recipient | ✅ greeting and sign-off · tone S4 (not yet) |
| Notification frequency · repeated manual work → suggested automation | S5 |
| Adapting to knowledge level | L |

### 27. Integrations (in-scope only)
| Integration | Status |
|---|---|
| Email (Gmail) | ✅ send · ✅ read (recorded responses; live needs the OAuth client) |
| Calendar (Google) | ✅ add · ✅ busy times (recorded responses; live needs the OAuth client) |
| Outgoing webhooks (alerts) | ✅ |
| Cloud storage (Drive), notes, task managers, office apps, messaging, maps, incoming webhooks | L |
| Project management, CRM | later, with category 20 |
| Banking, travel, fitness, smart home, browsers, developer tools | — their categories are out of scope |

### 28. Context awareness
| Capability | Status |
|---|---|
| Provenance · facts vs inferences (CONFIRMED / INFERRED / UNCERTAIN) · when human judgement is needed | ✅ |
| Current task context | S1 |
| Combining sources · contradictions in stored facts · work vs personal contexts | S2 |
| Dependencies · next steps · completion estimates · predicted clashes · contingency plans · learning from feedback | S3 |
| Recurring bottlenecks | S5 |

## Owner inputs, by stage

| Stage | Needs from the owner |
|---|---|
| 0 | Apply migration 017 (Row Level Security) to Supabase — no code depends on it |
| 1 | The Google OAuth client; re-consent for `gmail.readonly`; approval for the paid multi-turn eval run (8 calls per provider), then switching `AI_CONVERSATION_CONTEXT` on |
| 2–3 | Nothing beyond review |
| 4–5 | Migration 018 applied; a decision on the email digest's sender and quiet hours |
| Any | Branch protection on `main`; deploy credentials ([`YOUR-ACTIONS.md`](YOUR-ACTIONS.md)) |
