# Phase 1 design — structured state + validated tool layer

Output of Mission 1 (four-lens plan review): `arch` (this document), `ceo` (scope),
`design` (representability), `dx` (developer experience). Verdict: **APPROVE WITH CHANGES**.

This is the document the Mission 4 build team starts from. It is a design contract, not a
tutorial: it states what to build and *why the alternative was rejected*, because the
rejections are the expensive part to rediscover.

**Read first:** `docs/DECISIONS.md` (locked decisions — do not re-litigate),
`docs/EXECUTION-PLAN.md` (full plan), `.claude/rules/agent-teams.md` (file ownership).

---

## 1. Scope

Phase 1 builds schema + a typed tool layer. **No LLM.** Tools are driven by tests.

### In scope

- Nine tables with bitemporal columns: `commitments`, `people`, `organizations`, `projects`,
  `events`, `reminders`, `relationships`, `messages`, `action_log`.
- `users` (single row in Phase 1 — needed for `timezone`).
- Typed tool registry: validate → commit-in-transaction → append-to-`action_log` → undo.
- `entity_types` + `entity_type_fields` + `entity_records`, with **runtime-loaded schema
  validation** proven by one dynamic tool. Not the Phase 5 subsystem.
- `pnpm db:migrate` / `pnpm db:reset`.

### Explicitly deferred

