# Phase 4 design — Understanding over time

Semantic memory, hybrid retrieval, memory provenance and correction (§16, §17), conflict
detection (§24), proactive behaviour with a relevance gate (§26), and inspection queries
(§28).

**Importers: none.** Read by contributors and by the Phase 4 build team before it spawns.
Companion to `PHASE-1-DESIGN.md`, `PHASE-2-DESIGN.md` and `PHASE-3-DESIGN.md`.

**Demo:** *"Schedule Arun at 5 tomorrow"* surfaces the Hult conflict and **asks rather than
choosing**.

---

## 0. Findings — plan claims the code does not support

Written first, and deliberately, because this check has produced a finding in every phase so
far (F1–F6, `DECISIONS.md`). The rule that catches them: **verify a prerequisite by finding
the CODE PATH, not the schema object.**

### F7 — `object_embedding` exists and nothing has ever written to it

`commitments.object_embedding vector(1024)` has existed since migration 003. Verified against
the code: the only three references in the repo are `commitments.ts`'s row type and two
comments in `resolve.ts` saying *"Phase 4 replaces this with embeddings"*. **No code computes
an embedding, and no client is installed.**

So "the column exists" must not be read as "vectors work". Phase 4 builds the entire path:
provider client → embed-on-write → index → query.

### F8 — no embedding provider was ever chosen, and `vector(1024)` was a guess

The dimension is not a free parameter — it is fixed by the model — and it was committed in
migration 003 before any provider was selected. **Verified from primary sources this phase:**

- Anthropic ships **no embeddings API** and names **Voyage AI** as its recommended provider
  (`platform.claude.com/docs/en/build-with-claude/embeddings`).
- Every current Voyage model — `voyage-4`, `voyage-4-lite`, `voyage-3.5`, `voyage-3.5-lite`,
  `voyage-3-large` — defaults to **1024 dimensions**, and supports 256/512/1024/2048 via
  Matryoshka truncation.

**`vector(1024)` is therefore correct — by luck, not by derivation.** Recorded plainly so
nobody re-derives it as though it were reasoned: had the guess been 1536 (the OpenAI default
that "1024-ish" intuitions usually land on), this phase would have opened with an
`ALTER TABLE` on a populated table.

### F9 — no `relationships` repository, so §15/§16/§17 have no code path

Migration 004 creates `relationships` with `inference_level`, `source_message_id`, bitemporal
columns, both traversal indexes, and a `relationships_current` view — and its own comment
describes §17 correction. **`packages/db/src/repositories/` contains no `relationships.ts`.**
Nothing reads or writes the table. §15's graph, §16's provenance and §17's correction are all
schema-only today.

### F10 — `memories` does not exist at all

