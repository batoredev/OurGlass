# AI evals

How extraction quality is measured, what each lane costs, and — plainly — which lanes have
actually been run.

Related: [AI_PROVIDERS.md](AI_PROVIDERS.md), [AI_FALLBACK.md](AI_FALLBACK.md).

---

## Why this exists

Structured output guarantees **shape**, not **meaning**. A schema-valid extraction that says
Karthik owes you the deck when you owe Karthik the deck passes every type check, and it is the
worst failure this product can have. The eval harness is the only thing that measures meaning.

---

## The lanes — and what has been run

| Lane | Command | Cost | Needs | Runs in CI | **Has it been run?** |
|---|---|---|---|---|---|
| Fixture integrity & comparator | `pnpm test` (in `packages/evals`) | Free | Nothing | Every push to `main` and every PR | **Yes** — every CI run |
| Model ids exist | `pnpm check:models` | Free (`GET /v1/models`, no tokens) | `ANTHROPIC_API_KEY` | No | **Yes** — passed 2026-09-17 |
| Claude extraction, live | `pnpm --filter @ourglass/evals test:live` | **Paid** — one Sonnet call per fixture | `ANTHROPIC_API_KEY` | Manual dispatch only | **No. Never run.** |
| Provider comparison | `pnpm eval:ai` | **Paid** — one Interpret call per fixture, per configured provider | At least one provider configured | No | **No. Never run.** |

**No quality numbers exist for any provider.** Anything claiming an accuracy figure for this
system before one of the paid lanes has run is fabricated. Both paid lanes need the owner's
explicit approval each time — see `.claude/rules/wat.md`.

---

## The fixture set

`packages/evals/src/fixtures.ts` — **99 hand-labelled utterances**, using only the spec's
fictional cast (Barkha, Arun, Karthik, Hult, MTTN). The repository is public; never substitute
a real person.

Each fixture has:

| Field | Meaning |
|---|---|
| `id` | Stable, descriptive (`status-blocked`, `negative-commitment-is-not-a-memory`) |
| `utterance` | What the user types |
| `expected` | The `Extraction` a correct model produces |
| `forbids` | Optional. Fields the extraction must **not** contain |

### Labelling rules

- **Ownership direction is labelled on every commitment.** `owner` delivers, `recipient`
  receives. A reversal is the worst failure in the system, so both directions appear many times.
- **Time is the verbatim phrase**, never a timestamp. A test fails any fixture that encodes a
  resolved time.
- **Only label what the utterance supports.** An unlabelled field is unconstrained. Where the
  utterance is genuinely ambiguous, the fixture is `UNCERTAIN` — that is the assertion.
- **Negative fixtures use `forbids`.** `expected` can only say what *should* be present;
  `forbids` catches over-triggering, such as inventing a `memoryBody` for a plain commitment.
  Over-triggering is the failure that looks like the feature working.

### How an extraction is compared (`packages/evals/src/match.ts`)

- **Intent count must match exactly.** A missing intent and an invented one are both failures.
- **Order does not matter** — exact bipartite matching, not greedy first-fit.
- Per intent: `kind` and `inferenceLevel` exact; `owner` / `recipient` / `relatedEntity`
  compared **positionally** (a swap fails) by normalised name; text fields normalised
  (case, punctuation, whitespace); time by `kind` and normalised source phrase; plus every
  planner field (`newStatus`, `memoryBody`, `correctionTarget`, `condition`,
  `entityTypeDefinition`, `entityRecord`, `eventTitle`).
- Entity `kind` (person vs organization) is deliberately **not** compared: "Hult" is
  defensibly either at extraction time, and Resolve settles it against the database.

---

## `pnpm eval:ai` — the provider comparison

`packages/evals/src/provider-comparison.ai-eval.ts`, scoring in `provider-eval.ts`.

It builds each provider from the same environment variables the app uses, **skips** any
provider that is not configured (printing why), and **refuses to run** when none is — rather
than reporting zeros for providers it never called, because a zero reads as "measured and bad".
It then runs every fixture through each configured provider's Interpret stage and prints one
table.

