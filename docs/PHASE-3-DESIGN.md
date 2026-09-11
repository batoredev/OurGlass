# Phase 3 design — conversational loop + reminders

Full four-stage orchestrator (Interpret → Resolve → Mutate → Respond), completion and
lateness, the reminder-firing mechanism, flattened conditional rules (§25), trace
persistence, and a way for a human to actually run the demo.

This is a design contract, not a tutorial. It states what to build and **why the
alternative was rejected**, because the rejections are the expensive part to rediscover.
It matches `docs/PHASE-1-DESIGN.md` in rigour deliberately.

**Read first, in this order:** `docs/PHASES.md` (the Phase 3 entry — scope is **settled**
by the `ceo3` review and is not open for relitigation), `docs/DECISIONS.md` (locked
decisions and all build findings), `docs/PHASE-1-DESIGN.md` (§2.4, §2.6, §2.7, §3, §4),
`docs/PHASE-2-DESIGN.md`, `.claude/rules/agent-teams.md` (file ownership).

**Consumed as settled, not redesigned here:**

- Scope in/out exactly as recorded in `docs/PHASES.md`. §24, §26, §16/§17, §28 and all
  UI stay out.
- Respond is **one constrained Haiku call**, no tools, no DB handle, with a **mandatory**
  deterministic template fallback (§5 below).
- **Sonnet and Haiku only, no Opus**, anywhere in this product (owner decision,
  `DECISIONS.md` open question 2).
- Phase 1's `executeTurn` already opens **one transaction per turn** and logs inverses at
  turn grain. Consume it.
- Tool inputs take **resolved UUIDs**; content fields stay raw strings (§3 of Phase 1).
- **Invalidate, never delete.**

---

## 0. Findings — plan claims the code does not support

Phase 3's scope review found one of these (`complete_commitment`). Reading the code for
this document found **three more of exactly the same shape**. All four are prerequisites,
not nice-to-haves: the stated demo sentence is unreachable while any of them stands.

They are listed first because a plan claim the code cannot support is the most expensive
thing to discover late.

### F1 — `complete_commitment` does not exist *(already recorded in `PHASES.md`)*

`apps/api/src/tools/index.ts` registers exactly three tools: `create_commitment`,
`create_reminder`, `define_entity_type`. `packages/db/src/repositories/commitments.ts`
exports `createCommitment`, `getById`, `listCurrent`, `listByOwner`, `listByRecipient`,
`invalidateCommitment`, `revalidateCommitment` — **nothing that writes `completed_at` or
transitions `status`**. The `completed_late` enum value and the `completed_at` column
exist (migration 003) with no code path reaching them. Design in §1.

### F2 — nothing reads `users.timezone`, and nothing ever has *(new)*

`resolveTime(reference, now, timezone, direction)` requires an IANA zone. `users.timezone`
exists (migration 002) precisely to supply it — `PHASE-1-DESIGN.md` §2.2 says so in as
many words. Verified by grep across `apps/api/src/**` and `packages/db/src/**`: the only
occurrence of the string `users` outside migrations is in
`packages/db/src/testing/truncate.ts`'s table list. There is:

- no `users` repository in `packages/db/src/repositories/` (there are four: people,
  organizations, projects, commitments),
- no seed or bootstrap that inserts the single Phase 1 user row,
- no caller that reads a timezone from anywhere.

Every existing test passes a timezone literal. The orchestrator is the first caller that
cannot. **Phase 3 must create the `users` repository and the bootstrap row.** Design in
§3.2.

### F3 — "me" / "I" has no resolution path *(new, and the most serious)*

The demo sentence is *"Barkha needs to give **me** the article by 6."* That is
`recipient_id = the user`. But:

- `users` and `people` are unrelated tables. There is no FK, no `person_id` on `users`, no
  `is_self` flag on `people`.
- `resolvePersonMention` scores a mention against `people.list()` by name similarity.
  A mention of `"me"` scores ~0 against every real person and lands in `reject`.
- `apps/api/src/tools/create-commitment.integration.test.ts:76` works around this by
  creating a person whose `display_name` is the literal string `"User"` — so the test
  passes because `"me"` never reaches the resolver at all; the test hands the tool a UUID
  directly.

This is the same class of defect as F1 — a green test over a path the product cannot take.
The first-person pronoun appears in the demo sentence, in spec §19, §20, §21, §22 and §25.
**Phase 3 must give the user a person row and resolve first-person mentions to it before
the resolver's similarity scoring runs.** Design in §3.2.

### F4 — commitments have nowhere to attach context *(new)*

`PHASES.md` puts *"context attachment (§20) as a note with message provenance"* explicitly
IN scope. Migration 003 gives `commitments` no `notes` column (verified: zero occurrences
of `notes` in `003_commitments.sql`, while `people`, `organizations` and `projects` all
have one in `002`). There is also no `commitment_notes` table. §20's *"She had a family
emergency"* has nowhere to land. Design in §7.

### F5 — no `messages` or `reminders` repository *(minor, but it forces a decision)*

`packages/db/src/index.ts` exports four repository namespaces. `messages` and `reminders`
are tables with no repository, so `create-reminder.ts` writes raw SQL through `ctx.tx` and
says so in its own header comment. Phase 3 adds a poller and trace persistence, both of
which need these tables. Adding the two repositories is in scope; leaving raw SQL in three
more places is not.

> **The general lesson, repeated from `DECISIONS.md` Phase 1 finding #8.** Every one of
> F1–F5 is a *column or table that exists with no code path reaching it*. That shape is
> invisible to typecheck, lint, and a green test suite. Before Phase 4 is planned, grep
> the schema for columns no repository function names, and check each against the phase
> that claimed it.

---

## 1. `complete_commitment` — the first task of the phase

Nothing else in Phase 3 can be demonstrated until this exists. Build it first.

### 1.1 The repository function

Lives in `packages/db/src/repositories/commitments.ts`, alongside `invalidateCommitment`
and following its conventions exactly.

```sql
UPDATE commitments AS c
   SET status       = $2::commitment_status,
       completed_at = $3::timestamptz
  FROM (SELECT id, status, completed_at FROM commitments WHERE id = $1) AS old
 WHERE c.id = old.id
RETURNING c.*,
          old.status       AS prev_status,
          old.completed_at AS prev_completed_at
```

```ts
export interface CompleteCommitmentResult {
  commitment: Commitment;
  previousStatus: CommitmentStatus;
  previousCompletedAt: Date | null;
}

export async function completeCommitment(
  tx: Queryable,
  id: string,
  input: { status: "completed" | "completed_late"; completedAt: Date | string },
): Promise<CompleteCommitmentResult>;

/** The exact inverse. Both prior values are REQUIRED — see below. */
export async function uncompleteCommitment(
  tx: Queryable,
  id: string,
  previousStatus: CommitmentStatus,
  previousCompletedAt: Date | null,
): Promise<void>;
```

**The self-join is the whole point, and it is not stylistic.** `RETURNING *` on an
`UPDATE` yields **post-update** state. Capturing `prev_status` from it would capture
`'completed'` — the value we just wrote — so the inverse would restore `'completed'`
instead of `'pending'`. Undoing a completion would then be a no-op that reports success.

This is *precisely* `DECISIONS.md` Phase 1 build finding #4, one table over. `mergePerson`
in `packages/db/src/repositories/people.ts` had exactly this bug and was fixed with exactly
this `FROM (SELECT ...) AS old` self-join. **Read that function before writing this one.**

**`uncompleteCommitment` takes both prior values with no defaults**, mirroring
`unmergePerson`'s signature and for the same reason stated in its comment: defaults would
restore "never completed, pending", which is right only for undoing a *first* completion.
A commitment completed, undone, re-completed, and undone again must restore the *captured*
prior state, not an assumed one. A default silently converts a wrong restore into a
plausible one.

> **Rejected: `UPDATE ... RETURNING *` plus a separate `SELECT` beforehand.** Two
> statements in one transaction is correct under Postgres' read-committed snapshot, and it
> reads more simply. Rejected because it is *conditionally* correct — it depends on nobody
> ever moving the `SELECT` outside the transaction or the tool's `commit()`. The self-join
> is unconditionally correct in one statement and is the pattern already established in
> this repo. One pattern, three call sites (`mergePerson`, `completeCommitment`,
> `updateCommitment`), is cheaper to keep right than two patterns.

> **Rejected: an `UPDATE ... SET status` with no capture, reconstructing the prior state
> from `action_log`'s earlier `forward_patch`.** The information is technically there. It
> requires the inverse handler to *query the log it is being driven by*, ordering matters,
> and a commitment created before Phase 3 (or by a future non-logged path) has no entry to
> reconstruct from. `LoggedMutation.inversePatch` is defined to be self-sufficient
> (`PHASE-1-DESIGN.md` §4.2, final invariant). Keep it self-sufficient.

### 1.2 The tool

`apps/api/src/tools/complete-commitment.ts`, following `create-commitment.ts`'s structure
(hand-written `validate`, no Zod — the repo has no Zod dependency and three more tools do
not justify one).

```ts
export interface CompleteCommitmentRawInput {
  readonly commitment_id?: unknown;  // resolved UUID (§3 input contract)
  readonly completed_at?: unknown;   // ISO-8601 string, resolved by chrono, never by the model
}

export interface CompleteCommitmentInput {
  readonly commitmentId: string;
  readonly completedAt: string;
}

export interface CompleteCommitmentOutput {
  readonly id: string;
  readonly status: "completed" | "completed_late";
  readonly completedAt: string;
  readonly expectedAt: string | null;
  readonly latenessMs: number | null;   // null when expected_at IS NULL — see §2
}
```