Cut from Phase 1 deliberately (migration 003's comment: *"This is not the `memories` table,
which stays cut until Phase 4"*). This one is **honest and expected** — listed so the build
team does not go looking for it.

### F11 — §28's own examples are not semantic search

*"What am I waiting on?"*, *"What does Barkha owe me?"*, *"What do I owe Hult?"*, *"Show me
everything pending for Batore"* — **every §28 example in the spec is a structured-state query
over `commitments`**, answerable by SQL with a `WHERE` clause. None of them needs an embedding.

This matters because "inspection queries" sitting in a phase titled *semantic memory* invites
building them on the retrieval layer. That would be slower, non-deterministic, and wrong: the
answer to "what does Barkha owe me" is a **fact**, and a vector search can miss a row that a
`WHERE owner_id = $1` would return. See §5.

---

## 1. The embedding provider

**Decision: Voyage AI, `voyage-3.5`, 1024 dimensions.**

| Choice | Value | Why |
|---|---|---|
| Provider | Voyage AI | Anthropic's own recommended provider; no Anthropic embeddings API exists |
| Model | `voyage-3.5` | General-purpose, 32K context. Not `-lite` (quality matters more than latency on a per-message path); not `voyage-4-large` (120K token/request cap and higher cost for no measured gain here) |
| Dimension | **1024** | The model default AND what migration 003 already declares. Changing either now costs an `ALTER TABLE`. |
| Distance | cosine (`<=>`) | Voyage embeddings are normalised; cosine is the documented default |

> **Rejected: a local embedding model (`Xenova/all-MiniLM`, `bge-*` via ONNX).** No API key, no
> per-message cost, no network hop — genuinely attractive for a per-message path. Rejected on
> dimension: MiniLM is 384-dim and BGE-base is 768, so either forces the `ALTER TABLE` that
> F8's lucky guess avoided, on the one column already in the schema. Also adds a ~90MB model
> artifact to CI. Revisit if per-message embedding cost is measured and proves material.
>
> **Rejected: OpenAI `text-embedding-3-*`.** 1536 native (truncatable to 1024 via
> `dimensions`), so it would work — but it adds a second vendor and a second key to a product
> whose only other model calls are Anthropic, for no capability Voyage lacks.

### 1.1 `input_type` is asymmetric and getting it wrong is silent

Voyage's `input_type` prepends a different instruction per value:

- `"document"` → *"Represent the document for retrieval: "* — use when **storing**.
- `"query"` → *"Represent the query for retrieving supporting documents: "* — use when **searching**.

**Using one for both is a silent quality regression.** Nothing errors, nothing fails a
typecheck, and recall degrades by an amount no test in this repo would notice. So the client
API makes it impossible to omit:

```ts
// NOT `embed(text, opts?)` with a defaulted input_type. Two named functions, because
// a default here is a footgun: the wrong one still returns 1024 valid-looking floats.
export function embedDocument(texts: readonly string[]): Promise<number[][]>;
export function embedQuery(text: string): Promise<number[]>;
```

### 1.2 Cost, stated up front

`.claude/rules/ai-systems.md`: *"Cost per request is a design constraint."* Spec §22 means
every message triggers extraction, and Phase 4 adds an embedding call to the write path.

| Path | Calls per turn | Notes |
|---|---|---|
| Interpret (Sonnet) | 1 | Phase 2 |
| Respond (Haiku) | 1 | Phase 3 |
| **Embed on write** | **0 or 1** | Only when a commitment or memory is actually created. A question turn embeds nothing on the write path. |
| **Embed on query** | **0 or 1** | Only when a retrieval actually runs — §5's structured queries embed nothing. |

Batched: `embedDocument` takes an array (Voyage allows 1,000 per request), so a multi-intent
turn creating two commitments is **one** call, not two.

---

## 2. `memories` (migration 010)

```sql
CREATE TYPE memory_kind AS ENUM (
  'fact',        -- "Arun handles Batore backend"
  'preference',  -- "I prefer morning meetings"
  'pattern'      -- "You've postponed this three times" — OBSERVED, never inferred motive
);

CREATE TABLE memories (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              memory_kind NOT NULL,
  body              text NOT NULL,          -- raw content field (§3), stored verbatim
  embedding         vector(1024),           -- NULL until embedded; see §2.2
  -- Provenance (§16). "Fact: Arun handles Batore backend. Source: Conversation from
  -- September 7 2026. Confidence: Confirmed." Every field of that sentence is a column.
  source_message_id uuid REFERENCES messages(id),
  inference_level   inference_level NOT NULL,
  -- Optional subject, so "what do you know about Arun" (§28) is an indexed lookup rather
  -- than a similarity search over everything.
  subject_kind      text,
  subject_id        uuid,
  CONSTRAINT memories_subject_kind_known
    CHECK (subject_kind IS NULL OR subject_kind IN ('person','organization','project'))
);
SELECT add_bitemporal_columns('memories');

CREATE VIEW memories_current AS SELECT * FROM memories WHERE t_invalid IS NULL;

CREATE INDEX memories_subject_idx ON memories(subject_kind, subject_id)
  WHERE t_invalid IS NULL;
```

**`memory_kind` has exactly three values and `pattern` is the load-bearing one.** Spec §13 is
explicit: *"avoid amateur psychological profiling… Do not make unsupported claims like 'You
procrastinate because you fear failure.' Instead use observable facts: 'You've postponed this
three times.'"* A `pattern` memory must be **countable from rows**. There is deliberately no
`trait` or `insight` kind — a closed enum is the enforcement.

### 2.1 The HNSW index, and why `iterative_scan` is mandatory

```sql
CREATE INDEX memories_embedding_idx ON memories
  USING hnsw (embedding vector_cosine_ops)
  WHERE t_invalid IS NULL;
```

> ⚠️ **`hnsw.iterative_scan` must be set, and this is not a tuning nicety.**
>
> Verified from pgvector's own README: *"With approximate indexes, filtering is applied
> **after** the index is scanned. If a condition matches 10% of rows, with HNSW and the
> default `hnsw.ef_search` of 40, **only 4 rows will match on average**."*
>
> **Every retrieval in this product is filtered** — by subject, by validity, by owner. So the
> default configuration silently returns almost nothing, and it returns it *successfully*: no
> error, no empty-result signal distinguishable from "there is genuinely nothing". That is the
> same shape as the concurrency bug in Phase 3 — a plausible-looking empty read.
>
> Set `hnsw.iterative_scan = 'relaxed_order'` per connection, and **assert it in an
> integration test with enough rows for the filter to bite** (a 3-row fixture cannot
> reproduce this; the test needs ~200 rows with a 10%-selective filter).

`relaxed_order` over `strict_order`: relaxed gives better recall and the ordering slack is
irrelevant here, because results are re-ranked by the hybrid scorer in §3 anyway.

### 2.2 `embedding` is nullable, and the write path must not require it

The embedding call is a **network hop to a third party on the write path**. If it is required,
Voyage being down means the user cannot record a commitment — an availability failure in the
core product caused by an optional enhancement.

**Decision: write the row first, embed second, tolerate NULL.** A memory with a NULL embedding
is invisible to semantic search and fully visible to structured queries — degraded, not lost.
`.claude/rules/ai-systems.md`'s *"degrade honestly"*.

> **Rejected: embedding inside the tool's transaction.** It would make embedding atomic with
> the write, which sounds right. It holds a Postgres transaction open across an external HTTP
> call — the classic way to exhaust a connection pool when a vendor gets slow. A backfill for
> NULL embeddings is the correct shape, and is trivial because `embedding IS NULL` is exactly
> the query.

---

## 3. Hybrid retrieval (HNSW + BM25)

`EXECUTION-PLAN.md` specifies hybrid, not pure vector. Postgres supplies both halves:
`tsvector`/`ts_rank_cd` for lexical, pgvector for semantic.

```sql
ALTER TABLE memories ADD COLUMN body_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', body)) STORED;
CREATE INDEX memories_tsv_idx ON memories USING gin (body_tsv) WHERE t_invalid IS NULL;
```

**A generated column, not a trigger.** It cannot drift from `body`, and there is no trigger to
forget when a second write path appears.

### 3.1 Fusion: Reciprocal Rank Fusion, not score addition

```
score(d) = Σ  1 / (k + rank_i(d))        k = 60
```

**Why RRF rather than a weighted sum of the two scores:** cosine distance and `ts_rank_cd` are
on incomparable scales — cosine is bounded [0,2], `ts_rank_cd` is unbounded and
corpus-dependent. Any weighted sum needs a normalisation constant that is really a tuning
parameter nobody will ever re-tune, and it silently shifts as the corpus grows. RRF uses only
**ranks**, so it is scale-free by construction.

`k = 60` is the value from the original RRF paper and the common default. Recorded as a
**tunable with a stated default**, not a constant of nature.

> **Rejected: pure vector search.** §28's *"Forget that Arun works on backend"* and
> *"That's not Karthik from Hult"* are lexically specific — exact names matter, and embeddings
> are notoriously weak on rare proper nouns. Lexical search is what catches those.
>
> **Rejected: a dedicated search service (Elastic, Typesense).** A second datastore for one
> BM25 index, against `DECISIONS.md` #7's transactional argument.

---

## 4. §16 and §17 — provenance and correction

### 4.1 The `relationships` repository (resolving F9)

The table has existed since migration 004 with the right columns. Phase 4 writes the code:

```ts
createRelationship(tx, { subjectId, relType, objectKind, objectId, inferenceLevel, sourceMessageId })
listBySubject(tx, subjectId)                 // "what does Arun work on"
listByObject(tx, objectKind, objectId)       // "who works on backend"
supersedeRelationship(tx, oldId, newValidFrom)  // §17 — see below
invalidateRelationship(tx, id, at?)
```

### 4.2 Correction is a supersede, never a delete

Spec §17: *"Arun handles the backend."* → *"No, Karthik handles it now."*

**The old edge's `t_invalid` is set to the new edge's `t_valid`.** Two rows, one current.
History preserved; the timeline has no gap and no overlap. Migration 004's own comment already
specifies this — Phase 4 implements it.

```
t_invalid(old) := t_valid(new)     -- NOT now(), and NOT NULL-then-delete
```

**Why `t_valid(new)` and not `now()`:** they differ whenever the correction describes a change
that happened earlier ("Karthik took over *last month*"). Using `now()` would claim Arun held
the role until the moment the user mentioned it, which is a fact the system invented.

> **Rejected: `UPDATE relationships SET object_id = <karthik>`.** One row, current state
> correct, and it **destroys the history §17 explicitly requires preserving** — with no way to
> answer "who handled backend in September?" It is also the wrong-merge failure mode
> `DECISIONS.md` #9 names as the worst in this system, applied to the relationship graph.

### 4.3 `forget_memory` — §28's "Forget that Arun works on backend"

A tool, `invertibility: 'full'`, inverse = revalidate. **Invalidate, never delete**, for the
same reason as everywhere else: "forget" is a statement about what is *currently true*, not a
demand to destroy the audit trail. The row leaves `*_current`; `action_log` can undo it.

---

## 5. §28 inspection queries — structured, NOT semantic (resolving F11)

**Every §28 example is a structured-state query.** They are answered by SQL over
`commitments`, with **no embedding call**:

| Utterance | Query |
|---|---|
| "What am I waiting on?" | `owner_id != self AND status pending` |
| "What does Barkha owe me?" | `owner_id = barkha AND recipient_id = self` |
| "What do I owe Hult?" | `owner_id = self AND recipient_id ∈ hult` |
| "Show me everything pending for Batore" | `project_id = batore AND status pending` |
| "What do you know about Arun?" | `memories WHERE subject_id = arun` + `relationships` by subject — **indexed lookup, not similarity** |

**This is the phase's most important scoping decision, so it is stated as a rule:** semantic
retrieval is for *"find me things like this"*; structured queries are for *"what is true"*. A
vector search can **miss** a row that a `WHERE` clause returns, and for "what does Barkha owe
me" a miss is a commitment silently disappearing from the one surface the user relies on to
catch mistakes. Never answer a §28 question with an approximate index.

New intent kind: **`inspection`**, distinct from Phase 3's `question` (which declined
honestly). The orchestrator routes it to a **read-only** query planner — no `executeTurn`, no
`turn_id`, nothing in `action_log`.