Verified without cost: with every provider variable unset, it throws before making any call.

### Metrics

| Column | Definition |
|---|---|
| **WrongMut** | **Headline.** Fixtures with *wrong-mutation risk* (below) |
| Match | Full-match rate, over **all** fixtures |
| Intent | Intent-kind accuracy (sorted kinds equal), over **all** fixtures |
| Invented | Total forbidden fields produced |
| Unneeded? | Asked (`UNCERTAIN`) where the label is clear — the §27 over-asking failure |
| Missed? | Did not ask where the label is `UNCERTAIN` — the guessing failure |
| Failed | Calls that produced no extraction, out of all fixtures |
| Latency | Mean seconds per call, including failures |

### What "wrong mutation" means here — read before quoting the number

This lane runs **Interpret only**. It never runs Resolve or Mutate and never touches a
database, so it **cannot observe a real write**. The metric is *wrong-mutation risk at the
extraction level*: a fixture counts when the extraction

- produces any forbidden field, **or**
- does not match the label **and** contains an intent that would drive a write (`information`,
  `action`, `completion_update`, or `context` carrying a memory or correction).

A mismatched read-only answer (an `inspection` or `question`) is a miss, not a mutation risk.

Two scoring decisions, each pinned by a mutation-verified test in `provider-eval.test.ts`:

- **Rates are over all fixtures.** A provider that fails half the set cannot score as accurate
  on the half it answered.
- **A failed call is not a wrong mutation.** Failing writes nothing; counting it would reward a
  provider that answers wrongly over one that fails loudly. Failures are their own column.

### Running it

```sh
# Export the providers you want compared in the shell, then:
pnpm eval:ai
```

The paid lanes do not load `.env` themselves; export the variables first (or run through
`node --env-file`). Cost scales with **fixtures × configured providers**, and every call sends
the full extraction system prompt. Get owner approval first, run `pnpm check:models` first, and
record the result below with the date, commit and model ids — never a number from memory.

---

## `pnpm check:models`

`packages/evals/src/models.live.test.ts`. Asks the Anthropic API which models exist and
asserts the shipped Interpret and Respond ids are among them, and that they remain a Sonnet
and a Haiku. Free, and it loads `.env` from the repo root if present.

It exists because `RESPOND_MODEL` named a nonexistent model from Phase 3 until 2026-09-17,
invisibly — see [AI_PROVIDERS.md](AI_PROVIDERS.md). Verified both ways: it failed against the
old id and passes against the fix. Run it after changing either model constant, and before any
paid lane.

---

## CI

`.github/workflows/evals.yml`:

- **`fixtures`** — runs on every pull request. Free and deterministic.
- **`live`** — `workflow_dispatch` with `live=true` only. Never triggered by a pull request, so
  a fork cannot reach `ANTHROPIC_API_KEY`.

Both jobs build the workspace libraries first. Until 2026-09-17 they did not, and every PR run
of `fixtures` failed to resolve `@ourglass/shared` — unnoticed, because stages landed by direct
push to `main`, where this workflow does not trigger. The fix was confirmed by a manual
dispatch on a clean runner.

---

## Adding a fixture

1. Write the utterance with the fictional cast only.
2. Label only what the words support; mark real ambiguity `UNCERTAIN`.
3. If the likely mistake is a *neighbouring* field, add it to `forbids`.
4. Run `pnpm --filter @ourglass/evals test` — integrity tests reject a resolved timestamp, a
   duplicate id, a source phrase not drawn from the utterance, or a contract-invalid label.
5. When changing the comparator, break it on purpose and confirm a fixture fails. A comparator
   that ignores a field makes every fixture labelling that field decorative — this happened
   once already.

---

## Results

None recorded. No paid lane has been run.

| Date | Commit | Lane | Providers & models | Result |
|---|---|---|---|---|
| — | — | — | — | — |
