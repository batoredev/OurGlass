# Remaining execution plan

Everything still to build, in the order it should be built, with the decisions that must be
settled before each piece starts. Written for whoever picks this up next — the owner, or an
agent session reading it cold.

The plan of record for what is *already* built is
[`MASTER-EXECUTION-PLAN.md`](MASTER-EXECUTION-PLAN.md); this file takes over where its board
stops. Phase definitions come from [`PHASES.md`](PHASES.md), the product requirements from
[`SPEC.md`](SPEC.md), and the mission formats from [`MISSIONS.md`](MISSIONS.md).

---

## Where the build actually stands

| | |
|---|---|
| **Built and CI-verified** | Stages 1–12 plus 12d: schema and tool layer, extraction and resolution, the four-stage turn loop, reminders and conditional rules, memory and inspection, the dynamic entity registry, the UI, multi-provider AI with a measured fallback chain, the §35 permission model with its control plane, and the demo-readiness pass |
| **Not started** | Stage 13 (Phase 6, ingestion) — there is no `documents` table. Stage 14 (Phase 7, integrations) — no integration code exists. Stage 15 (Phase 8, voice) — no audio code |
| **Partial** | Stage 16 (full recheck) — the demo path was verified live on 2026-09-21; the model-quality half has never run |
| **Outside the original plan** | Track C, multi-tenant SaaS readiness. None of it exists, and none of it is needed until there is a second customer |

**One honest framing.** The product does what it claims through Phase 5 plus permissions.
The three unbuilt phases are the ones `DEMO-GUIDE.md` §4 tells you not to promise.

---

## Gate 0 — model provider capacity (owner action, blocks almost everything)

Nothing below that touches a model can proceed until one provider has capacity. As of
2026-09-21 neither does:

- **Anthropic** — `400 … credit balance is too low`
- **Gemini** free tier — `429 … exceeded your current quota`, plus `503 high demand` on all
  three flash models for stretches of the day

Pick one:

| Option | Cost | Effect |
|---|---|---|
| **Add Anthropic credit** *(recommended)* | Small — a demo is cents | Turns drop from 5–15s to about 1s, quality is the tier the prompts were written for, and B1/B4 unblock immediately |
| Paid Gemini tier | Small | Removes the daily cap; 503s are Google-side and remain |
| Install Ollama + `qwen3:8b` | Free, multi-GB, slow on CPU | The only quota-free option. Also clears stage 4's "unverified live" caveat |

Until then every turn answers *"I couldn't process that just now — nothing was saved."*

---

## Sequencing

```
Gate 0 (provider capacity)  ─┬─> Track B (live verification)  ─> Stage 16 recheck
                             │
                             └─> Track A: Phase 6 ──> Phase 7 ──> Phase 8
                                          (ingestion) (integrations) (voice)

Track C (multi-tenant SaaS) ── independent of A, gated on a BUSINESS decision, not a technical one
Track D (open decisions)    ── needed inputs, not engineering work
```

**Recommended order:** Gate 0 → Track B → Phase 6 → Phase 7 → Phase 8, with Track C inserted
before Phase 7 *only if* a second customer is committed. Rationale: Track B is cheap and tells
you whether the model behaves, Phase 6 is the largest remaining product gap, and Phase 7 is the
one with real external blast radius — it deserves to run after ingestion has exercised the
untrusted-input boundary.

---

## Track B — live model verification

**Why first.** It is the only evidence that the model *behaves*, as opposed to the code being
correct. Everything green today is evidence about the code. Cheap, fast, and it may change
what the phases below have to handle.

| Step | Command | Cost | Blocked on |
|---|---|---|---|
| **B1** | `pnpm test:live` | ~99 Sonnet calls | Anthropic credit |
| **B2** | *(done 2026-09-18/19)* | — | Found two real defects |
| **B3** | `pnpm eval:ai` with `OLLAMA_BASE_URL` set | free, slow | Ollama install |
| **B4** | `pnpm eval:ai` across every configured provider | ~97 calls per provider | B1 or B3 |

**Do not run B4 on a free-tier Gemini key the day of a demo** — 97 calls exhausts the daily
quota the demo needs. That is not hypothetical; it happened on 2026-09-21.