---

## 6. §24 conflict detection — and the demo sentence

*"Schedule Arun at 5 tomorrow"* with an existing 5 PM Hult meeting →
*"5 PM tomorrow conflicts with your Hult meeting. Should I move the call or keep both?"*

**Detection is deterministic SQL, not a model judgement.** An overlap is an interval
comparison; asking a model whether two timestamps overlap is the "different result each run"
case `.claude/rules/wat.md` §1 says belongs in a script.

```sql
-- Phase 4 scope: TIME OVERLAP on events only. Not "impossible deadlines" (needs an
-- effort model that does not exist), not "contradictory commitments" (needs semantic
-- equivalence — that is duplicate detection, §23, already built in Phase 2).
SELECT * FROM events_current
 WHERE tstzrange(starts_at, ends_at, '[)') && tstzrange($1, $2, '[)')
```

§24 lists six conflict types. **Phase 4 implements one — time overlap — and declines the rest
honestly.** Shipping a shallow version of "contradictory people information" would produce
false conflicts, and a false conflict is worse than no conflict: it trains the user to dismiss
the surface entirely.

**The behavioural requirement is stronger than the detection.** Spec §24: *"Do not
automatically choose."* The conflict path **must not resolve**; it asks, and the reply names
both sides. That is an eval assertion, not a style note.