`validate` must reject, in this order, stopping before any DB access on shape errors:

| Check | Code | Why |
|---|---|---|
| `commitment_id` is a UUID | `invalid_uuid` | §3 input contract — never a description |
| `completed_at` is a string | `invalid_completed_at` | The model never supplies timestamps (`DECISIONS.md` #4) |
| `completed_at` parses as ISO-8601 | `invalid_completed_at` | `create_commitment` currently accepts any string for `expected_at`; do not copy that laxity |
| Row exists and `t_invalid IS NULL` | `unknown_commitment` | Same contract `create_reminder` uses for `commitment_id` |
| Row is not already terminal | `already_completed` | See below |

**Already-completed is a validation rejection, not an idempotent no-op.** If `status` is
already `completed` or `completed_late`, `validate` fails with `already_completed` naming
the existing `completed_at`. Respond turns that into *"Already marked that as done at 11
PM."* Rejected alternative: silently overwriting. That destroys the recorded moment the
commitment actually completed, which is the same correctness bug as `DECISIONS.md` Phase 1
finding #5 (`invalidateCommitment` overwriting `t_invalid`) — a bitemporal system's core
promise is that a recorded instant does not move. `cancelled` and `superseded` are also
terminal and reject the same way.

`commit()` computes lateness (§2), calls `completeCommitment`, and returns one
`LoggedMutation`:

```ts
{
  targetTable: "commitments",
  targetId: row.id,
  forwardPatch: { status, completedAt, expectedAt, latenessMs },
  inversePatch: { status: prev.status, completedAt: prev.completedAt },  // captured, pre-update
  invertibility: "full",
}
```

### 1.3 The inverse handler — and a real collision

`registerInverseHandler` (`apps/api/src/tools/inverses.ts`) is keyed by **table name** and
**throws if a table is registered twice**:

```ts
if (handlers.has(targetTable)) {
  throw new Error(`Inverse handler for table "${targetTable}" is already registered`);
}
```

`create-commitment.ts` already registers `"commitments"`. `complete_commitment` mutates
the same table with a *different* inverse. **A second `registerInverseHandler("commitments",
...)` throws at module load** — the registry index imports every tool module, so this is a
startup crash, not a runtime surprise. Good: it fails loudly. But it must be resolved.

**Decision: the `commitments` handler dispatches on the shape of `inversePatch`.** One
registration, in `create-commitment.ts` (which owns the table's handler), branching:

```ts
registerInverseHandler("commitments", async (tx, targetId, inversePatch) => {
  if (!targetId) return;
  const patch = inversePatch as Record<string, unknown> | null;
  // A create's inverse is `{ id }` — nothing to restore, just invalidate.
  if (patch && "status" in patch) {
    await commitments.uncompleteCommitment(
      tx, targetId,
      patch.status as CommitmentStatus,
      patch.completedAt == null ? null : new Date(patch.completedAt as string),
    );
    return;
  }
  if (patch && "fields" in patch) {           // update_commitment, §1.4
    await commitments.restoreCommitmentFields(tx, targetId, patch.fields as ...);
    return;
  }
  await commitments.invalidateCommitment(tx, targetId);
});
```

> **Rejected: re-key `registerInverseHandler` by `(targetTable, toolName)`.** Cleaner on
> paper — each tool owns its own inverse, no shape sniffing. Rejected for two reasons.
> (1) `undoTurn` reads `target_table` out of `action_log` and calls
> `applyInverseForTable(tx, entry.targetTable, ...)`; `tool_name` is selected but not
> passed. Re-keying changes the executor, the dispatcher, and the `SELECT` — three edits in
> Phase-1-owned, CI-verified code to accommodate a Phase 3 tool. (2) It couples undo to
> tool *names*, so renaming a tool silently orphans historical log entries whose
> `tool_name` no longer resolves — a log row that cannot be undone with no error until
> someone tries. Table + patch shape is stable across renames.
>
> The cost of the chosen option is real and must be paid explicitly: the shape check is
> positional discipline, not type safety. **Each branch's discriminating key is asserted
> by a unit test**, and the `inversePatch` shapes are declared as a discriminated union in
> `create-commitment.ts` so the compiler catches a fourth shape added without a branch.

> **Rejected: one generic "restore these columns" inverse for the whole table.** i.e.
> `inversePatch: { status, completed_at, expected_at, object_text, ... }` for every
> commitment mutation, with a single `UPDATE ... SET` handler. Attractively uniform.
> Rejected because it makes the inverse of a *create* into an `UPDATE` restoring a
> pre-existence state that has no meaning, and because a create's inverse must be an
> **invalidate** (`t_invalid`), not a column restore. Two genuinely different operations
> wearing one shape is how the `invalidate`-vs-`unmerge` confusion that
> `people.ts:invalidatePerson`'s comment warns about gets reintroduced.

### 1.4 `update_commitment` — spec §22

Spec §22: *"Arun still hasn't sent the schema"* must update the existing commitment's
status rather than create a second one. This is the other tool `PHASES.md` puts in scope.

```ts
export interface UpdateCommitmentRawInput {
  readonly commitment_id?: unknown;
  readonly status?: unknown;        // a commitment_status value, excluding the two completed ones
  readonly expected_at?: unknown;   // ISO string or null
  readonly object_text?: unknown;   // raw string — a content field, never resolved
}
```

Three constraints:

1. **`update_commitment` cannot set `completed` or `completed_late`.** Those come only from
   `complete_commitment`, which is the only place lateness is derived. Validation rejects
   them with `use_complete_commitment`. Rejected alternative: allowing it and deriving
   lateness inside `update_commitment` too. Two derivation sites is how one of them drifts;
   §2's rule is that lateness has exactly one source.
2. **Only the fields actually present are updated**, and `inversePatch` captures **only
   those same fields'** prior values (`{ fields: { status: 'pending', expected_at: '...' } }`).
   Capturing the whole row would make undo restore fields a *different* turn had legitimately
   changed in between.
3. Same self-join capture as §1.1. `restoreCommitmentFields(tx, id, fields)` builds a
   parameterised `SET` list from a **closed allowlist** of column names — never string
   interpolation of a key from `inversePatch`, which is JSONB read back from the database
   and is therefore untrusted input by the letter of `.claude/rules/security.md`.

---

## 2. Lateness, derived in the tool layer

**Spec §20 is the requirement:** expected 6 PM, actual 11 PM → `completed_late`, five
hours. **`PHASES.md` fixes the mechanism:** derived in the tool layer, *never* from model
output.

### 2.1 The rule

Inside `complete_commitment`'s `commit()`, after the row is fetched and before the update:

```ts
function deriveCompletion(
  expectedAt: Date | null,
  completedAt: Date,
): { status: "completed" | "completed_late"; latenessMs: number | null } {
  if (expectedAt === null) return { status: "completed", latenessMs: null };
  const latenessMs = completedAt.getTime() - expectedAt.getTime();
  return latenessMs > 0
    ? { status: "completed_late", latenessMs }
    : { status: "completed", latenessMs };
}
```

Four properties, each deliberate:

- **`expected_at IS NULL` → plain `completed`, `latenessMs: null`.** There is no deadline
  to be late against. Rejected alternative: treating a missing deadline as "late if
  completed after creation". That invents a deadline the user never set, and §20's whole
  point is recording what happened, not judging it. `null` is not zero: zero would mean
  "on time to the millisecond", which is a claim we cannot make.
- **On time or early is `completed`, and `latenessMs` is still returned** (negative or
  zero). Respond may use it (*"two hours early"*); nothing else may. Rejected alternative:
  clamping to zero — it discards information for no gain.
- **Strictly `> 0`.** Exactly-on-time is `completed`. A `>=` would mark a
  millisecond-perfect completion late.
- **Pure function of two `Date`s.** No `now()`, no timezone, no DB. `expected_at` and
  `completed_at` are both `timestamptz` — absolute instants — so the difference is
  zone-independent and DST-independent by construction. It is unit-testable with no clock
  and no database, and that is the point.

`latenessMs` is **not stored**. It is a pure function of two stored columns, exactly as
`due_soon`/`overdue` are (`DECISIONS.md` #2). Storing it would create the same "a value
that can disagree with its own inputs" problem. Respond formats it; nothing persists it.

### 2.2 `direction: "past"` is mandatory on a completion — and it is load-bearing

`resolveTime`'s fourth parameter is **required, not defaulted**, and
`apps/api/src/assistant/time.ts` explains why in its own comment: the previous signature
hardcoded `forwardDate: true`, so *"Barkha gave the article at 11"* resolved to **tomorrow
at 11**. §20 then computes lateness against a future timestamp and reports the commitment
as *early by nineteen hours*.

That was one of Phase 2's three confirmed blockers (`PHASES.md`, Phase 2 entry, item 3).
The fix is `timeDirectionForIntent("completion_update") === "past"`, which is already wired
in `DIRECTION_BY_INTENT_KIND`.

**The orchestrator must pass `timeDirectionForIntent(intent.kind)` — never a literal, and
never a default.** Stated as an invariant because the compiler cannot help: `"forward"` and
`"past"` are both valid `TimeDirection` values and a hand-written literal typechecks
perfectly. A regression test pins it: *"Barkha gave the article at 11"* with a reference
instant of the same day at 14:00 must resolve to **11:00 that day**, and produce
`completed_late` with `latenessMs === 5 * 3600_000` against an `expected_at` of 18:00.

> **Rejected: letting the model classify past-vs-future.** It is already classifying the
> intent kind, and the intent kind *determines* the direction deterministically through a
> table we control. Adding a second, independent model-supplied signal means the two can
> disagree, and nothing would arbitrate. One source, derived.

---

## 3. The orchestrator

`apps/api/src/assistant/orchestrator.ts`. One utterance in, one reply out.

```ts
export interface TurnRequest {
  readonly utterance: string;
  readonly userId: string;          // the users row; supplies timezone + self person
  readonly now?: Date;              // injectable clock; defaults to new Date()
}

export interface TurnResponse {
  readonly turnId: string | null;   // null when nothing was mutated
  readonly reply: string;
  readonly asked: readonly string[];      // clarifications raised this turn
  readonly committed: readonly string[];  // tool names actually applied
  readonly degraded: boolean;             // true when the template fallback produced `reply`
}

export async function runTurn(req: TurnRequest, deps: OrchestratorDeps): Promise<TurnResponse>;
```

### 3.1 Stage order and what each stage may touch

| Stage | Input | Output | May touch DB | May call a model |
|---|---|---|---|---|
| Interpret | utterance | `ExtractionResult` | **no** | yes (Sonnet, forced tool) |
| Resolve | extraction + tx | `ToolCall[]` + questions | read only | **no** |
| Mutate | `ToolCall[]` | `ExecuteTurnOutcome` | read/write, one tx | **no** |
| Respond | a plain summary object | `string` | **no** | yes (Haiku, no tools) |

Two of those cells are the trust boundary and are worth stating as prohibitions rather than
capabilities: **Interpret never receives a database handle**, and **Respond never receives
one either**. Interpret's isolation is Phase 2's design (`PHASE-2-DESIGN.md`, "Trust
boundary"). Respond's is §5's.

### 3.2 Where `turn_id` originates — and the answer is "it does not, here"

**`turn_id` is generated inside `executeTurn`, and the orchestrator receives it back.**
`apps/api/src/tools/executor.ts` line 1 of `executeTurn` is `const turnId = randomUUID();`,
and it is returned in `ExecuteTurnSuccess`. The orchestrator does **not** pass one in.

> **Rejected: hoisting `turn_id` generation into the orchestrator and passing it down.**
> Superficially better — the orchestrator could stamp the `messages` row with the same
> `turn_id` *before* the mutation runs, and the id would exist for logging even when no
> mutation happens. Rejected for a specific reason: it changes `executeTurn`'s signature,
> which is Phase-1-owned and CI-verified, and it creates a state the schema forbids —
> a `turn_id` that exists on a message but appears in **zero** `action_log` rows, because
> the turn turned out to be a pure question. `messages.turn_id` is documented in migration
> 004 as *"NULL for messages that produced no mutation"*. Generating an id that names
> nothing contradicts that comment and makes `action_log_turn_idx` lookups return empty for
> ids that the messages table swears are real.
>
> So: **a turn that mutates nothing has `turn_id = NULL` on its messages**, which is what
> migration 004 already says. §8 covers how the trace is still persisted in that case.

Ordering inside `runTurn`, therefore:

1. Insert the **user** `messages` row with `turn_id = NULL`. (It must exist before
   `relationships.source_message_id` can point at it in Phase 4, and it must survive even
   if the turn fails.)
2. Interpret.
3. Resolve (inside a **read-only** transaction, or on the pool — it writes nothing).
4. Mutate: `executeTurn(calls, deps)` → `turnId`.
5. **`UPDATE messages SET turn_id = $1 WHERE id = $2`** for the user message, if a turn
   committed.
6. Respond.
7. Insert the **assistant** `messages` row with the same `turn_id` and the trace (§8).

Step 5 is a small extra write and it is the cost of not hoisting the id. It is paid once
per mutating turn.

### 3.2.1 Self-identity and timezone — resolving F2 and F3

Both are prerequisites for step 3 and are built with the orchestrator.

**Schema (migration 007):**

```sql
ALTER TABLE users ADD COLUMN person_id uuid REFERENCES people(id);
CREATE UNIQUE INDEX users_person_idx ON users(person_id) WHERE person_id IS NOT NULL;
```

**`packages/db/src/repositories/users.ts`** — new, small:

```ts
export interface User { id: string; display_name: string; timezone: string; person_id: string | null; }
export async function getUser(tx: Queryable, id: string): Promise<User | null>;
/** Idempotent: creates the single user row AND its person row if absent. */
export async function ensureUser(
  tx: Queryable, input: { displayName: string; timezone?: string },
): Promise<User>;
```

**Resolution:** `resolvePersonMention` gains a first-person short-circuit *before*
similarity scoring:

```ts
const FIRST_PERSON = new Set(["me", "i", "myself", "my", "mine"]);
// in resolvePersonMention, before candidates are scored:
if (FIRST_PERSON.has(normalize(mention.name)) && selfPersonId) {
  return { band: "auto", id: selfPersonId, score: 1 };
}
```

The self person id is passed in from the orchestrator (which read it from `users`), not
looked up inside the resolver — `packages/db`'s config boundary and the resolver's purity
both argue for passing it.

> **Rejected: seeding a person named `"User"` and letting name similarity handle it.**
> This is what the Phase 1 integration test does, and it is why F3 stayed invisible.
> `nameSimilarity("me", "User")` is ~0. It only works if the user literally types "User",
> which nobody does.
>
> **Rejected: an `is_self boolean` on `people` instead of `users.person_id`.** A flag on
> the entity table permits two selves and has no FK to the account. A unique-indexed FK on
> `users` permits exactly one and reads in the direction the question is actually asked
> ("who is this account, as a person?").
>
> **Rejected: expanding "me" in the extraction prompt** (asking the model to emit the
> user's display name). That is the model fabricating an identity, and it breaks the moment
> two people share a name. Resolution is deterministic backend work; the prompt already
> says *"Keep entity names as mentions, never IDs."*

**Timezone** flows: `getUser(tx, userId).timezone` → `resolveTime(ref, now, tz, direction)`.
No `process.env`, no constant, no default at the call site. If the user row is missing,
`runTurn` throws before Interpret — a missing user is a deployment fault, not a
conversational one, and inventing `Asia/Kolkata` at the call site would hide it.

### 3.3 The hard question: partial commit vs whole-turn abort

**Setup.** Resolve returns a band per mention. One utterance may carry three intents; one
mention resolves `ask` while the other two resolve `auto`. Do the resolvable intents
commit while the third becomes a question, or does the whole turn abort into questions?

**Both directions have a spec section pointing at them.** §27 warns against confirmation
fatigue — *"Infer when safe. Ask when necessary."* — which argues for committing what is
safe. `DECISIONS.md` #9 says a wrong write is the worst failure in the system, and a
partial commit the user did not intend is a wrong write.

**Decision: commit the resolvable intents; ask about the rest — but only when the asked
intent is INDEPENDENT of every committed one. If it is dependent, the whole turn aborts
into a question and nothing commits.**

**Dependence is structural and computed, not judged.** Intent B depends on intent A when B
would reference a row A creates. Concretely, in Phase 3's scope there are exactly two ways
that happens:

1. **`create_reminder.commitment_id`** points at a commitment created by another intent in
   the same turn. This is the demo utterance: *"Barkha needs to give me the article by 6.
   Remind me at 5 to ask her."*
2. **`complete_commitment.commitment_id` / `update_commitment.commitment_id`** point at a
   commitment matched or created in the same turn.

The orchestrator builds an intent dependency graph while translating to `ToolCall`s (it
already knows which call supplies which id — it is filling those fields in). Then:

```
asked       = intents where any mention resolved `ask` | `reject` | `unresolved`,
              or a BLOCKING completeness issue exists (advisory issues never ask),
              or a completion matched `ask` / zero candidates per §4.2
blocked     = transitive closure of "depends on" over `asked`
committable = intents \ blocked, in original utterance order
if committable is empty → mutate nothing, ask about everything   // no turn_id is minted
else                    → executeTurn(committable), and ask about `blocked`
```

**The closure on line 2 IS the safety property** — the whole of it. An intent never
commits while something it depends on is still a question, and no intent is asked about in
a way that leaves a dangling half-structure. Everything else is bookkeeping.

> **Corrected during the build.** An earlier draft of this block had a fourth line —
> `if (blocked ∩ dependencyRootsOf(committable)) is non-empty → abort the whole turn` —
> and the prose below credited worked example 2's abort to it. That line was **unreachable
> dead code**: line 2 takes the transitive closure and line 3 subtracts all of it, so
> `committable` provably contains nothing depending on `blocked`, and the intersection is
> necessarily empty.
>
> The misattribution was the dangerous part, not the dead line. Example 2's abort is
> produced by the **closure**, not by the guard. Anyone who later "simplified" line 2 to a
> one-hop check — reasonably, trusting line 4 as the backstop — would commit an **orphan
> reminder against a commitment that was never created**, which is the precise failure this
> section exists to prevent. The safety property was load-bearing in a line the prose
> treated as incidental, and nominally guarded by a line that did nothing.
>
> Caught by `ai-agent-engineer` reading the algorithm before building it, exactly as the
> spawn prompt asked. There is a regression test named for the orphan-reminder failure so
> the closure cannot be weakened silently.

**Why the empty case needs its own line.** `executeTurn`'s first statement is
`const turnId = randomUUID()` (`apps/api/src/tools/executor.ts:135`), unconditionally. So
`executeTurn([])` would return `ok: true` carrying a real `turnId` that names zero
`action_log` rows — contradicting §3.2's rule that a turn mutating nothing has
`turn_id = NULL` on its messages. The guard is not defensive padding; it is what keeps
§3.2 true.

**Worked examples.**

| Utterance | Outcome |
|---|---|
| *"Barkha needs to give me the article by 6. Remind me at 5 to ask her."* — both resolve | One turn, two mutations, one `turn_id`. Unchanged from Phase 1's demo. |
| Same, but two Barkhas exist | The reminder **depends on** the commitment, which is blocked. **Whole turn aborts.** Reply: *"Barkha from Batore or Barkha from MTTN?"* Nothing written. |
| *"Barkha gave me the article. Also remind me to call the plumber at 6."* — "the plumber" unresolvable, "Barkha" fine | Independent. The completion **commits**; the reply is *"Got it — article marked complete. Who's the plumber?"* |
| *"Finished the Hult poster and the CRM deck"* — poster matches one commitment, deck matches two | Independent completions. Poster commits; deck asks. |

**Why not whole-turn abort always.** It is the safest rule and it was seriously considered.
It fails §27 concretely, not theoretically: in row 3 above, the user's completion — an
unambiguous, CONFIRMED fact about a commitment that exists — would be thrown away because
of an unrelated plumber. The user then has to repeat a sentence the assistant already
understood perfectly. That is the "conversational interface IS the control interface" (§21)
promise breaking on the assistant's own bookkeeping.

**Why not always commit what resolves.** Row 2 is the counterexample and it is why the
dependency rule exists rather than a flat "commit what you can". Committing the commitment
against a guessed Barkha, then asking, is the wrong-merge direction `DECISIONS.md` #9 names
as the worst failure. Creating the commitment against *no* Barkha is impossible
(`owner_id` is NOT NULL, and `create_commitment` rejects an unknown person by §3). And
creating the reminder without its commitment produces an orphan reminder that fires saying
*"ask her if the article arrived"* about a commitment that does not exist.

**Why the reply must say what it did.** A partial commit is only safe if it is visible.
Every partial turn's reply states both halves — *"Got it — article marked complete. Who's
the plumber?"* — so the user can say "undo that" and get the turn back. §31 says be
concise, not silent. Silence about a write is exactly the state §28 (user control) exists
to prevent.

**Undo granularity is unchanged.** The committed subset is one `turn_id`, so "undo that"
reverses the whole committed subset atomically — never a fraction of it. The asked
intents wrote nothing, so there is nothing to reverse.

### 3.4 Interpret and Mutate failure paths

- **`ExtractionError`** (`truncated` / `refused` / `context_window_exceeded` /
  `no_tool_call` / `invalid_payload`): Phase 2 built this taxonomy specifically so Phase 3
  can distinguish them. No mutation runs. Each maps to a distinct honest reply
  (`ai-systems.md`, *"degrade honestly"*). `truncated` → *"That got cut off — can you say
  it more briefly?"* `refused` → *"I can't help with that one."* The others →
  *"Something went wrong interpreting that — nothing was saved."* These are **templates,
  never a Haiku call**: the model just failed; calling another one to explain the failure
  adds a second thing that can fail.
- **`ExecuteTurnFailure`** (validation): nothing was written, per the executor's contract.
  Reply names the field, from the `ToolError.message` — those messages are already written
  user-facing with no SQL and no stack.
- **A thrown error inside `executeTurn`**: transaction rolls back. Reply is the generic
  honest failure. Log the trace.
- **`question` intents (§28)**: classified, then **declined honestly** —
  *"I can't look things up yet."* `PHASES.md` settles this: building lexical retrieval that
  Phase 4 throws away is worse than an honest gap. A `question` intent alone never blocks
  the mutating intents in the same utterance.

---

## 4. Matching a completion to an existing commitment

*"Barkha gave the article at 11"* must find the right open commitment.

### 4.1 `detectDuplicate` is used — with one veto inverted at the call site

`apps/api/src/assistant/resolve.ts`'s `detectDuplicate(proposal, existing)` is close to
what is needed and is already CI-verified, but its third hard veto is **backwards for this
use**:

```ts
return isCompleted(proposal.status) !== isCompleted(candidate.status);
```

For **duplicate detection** (§23) that is right: a completed commitment must never absorb a
new pending one. For **completion matching** it would veto every candidate, because the
proposal's status is `completed` and every open candidate is `pending`. `detectDuplicate`
would return `{ kind: "create", reason: "hard_veto" }` for the demo sentence — and
"create" is catastrophically wrong here: it would create a *second, already-completed*
commitment beside the open one, which is §23's forbidden duplicate **and** leaves the real
commitment open forever.

**Decision: reuse `detectDuplicate`'s scoring and the owner/recipient vetoes, by calling it
with a proposal whose `status` is `"pending"` and pre-filtering `existing` to open
commitments.**

```ts
export function matchCompletionTarget(
  proposal: { ownerId: string; recipientId: string | null; objectText: string },
  openCommitments: readonly CurrentCommitment[],
): DuplicateDecision {
  // Status is 'pending' on the probe so the completed-vs-not veto compares
  // like with like. Candidates are ALREADY filtered to open commitments by
  // the caller, so that veto is a no-op here rather than inverted.
  return detectDuplicate({ ...proposal, status: "pending" }, openCommitments);
}
```

Candidates come from a new repository read:

```sql
SELECT * FROM commitments_current
 WHERE owner_id = $1
   AND (recipient_id IS NOT DISTINCT FROM $2)
   AND status NOT IN ('completed','completed_late','cancelled','superseded')
 ORDER BY expected_at NULLS LAST
```

`IS NOT DISTINCT FROM` rather than `=` because `recipient_id` is nullable and
`NULL = NULL` is NULL — a self-owned commitment (*"I need to finish the poster"*) would
match nothing. This is the SQL-level twin of the `?? null` fix already commented in
`hasHardVeto`.

> **Rejected: a separate `matchCompletion` scorer written from scratch.** It would
> duplicate `objectTextSimilarity`, the stopword list, and the containment-vs-Jaccard
> weighting — all of which exist and were tuned against spec §23's own example. Two scorers
> drift, and the §23 fix (*"finish the poster"* vs *"still need to finish that Hult
> poster"*: 0.250 → 0.900) would have to be rediscovered in the second one. Reuse, with the
> veto handled at the call site and a comment saying why.
>
> **Rejected: mutating `hasHardVeto` to take a mode flag.** It puts a Phase 3 concern
> inside a Phase 2 function that duplicate detection also calls, and a mode flag on a veto
> is exactly the kind of parameter someone later passes wrong. The call-site probe is
> local and self-documenting.

### 4.2 Zero matches, and multiple

| Outcome | Behaviour |
|---|---|
| `auto_match` (≥0.92) | Complete it. Reply per §31: *"Got it — Hult poster marked complete."* **Near-unreachable by construction — see the note below. Do not plan on it firing.** |
| `ask` (0.65–0.92, or several in band) | **Ask, commit nothing for this intent.** *"Which one — the Hult poster or the CRM deck?"* Per §3.3 this intent is blocked; anything depending on it is blocked too. |
| `create` / zero candidates | **Do not create a completed commitment. Ask.** See below. |

> **`auto_match` almost never fires for completions, and that is deliberate.** It requires
> the two content-token sets to be **identical** — one extra content token caps a two-token
> match at `0.7·1.0 + 0.3·(2/3) = 0.900`, below the 0.92 threshold. Measured against the
> real scorer: `"give me the article"` vs `"the article"` scores **0.850**, and
> `"the Hult poster"` vs `"the poster"` also **0.850**. Both ask.
>
> So **`ask` is the expected band for completion matching**, not an edge case, and §10's
> demo is two turns because of it. Do not "fix" this by lowering `AUTO_THRESHOLD` (§4.1
> forbids it) or by auto-completing a lone surviving candidate (§10 rejects it — the vetoes
> narrow the field, they do not confirm intent, and a wrongly-completed commitment fails
> silently by vanishing from *"what am I waiting on"*). The band table above is pinned as a
> unit test; change it deliberately, never to make a test pass.

**Zero matches is the interesting case, and the answer is "ask", not "create".**

*"Barkha gave the article at 11"* with no matching open commitment means one of: the
commitment was never recorded, it is recorded under a different owner direction, or the
object text is too different. Creating a retroactive already-completed commitment would:

- write a row the user never asked for, with a fabricated `expected_at` (or none, making
  §20's lateness unreachable — the very thing the sentence is about),
- and silently hide the real, still-open commitment if the miss was a text-similarity
  failure rather than a genuine absence.

So: `create` from `detectDuplicate` is treated by `matchCompletionTarget`'s **caller** as
an ask, not a create. Reply: *"I don't have anything from Barkha about the article — want
me to record it as done anyway?"* If the user says yes, the *next* turn is an ordinary
`create_commitment` + `complete_commitment` pair in one turn, undoable as one unit.

> **Rejected: auto-creating the completed commitment.** §27 says infer when safe. This is
> not safe: it is a write the user did not request, about a fact the system has no record
> of, and per `DECISIONS.md` #9 a wrong write beats a visible gap **never**. The
> `DuplicateDecision.reason` field (`no_candidates` | `hard_veto` | `below_threshold`)
> exists precisely so the question can be honest about *why* — it feeds §28's
> "why did you do that?" surface in Phase 4.

**One consequence worth stating.** With the current lexical `objectTextSimilarity`
(interim until Phase 4 embeddings, as `resolve.ts` says in its own comment), *"the article"*
vs *"the piece"* scores 0 and will ask. That is the correct failure direction under
`DECISIONS.md` #9 and it will look dumb sometimes. Do not "fix" it by lowering
`ASK_THRESHOLD`; the fix is Phase 4's embeddings over `commitments.object_embedding`, which
already ships NULLable for this.

---

## 5. Respond — one Haiku call, with a mandatory template fallback

Settled by `ceo3` and restated here as a build contract.

### 5.1 The call

```ts
export interface RespondInput {
  readonly committed: readonly CommittedFact[];   // plain data — no rows, no ids the model can echo
  readonly questions: readonly string[];          // already-composed clarifications
  readonly declined: readonly string[];           // e.g. "I can't look things up yet"
}

export interface Responder {
  respond(input: RespondInput): Promise<{ reply: string; degraded: boolean }>;
}
```

- Model: **Haiku**, injectable, defaulting to a constant in `packages/shared` next to
  `EXTRACTION_MODEL` — the same anti-drift reason that constant exists.
- **`tools: []`, no `tool_choice`, no DB handle, no pool, nothing constructed from
  `ToolContext`.** The Responder's constructor takes an Anthropic client and nothing else.
  That is the guarantee: a hallucination produces a wrong *sentence*, never a wrong *row*.
- `max_tokens: 200`. §31 says be concise; a token cap makes "concise" structural rather
  than a request the model may ignore.
- Input is a **plain summary object**, never row objects. The model never sees a UUID —
  there is nothing for it to echo back that could be mistaken for a resolved identifier.
- The system prompt carries §30's examples verbatim (*"Got it."* over *"I've successfully
  analyzed…"*; *"Karthik from Hult?"* over *"Please clarify which Karthik entity…"*) and
  §20's *"do not make judgmental statements"* clause.

**Why a model at all, when templates exist.** Two places inside this phase's own demo where
templating genuinely fails, both named by `ceo3`:

1. **§20's optional late-completion prompt.** *"Got it — she sent it at 11 PM, five hours
   late. Do you want to add any context for the delay?"* — and *"if the user says no, do
   not continue asking."* That last clause is conversational state, not string formatting.
2. **§30's *"Karthik from Hult?"*** Choosing *which* attribute disambiguates naturally —
   organization? project? the last thing they were mentioned about? — is judgement. A
   template picks one column forever and is wrong whenever that column is empty or shared.

### 5.2 The fallback — concrete, and mandatory

**The mutation has already committed when Respond runs.** A cosmetic model failure must not
produce a 500, must not roll anything back, and must not be retried into a paid loop.

```ts
export function templateReply(input: RespondInput): string {
  const parts: string[] = [];
  for (const fact of input.committed) {
    switch (fact.kind) {
      case "commitment_created":
        parts.push(`Noted: ${fact.ownerName} → ${fact.objectText}${
          fact.expectedAtLocal ? `, due ${fact.expectedAtLocal}` : ""}.`);
        break;
      case "reminder_created":
        parts.push(`Reminder set for ${fact.fireAtLocal}.`);
        break;
      case "commitment_completed":
        parts.push(
          fact.latenessMs != null && fact.latenessMs > 0
            ? `Got it — ${fact.objectText} marked complete, ${formatDuration(fact.latenessMs)} late.`
            : `Got it — ${fact.objectText} marked complete.`,
        );
        break;
      case "commitment_updated":
        parts.push(`Updated: ${fact.objectText}${fact.status ? ` — ${fact.status}` : ""}.`);
        break;
    }
  }
  parts.push(...input.questions, ...input.declined);
  return parts.join(" ") || "Done.";
}
```

`formatDuration` is deterministic and unit-tested: `5 * 3600_000` → `"five hours"`
(§20's own wording), rounding to the nearest hour above 90 minutes and to minutes below.

**It fires on every one of these, with no retry:**

| Condition | Why no retry |
|---|---|
| Any thrown error from the SDK (network, 429, 5xx) | A retry loop on a paid endpoint is the most expensive failure available (`.claude/rules/wat.md` §3) |
| `stop_reason === "refusal"` | Retrying a refusal produces another refusal |
| `stop_reason === "max_tokens"` | A truncated sentence is worse than a template one |
| Empty or whitespace-only text | Nothing to show the user |
| Reply exceeds a hard character cap (600) | §31; a wall of text is a failure of the one thing this call is for |
| A timeout (**3 s**, `AbortController`) | The mutation is already durable; the user is waiting on cosmetics |

The 3-second timeout is not a nicety. Without it, an SDK hang makes a *committed* turn
appear to fail, and the user says it again — producing a duplicate the §23 machinery then
has to catch. Bound the cosmetic stage.

**`degraded: true` is surfaced, not swallowed.** It goes into `TurnResponse.degraded`, is
logged with the trace (§8), and is asserted by a test that injects a throwing client and
checks the reply is still correct and the row is still there. `ai-systems.md`: *"never
present a fallback as a confident answer"* — the reply is honest either way (it states
what happened), but the *system* must know which path produced it, or a Haiku outage looks
like normal operation forever.

> **Rejected: templates only, no model.** Fails §20's optional-prompt clause and §30's
> disambiguation, both inside this phase's demo. See §5.1.
>
> **Rejected: letting Respond run before the transaction commits, so a failure aborts the
> turn.** Then a Haiku outage rolls back the user's completed commitment. The whole
> argument for the fallback is that the write is more important than the sentence.
>
> **Rejected: Respond given read access to fetch context for a better sentence.** A DB
> handle is the difference between "hallucinates a sentence" and "hallucinates a sentence
> while holding a connection". Everything Respond needs, Mutate already knows and passes
> in.
>
> **Rejected: one retry with a shorter prompt.** Tempting and cheap-looking. It doubles
> worst-case latency on a stage the user is already waiting through, and the template is
> *right there* and always correct.

---

## 6. Reminder firing — the in-process poller

**Settled.** `pg_cron` is absent from `pgvector/pgvector:pg17` (verified from the image's
Dockerfile source; `PHASE-1-DESIGN.md` §6, `DECISIONS.md` #7). The custom-image path
requires a GHCR publish step on a repo where we hold WRITE, not ADMIN. **In-process
poller.**

### 6.1 The query

`reminders_pending_idx` already exists with exactly this predicate (migration 004, whose
comment says it exists for this poller):

```sql
CREATE INDEX reminders_pending_idx ON reminders(fire_at)
  WHERE fired_at IS NULL AND t_invalid IS NULL;
```

The claim:

```sql
SELECT id, commitment_id, body, fire_at, source_phrase
  FROM reminders
 WHERE fired_at IS NULL
   AND t_invalid IS NULL
   AND fire_at IS NOT NULL
   AND fire_at <= $1                      -- the injected instant, NEVER now()
 ORDER BY fire_at
 LIMIT $2
   FOR UPDATE SKIP LOCKED
```

- **`fire_at <= $1`, not `<= now()`.** The clock is a parameter. This is what makes the
  poller testable without sleeping — see §6.4.
- **`fire_at IS NOT NULL`** excludes the relational and event-trigger tiers
  (`DECISIONS.md` #3). Those have no timestamp and belong to the rule engine (§7), not the
  poller. The partial index does not filter them, so the query must.
- **`FOR UPDATE SKIP LOCKED`** so two API instances never hand the same reminder to two
  users. Rejected alternative: an advisory lock around the whole batch, which serialises
  every instance onto one and defeats the point of running more than one.
- **`LIMIT $2`** (default 100). A backlog after downtime must not be read in one
  unbounded transaction.

### 6.2 `fired_at` is the idempotency key

Inside the same transaction as the `SELECT ... FOR UPDATE`:

```sql
UPDATE reminders SET fired_at = $2 WHERE id = ANY($1::uuid[]) AND fired_at IS NULL
```

The redundant `AND fired_at IS NULL` costs nothing and makes a double-fire impossible even
if the row lock were somehow not held. Delivery is **at-least-once**; `fired_at` is what
collapses it to effectively-once. `pg_cron` would have needed the identical guard.

### 6.3 `actor_kind = 'scheduled_job'` — and undo does still exclude it

Firing writes an `action_log` entry through `executeTurn`'s optional third parameter, which
**already exists** in `apps/api/src/tools/executor.ts`:

```ts
export async function executeTurn(
  calls: readonly ToolCall[],
  deps: Deps,
  actorKind: ActorKind = "user_turn",
): Promise<ExecuteTurnOutcome>
```

The poller calls `executeTurn(calls, deps, "scheduled_job")`.

**Confirmed against the code, not the plan.** `undoTurn`'s `SELECT` is:

```sql
WHERE turn_id = $1 AND actor_kind = 'user_turn'
```

A `scheduled_job` turn therefore returns **zero rows**, and `undoTurn` throws
`TurnNotFoundError`. The user cannot undo a clock tick. This is `PHASE-1-DESIGN.md` §2.7
invariant 4 and migration 005's own comment, and it holds without modification.

One consequence to handle rather than discover: `TurnNotFoundError` is what the user gets
if they say "undo that" immediately after a reminder fires and the assistant's last
`turn_id` happened to be the scheduled one. **The orchestrator must track the last
`user_turn` id per user for undo, never "the most recent `turn_id` of any kind."**

The firing tool itself is `fire_reminder`, `invertibility: 'full'` (its inverse resets
`fired_at` to the captured prior value — `NULL`) even though undo will never reach it. A
tool that could not name its inverse would have to declare `'none'`, and declaring `'none'`
on something that *is* reversible would poison any future admin-level replay. Same
self-join capture as §1.1.

### 6.4 The injectable clock — and the 15-second trap

> ⚠️ **`apps/api/vitest.integration.config.ts` sets `testTimeout: 15_000`.** Verified. Any
> poller test that waits on a real interval to tick will time out before it does anything
> useful. **The injectable clock is not a nicety — it is the only way this is testable.**

```ts
export interface Clock { now(): Date; }
export const systemClock: Clock = { now: () => new Date() };

export interface PollerDeps {
  readonly db: { withTransaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> };
  readonly clock: Clock;
  readonly batchSize?: number;
  readonly onFire: (reminder: DueReminder, tx: DatabaseTransaction) => Promise<void>;
}

/** ONE pass. Pure with respect to time: reads clock.now() exactly once, at the top. */
export async function pollOnce(deps: PollerDeps): Promise<{ fired: number }>;

/** The loop. The ONLY place setInterval appears. Never called from a test. */
export function startReminderPoller(deps: PollerDeps, intervalMs = 30_000): { stop(): void };
```

**Every test calls `pollOnce` with a fixed `clock`. No test calls `startReminderPoller`.
No test sleeps.** Write that as a comment in the test file, because the next person's
instinct is to start the loop and wait.

```ts
it("fires a reminder whose fire_at has passed", async () => {
  const at = new Date("2026-09-11T11:30:00+05:30");
  await seedReminder({ fireAt: "2026-09-11T11:00:00+05:30" });
  const r = await pollOnce({ ...deps, clock: { now: () => at } });
  expect(r.fired).toBe(1);
});

it("does not fire the same reminder twice", async () => {
  /* two pollOnce calls at the same instant; second returns fired: 0 */
});

it("does not fire a reminder that is not yet due", async () => {
  /* clock one minute before fire_at */
});

it("does not fire an invalidated reminder", async () => {
  /* t_invalid set — the undo path; a cancelled reminder must stay silent */
});

it("logs the firing as scheduled_job, and undo refuses it", async () => {
  await expect(undoTurn(turnId, deps)).rejects.toThrow(TurnNotFoundError);
});
```

The last one is the regression test for invariant 4. Without it, someone "simplifying"
`undoTurn`'s `WHERE` clause makes clock ticks undoable and nothing fails.

`intervalMs = 30_000` is deliberately coarse. Reminders in this product are set at
human granularity (*"at 5"*); a 30-second worst-case skew is invisible, and a 1-second poll
is 30× the query load for nothing. Record it as a tunable, not a constant of nature.

### 6.5 If the process dies mid-transaction

**Nothing is lost, and nothing double-fires — by construction, not by recovery code.**

The `SELECT ... FOR UPDATE SKIP LOCKED`, the `UPDATE ... SET fired_at`, and the
`action_log` insert are **one transaction**. If the process dies at any point before
`COMMIT`:

- Postgres rolls the transaction back when the connection drops (the backend notices the
  closed socket).
- `fired_at` stays `NULL`. The row is still claimed by nobody.
- The row reappears in the very next `pollOnce` on any instance, and fires then.

The failure mode this leaves is **a delayed reminder**, bounded by the poll interval — not
a lost one and not a duplicated one. That is the correct trade for this product.

**The one thing that breaks it, stated so nobody builds it:** any external side effect
(email, push, webhook) performed *inside* the transaction is not covered by the rollback,
so a crash between the side effect and the `COMMIT` sends twice. Phase 3 has no external
delivery — a fired reminder becomes an assistant `messages` row, which *is* transactional.
**When Phase 7 adds external delivery, it needs a transactional outbox, and the delivery
must happen after commit, keyed on `fired_at`.** Recorded here because that is the moment
this design stops being sufficient, and it will not be obvious then.

Two smaller points:

- **Connection loss mid-`SELECT`** is identical: no rows were claimed, nothing changed.
- **A stuck instance holding row locks** blocks nobody: `SKIP LOCKED` means other instances
  step over locked rows rather than waiting. When the stuck instance's connection is
  reaped, the locks release and the rows reappear.

---

## 7. Conditional rules (§25), flattened

*"If Arun hasn't sent the schema by Friday, remind me."*

`DECISIONS.md` #2: **recursive schemas are unsupported by Anthropic structured outputs**, so
the representation is flattened to a fixed depth — not a recursive AST. `workflows` was
deliberately deferred out of Phase 1 (`PHASE-1-DESIGN.md` §1) precisely because its shape
depended on extraction existing. Extraction exists now.

### 7.1 The `workflows` table (migration 008)

```sql
CREATE TYPE workflow_condition_kind AS ENUM (
  'commitment_not_completed',   -- "if Arun hasn't sent the schema"
  'commitment_not_updated'      -- "if Barkha doesn't reply"  (interim: same check, different wording)
);

CREATE TYPE workflow_action_kind AS ENUM (
  'remind',      -- "remind me"
  'ask'          -- "ask me whether I want to follow up"
);

CREATE TABLE workflows (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FIXED DEPTH, ONE LEVEL. Exactly one condition, one deadline, one action.
  -- Not an AST, not a JSONB tree: DECISIONS.md #2 rules out recursion at the
  -- extraction boundary, and a shape the model cannot emit is a shape we must
  -- not store. Compound conditions ("if X and Y") are OUT OF SCOPE for Phase 3
  -- and are rejected at validation with a clean ToolError, not silently
  -- half-stored.
  condition_kind      workflow_condition_kind NOT NULL,
  subject_commitment_id uuid NOT NULL REFERENCES commitments(id),
  evaluate_at         timestamptz NOT NULL,     -- "by Friday", resolved by chrono
  action_kind         workflow_action_kind NOT NULL,
  action_body         text NOT NULL,            -- raw content field, never resolved
  source_phrase       text,                     -- the verbatim conditional, auditable
  evaluated_at        timestamptz,              -- NULL = not yet evaluated. IDEMPOTENCY KEY.
  fired               boolean                   -- NULL until evaluated; then did the condition hold
);
SELECT add_bitemporal_columns('workflows');

-- Exactly the poller's WHERE clause, same shape as reminders_pending_idx.
CREATE INDEX workflows_pending_idx ON workflows(evaluate_at)
  WHERE evaluated_at IS NULL AND t_invalid IS NULL;
```

> **Rejected: a JSONB `condition` column holding an arbitrary predicate tree.** Maximum
> flexibility, and it is what "represent the condition" reads like it wants. Rejected on
> `DECISIONS.md` #2's authority: a tree the model cannot reliably emit under the strict
> subset is a tree we cannot populate, so the flexibility would be decorative — and it
> moves validation from Postgres enums into hand-written JSONB checks, which is the exact
> mistake `PHASE-1-DESIGN.md` §2.8 rejected for `entity_types`.
>
> **Rejected: reusing the `reminders` table with a nullable condition.** A workflow is not
> a reminder: it fires *conditionally*, and it may resolve to nothing at all. Overloading
> `reminders` means every poller query grows a "and it is not actually a workflow" clause,
> and `reminders_pending_idx` stops matching its own predicate.
>
> **Rejected: a general rule engine.** Three sentence-shapes in the spec (§25's three
> examples) do not justify one. Two condition kinds and two action kinds cover all three.

### 7.2 When the condition is evaluated

**At `evaluate_at`, by the same poller pass, in the same transaction as reminder firing —
never continuously.**

`pollOnce` does two claims per pass: due reminders (§6.1), then due workflows:

```sql
SELECT id, condition_kind, subject_commitment_id, evaluate_at, action_kind, action_body
  FROM workflows
 WHERE evaluated_at IS NULL
   AND t_invalid IS NULL
   AND evaluate_at <= $1
 ORDER BY evaluate_at
 LIMIT $2
   FOR UPDATE SKIP LOCKED
```

For each claimed workflow, evaluate the condition **against live state**:

```sql
SELECT status FROM commitments_current WHERE id = $1
```

- `condition_kind = 'commitment_not_completed'` holds **iff** the status is not
  `completed`, `completed_late`, `cancelled` or `superseded`.
- Then, in the same transaction: `UPDATE workflows SET evaluated_at = $1, fired = $2`.
- If it held, emit the action (a `create_reminder` firing immediately, or an assistant
  message) in the same `scheduled_job` turn.

`evaluated_at` is the idempotency key, exactly as `fired_at` is for reminders. Same
crash-safety argument as §6.5, verbatim: the whole thing is one transaction, so a crash
leaves `evaluated_at` NULL and the workflow is re-claimed next pass.

> **Rejected: evaluating continuously (checking every poll pass whether the condition holds
> *yet*).** It answers a question nobody asked. *"If Arun hasn't sent the schema **by
> Friday**"* is a statement about Friday, not about Wednesday. Continuous evaluation fires
> on Wednesday when Arun simply has not gotten to it yet — spec §26's *"Bad: You should
> study now"* nagging, and it is out of scope besides (§26 is Phase 4).
>
> **Rejected: a database trigger on `commitments` that fires the workflow the moment the
> condition becomes true.** Same wrongness plus `DECISIONS.md` #2's structural objection:
> a trigger writes state with no actor, which is the exact argument that removed stored
> `due_soon`/`overdue` (`PHASE-1-DESIGN.md` §2.4). It would also put business logic in
> plpgsql, where no test in this repo can reach it.

### 7.3 Early completion must NOT fire the rule

**This is the correctness requirement of the whole section**, and the design above satisfies
it for a structural reason worth naming explicitly: **evaluation reads live state at
`evaluate_at`.** If Arun sent the schema on Wednesday, then on Friday
`commitments_current.status` is `completed` (or `completed_late`), the condition
`commitment_not_completed` is **false**, and `fired` is set to `false`. Nothing is emitted.
The user is never reminded about something that already happened.

The row is still marked `evaluated_at` — the rule was evaluated and correctly declined.
That is what makes §28's *"why didn't you remind me?"* answerable in Phase 4: the log says
*evaluated on Friday, condition did not hold*.

**Two paths that also correctly silence a workflow, both needing a test:**

1. **The subject commitment was invalidated** (undo, or a §17 correction). It is absent
   from `commitments_current`, so the `SELECT` returns zero rows. **Zero rows means do not
   fire** — treat it as `fired = false`, not as "condition holds because it isn't
   completed". Getting this backwards fires a reminder about a commitment that no longer
   exists, which is the most confusing possible output.
2. **The workflow itself was undone.** `t_invalid IS NOT NULL`, so the claim query never
   sees it. The `create_workflow` tool's inverse is an invalidate, same as every other
   create.

Three tests, all with a fixed clock:

```ts
it("fires when the commitment is still open at evaluate_at");
it("does NOT fire when the commitment completed early");           // §7.3, the requirement
it("does NOT fire when the subject commitment was invalidated");   // zero-rows path
```

---

## 8. Trace persistence

Phase 2's extractor already captures model, latency, stop reason, and token counts
including cache accounting, and `PHASE-2-DESIGN.md` deliberately persists none of it,
assigning that to Phase 3. `messages` exists with a `turn_id` column.

### 8.1 Schema (migration 009)

```sql
ALTER TABLE messages
  ADD COLUMN trace jsonb,          -- ExtractionTrace + respond trace; NULL for user messages
  ADD COLUMN degraded boolean;     -- true iff the template fallback produced this reply
CREATE INDEX messages_trace_model_idx ON messages ((trace->>'model')) WHERE trace IS NOT NULL;
```

> **Rejected: a separate `traces` table with an FK to `messages`.** Normalised, and it is
> what a metrics pipeline would eventually want. Rejected for now: it is a second table
> with exactly one consumer (`messages`), a 1:1 relationship, and no query that joins it to
> anything else. `PHASE-1-DESIGN.md` §2.8's *"free columns are only free when you know what
> the columns are"* cuts the other way here — we know exactly what the trace shape is
> (`ExtractionTrace`, already typed in `packages/shared`), and it is read as a unit or not
> at all. Revisit when something aggregates across traces without touching messages.
>
> **Rejected: structured columns (`model text`, `input_tokens int`, ...).** The Respond
> stage's trace and the Interpret stage's trace have different shapes, and a third stage
> will have a fourth. JSONB with one expression index on the field we will actually filter
> by (`model`) is the honest fit.

### 8.2 What is persisted, and what must not be

| Persisted | Why |
|---|---|
| `model`, `stopReason`, `latencyMs` | `ai-systems.md`: *"an LLM failure with no trace is unfixable"*; a 200 OK can still be a wrong answer |
| `usage` (input/output/cache tokens) | `DECISIONS.md` open question 4 (per-message cost budget) **cannot be answered without these**, and spec §22 means every message triggers extraction |
| `requestId` | The only handle for a support conversation with the vendor |
| `degraded` | Otherwise a Haiku outage is indistinguishable from normal operation |
| The **user utterance** (`messages.body`) | Already persisted; it is the product's own record |

**Not persisted:** the raw model completion object, and the extracted `Extraction` payload
itself. The utterance plus the trace is enough to re-run and compare; storing the
intermediate interpretation doubles the storage of every turn to preserve a value that is
reproducible from data we already keep — and `ExtractionError.rawPayload` already carries
it in-process for the failure path, where it matters.

**Trace is written even when the turn mutates nothing** (a question, a refusal, a
validation rejection). Those are exactly the turns worth studying. In that case
`messages.turn_id` stays NULL (§3.2) and the trace lives on the assistant message anyway —
which is why `trace` is on `messages` and not on `action_log`.

> **Rejected: putting the trace in `action_log.forward_patch`.** `action_log` is an
> append-only ledger of *mutations and their inverses* (migration 005's own closing
> comment: no bitemporal columns, because it is a ledger, not a fact). A turn that mutates
> nothing has no `action_log` row at all — so the traces most worth reading would be the
> ones never written.

---

## 9. Running the demo as a human

**The gap, stated plainly:** there is no UI until Phase 5, and if the only way to see this
phase's demo is a CI test, nobody ever experiences the product. That is a real DX defect,
not a nicety — every judgement in §5 (conversational tone, §31 conciseness, §20's optional
prompt) is *unfalsifiable* by a test suite. A human has to read the replies.

**Decision: one HTTP endpoint on the existing Fastify server, plus a two-line curl in the
README.** It is a test surface, not a product surface.

```
POST /turn
  { "utterance": "Barkha needs to give me the article by 6. Remind me at 5 to ask her." }
→ { "turnId": "...", "reply": "Noted — Barkha owes you the article by 6 PM. Reminder set for 5 PM.",
    "asked": [], "committed": ["create_commitment","create_reminder"], "degraded": false }

POST /undo   { "turnId": "..." }   → { "undone": 2 }
```

Three guards, because an unauthenticated write endpoint that spends model tokens is a real
liability even locally:

1. **Registered only when `process.env.ENABLE_DEMO_ENDPOINT === "true"`.** Absent in CI,
   absent by default. A route that does not exist cannot be reached.
2. **Binds `127.0.0.1` when the demo endpoint is on.** The server currently binds
   `0.0.0.0`, which is right for a container and wrong for an unauthenticated dev endpoint.
3. **Requires `ANTHROPIC_API_KEY`.** Fails at startup with a clear message rather than at
   first request, so nobody discovers it mid-demo.

`README.md` gains a short section: `docker compose up postgres`, `pnpm db:migrate`,
`ENABLE_DEMO_ENDPOINT=true pnpm --filter @ourglass/api dev`, then the three curls that walk
the spec's own Barkha narrative — create, complete late, undo.

> **Rejected: a `pnpm demo` CLI.** Slightly nicer ergonomics (no JSON quoting on Windows,
> where this repo is developed). Rejected because it is a *second entry point* that has to
> construct the pool, read the env, build the registry, and instantiate both model clients
> — duplicating `server.ts`'s bootstrap. The moment those two drift, the demo stops
> demonstrating the thing that ships. The endpoint reuses `buildServer` exactly.
>
> If curl quoting on PowerShell proves genuinely painful, add
> `tools/demo-turn.ps1` — a thin wrapper that POSTs to the endpoint. That is the WAT
> answer: a script over the one entry point, not a second entry point.
>
> **Rejected: shipping it always-on with no flag.** An endpoint that spends tokens on
> unauthenticated input is exactly the shape `.claude/rules/security.md` says to treat as
> untrusted. Phase 7 owns the real permission model (§35); until then, off by default.
>
> **Rejected: exposing the demo through the eval harness (`pnpm test:live`).** That lane
> makes 69 paid calls and is manual-dispatch-only for that reason. A human wanting to type
> one sentence should not trigger it.

**One honest limitation.** The reminder poller fires on a 30-second interval against real
`fire_at` values, so demonstrating a *fired* reminder live means setting one a minute out
and waiting. Acceptable for a human demo. It is also why §6.4's tests use `pollOnce` with
an injected clock rather than this path.

---

## 10. Build order

Strictly sequential where marked; F1–F3 gate everything.

| # | Task | Blocks |
|---|---|---|
| 1 | `users` repository + `person_id` migration + `ensureUser` (**F2, F3**) | 3, 5 |
| 2 | `complete_commitment` repo fn + tool + inverse dispatch (**F1**, §1) | 5, demo |
| 3 | Lateness derivation + `past`-direction regression test (§2) | demo |
| 4 | `update_commitment` (§1.4) | §22 demo |
| 5 | Orchestrator: stages, dependency graph, partial-commit rule (§3) | 6, 7, 8, 9 |
| 6 | Respond + template fallback + degraded flag (§5) | demo |
| 7 | Reminder poller + `pollOnce` tests with injected clock (§6) | — |
| 8 | `workflows` table + evaluation in `pollOnce` (§7) | — |
| 9 | Commitment notes for §20 context attachment (**F4**, §7 of `PHASES.md` scope) | demo |
| 10 | Trace persistence (§8) | — |
| 11 | Demo endpoint + README (§9) | — |

**F4's concrete shape**, since it is small and otherwise unspecified: a
`commitment_notes` table (`commitment_id`, `body`, `source_message_id`, bitemporal) rather
than a `notes text` column on `commitments`. A column would be overwritten by the second
piece of context and would carry no provenance; `PHASES.md` puts *"with message
provenance"* in scope explicitly, and `relationships.source_message_id` is the established
pattern for it. Its tool is `attach_context`, invertibility `full`, inverse = invalidate.

### Definition of done

Beyond `pnpm typecheck && pnpm lint && pnpm test`:

```
pnpm db:migrate && pnpm -r --if-present run test:integration
```

Plus, per `DECISIONS.md` Phase 1 finding #8's standing lesson — **a migration that has only
been read is not verified**: migrations 007, 008 and 009 must run against the live CI
Postgres before this phase is called done. Expect a syntax-level surprise even after
thorough review; that has now happened in both prior schema phases.

The phase demo is the spec's own Barkha narrative end-to-end, with
*"Barkha gave the article at 11"* producing `completed_late` and a five-hour delay —
**run by a human through §9's endpoint, not only asserted in CI.**

**The completion is TWO turns, and that is the correct behaviour — not a degraded demo.**

```
> Barkha needs to give me the article by 6. Remind me at 5 to ask her.
  Noted - Barkha owes you the article by 6 PM. Reminder set for 5 PM.

> Barkha gave the article at 11.
  Which one - "give me the article", due 6 PM?

> Yes.
  Got it - marked complete, five hours late.
```

The middle turn is not a bug to be tuned away. Completion `auto_match` requires the two
content-token sets to be **identical**, so it fires only when the user repeats the stored
`object_text` verbatim modulo stopwords. Measured against the real scorer (§4.2's pinned
test records these):

| stored `object_text` | user says | score | band |
|---|---|---|---|
| `the article` | `the article` | 1.000 | `auto_match` |
| `give me the article` | `the article` | 0.850 | **`ask`** |
| `the Hult poster` | `the poster` | 0.850 | **`ask`** |
| `the article by 6` | `the article` | 0.800 | **`ask`** |
| `the piece` | `the article` | 0.000 | `create` |

One extra content token caps a two-token match at `0.7·1.0 + 0.3·(2/3) = 0.900`, under the
0.92 threshold. Since the demo's own first sentence plausibly stores `"give me the
article"`, **the ask path is the expected path**, not an edge case.

Asking here is spec §27 working, not failing: *"Infer when safe. Ask when necessary. Never
guess when guessing can cause a meaningful mistake."* Marking the wrong commitment complete
is a meaningful mistake, and a near-invisible one — a wrongly-completed commitment silently
stops appearing in *"what am I waiting on"*, the §28 surface a user would rely on to catch it.

> **Rejected: auto-completing when exactly one candidate survives the vetoes.** Tempting —
> the owner/recipient vetoes already did the hard discrimination, so "there is nothing else
> it could mean" feels safe. It is still a guessed write. The vetoes narrowed the field;
> they did not confirm intent. `DECISIONS.md` #9 is unambiguous that a wrong write is the
> worst outcome in this system, and this one fails silently. Do **not** implement it, and
> do **not** lower `AUTO_THRESHOLD` to make the demo one turn — §4.1 already forbids
> exactly that, and the demo script above is the honest alternative.
>
> Found during the build by `ai-agent-engineer` and `staff-code-reviewer` independently,
> and re-derived by the lead before the decision. The code was never wrong; §4.2 presented
> `auto_match` as a live band when the arithmetic makes it near-unreachable, and this
> section's acceptance criterion was written as though the auto path would fire. **A
> threshold band that is unreachable by construction is a documentation defect even when
> every line of code is correct.**

**Standing caveat, carried forward from Phase 2 and still true:** none of the above says
anything about model behaviour. There is still no recorded model output in the repo, and
`pnpm test:live` has never been run. Phase 3 adds a *second* model call (Respond), so the
unmeasured surface grows. §5's fallback means a Respond failure is cosmetic — that is the
mitigation, and it is not the same thing as evidence.

---

## 11. File-ownership map

One glob per role, **non-overlapping**. File ownership between agents is **convention plus
the spawn prompt** — `.claude/rules/agent-teams.md` §3 establishes by direct test that
`/freeze` protects a session from *itself*, not one teammate's files from another's, and
that the slot is global while enforcement is per-session.

| Role | Owns (glob) | Notes |
|---|---|---|
| `database-data-engineer` | `packages/db/**` | **Sole owner** of schema. Migrations 007 (`users.person_id`), 008 (`workflows`), 009 (`messages.trace`), plus `commitment_notes`. New repositories: `users`, `reminders`, `messages`, `commitment_notes`; extends `commitments` with `completeCommitment` / `uncompleteCommitment` / `updateCommitment` / `restoreCommitmentFields` / `listOpenForOwner`. **Publish `completeCommitment`'s signature and the `workflows` DDL to `backend-lead` and `ai-agent-engineer` the moment they settle** — both are blocked on them. |
| `backend-lead` | `apps/api/src/tools/**`, `apps/api/src/server.ts`, `apps/api/src/reminders/**` | `complete_commitment`, `update_commitment`, `attach_context`, `fire_reminder`, `create_workflow`; the `commitments` inverse-dispatch branch (§1.3); the poller (§6); the demo endpoint (§9). |
| `ai-agent-engineer` | `apps/api/src/assistant/**` | Orchestrator (§3), Respond + fallback (§5), completion matching (§4), the self-mention short-circuit in `resolve.ts`. **First code in this glob** — Phase 1 and 2 left it to Phase 2's extract/resolve/time only. |
| `backend-lead` | `packages/shared/src/**` | Shared types: `RespondInput`, `CommittedFact`, the Respond model constant. Publish immediately — `ai-agent-engineer` builds against it. |
| *(unassigned)* | `apps/web/**` | **No frontend work in Phase 3.** Do not spawn `frontend-lead`. |
| `staff-code-reviewer` | *(read-only)* | No write tools; runs in parallel safely. |

**Root config** (`package.json`, `docker-compose.yml`, `.github/workflows/**`, `README.md`)
is **lead-owned**. Two implementers editing root `package.json` is the classic silent
overwrite in this repo's layout.

**`/freeze`:** at most **one** implementer runs it, for its own benefit only. Given three
implementers with genuinely separate globs, the recommendation is that
`database-data-engineer` holds it (schema is the highest-cost thing to have strayed into).
Anyone told to freeze while the slot is occupied must **refuse** and message the lead and
the holder — overwriting a live boundary buys nothing and disarms the holder's hook.

### Browser owner

**There is no browser work in Phase 3, and no browser owner is assigned — deliberately.**

There is still no UI (§29 is Phase 5, and `PHASES.md` puts all UI explicitly out of this
phase's scope). §9's demo endpoint is a JSON surface exercised by curl, not a page. Per
`.claude/rules/routing.md` §9, a teammate that cannot be justified in one sentence is not
spawned: **do not spawn `qa-browser-lead` or `frontend-lead`.** The gstack browse daemon
must not be started during Phase 3 at all. The exclusive-browser-owner rule
(`agent-teams.md` §1) resumes at Phase 5.

### Team

Three implementers plus one read-only reviewer: `database-data-engineer`, `backend-lead`,
`ai-agent-engineer`, `staff-code-reviewer`. Auto-committing skills (`/review`, `/qa`,
`/ship`, `/graphify --update`) run **only in the lead, after every teammate has shut down**
(`agent-teams.md` §2).

---

## 12. Decisions to record in `DECISIONS.md`

1. **`complete_commitment` and `update_commitment` capture pre-update state via the
   `FROM (SELECT ...) AS old` self-join**, the same pattern `mergePerson` uses. `RETURNING *`
   yields post-update state and produces a silently wrong inverse — Phase 1 build finding
   #4, one table over. Both `uncomplete`/`restore` functions take prior values with **no
   defaults**.
2. **Lateness is derived in the tool layer from two `timestamptz` columns, never from model
   output, and is never stored.** `expected_at IS NULL` → plain `completed`, `latenessMs:
   null` (not zero). Strictly `> 0` is late. Completion intents **must** pass
   `direction: "past"` to `resolveTime`.
3. **Partial commit is allowed only for intents INDEPENDENT of every asked intent**;
   a dependent ask aborts the whole turn. Dependence is structural (does call B reference
   an id call A creates), computed by the orchestrator, not judged. Every partial turn's
   reply states both what committed and what was asked.
4. **`turn_id` originates in `executeTurn` and is not hoisted into the orchestrator.** A
   non-mutating turn leaves `messages.turn_id` NULL, as migration 004 already specifies.
5. **Completion matching reuses `detectDuplicate`** with a `"pending"` probe status and
   pre-filtered open candidates, because its completed-vs-not veto is inverted for this
   use. **Zero matches asks; it never creates a retroactive completed commitment.**
6. **Respond is one Haiku call with no tools and no DB handle, and a deterministic template
   fallback that fires on error, refusal, truncation, empty text, over-length, or a 3 s
   timeout — with no retry.** `degraded` is persisted, not swallowed.
7. **In-process poller, formally chosen over `pg_cron`** (`DECISIONS.md` #7 asked Phase 3 to
   decide; this is the decision). `FOR UPDATE SKIP LOCKED` + `fired_at` as the idempotency
   key + an **injectable clock**. `pollOnce(clock)` is the tested unit; `startReminderPoller`
   is never called from a test — `apps/api/vitest.integration.config.ts`'s
   `testTimeout: 15_000` makes any interval-waiting test fail by construction.
8. **Firing is `actor_kind = 'scheduled_job'`.** `undoTurn`'s `WHERE actor_kind =
   'user_turn'` already excludes it — confirmed against the code. The orchestrator tracks
   the last **`user_turn`** id for "undo that", never the most recent turn of any kind.
9. **`workflows` is fixed-depth: one condition, one deadline, one action** (`DECISIONS.md`
   #2 — no recursion under the strict subset). Evaluated **at `evaluate_at`, by the poller,
   against live state**; a commitment completed early makes the condition false and the rule
   does not fire. `evaluated_at` is the idempotency key. Compound conditions are rejected at
   validation, not half-stored.
10. **Trace persists as JSONB on `messages`**, including on turns that mutate nothing —
    not in `action_log`, which has no row for a non-mutating turn.
11. **New findings F2, F3, F4, F5:** `users.timezone` had no reader; the user had no person
    row so "me" could not resolve; commitments had nowhere to attach §20 context; `messages`
    and `reminders` had no repository. All four are plan claims the code did not support,
    all four are Phase 3 prerequisites, and none was detectable by typecheck, lint, or the
    green test suite. **Before planning Phase 4, grep the schema for columns no repository
    function names.**