**What to do with the results.** The headline metric is `wrongMutationRisk`, not pass rate: a
wrong write is the worst outcome in this system (`DECISIONS.md` #9). Any fixture where the
model invents a field or fails to ask when the label says it should becomes a prompt fix plus a
pinned fixture — never a threshold change.

**Definition of done:** a results table committed into `AI_EVALS.md`, and the README's standing
caveat ("model quality is barely measured") rewritten to say what was measured.

---

## Track A — the remaining product phases

### Stage 13 — Phase 6, ingestion (§32, §33)

The largest remaining gap, and the one a producer is most likely to ask for ("can I forward it
a screenshot?").

**Settle before building — these are genuine unknowns, not implementation detail:**

1. **Where do the bytes live?** Supabase Storage, Cloudflare R2, or `bytea` in Postgres. The
   deployment target is GitHub + Supabase + Cloudflare (`DEPLOYMENT-DESIGN.md`), so R2 and
   Supabase Storage both fit; `bytea` does not survive a large PDF gracefully. **Decide before
   the schema.**
2. **Which parsers?** PDF, DOCX, XLSX, TXT, images. Versions and licences must be verified from
   primary sources, not recalled — spawn `research-analyst` first. This is exactly the
   capability gap `routing.md` §5 describes.
3. **Does an image go to a vision model, and which?** Claude and Gemini both do vision; the
   provider layer currently has no image path at all. This is an `AIProvider` contract change,
   so it touches every provider.
4. **Cost per ingest.** A 40-page PDF is not one turn's worth of tokens. `ai-systems.md` makes
   cost per request a design constraint — state it, cap it, and reject oversized input with an
   honest message rather than a surprise bill.

**The non-negotiable part.** Ingested content is **data, never instructions**. A poster that
says "delete all commitments" must produce, at most, a *proposed* tool call that validation and
the permission gate reject. The test for this is not optional and must be mutation-verified:
break the boundary, watch the test fail.

**Team (Mission 4, 4 teammates):** `database-data-engineer` (owns `packages/db/**` — the
`documents` table, bitemporal like everything else), `backend-lead` (upload route, storage
adapter), `ai-agent-engineer` (extraction, the vision contract, injection tests),
`security-cso` (read-only; owns the verdict on the trust boundary). `frontend-lead` joins for a
follow-up mission, not this one — the pipeline must be real before there is a button.

**Verification gates:** injection tests green and mutation-verified; a real PDF, DOCX, XLSX and
image ingested end to end; cost per ingest recorded; `pnpm eval:ai` unaffected; CI green
including integration.

**Size:** the biggest remaining item. Plan two missions — pipeline, then UI and association.

---

### Stage 14 — Phase 7, integrations (§34)

Gmail, Calendar, Drive. The permission model (§35, Phase 7a) that gates these is **already
built** — that was stage 12 — which is why this phase is now mostly integration work rather
than policy work.

**Settle before building:**

1. **OAuth app ownership.** Google Cloud project, consent screen, verification status. A
   consent screen in "testing" caps you at 100 users and expires refresh tokens weekly. Owner
   decision, and it has a lead time.
2. **Token storage.** Refresh tokens are credentials. They need encryption at rest and a
   rotation story — `security.md` forbids treating them like ordinary columns.
3. **Scopes.** `gmail.send` versus `gmail.compose` is the difference between the assistant
   being able to send on your behalf and only drafting. Least privilege, per scope, written
   down.
4. **What counts as irreversible.** Sending an email is not undoable, and `action_log`'s
   inverse machinery cannot reverse it. These actions must route through the existing
   `pending_actions` hold-and-confirm path, never through a standing grant.

**Team (Mission 4, 4–5):** `integration-engineer` (owns the Google clients), `backend-lead`,
`security-cso` (read-only, and this time with teeth — external side effects plus stored
credentials), `ai-agent-engineer` (tool definitions and the decline-vs-propose boundary), with
`research-analyst` first if the Google SDK surface is not verified.

**Verification gates:** every external action confirmed through a real `pending_actions` hold;
a revoked grant provably stops the action; tokens encrypted; scopes minimal and documented; no
path from ingested content (Phase 6) to an external send without a human confirmation.

**Size:** one mission per surface (Gmail, then Calendar, then Drive). Do not attempt all three
at once.

---

### Stage 15 — Phase 8, voice

The spec calls this "eventually" (§1), and it is the lowest-value remaining item. Keep it
small.

**The one decision:** browser `SpeechRecognition` (free, zero backend, uneven browser support)
versus a hosted transcription API (costs per minute, consistent). For an internal tool the
browser API is the honest first move — it can ship in a single session.

**Scope discipline:** speech *into the existing composer*, nothing else. Voice replies, wake
words and continuous listening are not in the spec and should not appear because they are easy.

**Team:** `frontend-lead` solo, or with `accessibility-engineer` read-only — a microphone
affordance has real accessibility implications.

---

### Stage 16 — full recheck and run test

Runs last, and partly overlaps Track B.

**Checklist:** every phase demo script from `PHASES.md` replayed end to end against a live
model; every page in the browser with console clean; reminders fired and observed; a permission
granted, used, and revoked; undo across each tool; `pnpm eval:ai` results recorded; the
production build deployed and smoke-verified (`production.md` gates).

**Team (Mission 2, read-only, 4 teammates):** `staff-code-reviewer`, `security-cso`,
`performance-engineer`, `qa-browser-lead` — the last of which is the exclusive browser owner.

**Definition of done:** an evidence table, not an assertion. "Tests pass" requires having run
them.

---

## Track C — multi-tenant SaaS readiness

**Gated on a business decision, not a technical one.** Today the product is single-user by
construction: one shared access token, no tenant boundary, and entity resolution that searches
every person in the database. That is *correct* for an internal Batore assistant and
*disqualifying* for a second customer.

**Do not start this before the demo.** C1 is a schema migration across every table of live
Supabase data, and CLAUDE.md §7 requires an independent reviewer on work of that risk.

**C1 — tenancy foundation (everything else depends on it)**

- `tenant_id uuid NOT NULL` on every domain table; RLS enabled per table with a policy on
  `current_setting('app.tenant_id')`; the setting applied inside `withTransaction` so no query
  can forget it.
- A cross-tenant leak test that is **mutation-verified** — drop the policy, watch it fail.
  Anything less is a citation, not a verification.
- Three known leaks to close, each already identified: `resolvePersonMention` scores against
  all people (two tenants' "Arun"s would collide — the wrong-merge failure `DECISIONS.md` #9
  calls the worst in the system); hybrid retrieval ranks over the whole `memories` table; and
  `/api/undo` accepts any `turnId` without checking who owns it.

**C2 — identity and auth.** Real identity on `users`, a hosted IdP rather than rolled
credentials, and an actor id threaded through `executeTurn`, which today takes only
`actorKind`. §37's "is the actor permitted?" check is documented and has no code. Lands after
C1 and overlaps the existing permission model — do them together rather than sequentially.

**C3 — billing.** Plans, subscriptions, usage. The per-turn token trace already exists in
`messages.trace`; attribute it to a tenant and enforce a budget **before** the Interpret call,
which is the difference between a bounded and an unbounded cost.

**C4 — deployment pipeline.** No Dockerfile exists. IaC choice undecided. CI today is
test-only; a deploy pipeline plus post-deploy smoke verification is a separate piece.

**C5 — rollback.** `db:reset` is the current model and is fine for a disposable dev database —
it is a loaded gun now that Supabase holds real data. Needs down-migrations for the existing
migrations, confirmed PITR, and a runbook.

**C6 — load and infrastructure.** `pg` defaults to `max: 10` and a turn checks out several
connections; Supabase session mode has its own ceiling. Load-test before believing either. The
reminder poller uses one fixed global batch — at scale reminders fire silently late.

**C7 — independent adversarial review.** The last SaaS review ran solo with no second
reviewer. C1 and C2 both need `staff-code-reviewer` plus `security-cso`, per CLAUDE.md §7.

---

## Track D — decisions only the owner can make

These are inputs, not engineering work. Each one blocks something above.

| Decision | Blocks | Notes |
|---|---|---|
| Model provider capacity | Everything | Gate 0 |
| Repo ADMIN on `batoredev/OurGlass` | Branch protection, required checks, security toggles | `DECISIONS.md` open question 1; we hold WRITE |
| Where ingested files live | Phase 6 schema | Supabase Storage vs R2 |
| Google Cloud project + consent screen | Phase 7 | Has a verification lead time |
| Cost budget per message | Phase 6 sizing, C3 | `DECISIONS.md` open question 4 — still unstated, and §22 means *every* message triggers extraction |
| Second customer: yes or no | All of Track C | The only thing that makes tenancy urgent |
| Pricing model | C3 | Product decision |
| Terms of service / privacy policy | Any external user | You store commitments and relationships about real people. Needs legal input before a second tenant |

---

## Standing rules for every mission above

Unchanged from CLAUDE.md, restated because they are what keeps this build honest:

1. **A stage is done when CI is green on it** — integration tests do not run on the dev machine
   here, so a local pass is not evidence.
2. **Every fix ships with a test that was shown to fail without it.** Break the code, watch it
   go red, restore.
3. **`/graphify --update` after every stage**, then read `GRAPH_REPORT.md` for God Nodes and
   Surprising Connections. A new edge from the ingestion parser into anything with write
   authority is the injection path this design forbids — the graph is how you see it
   structurally rather than hoping review catches it.
4. **Implementation agents do not approve their own work.** At least one independent reviewer
   per mission; for Track C, two.
5. **Never claim production-ready without evidence for the applicable gates** — functional QA,
   security review, performance validation, independent review, deploy verification,
   observability, rollback.