---

## 7. §26 proactive behaviour — the relevance gate

Spec §26's own good/bad list is the acceptance criterion:

| | |
|---|---|
| ✅ Good | "Barkha's article is five hours overdue and you haven't marked it as received." |
| ✅ Good | "You have a 5 PM meeting with Hult and you're trying to schedule Arun at the same time." |
| ❌ Bad | "You have 17 tasks! Here's how to optimize your day!" |
| ❌ Bad | "You should study now." |
| ❌ Bad | "Would you like me to create a plan?" after every statement. |

**The distinguishing property, stated precisely:** every *good* example is a **specific,
checkable fact about a specific entity, surfaced at the moment it became relevant**. Every
*bad* one is either a summary statistic, unsolicited advice (§4), or an offer with no trigger.

So the gate is structural rather than a prompt instruction:

1. **A proactive line must cite a specific row** — a commitment id, an event id. No row, no
   line. This alone eliminates "you have 17 tasks".
2. **It must have a trigger condition that just became true** — crossed overdue, a conflict on
   the sentence being processed. Not "is still true", which fires every turn.
3. **At most one per turn**, and never when the turn already asks a question. Two asks in one
   reply is the confirmation fatigue §27 forbids.
4. **Never advice.** §4 negative evals are test failures, not style notes.

