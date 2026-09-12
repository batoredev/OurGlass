-- 008 — workflows: conditional rules (spec §25), FLATTENED.
--
-- "If Arun hasn't sent the schema by Friday, remind me."
--
-- FIXED DEPTH, ONE LEVEL: exactly one condition, one deadline, one action. Not an
-- AST, not a JSONB predicate tree. docs/DECISIONS.md #2 records that RECURSIVE
-- SCHEMAS ARE UNSUPPORTED by Anthropic structured outputs under the strict subset,
-- and a shape the model cannot emit is a shape we must not store — the flexibility
-- would be decorative while moving validation out of Postgres enums and into
-- hand-written JSONB checks, which is the exact mistake PHASE-1-DESIGN §2.8
-- rejected for `entity_types`.
--
-- Compound conditions ("if X and Y") are OUT OF SCOPE for Phase 3 and are rejected
-- at tool validation with a clean ToolError — never silently half-stored.
--
-- `workflows` was deliberately deferred out of Phase 1 (PHASE-1-DESIGN §1) because
-- its shape depended on extraction existing. Extraction exists now (Phase 2).
--
-- Forward-only; `pnpm db:reset` is the rollback model.

CREATE TYPE workflow_condition_kind AS ENUM (
  'commitment_not_completed',   -- "if Arun hasn't sent the schema"
  'commitment_not_updated'      -- "if Barkha doesn't reply" (interim: same check,
                                --  different wording; split when they diverge)
);

CREATE TYPE workflow_action_kind AS ENUM (
  'remind',   -- "remind me"
  'ask'       -- "ask me whether I want to follow up"
);

CREATE TABLE workflows (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condition_kind        workflow_condition_kind NOT NULL,
  subject_commitment_id uuid NOT NULL REFERENCES commitments(id),
  -- "by Friday", resolved by chrono-node. The MODEL NEVER COMPUTES A TIMESTAMP
  -- (DECISIONS.md #4) — it extracts the phrase, chrono resolves it.
  evaluate_at           timestamptz NOT NULL,
  action_kind           workflow_action_kind NOT NULL,
  action_body           text NOT NULL,   -- raw content field (§3), never resolved
  source_phrase         text,            -- the verbatim conditional, auditable
  -- IDEMPOTENCY KEY, exactly as `reminders.fired_at` is for the reminder poller.
  -- NULL = not yet evaluated. A crash before COMMIT leaves it NULL and the row is
  -- re-claimed on the next pass (PHASE-3-DESIGN §6.5, same argument verbatim).
  evaluated_at          timestamptz,
  -- NULL until evaluated; then: did the condition actually hold? A rule that was
  -- evaluated and correctly DECLINED is the difference between "we forgot" and
  -- "we checked on Friday and Arun had already sent it" — which is what makes
  -- §28's "why didn't you remind me?" answerable in Phase 4.
  fired                 boolean
);
SELECT add_bitemporal_columns('workflows');

-- Exactly the poller's WHERE clause, same shape and same reasoning as
-- reminders_pending_idx in migration 004: the partial index stays the size of the
-- un-evaluated backlog rather than of all history.
CREATE INDEX workflows_pending_idx ON workflows(evaluate_at)
  WHERE evaluated_at IS NULL AND t_invalid IS NULL;

-- The subject is read on every evaluation, and "what rules watch this commitment?"
-- is the Phase 4 provenance query.
CREATE INDEX workflows_subject_idx ON workflows(subject_commitment_id)
  WHERE t_invalid IS NULL;

CREATE VIEW workflows_current AS SELECT * FROM workflows WHERE t_invalid IS NULL;

-- REJECTED: a JSONB `condition` column holding an arbitrary predicate tree.
--   Maximum flexibility, and it is what "represent the condition" reads like it
--   wants. Rejected on DECISIONS.md #2's authority (above).
-- REJECTED: reusing `reminders` with a nullable condition.
--   A workflow is not a reminder: it fires CONDITIONALLY and may resolve to
--   nothing. Overloading the table means every poller query grows an "and it is
--   not actually a workflow" clause, and reminders_pending_idx stops matching its
--   own predicate.
-- REJECTED: a general rule engine. Three sentence-shapes in spec §25 do not
--   justify one. Two condition kinds and two action kinds cover all three.
-- REJECTED: a database trigger on `commitments` firing the moment the condition
--   becomes true. Evaluation must happen AT `evaluate_at` against live state —
--   "by Friday" is a statement about Friday, not about Wednesday. A trigger also
--   writes state with no actor, the same argument that removed stored
--   due_soon/overdue (PHASE-1-DESIGN §2.4), and puts business logic in plpgsql
--   where no test in this repo can reach it.
