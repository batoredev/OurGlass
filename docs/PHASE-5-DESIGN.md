# Phase 5 design — Dynamic entities + minimal UI

The `entity_types` registry made usable end to end, schema-driven frontend rendering, and the
bare read-only inspection surfaces of spec §29.

**Importers: none.** Read by contributors and by the Phase 5 build team before it spawns.
Companion to `PHASE-1`–`PHASE-4-DESIGN.md`.

**Demo:** *"track my gym sessions with a date and a duration"* creates a new type that appears
in the UI immediately, **with no deploy** — and the user can then record an actual session.

---

## 0. Findings — plan claims the code does not support

Written first, as in every phase. The rule: **verify a prerequisite by finding the CODE PATH,
not the schema object.** Phase 4 produced F7–F11 plus `events`; this phase produces four more.

### F12 — a type can be defined, and NOTHING can create a record of it

`define_entity_type` (Phase 1) writes `entity_types` and `entity_type_fields`. Verified
against the code: **`entity_records` appears in exactly one place in the entire repo — a
reserved-names list inside that same tool.** No repository, no tool, no query.

So today the demo half-works in the worst possible way: *"track my gym sessions"* succeeds,
the type exists, and the user then has **nowhere to put a session**. That is not a missing
feature at the edge — it is the centre of the user's stated requirement, and it is the first
task of this phase.

### F13 — nothing can READ the registry either

There is no `entity_types` repository. `define-entity-type.ts` issues its own raw SQL
(`SELECT count(*)`, `SELECT id FROM entity_types WHERE type_key = $1`) for validation and
never exposes a read. **The frontend cannot fetch the registry, because no code returns it.**

### F14 — the API has three routes, none of which serve data

`apps/api/src/server.ts` registers `/health`, `/turn`, `/undo`. §29's surfaces — Today,
Commitments, People, Projects, Memory, Activity — have **no endpoint**. The web app cannot
render tables that nothing serves.

### F15 — `apps/web` is a Phase 0 placeholder with no data path

`apps/web/app/page.tsx` renders a hardcoded heading and `OURGLASS_SCHEMA_VERSION`. There is no
fetch, no API client, no component that has ever displayed a row. Its only dependency on the
rest of the system is one constant.

> **The honest summary of all four:** Phase 5 is not "add a UI to a working backend". It is
> "build the read layer, then the UI". `PHASES.md`'s one-line description hides that, and the
> build order below reflects the real shape.

---

## 1. `entity_records` — the missing half (F12)

The table exists (migration 006). What it needs is a repository and a tool.

```sql
-- migration 006, for reference — NOT re-created here:
CREATE TABLE entity_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type_id uuid NOT NULL REFERENCES entity_types(id),
  schema_version integer NOT NULL,
  payload        jsonb NOT NULL
);
```

### 1.1 Validation is DYNAMIC, and that is why the tool contract is a function

`PHASE-1-DESIGN.md` §4.1 chose `validate` as a **function** rather than a static schema object
specifically so this tool could exist: the valid shape of a `gym_session` payload is not known
until `entity_type_fields` is read at call time. `create_entity_record` is the first tool that
actually exercises that choice.

```
validate(raw, ctx):
  1. type_key -> entity_types_current row, else unknown_entity_type
  2. load entity_type_fields for that type, ordered by ordinal
  3. every REQUIRED field present, else missing_required_field
  4. every supplied key EXISTS in the schema, else unknown_field
  5. every value matches its field_kind, else invalid_field_value
  6. stamp schema_version = entity_types.current_version
```

**Rule 4 is the one worth stating explicitly.** Rejecting unknown keys is what stops
`entity_records.payload` from becoming an untyped bag: a typo'd `durationn` must fail loudly,
not persist silently and vanish from every render because no field definition names it.

### 1.2 Per-kind value validation

| `field_kind` | Accepts | Rejects, and why it matters |
|---|---|---|
| `text` | string | — |
| `number` | finite number | `NaN`, `Infinity` — both survive `typeof x === "number"` and neither round-trips through JSONB usefully |
| `bool` | boolean | the strings `"true"`/`"false"`, which a model will happily emit |
| `date` | ISO-8601 string | anything `Date.parse` rejects. **Stored as a string, not a `Date`** — JSONB has no date type, so a `Date` silently becomes an ISO string anyway; being explicit means the read path never has to guess |
| `enum` | a value in `enum_options` | anything else, by exact match |
| `person_ref` | a UUID **that resolves** | an unresolvable id. Checked against `people`, so a dangling reference cannot be stored — the same rule `create_commitment` applies to owner/recipient |

**`person_ref` is validated against the database, not just shape-checked.** A dynamic type
that can hold a broken foreign key is a dynamic type whose records render as blanks later.

### 1.3 `schema_version` is stamped at write time, never resolved at read time

The column exists and Phase 1 left it unused. It is stamped from `entity_types.current_version`
when the record is written.

> **Why this matters and is not ceremony:** `add_entity_field` can add an optional field to a
> populated type. Records written before that addition legitimately lack the key. Without a
> stamped version, the renderer cannot distinguish *"this record predates the field"* from
> *"this record is missing a required value"* — the first is normal and the second is a bug,
> and conflating them produces either false alarms or hidden corruption. With it, the renderer
> shows an em-dash for a field the record's version did not have.

---

## 2. The read layer (F13, F14)

### 2.1 `entity_types` repository

```ts
listTypes(tx): EntityTypeWithFields[]        // the whole registry, fields ordered by ordinal
getTypeByKey(tx, typeKey): EntityTypeWithFields | null
listRecords(tx, typeKey, limit): EntityRecord[]
```