> **Rejected: a "should I mention this?" model call.** Non-deterministic, unmeasurable, and it
> puts the §4 boundary inside a prompt where nothing enforces it. Rules 1–3 are checkable in
> code and testable without a model.

---

## 8. Build order

| # | Task | Blocks |
|---|---|---|
| 1 | Voyage client, `embedDocument`/`embedQuery`, keyless-skip test lane (**F7, F8**) | 2, 3 |
| 2 | Migration 010: `memories`, HNSW + `iterative_scan`, `body_tsv` + GIN (**F10**) | 3, 4 |
| 3 | Hybrid retrieval + RRF, with the ~200-row filtered-recall test | 6, 7 |
| 4 | `relationships` repository + supersede (**F9**, §16/§17) | 5 |
| 5 | `remember`, `forget_memory`, `correct_relationship` tools | 6 |
| 6 | `inspection` intent + structured query planner (**F11**, §28) | — |
| 7 | §24 time-overlap detection, wired to ask not choose | demo |
| 8 | §26 relevance gate + its negative evals | demo |

### Definition of done

Beyond `pnpm typecheck && lint && test` and the integration lane:

- **The filtered-recall test exists and would fail without `iterative_scan`.** Verified by
  mutation — unset it and the test must go red. Otherwise the phase's central retrieval
  correctness claim is untested.
- **§4/§26 negative evals**: the bad examples are asserted as *failures*.
- **Demo:** *"Schedule Arun at 5 tomorrow"* surfaces the Hult conflict and **asks**.

**Standing caveat, now in its third phase:** `pnpm test:live` has still never run. Phase 4 adds
a *third* model dependency (Voyage), and unlike Sonnet and Haiku its failure mode is silent —
a wrong `input_type` or a degraded model returns 1024 plausible floats and worse recall, with
nothing to fail. **Retrieval quality is unmeasured until an eval lane measures it.**

---

## 9. File-ownership map

| Role | Owns (glob) |
|---|---|
| `database-data-engineer` | `packages/db/**` — migration 010, `memories`, `relationships`, retrieval SQL |
| `ai-agent-engineer` | `apps/api/src/assistant/**`, `apps/api/src/embeddings/**` |
| `backend-lead` | `apps/api/src/tools/**`, `apps/api/src/server.ts` |
| `staff-code-reviewer` | read-only, no write tools |

No browser owner — no UI in this phase (UI is Phase 5).
