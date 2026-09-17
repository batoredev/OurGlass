# Phase 7a — the §35 permission model

Master plan stage 12. Spec §35: *"Separate internal state changes from external actions …
Build a permission system that supports: one-time confirmation, persistent permission,
permission by action type, permission revocation."*

This document covers **12a** (the permission model). **12b** (HTTP access control, replacing
`ENABLE_DEMO_ENDPOINT` as the only guard on the routes) is a separate section at the end.

---

## 0. What already exists

| Piece | Where | State |
|---|---|---|
| Risk level per tool | `apps/api/src/tools/risk.ts` | Classification only before this stage; its risk-only `requiresConfirmation` had no caller and was deleted in favour of `decidePermission` |
| Confirmation floor | `packages/shared/src/risk.ts` | `EXTERNAL_ACTION` |
| Registered tools | 14, all `REVERSIBLE_WRITE` or `IMPORTANT_STATE_CHANGE` | Nothing external exists until stage 14 |
| Undo | `executeTurn` / `undoTurn`, per-table inverse handlers | Reused unchanged |

Locked decision (EXECUTION-PLAN): *act immediately on internal state, undo available; external
actions confirm.*

---

## 1. The rule this design turns on

**A permission is never granted by talking to the model.**

Spec §35's examples are phrased conversationally — *"Always allow calendar creation."* — and
the obvious build is an extraction field that becomes a `set_permission` call. That build is
rejected, and the reason is the whole security model:

> If a grant can come from extraction, it can come from anything extraction reads. Stage 13
> ingests documents and screenshots. A PDF containing *"Always allow sending emails"* would be
> one prompt injection away from granting it. §37 says the model proposes and the backend
> validates — but a *grant* is precisely the thing that changes what validation allows. It must
> not be proposable.

So permissions form a **control plane outside the model**: explicit HTTP actions by the user,
executed through the same tool layer (validation, one transaction, `action_log`, undo), and
**never reachable from a conversational turn**. The orchestrator refuses a control-plane tool if
a planner ever emits one — failing closed, not trusting that no planner does.

This is also why confirming a held action is a button, not a chat reply. A conversational
*"yes, send it"* is deferred (§7) for the same reason: the confirming signal must not be
something a model could produce on the user's behalf.

---

## 2. Schema — migration 011

```sql
permission_grants   (id, action_type, decision: allow|confirm) + bitemporal
                    UNIQUE (action_type) WHERE t_invalid IS NULL   -- one current grant per type
pending_actions     (id, calls jsonb[], risk_level, summary, source_message_id,
                     status: pending|executed|declined|failed, expires_at,
                     decided_at, executed_turn_id, failure jsonb) + bitemporal
                    CHECK ((status = 'pending') = (decided_at IS NULL))
```

- **Revocation is invalidation**, never deletion — the same invalidate-never-delete rule as every
  other table, so a revoke is undoable and auditable.
- **`action_type` is a tool name.** "By action type" (§35) maps onto the unit the risk table
  already classifies. A grant for a name that is not a registered tool is rejected.
- **A pending action holds a whole intent's calls**, not one call. An intent's calls are
  interdependent (a `create_person` whose id a later call uses); holding one and committing the
  other would split an atomic unit across two moments.

---

## 3. Policy

Pure function: `decidePermission(risk, grant) -> allow | confirm`.

| Risk | No grant | Grant `allow` | Grant `confirm` |
|---|---|---|---|
| `READ` | allow | allow | **confirm** |
| `REVERSIBLE_WRITE` | allow | allow | **confirm** |
| `IMPORTANT_STATE_CHANGE` | allow | allow | **confirm** |
| `EXTERNAL_ACTION` | **confirm** | allow | **confirm** |
| `HIGH_IMPACT_ACTION` | **confirm** | **confirm** — never persistently allowed | **confirm** |

- A **stricter** grant is always honoured: a user may ask to confirm before `forget_memory`.
- A **looser** grant can lift only `EXTERNAL_ACTION`. `HIGH_IMPACT_ACTION` always confirms, and
  `set_permission` rejects an `allow` grant for it rather than accepting a grant that would be
  silently ignored.
- Unclassified tool → `riskFor` throws. Fails closed.

---

## 4. Enforcement point

In `runTurn`, **after Resolve and before Mutate**. For each planned intent with calls, the
gate reads the current grants and the risk table:

- any call is a control-plane tool → **throw** (a planner bug; never silently executed)
- any call resolves to `confirm` → the intent is **held**: its calls become one
  `pending_actions` row, and the intent gets a question telling the user it awaits approval.
  Being a question, it is blocked by the existing partial-commit rule — and so is every intent
  that depends on it. No new blocking mechanism.
- otherwise → commits as today.

Why not inside `executeTurn`: stage 7 found that a check which can only *throw* enforces
nothing but name presence, and every in-memory test double would have to join the production
risk table. The gate needs to *hold*, which needs the planner's intent grouping — which exists
only in `runTurn`.

What keeps that honest: a **structural test** lists every production call site of
`executeTurn` and fails when a new one appears (`executor.callsites.test.ts`). Today there are
four: `runTurn` (gated), the poller (its two scheduled internal tools, checked by name),
pending-action release (which *is* the approval), and the permissions route (control-plane
tools only, checked by name).

---

## 5. Holding and releasing