`EntityTypeWithFields` is the **one shape the frontend renders from**. It carries
`type_key`, `display_name`, `current_version`, and `fields[]` each with `field_key`,
`field_kind`, `label`, `required`, `ordinal`, `enum_options`.

**Ordered by `ordinal`, always.** Migration 006's own comment says why: JSONB has no key
order, so without the stored ordinal there is no deterministic render order and the UI would
reshuffle columns between requests.

### 2.2 Read-only API routes

```
GET /api/entity-types              -> EntityTypeWithFields[]
GET /api/entity-types/:key/records -> EntityRecord[]
GET /api/commitments               -> §29 Commitments
GET /api/people                    -> §29 People
GET /api/projects                  -> §29 Projects
GET /api/memories                  -> §29 Memory
GET /api/activity                  -> §29 Activity (action_log)
GET /api/today                     -> §29 Today (due + overdue + upcoming)
```

**All GET, all read-only, no mutation endpoint anywhere in this phase.** Every mutation
continues to go through `/turn` and the validated tool layer (§37). A `POST /api/commitments`
would be a second write path around the tool layer — precisely the thing the architecture
exists to prevent — and it would be the easy shortcut once a UI exists.

> **Rejected: GraphQL, or one `/api/state` returning everything.** A single blob is simpler to
> write and makes every surface re-fetch the whole world on any change. Seven small endpoints
> match the seven surfaces §29 actually names.

**Guarded like the demo endpoint (Phase 3 §9), for the same reason:** these serve personal
data over HTTP with no authentication, because Phase 7 owns the permission model (§35). They
bind loopback and are registered only when the demo/UI flag is on.

---

## 3. Schema-driven rendering — the user's explicit requirement

> *"make sure that when new tables are created by the llm, the link to it and display of it in
> the frontend must be also managed accordingly"*

**The frontend has NO hardcoded list of entity types.** It fetches `/api/entity-types` and
renders generically from `field_kind`. A type defined thirty seconds ago appears on the next
page load with no deploy, no migration, and no code change.

### 3.1 One renderer per `field_kind`, and the enum is closed

```tsx
function renderValue(kind: FieldKind, value: unknown, ctx: RenderContext): ReactNode
```

Six kinds, six branches, and an exhaustiveness check so a seventh `field_kind` added to the
Postgres enum **fails to compile** rather than rendering `[object Object]`.

| kind | rendering |
|---|---|
| `text` | as-is |
| `number` | as-is, right-aligned |
| `bool` | ✓ / ✗ |
| `date` | formatted in the user's timezone |
| `enum` | the matching option's `label`, not its `value` |
| `person_ref` | the person's `display_name`, resolved through the registry response |

**A missing key renders as an em-dash, never as "undefined" or a blank cell.** Per §1.3 that is
the normal state for a record predating an added field, not an error.

> **This is why `field_kind` is a closed six-value enum** (`DECISIONS.md`: the LLM invents
> *types* freely, never *kinds*). An open kind space would mean the frontend could receive a
> kind it has no renderer for — the exact failure the user's requirement rules out.

### 3.2 The §29 surfaces

Conversation view, plus Today / Commitments / People / Projects / Memory / Activity as
**read-only tables**, plus one generic page per dynamic type. Deliberately unstyled: the
execution plan puts UI last and these exist to make state inspectable, not attractive.

---

## 4. Build order

| # | Task | Blocks |
|---|---|---|
| 1 | `entity_records` repository + `create_entity_record` tool (**F12**) | 2, demo |
| 2 | `entity_types` repository: `listTypes`, `getTypeByKey`, `listRecords` (**F13**) | 3 |
| 3 | Read-only API routes, loopback-guarded (**F14**) | 4 |
| 4 | Web API client + the generic `field_kind` renderer (**F15**) | 5 |
| 5 | §29 surfaces + the dynamic-type page | demo |

### Definition of done

Beyond `pnpm typecheck && lint && test` and the integration lane:

- **A record can be created for a type defined in the same session**, verified end to end —
  not "the table accepts an insert".
- **The generic renderer handles all six `field_kind` values**, with the exhaustiveness check
  verified by mutation: add a seventh kind and the build must fail.
- **No mutation endpoint exists.** Asserted by a test that enumerates registered routes, so a
  future `POST /api/commitments` fails rather than quietly bypassing the tool layer.
- **Demo:** *"track my gym sessions with a date and a duration"* → the type appears in the UI
  → a session is recorded → it renders in the table. No deploy between any two steps.

**Carried forward, and now two phases old:** `pnpm test:live` has never run. Phase 5 adds no
new model dependency, so the unmeasured surface does not grow — but it does not shrink either.

**Also carried forward:** Phase 4's demo remains unwired (`PHASES.md`). Phase 5 does not
depend on it, and §24/§26 stay unreachable from a turn until someone adds the two call sites.

---

## 5. File-ownership map

| Role | Owns (glob) |
|---|---|
| `database-data-engineer` | `packages/db/**` — the two repositories |
| `backend-lead` | `apps/api/src/tools/**`, `apps/api/src/routes/**`, `server.ts` |
| `frontend-lead` | `apps/web/**` — first active phase for this role |
| `staff-code-reviewer` | read-only, no write tools |

**Browser owner: `qa-browser-lead`**, and this is the first phase where that matters — there
is a UI to drive. Per `.claude/rules/agent-teams.md` §1 the browse daemon is a single
persistent session: exactly one agent drives it, everyone else reports through them.
