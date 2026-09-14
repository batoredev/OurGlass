# Planner wiring — making the built tools reachable

**Importers: none.** Read before touching `packages/shared/src/assistant-contract.ts`,
`extraction-schema.ts`, or `apps/api/src/assistant/orchestrator.ts`.

`EXECUTION-PLAN.md`'s outstanding-work audit found the dominant gap: **13 tools registered,
4 reachable from a conversation.** This is the plan for closing that.

---

## 0. The audit was too optimistic, and here is why

The audit said the stranded tools were "one `case` branch each" away. **Verified against the
contract: they are not.** `ExtractedIntent` carries exactly nine fields:

```ts
kind, inferenceLevel, sourceText, owner, recipient, objectText, time,
reminderBody, relatedEntity
```

There is **no field that can express** "this is a correction", "forget this", "define a type
with these fields", or "the new status is blocked". Grep for
`correction|memoryBody|forget|entityType` in the contract returns **zero**. So a `case` branch
would have nothing to read.

**The real shape of the work, in order:**

1. Extend `ExtractedIntent` with the fields the stranded tools need.
2. Extend the JSON schema and system prompt so the model can *emit* them.
3. Add fixtures so the eval harness covers the new shapes.
4. *Then* add planner branches.

Steps 1–3 are the part the audit missed. Step 4 alone would produce branches that never fire —
the same "built but unreachable" failure one layer further in.

> **This is worth recording as its own lesson.** "One branch each" was a reasonable inference
> from *"the tool exists and the switch exists"*. It was wrong because it assumed the data
> flowing into the switch already carried what the branch would need. **Verifying reachability
> means checking the whole path, not the two ends of it.**

---

## 1. Contract additions

Minimal, and each justified by a specific tool that cannot be reached without it.

```ts
export interface ExtractedIntent {
  // ... existing nine fields unchanged ...

  /** §22 — "the poster is blocked", "push that to Friday". For update_commitment. */
  readonly newStatus?: CommitmentStatusHint;

  /** §16 — the durable fact to store, verbatim. For remember. */
  readonly memoryBody?: string;

  /** §17/§28 — what to stop treating as true. For forget_memory and correct_relationship. */
  readonly correctionTarget?: string;

  /** §25 — the conditional's two halves, flattened (DECISIONS.md #2 forbids recursion). */
  readonly condition?: ConditionReference;

  /** §36 — a type the user asks to track, and its fields. For define_entity_type. */
  readonly entityTypeDefinition?: EntityTypeDefinitionHint;

  /** §36 — one instance of an existing type. For create_entity_record. */
  readonly entityRecord?: EntityRecordHint;
}
```

**Every addition is optional**, so no existing extraction becomes invalid and the seven current
intent kinds keep working unchanged. That matters: Phase 2's eval fixtures are the only
evidence the extractor behaves at all, and a breaking contract change would invalidate all 69
of them at once.

### 1.1 Why these are fields and not new intent kinds

`inspection` earned a new kind because it is a genuinely different *act* — a read, mutating
nothing. These are not. *"The poster is blocked"* is an `information` intent with a status;
*"forget that Arun works on backend"* is a `context` intent with a correction target. Adding a
kind per tool would make `IntentKind` a list of function names, which is the model's job to
choose between and exactly the thing a taxonomy should protect it from.

### 1.2 The one place a new kind IS warranted

None, today. Recorded so the next person does not re-litigate: if ingestion (Phase 6) adds
*"here is a screenshot, extract from it"*, that is a different act and gets a kind.

---

## 2. What each tool needs, and its risk

| Tool | New field(s) | The failure mode if the model gets it wrong |
|---|---|---|
| `update_commitment` | `newStatus` | **Low.** A wrong status is visible in the Commitments table and correctable by saying so. |
| `remember` | `memoryBody` | **Low.** A spurious memory is visible in Memory and forgettable. |
| `forget_memory` | `correctionTarget` | **Medium.** Forgetting the wrong thing is invalidate-not-delete and undoable, but the user may not notice. |
| `correct_relationship` | `correctionTarget` | **Medium.** Same, plus it rewrites a timeline. The supersede preserves history, so it is recoverable. |
| `create_workflow` | `condition` | **Low.** A wrong rule evaluates and declines; §7.3 makes early completion silence it. |
| `define_entity_type` | `entityTypeDefinition` | **Medium.** Types are capped and reversible, but a junk type clutters the UI persistently. |
| `create_entity_record` | `entityRecord` | **Low.** Validation rejects unknown keys outright. |

**No tool here reaches HIGH**, which is the argument for wiring them all rather than a subset:
the dangerous write in this system is a wrong *merge* (`DECISIONS.md` #9), and none of these
merge anything. The resolution layer's three-band policy already guards the entity lookups they
depend on.

---

## 3. Ordering, and what blocks what

| # | Task | Blocks |
|---|---|---|
| 1 | Contract fields + `isExtraction` validation | 2, 4 |
| 2 | JSON schema + system prompt (derived, never retyped — see below) | 3 |
| 3 | Eval fixtures per new shape, incl. NEGATIVE ones | 4 |
| 4 | Planner branches, one per tool | demo |
| 5 | Wire §24 conflict + §26 gate into `runTurn` (Phase 4's unfinished half) | demo |
| 6 | `create_event` tool, so a conflict has something to conflict with | 5 |

**Task 2 is where the last two phases both bit.** The intent enum was hardcoded a second time
in `extraction-schema.ts`, so adding `inspection` to the taxonomy would have left the model
unable to emit it — dead on arrival with nothing failing. Both the schema enum and the prompt
now derive from `INTENT_KINDS`. **Any new field must be added to the JSON schema too, or the
model cannot produce it** and the planner branch never fires.

### 3.1 Negative fixtures are not optional here

Every new field is a way for the model to over-trigger. The fixtures must include utterances
that look like they need the field and do not:

- *"I should probably remember to call her"* → an `action`, **not** a `remember`.
- *"Arun handles backend"* → a `remember`, **not** a `correct_relationship` (nothing to correct).
- *"the poster is done"* → `completion_update`, **not** `update_commitment` with a status.

Without these, a field that fires too eagerly looks like a feature working.

---

## 4. Definition of done

- `pnpm typecheck && lint && test` green, plus the integration lane.
- **Every registered tool is emitted by at least one planner branch OR explicitly listed as
  poller-only.** Asserted mechanically, extending `registry.coverage.test.ts` — which already
  scans the orchestrator source for emitted names, so it only needs the inverse assertion.
- **The Phase 4 demo runs**: *"Schedule Arun at 5 tomorrow"* surfaces the Hult conflict and
  asks rather than choosing.
- Negative fixtures pass, so the new fields do not over-trigger.

**Still not measured, and this work does not change it:** `pnpm test:live` has never run. These
contract changes alter the extraction prompt, which is exactly what the live lane exists to
measure — so the unmeasured surface **grows** here. That is a reason to run it, not a reason to
skip the work, but it should be stated plainly rather than discovered later.