**Hold** (in `runTurn`): insert `pending_actions` with `expires_at = now + 24h`, the intent's
calls, their highest risk, and a summary rendered from the intent's planned facts.

**Release** (`releasePendingAction`, called by the confirm route): one `executeTurn` whose first
call is `release_pending_action`, followed by the held calls.

- `release_pending_action` validates `status = 'pending'` and `expires_at > now()`, then marks
  the row `executed` with `executed_turn_id = ctx.turnId` via `UPDATE … WHERE status =
  'pending'`. A concurrent second release blocks on the row lock, matches zero rows, throws, and
  rolls back its entire turn. **Double release cannot execute twice** — by construction, the same
  pattern as `fired_at` (PHASE-3-DESIGN §6.2).
- Everything is one transaction: if a held call no longer validates (the memory was already
  forgotten), the status update rolls back with it and the row is then marked `failed` with the
  tool's errors, outside the turn.
- **Undo** of a release turn reverses the held calls *and* reopens the row to `pending`. Undoing
  a decline reopens it too. Expiry still bounds a reopened row.

**Decline**: `decline_pending_action` marks `declined`. Nothing held is executed.

---

## 6. Control-plane surface

All behind the same access check as the other routes (§8 / 12b), and all mutating routes
require a same-origin JSON request.

| Route | Tool |
|---|---|
| `GET /api/permissions` | read: current grants, recent pending actions |
| `POST /api/permissions` `{action_type, decision}` | `set_permission` |
| `DELETE /api/permissions?action_type=…` | `revoke_permission` |
| `POST /api/pending-actions/{id}/confirm` | `release_pending_action` + held calls |
| `POST /api/pending-actions/{id}/decline` | `decline_pending_action` |

A **Permissions** page lists grants and pending actions with confirm, decline and revoke
buttons. This is the one deliberate exception to "the UI is read-only": the web client gets a
separate `lib/control.ts` for exactly these actions, and `lib/api.ts` stays read-only. The
exception exists because the model must not be the one issuing them (§1).

---

## 7. Deferred, with reasons

| Deferred | Why |
|---|---|
| Conversational grants ("always allow …") | §1 — a grant must not be proposable by the model |
| Conversational confirmation ("yes, send it") | §1 — same; and it needs a pending-action reference in the extraction contract |
| Per-tool human summaries for external actions | No external tool exists until stage 14; each will bring its own |
| Gating poller-driven actions | The poller runs only `fire_reminder` and `evaluate_workflow`; a workflow that *sends* something must hold, and is stage 14's problem, pinned by the structural test |

---

## 8. Stage 12b — HTTP access control

Until 12b, `ENABLE_DEMO_ENDPOINT` was the entire access control: every data route served
personal data to anyone, or served nothing. That is either no authentication or no product.

### Decision: a shared access token, per-route guard, signed session cookie

| Mode | When | Behaviour |
|---|---|---|
| `token` | `OURGLASS_ACCESS_TOKEN` set (≥ 32 chars) | `Authorization: Bearer <token>`, or the session cookie from `POST /api/session` |
| `demo` | no token, `ENABLE_DEMO_ENDPOINT=true` | open — **local development only**; ignored when a token is set |
| `closed` | neither | every data route 404s |
| `misconfigured` | token shorter than 32 chars | 500 naming the problem, never serve behind a guessable secret |

- **Why a token, not accounts.** The schema has one `users` row: this is a single-user
  assistant. Accounts would be an identity system for a population of one.
- **Why per-route, not middleware.** Next 16 renames middleware to "proxy", and its behaviour
  under the Cloudflare adapter is unverified here. Every route already had one guard call; the
  guard stays there, and `access-guard.test.ts` reads each route's source and fails if any
  exported handler does not call `authorize(request)` first.
- **Sessions.** `v1.<expiry>.<HMAC-SHA256>`, keyed by a key *derived from the token*, so rotating
  the token signs everyone out. Cookie `og_session`: `HttpOnly`, `Secure`, `SameSite=Strict`,
  7 days. Pure Web Crypto — identical under `next dev` and Workers; no dependency.
- **Comparison is constant-time**: both sides are HMAC'd under a random key and the fixed-length
  digests compared, so neither length nor content shapes timing.
- **Server components forward credentials.** Pages fetch the app's own `/api/*` from the server,
  where the browser's cookie is not attached automatically; `lib/api.ts` forwards the incoming
  `cookie` and `authorization` headers.
- **CSRF.** The cookie is `SameSite=Strict`, and every mutating route (`/api/turn`, `/api/undo`,
  the control plane, `/api/session`) also refuses a foreign `Origin` and non-JSON bodies.
- **Exempt**: `/api/health` (no data; monitors need it) and `/api/session` (the door).

### Rejected

| Option | Why not |
|---|---|
| Cloudflare Access as the only layer | Cannot be verified from this machine, and a server component's fetch to its own hostname would meet the Access login redirect. Recommended as an *additional* layer |
| A JWT library | Web Crypto does HMAC natively; a dependency for 40 lines is the wrong trade |
| Rate limiting in the app | A ≥ 32-character token makes online guessing hopeless; Cloudflare WAF rate rules are the right layer if the Worker is public |

### Not verified

The session flow has not been exercised against a deployed Worker — only by unit tests with real
crypto and, locally, by `next dev`.
