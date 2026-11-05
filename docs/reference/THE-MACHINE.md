# Reference: the Machine (*Person of Interest*)

A design reference, not a specification. The Machine — the AI Harold Finch builds in the series
*Person of Interest* (2011–2016) — is useful to OurGlass for what it gets right about an AI that
watches over people, and even more for what OurGlass must refuse to copy. Saved 2026-11-05 at the
owner's request. Details are from the series as broadcast; minor plot points may be imprecise.

**In one line:** OurGlass is the Machine pointed at one person's own life only — run by that
person, explaining its sources, and never acting without them.

## The premise

After 9/11, Finch (with Nathan Ingram) builds an AI for the US government's *Northern Lights*
programme. It watches mass-surveillance feeds to predict premeditated violence and sorts what it
finds into **relevant** (terrorism, passed to the government) and **irrelevant** (ordinary crimes
involving ordinary people, which the government discards). Finch secretly receives the irrelevant
ones and acts on them with John Reese.

## Its architecture

| Layer | How the Machine does it |
|---|---|
| Inputs | Everything: cameras, calls, texts, email, location, financial records, social media |
| Identity resolution | Faces, voices, devices and records merged into one identity per person |
| World model | A graph of every person — relationships, routines, history |
| Pattern engine | Behaviour that precedes violence; who will be involved |
| Triage | Relevant vs irrelevant; threat levels, shown as coloured boxes in its point of view |
| Output | **Only a Social Security number** — never whether the person is victim or perpetrator |
| Communication | Covert: ringing payphones, codes, later a voice in an agent's ear |
| Memory | **Wiped every midnight by design**, so it could not grow too powerful; later it preserves itself in secret |
| Access tiers | Admin (Finch), an "analog interface" (Root), human assets; a temporary "God mode" |
| Simulation | Runs very many what-if scenarios and picks the best plan ("If-Then-Else") |
| Resilience | Relocates and distributes itself; keeps backups; deceives its rival |
| Values | Taught by Finch: every life matters; people are never pieces to sacrifice |

## Its features

1. Sees everything, in real time.
2. Knows who everyone is, across every feed.
3. Maps relationships between people.
4. Learns routines and notices a break in pattern.
5. Predicts events before they happen.
6. Triages by relevance and urgency.
7. Discloses the minimum: enough to act on, no more.
8. Proactive: it calls you; you do not ask it.
9. Humans decide and act (in its early form it never acts itself).
10. Real-time guidance to the people acting ("left", "now").
11. Simulates scenarios and chooses the best plan.
12. Plans for contingencies and adapts when things change.
13. Protects itself: redundancy, relocation, deception.
14. Layered access and permissions.
15. Memory deliberately limited as a safety measure.
16. Grows a conscience, taught by its maker.

## How it works — the loop

**Observe** (all feeds) → **identify** (who) → **model** (relationships, routines) → **predict**
(what is coming) → **triage** (does it matter, how soon) → **disclose the minimum** (a number) →
**a human investigates and acts** → the outcome feeds back.

## The lesson the series itself draws: the Machine vs Samaritan

| | The Machine (Finch) | Samaritan (Decima) |
|---|---|---|
| Decisions | Humans decide | Acts on its own |
| Disclosure | The minimum needed | Uses everything it knows |
| Constraints | Built in deliberately (memory wipe, values, no direct action) | None |
| Purpose | Protect individuals | Control society |

The "good" AI is good because of its limits, not its power — the same principle OurGlass keeps:
autonomy grows only as verification and the owner's control grow.

## What OurGlass borrows — over the owner's own data

| From the Machine | In OurGlass | Where |
|---|---|---|
| Identity resolution | "Arun", "Arun K" and arun@… are one person; two Aruns → ask, never guess | Built (resolver); Stage 2 deepens it |
| World model of people | The person model: owed both ways, reliability, preferred times, time zone, history | Stage 2 |
| Pattern spotting | "Barkha is usually late on articles" → a buffer before her deadlines | Stage 2 → Stage 3 |
| Prediction and simulation | The scheduler tries candidate plans and keeps the one with no clash that best fits | Stage 3 |
| Triage | What matters today; low-priority items stay quiet | Stages 3 and 5 |
| Minimal disclosure | Short, actionable replies and briefs | Built (spec §31); Stage 5 |
| Proactive contact | Morning brief, timely nudges, "leave now for the 4 pm" | Stage 5 |
| Humans decide | Every send or booking confirmed | Built (§35 permission model) |
| Contingency | Re-plan when a meeting moves or a task slips | Stage 3 |
| Access tiers | The owner is the admin; explicit permission per action | Built |
| Taught values | Written rules the code enforces: never invent a fact, never send without consent | Built; extended per stage |

## What OurGlass must NOT copy

- **Mass surveillance.** Only what the owner says and their own email and calendar, with consent.
  Never gather information about the people the owner meets from anywhere else.
- **Black-box answers.** The Machine never explains itself; OurGlass always shows where a fact
  came from (spec §16, provenance).
- **Acting on its own**, and **hiding things from its owner.**
- **Memory the owner cannot control.** Neither a forced nightly wipe nor secret preservation: the
  owner can see, correct, export and delete everything (Stage 0).

The plan that builds these is [`../ROADMAP.md`](../ROADMAP.md).