| Table | Phase | Why |
|---|---|---|
| `workflows` | 3 | Shape depends on the flattened-conditional design (`DECISIONS.md` #2), still open until extraction exists |
| `memories` | 4 | Embeddings, HNSW, hybrid retrieval — no consumer until then |
| `documents` | 6 | No ingestion until then |
| `permissions` | 7 | No external actions until then |

Bitemporal consistency across the deferred tables is a **shared-helper** problem, not a
pre-create-the-tables problem. See §2.1.

**Also cut:** seed/fixture harness. Tool tests create their own rows *through the tools under
test* — that is the demo. Seeding behind the tool layer proves less, not more.

### Carve-in, and its provenance

`entity_types` is in Phase 1 only because the registry must structurally support a tool whose
validation schema is **loaded from the database at runtime**. Retrofitting that in Phase 5
touches every tool. See §4.1.

> **Provenance warning.** Dynamic entity types appear **nowhere** in the 38-section spec —
> verified by grep of `docs/SPEC.md` and `docs/SPEC-raw.txt`, zero hits, re-run independently
> by two reviewers. §14 lists a closed set of core entities. The requirement's only source is
> `DECISIONS.md:16` ("User's explicit requirement"). It is an **owner addition beyond the
> spec**, escalated for user confirmation. If withdrawn, drop three tables and one tool — the
> validate-is-a-function property (§4.1) stays regardless, because it is a better registry
> design independent of dynamic entities.

---

## 2. Schema

Postgres 17 + pgvector 0.8.6. Migration `001` runs `CREATE EXTENSION IF NOT EXISTS vector;`
before anything else.

### 2.1 Bitemporal columns — on every table

Four timestamps, per `DECISIONS.md` #5 (borrow Graphiti/Zep's design, skip the dependency):

| Column | Meaning |
|---|---|
| `t_valid` | when the fact became true **in the world** |
| `t_invalid` | when it stopped being true in the world (`NULL` = still true) |
| `t_created` | when we recorded it |
| `t_expired` | when we superseded the record (`NULL` = current) |

**Invalidate, never delete.** `DELETE` appears in no tool implementation. This is what makes
memory correction (§17) and undo work.

Applied via a shared helper so Phase 3/4/6 tables get identical columns:

```sql
-- migrations/001_extensions_and_helpers.sql
CREATE OR REPLACE FUNCTION add_bitemporal_columns(tbl regclass) RETURNS void AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s
    ADD COLUMN t_valid   timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN t_invalid timestamptz,
    ADD COLUMN t_created timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN t_expired timestamptz', tbl);
END; $$ LANGUAGE plpgsql;
```

**Every instant column in this schema is `timestamptz`. Never a naive `timestamp`.**

### 2.2 `users`

```sql
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  timezone     text NOT NULL DEFAULT 'Asia/Kolkata'  -- IANA name
);
```

`timezone` resolves `DECISIONS.md` open question 3 **without deferring it**. chrono-node's
signature is `(text, instant, timezone)` (`DECISIONS.md` #4) — Phase 2 must read a timezone
from somewhere, and reading it from a defaulted column costs exactly what reading a constant
costs. Single-timezone in behaviour, multi-timezone in schema. "Multi-timezone" later becomes
a behaviour change rather than a migration over user data.

### 2.3 `people` — and the merge model

```sql
CREATE TABLE people (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    text NOT NULL,
  organization_id uuid REFERENCES organizations(id),
  merged_into_id  uuid REFERENCES people(id),   -- set by merge_person; loser points at winner
  notes           text
);
SELECT add_bitemporal_columns('people');
CREATE INDEX people_merged_into_idx ON people(merged_into_id) WHERE merged_into_id IS NOT NULL;

-- READ SHAPE 1 — LIST/ENUMERATE. Merged-away people are absent. Filters; does not resolve.
CREATE VIEW people_current AS
  SELECT * FROM people WHERE t_invalid IS NULL;

-- READ SHAPE 2 — DEREFERENCE BY ID. Follows merged_into_id to the survivor.
-- Never returns zero rows for a UUID that ever existed.
CREATE FUNCTION resolve_person(start_id uuid) RETURNS people AS $$
DECLARE
  cur people;
  hops integer := 0;
BEGIN
  SELECT * INTO cur FROM people WHERE id = start_id;
  WHILE cur.merged_into_id IS NOT NULL LOOP
    hops := hops + 1;
    IF hops > 16 THEN                                  -- cycle guard, see below
      RAISE EXCEPTION 'merge cycle or chain too deep from person %', start_id;
    END IF;
    SELECT * INTO cur FROM people WHERE id = cur.merged_into_id;
  END LOOP;
  RETURN cur;
END; $$ LANGUAGE plpgsql STABLE;
```

`merged_into_id` is a **new column not previously in the plan** — grep of `docs/` for
`merged_into|tombstone` returns nothing; `merge_person` appears only inside a parenthetical
list of example tool names at `EXECUTION-PLAN.md:46`. It is required, and `t_invalid` alone is
**not sufficient**: `t_invalid` records that A stopped being valid, not that *A became B*.
Without the forwarding pointer every existing FK reference to A dangles rather than resolving,
and undo has nothing to reverse against.

**`merge_person` is purely non-destructive.** It sets the loser's `t_invalid` and
`merged_into_id`. It repoints **no** foreign keys and rewrites **no** JSONB.

#### Two read shapes — they are different operations and must not share one name

Because merge repoints nothing, a stored UUID may name a person who has since been merged
away. There are therefore **two** distinct reads, and using the wrong one is a silent bug:

| Shape | Question | Mechanism | Merged person |
|---|---|---|---|
| **List / enumerate** | "show me the people" | `people_current` view | **Absent** — correct; the People list must show one row after a merge |
| **Dereference by id** | "who is this UUID" | `resolve_person(uuid)` | **Followed** to the survivor; never zero rows |

`people_current` **filters; it does not resolve.** A dereference written against it returns
zero rows for a merged UUID and renders a blank cell — which is exactly the dangling-reference
outcome the forwarding pointer exists to prevent.

The case that makes this concrete is Phase 5's `person_ref`: a JSONB payload holds the loser's
UUID (correctly — merge rewrites no JSONB), and the renderer must dereference it. It **must**
use `resolve_person`, never `people_current`. Same for any FK dereference on
`commitments.owner_id` / `recipient_id`.

Resolution is **transitive** with a cycle guard. A merged into B, then B merged into C, leaves
a `person_ref` still holding A that must reach C — a single hop returns B, who is themselves
merged away. The depth cap exists because `invertibility = 'full'` means merges can be undone
and redone, which is precisely how a cycle gets created by accident. Failing loudly on a cycle
beats looping.

> **Phase 1 ships `resolve_person` and a test; nothing calls it until Phase 5.** It is
> specified here rather than deferred because the next person greps `person_ref`, finds the
> enum and no read path, and writes the naive lookup. It renders blank only for merged people
> — the rarest path and the last one anyone tests.
>
> **Because it has no caller for four phases, its test is the only thing keeping it correct.**
> A function with no caller is exactly what gets quietly dropped as dead code, and if the test
> is weakened or skipped the failure surfaces in Phase 5 as blank names in a UI — four phases
> downstream of the change that caused it, the longest feedback loop in the plan. The test
> must carry a comment saying so.

Why this matters more than it looks: the obvious implementation
(`UPDATE commitments SET owner_id = winner`) is **lossy** — its inverse requires enumerating
every row touched. The non-destructive version's inverse is two column resets, so
`merge_person` is honestly `invertibility = 'full'`. Given `DECISIONS.md` #6 and #9 (*a wrong
merge silently destroys a commitment; a wrong merge is worse than a wrong split*), undo on
merge is the highest-stakes reversal in the system. It must be cheap and exact — and
`DECISIONS.md` #6 already commits to merges being correctable by the user saying "those are
the same thing", which a destroyed row would contradict.

> **Repository discipline — the residual risk.** Every read goes through `people_current`
> (list) or `resolve_person` (dereference) — never the raw table, and never the wrong one of
> the two. Raw `people` access lives in exactly one file
> (`packages/db/src/repositories/people.ts`) which owns merge and nothing else. Two regression
> tests assert the invariants: (1) create two people, merge, assert every *list* path returns
> exactly one; (2) merge A→B then B→C, assert `resolve_person(A)` returns C, and assert a
> cycle raises rather than hangs. A literal Postgres `REVOKE` was
> considered and rejected — the migration runner and tool layer share one role, and splitting
> roles is real infra for one invariant. This mitigation is weaker than `REVOKE`; if a person
> ever appears twice in Phase 5, the answer is the second role and we will have earned the
> evidence.

`organizations` and `projects` follow the same shape (`id`, `name`, bitemporal,
`merged_into_id`) — **and that includes the read path, not only the columns.** Each gets its
own `*_current` view and its own resolver (`resolve_organization`, `resolve_project`), with the
same transitive walk and depth cap. `merged_into_id` without a resolver is the same defect one
table over: an implementer dereferencing `commitments.project_id` reaches for whatever exists,
and what exists is the filtering view.

The project/organization case is *smaller* than the person case for a structural reason worth
stating, since it affects how hard to press on it: `project_id` is a real FK, so a merged
project cannot dangle into nothing, whereas a Phase 5 `person_ref` is an unconstrained JSONB
value. Smaller, not absent.

> **Implementation note.** Three near-identical plpgsql functions is the wrong shape. Write one
> `resolve_merged(tbl regclass, start_id uuid) RETURNS uuid` doing the capped walk, and let the
> three named resolvers be thin wrappers over it. One place to get the cycle guard right.

### 2.4 `commitments` — the primary abstraction

Spec §6: the primary abstraction is **COMMITMENT**, not Task.

```sql
CREATE TYPE commitment_status AS ENUM (
  'pending','in_progress','waiting','waiting_on_someone',
  'completed','completed_late','cancelled','blocked','superseded'
);

CREATE TABLE commitments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES people(id),   -- who is expected to do it
  recipient_id     uuid REFERENCES people(id),            -- for whom
  object_text      text NOT NULL,                         -- "the article" — raw, never resolved
  object_embedding vector(1024),                          -- NULL until Phase 2/4. No index yet.
  expected_at      timestamptz,
  completed_at     timestamptz,
  status           commitment_status NOT NULL DEFAULT 'pending',
  project_id       uuid REFERENCES projects(id),
  CONSTRAINT owner_is_not_recipient CHECK (owner_id <> recipient_id)
);
SELECT add_bitemporal_columns('commitments');
CREATE INDEX commitments_owner_idx     ON commitments(owner_id)     WHERE t_invalid IS NULL;
CREATE INDEX commitments_recipient_idx ON commitments(recipient_id) WHERE t_invalid IS NULL;
CREATE INDEX commitments_expected_idx  ON commitments(expected_at)  WHERE t_invalid IS NULL;
```

**Ownership direction is two explicit FK columns.** Spec §7 calls this "one of the major
differentiating features". It is structural and never inferred at read time. "I owe Barkha the
article" and "Barkha owes me the article" differ only in which column holds which id — that is
the whole point, and it is why `owner_id`/`recipient_id` must never be collapsed into a single
`person_id` + `direction` flag.

`object_embedding` ships **NULLable with no index**. Rationale: adding a pgvector column to a
populated table later means an index build under load. One line now; stays `NULL` until Phase
2/4. This is not the `memories` table, which remains cut.

**`due_soon` and `overdue` are NOT stored.** They are pure functions of
`(expected_at, now())`. Storing them would mean a scheduled job writing status changes — and
if those writes land in `action_log`, "undo that" can reverse a clock tick; if they don't,
`action_log` is no longer complete history and the Activity surface (§29) shows changes with
no actor. Both branches are wrong. Spec §8 says a commitment "can move through" these states;
it does not require them to be columns.

```sql
CREATE VIEW commitments_current AS
  SELECT c.*,
    CASE
      WHEN c.status <> 'pending' THEN c.status::text
      WHEN c.expected_at IS NULL THEN 'pending'
      WHEN c.expected_at < now() THEN 'overdue'
      WHEN c.expected_at < now() + interval '2 hours' THEN 'due_soon'
      ELSE 'pending'
    END AS display_status
  FROM commitments c WHERE c.t_invalid IS NULL;
```

> The **2-hour threshold is a placeholder, not a decision.** Product judgement, owned by
> design/ceo. Recorded reasoning: the spec's own narrative ("due by 6, remind me at 5")
> implies the user's sense of "soon" is set by the reminder they chose, not a global constant.
> Eventually `due_soon` should key off the commitment's own reminder. Not a Phase 1 change.

Side benefit: this removes one of the two `pg_cron` uses. See §6.

### 2.5 `relationships`

Spec §15/§16/§17. Carries `inference_level` per `DECISIONS.md` #1 — an **enum, not a float**.
Anthropic structured outputs support no `minimum`/`maximum`, so spec §37's `confidence: 0.97`
is not schema-enforceable; spec §12's own enum is the better design and is already in the spec.

```sql
CREATE TYPE inference_level AS ENUM ('CONFIRMED','INFERRED','UNCERTAIN');

CREATE TABLE relationships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id        uuid NOT NULL REFERENCES people(id),
  rel_type          text NOT NULL,                  -- 'works_on', 'handles', 'works_with'
  object_kind       text NOT NULL,                  -- 'person'|'organization'|'project'
  object_id         uuid NOT NULL,
  inference_level   inference_level NOT NULL,
  source_message_id uuid REFERENCES messages(id)    -- provenance, §16
);
SELECT add_bitemporal_columns('relationships');
```

Correction (§17) sets the old edge's `t_invalid` to the new edge's `t_valid` and **keeps the
row**. "Arun handles backend" → "No, Karthik handles it now" produces two rows, one current.
History preserved; contradictions do not accumulate forever.

### 2.6 `reminders`, `events`, `messages`

```sql
CREATE TABLE reminders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id uuid REFERENCES commitments(id),
  body          text NOT NULL,
  fire_at       timestamptz,          -- NULL for relational/event-trigger tiers
  fired_at      timestamptz,          -- NULL = not yet fired
  source_phrase text                  -- verbatim "next Friday" — see below
);
SELECT add_bitemporal_columns('reminders');
CREATE INDEX reminders_pending_idx ON reminders(fire_at)
  WHERE fired_at IS NULL AND t_invalid IS NULL;
```

`source_phrase` exists because of `DECISIONS.md` #4: **the LLM must not compute timestamps.**
It extracts the verbatim phrase; `chrono-node` resolves it deterministically. Keeping the
phrase makes resolution auditable and re-runnable. The three-tier split (`DECISIONS.md` #3) is
Phase 2 — Phase 1 only needs `fire_at` nullable so tiers 2/3 have somewhere to live.

`events` and `messages` are conventional (`messages` stores conversation turns and is the
provenance target for `relationships.source_message_id`).

### 2.7 `action_log` — the undo substrate

This table is why Phase 1 exists. Every mutation, its inverse, grouped by conversational turn.

```sql
CREATE TYPE actor_kind    AS ENUM ('user_turn','system_derived','scheduled_job','undo');
CREATE TYPE invertibility AS ENUM ('full','lossy','none');

CREATE TABLE action_log (
  id             bigserial PRIMARY KEY,
  turn_id        uuid NOT NULL,           -- one per orchestrator turn
  seq            integer NOT NULL,        -- order within the turn
  tool_name      text NOT NULL,
  actor_kind     actor_kind NOT NULL,
  invertibility  invertibility NOT NULL,
  target_table   text NOT NULL,
  target_id      uuid,
  forward_patch  jsonb NOT NULL,          -- what was applied
  inverse_patch  jsonb NOT NULL,          -- how to reverse it
  undoes_turn_id uuid,                    -- set when this entry IS an undo
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (turn_id, seq)
);
CREATE INDEX action_log_turn_idx ON action_log(turn_id);
CREATE UNIQUE INDEX action_log_undo_once_idx ON action_log(undoes_turn_id)
  WHERE undoes_turn_id IS NOT NULL;
```

**The grain is a conversational turn, not a row mutation.** Spec §22 (every message may modify
state) plus `DECISIONS.md` #8 (one utterance emits multiple parallel tool calls) plus the
Phase 2 demo utterance — *"Barkha needs to give me the article by 6. Remind me at 5 to ask
her."* — means one utterance produces a commitment **and** a reminder. When the user says
"undo that", "that" is the turn. Without `turn_id`, undo either reverses half the turn or
Phase 3 infers grouping by timestamp proximity, which is a heuristic over user data that will
be wrong at the worst moment.

Four properties, all enforced:

1. **Undo is transactional at turn grain.** All inverses for a `turn_id` apply in ONE
   transaction, in **descending `seq`** (a commitment must not be reversed before the reminder
   referencing it — FK ordering). Any failure rolls the whole undo back and the assistant says
   so. A half-undone turn is the worst state this product can present: the user's mental model
   and the DB diverge silently, while §28 promises they can always inspect and correct.
2. **Undo is append-only.** It writes NEW rows with `undoes_turn_id` set. Original rows are
   never mutated or deleted — consistent with invalidate-never-delete, and a deleted log row
   means the Activity surface lies about history. Redo becomes possible for free.
3. **Double-undo is impossible.** The partial unique index on `undoes_turn_id` makes it a
   database constraint, not a check-then-act race. Second attempt gets "that's already undone".
   This is a real user path — people say "undo that" twice when the first reply was ambiguous.
4. **Undo traverses only `actor_kind = 'user_turn'`.** Scheduled writes (Phase 3 reminder
   firing sets `fired_at`) belong in history but must never be undoable — the user cannot
   "undo" a clock tick. `actor_kind` also gives the Activity surface its honest "you did this"
   vs "this happened" distinction, and excludes undo entries from the normal undo path for free.

`invertibility` is `'full'` for every Phase 1 tool. `'none'` arrives in Phase 6/7 where an
action has genuinely no inverse (an email is sent). It exists now so the schema can say so
later without a migration.

### 2.8 Dynamic entity registry

Three tables. **`entity_types` stores a closed discriminator, never arbitrary JSON Schema.**

Raw JSON Schema is open-ended (`allOf`/`oneOf`/`$ref`/`pattern`) and a generic renderer cannot
render an open set — it grows a special case per construct, which *is* the "no frontend code
change" violation. `EXECUTION-PLAN.md:157`'s phrase "JSON-schema field definitions" is
superseded here: JSON Schema is what we **generate** from the registry to hand the model as a
tool input schema; it is not what we **store**.

```sql
CREATE TYPE field_kind AS ENUM ('text','number','bool','date','enum','person_ref');

CREATE TABLE entity_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key        text NOT NULL UNIQUE,        -- snake_case, e.g. 'gym_session'
  display_name    text NOT NULL,
  current_version integer NOT NULL DEFAULT 1
);
SELECT add_bitemporal_columns('entity_types');

CREATE TABLE entity_type_fields (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type_id uuid NOT NULL REFERENCES entity_types(id) ON DELETE CASCADE,
  field_key      text NOT NULL,               -- snake_case; the JSONB key
  field_kind     field_kind NOT NULL,
  label          text NOT NULL,               -- human text: "Duration (minutes)"
  required       boolean NOT NULL DEFAULT false,
  ordinal        integer NOT NULL,            -- stable display order
  enum_options   jsonb,                       -- [{value,label}] iff field_kind='enum'
  UNIQUE (entity_type_id, field_key),
  CONSTRAINT enum_options_present
    CHECK (field_kind <> 'enum' OR enum_options IS NOT NULL)
);
CREATE UNIQUE INDEX entity_type_fields_ordinal_idx
  ON entity_type_fields(entity_type_id, ordinal) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE entity_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type_id uuid NOT NULL REFERENCES entity_types(id),
  schema_version integer NOT NULL,
  payload        jsonb NOT NULL
);
SELECT add_bitemporal_columns('entity_records');
```

Why each non-obvious piece:

- **Normalised field table, not a JSONB blob** — this is what makes the closed `field_kind`
  enum enforceable *by Postgres* rather than by convention.
- **`ordinal`** — JSONB has no key order. Without a stored ordinal there is no deterministic
  render order, so Phase 5 sorts arbitrarily or hardcodes per type. Shape is forced to an
  integer; there is no Phase 5 design that arrives anywhere else.
- **Deferrable unique on `ordinal`** — reordering fields swaps two ordinals inside one
  transaction; a non-deferrable constraint rejects the intermediate state. Users reorder fields.
- **`schema_version` from row zero** — if `entity_records` lacks it and Phase 5 needs it, that
  is a migration over live user data. One integer now.

#### Schema evolution contract — `add_entity_field` must be non-breaking

`add_entity_field` is an ordinary tool the user invokes **by talking, mid-conversation**. If
validation were strict-against-current-schema, every pre-existing record would become invalid
the instant a field is added. That is the default you get if nobody decides otherwise, and it
is wrong. Decided:

- **Absent keys are legal** and render as an em-dash. No backfill, no guessed default.
- Validation rejects **only** keys not in the schema, and values of the wrong kind for keys
  that *are* present.
- `add_entity_field` may add **optional** fields only. Adding a *required* field to a
  populated type is **rejected** — it would make existing rows retroactively invalid.
- Validation runs against the type's `current_version`.

**Caps** (`EXECUTION-PLAN.md:161` says "capped" without a number; these are the numbers):
**32 fields per type, 64 types.** Phase 5 needs a fixture *at* the cap to verify the renderer
degrades sanely, so the value belongs in the plan rather than in an implementer's head.
Reserved `type_key`s cannot shadow the nine core tables. All enforced in `validate`.

**Deferred to Phase 5, deliberately:** `icon`, `label_field_key`, `list_field_keys`, and
anything else "display config" resolves to. Those have no determined shape because the renderer
that consumes them does not exist. Free columns are only free when you know what the columns
are. They land with their consumer, on a table that will still have near-zero rows.

#### The guarantee, stated precisely

> **A new ENTITY TYPE requires zero frontend code changes. Always. Unconditionally.**
> **A new FIELD KIND requires a frontend code change, and always will.**
>
> The LLM can invent entity **types** freely; it cannot invent field **kinds**.

This is not a softened absolute — it is a correctly-scoped one. The unbounded axis (types,
user-invented, unlimited) is genuinely unbounded. The bounded axis (six kinds,
engineering-owned) is genuinely bounded. `"track my gym sessions with a date and a duration"`
is `date` + `number`, both known: zero code, no deploy.

**What converts this from hopeful to enforced is a Phase 1 deliverable:**
`define_entity_type` **rejects an unknown field kind at validation time**, returning a clean
`ToolError` (`unsupported field kind 'geo_point'; supported: text, number, bool, date, enum,
person_ref`) rather than storing it and failing at render time in Phase 5. Do not let this slip.

---

## 3. The input contract

**Every tool input that references an entity takes a resolved UUID. No tool accepts a
natural-language person/project/organization name. Resolution is exclusively the Phase 2
Resolve stage's job.**

**This rule governs entity REFERENCES, not content fields.** `object_text` ("the article"),
`body`, and `title` remain raw strings — they are values, not references. State this precisely
or an implementer will try to resolve `object_text` into something.

### The edge case: a person who does not exist yet

`create_commitment` naming an unknown person **FAILS**. It does not create the person.

Resolve emits a sequence in one transaction: `create_person` → `create_commitment(owner_id:
<new uuid>)`, both stamped with the same `turn_id`, so undo reverses the pair.

Why not auto-create: the inverse becomes ambiguous. If undoing the commitment also deletes the
person, you can cascade-delete someone who acquired other commitments meanwhile; if it does
not, undo leaves garbage. Neither is acceptable, and the ambiguity is unresolvable at the tool
layer. Resolve *already* decides "new person or existing one" — that is the three-band
entity-resolution policy with hard vetoes (`DECISIONS.md` #6). It cannot delegate that to a
tool without destroying the veto logic.

Cost: nothing in Phase 2 beyond what it already does. Phase 2 **calls** this interface; it does
not rework it.

---

## 4. The tool registry

Lives in `apps/api/src/tools/`. No LLM in Phase 1 — tests are the caller.

### 4.1 A tool definition

```ts
export interface ToolContext {
  readonly tx: DatabaseTransaction;   // the open transaction; tools never open their own
  readonly turnId: string;
  readonly seq: number;
  readonly actorKind: ActorKind;
}

export interface ToolError {
  readonly field?: string;
  readonly code: string;              // 'unknown_person' | 'unsupported_field_kind' | ...
  readonly message: string;           // user-facing, no SQL, no stack
}

export interface LoggedMutation {
  readonly targetTable: string;
  readonly targetId: string | null;
  readonly forwardPatch: unknown;
  readonly inversePatch: unknown;
  readonly invertibility: Invertibility;
}

export interface ToolDefinition<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  /**
   * Validation is a FUNCTION, not a static schema object.
   * Static tools close over a Zod schema. Dynamic tools query entity_types
   * inside validate and build the check at call time. Same interface.
   */
  validate(raw: unknown, ctx: ToolContext): Promise<Result<TInput, ToolError[]>>;
  commit(input: TInput, ctx: ToolContext): Promise<{
    output: TOutput;
    mutations: readonly LoggedMutation[];
  }>;
}
```

**The load-bearing design choice is that `validate` is a function.** If the registry instead
declared tools as `{ name, schema: ZodType }` and the executor called `schema.parse()` itself,
then `define_entity_type` — whose valid inputs depend on rows in `entity_types` — cannot be
expressed, and Phase 5 becomes a registry refactor touching every tool. As a function, a
dynamic tool simply queries the DB inside its own `validate`. No special-casing, no branch in
the executor.

This property is worth keeping **even if dynamic entity types are withdrawn** — it is the
better registry design independently.

### 4.2 validate → commit → log → undo, end to end

```ts
async function executeTurn(calls: ToolCall[], deps: Deps): Promise<TurnResult> {
  const turnId = randomUUID();
  return deps.db.transaction(async (tx) => {          // ONE transaction for the whole turn
    const results = [];
    for (const [i, call] of calls.entries()) {
      const tool = registry.get(call.name);
      if (!tool) throw new ToolNotFound(call.name);
      const ctx = { tx, turnId, seq: i, actorKind: 'user_turn' as const };

      const validated = await tool.validate(call.input, ctx);   // 1. VALIDATE
      if (!validated.ok) return rollbackWith(validated.errors); //    reject before any write

      const { output, mutations } = await tool.commit(validated.value, ctx);   // 2. COMMIT
      for (const m of mutations) await appendActionLog(tx, ctx, tool.name, m); // 3. LOG
      results.push(output);
    }
    return { turnId, results };
  });
}

async function undoTurn(turnId: string, deps: Deps): Promise<UndoResult> {
  return deps.db.transaction(async (tx) => {          // ONE transaction — all or nothing
    const entries = await tx.query(
      `SELECT * FROM action_log
        WHERE turn_id = $1 AND actor_kind = 'user_turn'
        ORDER BY seq DESC`, [turnId]);                // 4. UNDO, descending seq

    if (entries.some(e => e.invertibility === 'none')) throw new NotInvertible(turnId);
    for (const e of entries) await applyInverse(tx, e);
    // append-only; the partial unique index makes double-undo a DB constraint
    await appendUndoEntries(tx, turnId, entries);
    return { undone: entries.length };
  });
}
```

Invariants an implementer must not relax:

- Validation completes **before** any write. A failed validation writes nothing.
- One transaction per turn; one transaction per undo. No partial application, ever.
- Tools never open their own transaction — they receive `ctx.tx`.
- Tools never `DELETE`. Invalidate via `t_invalid`.
- Every mutation returns its inverse. A tool that cannot produce one declares
  `invertibility: 'none'` rather than logging a wrong inverse.

### 4.3 First tool to implement: `create_commitment`

It proves the entire pattern and nothing else does: it exercises both FK directions (spec §7's
differentiator), the resolved-ID contract including the unknown-person rejection, the
transaction, the `action_log` round-trip, and undo.

Ship it with these tests (real Postgres, not mocks):

```ts
describe('create_commitment', () => {
  it('stores ownership direction structurally', async () => {
    // "Barkha needs to give me the article by 6"
    const r = await executeTurn([{ name: 'create_commitment', input: {
      owner_id: barkha.id, recipient_id: user.id,
      object_text: 'the article', expected_at: '2026-09-07T18:00:00+05:30',
    }}], deps);
    const c = await getCommitment(r.results[0].id);
    expect(c.owner_id).toBe(barkha.id);      // NOT inferred at read time
    expect(c.recipient_id).toBe(user.id);
    expect(c.status).toBe('pending');
  });

  it('rejects an unresolved person and writes nothing', async () => {
    const r = await executeTurn([{ name: 'create_commitment', input: {
      owner_id: randomUUID(), object_text: 'x' } }], deps);
    expect(r.ok).toBe(false);
    expect(await countRows('commitments')).toBe(0);   // no partial write
    expect(await countRows('action_log')).toBe(0);
  });

  it('undoes a whole turn, not one row', async () => {
    // the Phase 2 demo utterance: one turn -> commitment + reminder
    const r = await executeTurn([
      { name: 'create_commitment', input: {} },
      { name: 'create_reminder',   input: {} },
    ], deps);
    await undoTurn(r.turnId, deps);
    expect(await countCurrent('commitments')).toBe(0);
    expect(await countCurrent('reminders')).toBe(0);   // BOTH, or the test is meaningless
  });

  it('refuses to undo the same turn twice', async () => {
    const r = await executeTurn([], deps);
    await undoTurn(r.turnId, deps);
    await expect(undoTurn(r.turnId, deps)).rejects.toThrow(/already undone/);
  });
});
```

> **Phase 1's green tests are NOT evidence the tool layer is correct under model input.**
> Tests are harsher than the model on *malformed* input and **weaker on plausible-but-wrong**
> input — a test suite covers the failure modes its author imagined, while the model produces
> right-shape/wrong-owner-direction calls no adversarial payload test catches. That gap is
> Phase 2's eval harness (`packages/evals/`). Nobody in Phase 2 may skip eval work believing
> Phase 1 covered it.

---

## 5. Migrations and developer experience

**Decision: `node-pg-migrate` running plain numbered SQL files.** Record in `DECISIONS.md`.

Verified against the registry, not recalled: `node-pg-migrate@9.0.0`, MIT, dependencies
`glob`/`jiti`/`yargs` only, peer range `pg >=4.3.0 <9.0.0` — compatible with the `pg ^8.13.0`
already in `packages/db`, and it adds **no second Postgres driver**.

Justified against CLAUDE.md's *"no new framework without a concrete requirement"*: the concrete
requirement is that `EXECUTION-PLAN.md:240` already assigns `migrations/**` an owner while
naming no tool — so the alternative is an implementer improvising one on day one, and every
later phase inherits that idiom. This plan commits to hand-written SQL exactly where the
product is unusual (bitemporal columns, HNSW with `hnsw.iterative_scan`, JSONB validated
against a runtime registry, the deferrable unique above). A schema-first generator inverts
control precisely there. This is a **migration-runner** choice, not an ORM choice: Phase 1 uses
`pg` directly with parameterised queries in a thin repository layer.

> **Accepted caveat:** node-pg-migrate has no built-in down-migration for raw SQL files.
> Forward-only migrations plus `db:reset` is the right model for a greenfield repo with no
> production data. Production rollback (Phase 7+) is a compensating forward migration, not a
> down script. Recorded so it is not later mistaken for a defect.

| Item | Decision |
|---|---|
| `CREATE EXTENSION vector` | **Migration 001.** One mechanism everywhere, versioned, and `db:reset` re-establishes it free. **Delete the now-redundant explicit step at `ci.yml:71`** — CI should get the extension by running `pnpm db:migrate`, exercising the same path a fresh clone does. **The deletion is atomic with migration 001 — same commit, not a follow-up cleanup.** Delete it earlier and the integration job loses the extension with nothing replacing it, turning CI red for a reason unrelated to the change under review; delete it later and there is a window where both mechanisms create it (harmless under `IF NOT EXISTS`, but it is the two-mechanisms state this decision exists to remove). |
| `.env` loading | `node --env-file-if-exists=.env` on `dev`, `test:integration`, `db:*`. Node 24 native (repo pins `>=24`), no dependency, no-ops in CI so local and CI share one path. |
| Config boundary | `packages/db` takes an **explicit connection string argument**. No ambient `process.env` reads inside the package; env reading only at script entry points. |
| Test isolation | **`TRUNCATE ... RESTART IDENTITY CASCADE` between tests**, from one shared helper in `packages/db/src/testing/`. |
| Scripts | `pnpm db:migrate`, `pnpm db:reset`. |

**Why truncate and not transaction-per-test:** the tool layer's contract *is* "commit in a
transaction + append to action_log", and undo applies inverses in a single transaction.
Wrapping each test in an outer transaction means the code under test runs in a *nested*
transaction behaving differently from production — you would be testing savepoint semantics,
not the shipped path. A strategy that cannot exercise the primary contract is a blind spot, not
isolation. `db:reset` also prevents pass-on-fresh/fail-on-rerun flakes in order-dependent undo
tests.

**Definition of done for Phase 1** — root `pnpm test` stays unit-only (fast, no Docker), so the
phase gate explicitly adds:

```
pnpm typecheck && pnpm lint && pnpm test
pnpm db:migrate && pnpm --filter @ourglass/api test:integration
```

Naming the integration lane beats making the fast lane require Docker.

---

## 6. Verified finding: `pg_cron` is not in our image

Verified from the primary source (`raw.githubusercontent.com/pgvector/pgvector/master/
Dockerfile`): the official image is `FROM postgres:$PG_MAJOR-$DEBIAN_CODENAME` with pgvector
compiled in and **nothing else**. It ships no `pg_cron`. Independently confirmed by `dx`
against the published image docs, and the image is `pgvector/pgvector:pg17` in both
`docker-compose.yml:3` and `ci.yml:45`.

`EXECUTION-PLAN.md:191` and `PHASES.md:37` both assert `pg_cron` as settled. **Phase 3 as
written cannot run on our own image.** Those two lines should be softened now to name it an
open Phase 3 decision — a doc edit today versus a discovery after someone has built against it.

Phase 1 impact: none — `reminders` has indexed `fire_at` + `fired_at`, which serves either
resolution. The computed-status decision (§2.4) already removed the *other* `pg_cron` use, so
only reminder firing remains.

**Recommendation: in-process poller.** The custom-image path is more expensive than it looks
(priced by `dx`): `pg_cron` needs `shared_preload_libraries` plus a restart plus
`cron.database_name`, and compose has no `command:` or config mount today. Decisively, GitHub
Actions `services:` accepts an `image:`, not a `build:` — so a custom image must be built and
published to GHCR first, adding a build/push workflow, package auth, and a tag policy, on a
repo where we hold WRITE not ADMIN. It also regresses fresh-clone time for every contributor
forever.

The poller is testable without a clock (its "find due reminders" query is a pure function of
`(now, rows)` — inject the instant and assert), which matches `DECISIONS.md` #4's established
stance that time is deterministic and injectable rather than ambient. Honest cost:
at-least-once delivery needs the `fired_at` guard plus `SELECT ... FOR UPDATE SKIP LOCKED` so
two API instances do not double-fire — but `pg_cron` would need the same idempotency guard
anyway. Decide formally in Phase 3.

---

## 7. File-ownership map

One glob per role, **non-overlapping**. Each implementer runs `/freeze <its glob>` as its first
action. File ownership is convention; `/freeze` is what makes it real (`.claude/rules/
agent-teams.md` §3). Never `/unfreeze` to reach across a boundary — message the owner.

| Role | Owns (glob) | Notes |
|---|---|---|
| `database-data-engineer` | `packages/db/**` (migrations live at `packages/db/migrations/**`, not repo-root `migrations/**` — corrected during the build: co-locating with `node-pg-migrate` and its config is the more conventional layout for this tool, and it's still entirely inside the one owned glob) | **Sole owner** of schema. Runs `/careful`. Publishes final table shape to `backend-lead` **before** backend starts. |
| `backend-lead` | `apps/api/src/**` | Tool registry, executor, repositories, undo. Excludes `apps/api/src/assistant/**` (reserved for `ai-agent-engineer`, idle in Phase 1). |
| `backend-lead` | `packages/shared/src/**` | Shared types — the tool contract. Publish the moment it settles. |
| *(unassigned)* | `apps/web/**` | **No frontend work in Phase 1.** Do not spawn `frontend-lead`. |
| *(unassigned)* | `apps/api/src/assistant/**` | **No LLM in Phase 1.** Do not spawn `ai-agent-engineer`. |
| `staff-code-reviewer` | *(read-only)* | No write tools; runs in parallel safely. |

**Root config files** (`package.json`, `docker-compose.yml`, `.github/workflows/**`,
`tsconfig.base.json`) are **lead-owned**. The `db:migrate`/`db:reset` scripts and the `ci.yml:71`
deletion are lead edits, not implementer edits — two implementers editing root `package.json`
is the classic silent-overwrite in this repo's layout.

### Browser owner

**There is no browser work in Phase 1 — no browser owner is assigned, deliberately.**

Phase 1 has no UI and no HTTP surface a browser would exercise; the demo is
programmatic-and-undoable, verified by integration tests against real Postgres. Per
`.claude/rules/routing.md` §9, a teammate that cannot be justified in one sentence is not
spawned: **do not spawn `qa-browser-lead` or `frontend-lead` for this phase.** The gstack browse
daemon must not be started during Phase 1 at all.

The exclusive-browser-owner rule (`agent-teams.md` §1) resumes at **Phase 5**, when the
inspection surfaces first exist. At that point the owner is `qa-browser-lead` and everyone else
messages them.

### Team for Phase 1

Three implementers plus one read-only reviewer: `database-data-engineer`, `backend-lead`,
`staff-code-reviewer`. Auto-committing skills (`/review`, `/qa`, `/ship`, `/graphify --update`)
run **only in the lead, after every teammate has shut down**.

---

## 8. Open items for the user

Neither blocks the migration except where noted.

1. **Dynamic entity types are an owner addition, not spec.** Zero occurrences in the 38
   sections (verified twice, independently). Confirm before Phase 1 pours schema. Ask **which
   capability** is wanted: *"track my gym sessions with a date and a duration"* is a schema
   builder; *"remember that I have gym sessions"* may be served by Phase 4's memory layer with
   no registry at all. If the latter, the subsystem is unnecessary rather than merely thin.
2. **Timezone (`DECISIONS.md` open question 3) — no longer blocking.** `timestamptz` everywhere
   plus `users.timezone` makes the schema indifferent. Still worth confirming single- vs
   multi-timezone for Phase 2 behaviour.
3. **`due_soon` threshold** — 2h placeholder, product judgement, not an architectural decision.
4. Unchanged from `DECISIONS.md`: ADMIN on `batoredev/OurGlass`, extraction model tier, per-
   message cost budget.

### Lead-owned, sequenced before the Phase 1 team spawns

5. **`README.md` does not exist and is unowned.** Root `SETUP.md` is the Company Claude OS
   install guide, so a contributor cloning `batoredev/OurGlass` today lands on documentation
   for a different product. This is outside Phase 1's build scope (it is a lead-session task,
   not an implementer task) but it is recorded here because it was otherwise carried only in
   session messages, which are not a deliverable. It is **unblocked as of this document** —
   it was waiting on the migration-tool and env-flag decisions, both now made in §5. Write it
   before the team spawns, and have it name the real commands: `docker compose up postgres`,
   `pnpm install`, `pnpm db:migrate`, `pnpm test`.
6. **Proposed addition to `PHASES.md`'s definition of done:** *"A fresh clone with no pre-set
   environment variables reaches this phase's demo using only the commands in `README.md`."*
   The load-bearing clause is *no pre-set environment variables* — CI injects what a fresh
   clone lacks (`DATABASE_URL` as a job `env:` key, `CREATE EXTENSION` as an explicit step),
   so **CI cannot detect this class of defect by construction**. That single root cause
   produced three separate findings in this review.

---

## 9. Decisions to record in `DECISIONS.md`

1. Migration tooling: `node-pg-migrate` + numbered SQL files; forward-only; rationale in §5.
2. `due_soon`/`overdue` computed, never stored; `commitment_status` is nine values, not eleven.
3. `merge_person` is non-destructive; `merged_into_id` forwarding pointer. **Two read shapes:**
   `people_current` (list — merged people absent) and `resolve_person(uuid)` (dereference —
   follows the pointer transitively, cycle-guarded, never zero rows). A `person_ref` or FK
   dereference must use the second; using the first renders blank for merged people only.
   **Applies to all three mergeable tables** — `organizations` and `projects` get the same
   pointer, the same `*_current` view, and the same resolver, over one shared
   `resolve_merged(tbl, uuid)`. The pointer without a resolver is the defect, on any table.
4. `action_log` grain is the conversational turn (`turn_id` + `seq`); undo is transactional,
   append-only, once-only, and `user_turn`-only.
5. Tool inputs take resolved UUIDs; content fields stay raw strings; unknown person → tool
   fails, Resolve creates first.
6. `field_kind` is a closed six-value enum; `define_entity_type` rejects unknown kinds at
   validation time; `add_entity_field` is non-breaking (absent keys legal, optional-only);
   caps are 32 fields / 64 types. Add the *why* under `DECISIONS.md:16` — the entry itself
   stays as written.
7. `pg_cron` is absent from `pgvector/pgvector:pg17` (verified); Phase 3 must choose;
   `EXECUTION-PLAN.md:191` and `PHASES.md:37` should be softened to reflect that.
