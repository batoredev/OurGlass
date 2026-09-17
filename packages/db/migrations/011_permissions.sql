-- 011 — the §35 permission model (docs/PHASE-7-PERMISSIONS-DESIGN.md).
--
-- Two tables, deliberately different in kind:
--
--   permission_grants  a FACT about what the user allows — bitemporal,
--                      invalidate-never-delete, so a revoke is undoable.
--   pending_actions    a WORKFLOW record — an intent's tool calls held for a
--                      one-time confirmation, moving pending -> decided once.
--
-- Neither is ever written by the model. Grants and confirmations are a
-- control plane outside it (design §1): a grant that extraction could
-- propose is a grant a prompt-injected document could propose.
--
-- Forward-only; `pnpm db:reset` is the rollback model.

-- ---------------------------------------------------------------------------
-- permission_grants — persistent permission, by action type, revocable
-- ---------------------------------------------------------------------------
CREATE TYPE permission_decision AS ENUM (
  'allow',    -- "Always allow calendar creation."   (lifts EXTERNAL_ACTION only)
  'confirm'   -- "Require confirmation before …"     (honoured at every risk level)
);

CREATE TABLE permission_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A registered TOOL NAME. "By action type" (§35) maps onto the unit the risk
  -- table already classifies; the tool validates membership, this CHECK only
  -- keeps the column shaped like an identifier.
  action_type  text NOT NULL CHECK (action_type ~ '^[a-z][a-z0-9_]*$'),
  decision     permission_decision NOT NULL
);
SELECT add_bitemporal_columns('permission_grants');

-- ONE current grant per action type. Revocation sets t_invalid, which is what
-- lets a new grant for the same type be recorded while the old row survives
-- for audit and undo.
CREATE UNIQUE INDEX permission_grants_one_current
  ON permission_grants (action_type)
  WHERE t_invalid IS NULL;

-- ---------------------------------------------------------------------------
-- pending_actions — one-time confirmation
-- ---------------------------------------------------------------------------
CREATE TYPE pending_action_status AS ENUM (
  'pending',   -- awaiting the user
  'executed',  -- released: its calls committed in executed_turn_id
  'declined',  -- the user said no; nothing ran
  'failed'     -- released, but a held call no longer validated; nothing ran
);

CREATE TABLE pending_actions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A WHOLE INTENT'S calls, not one call. An intent's calls are interdependent
  -- (a create_person whose id a later call uses); holding one while committing
  -- another would split one atomic unit across two moments.
  calls             jsonb NOT NULL
                    CHECK (jsonb_typeof(calls) = 'array' AND jsonb_array_length(calls) > 0),
  risk_level        text NOT NULL CHECK (risk_level IN (
                      'READ', 'REVERSIBLE_WRITE', 'IMPORTANT_STATE_CHANGE',
                      'EXTERNAL_ACTION', 'HIGH_IMPACT_ACTION')),
  -- What the user is being asked to approve, in words. Rendered from the
  -- planner's facts, never from model output.
  summary           text NOT NULL,
  source_message_id uuid REFERENCES messages(id),
  status            pending_action_status NOT NULL DEFAULT 'pending',
  -- A confirmation is for NOW, not forever: an approval given days later is
  -- approving a world that has moved on.
  expires_at        timestamptz NOT NULL,
  decided_at        timestamptz,
  executed_turn_id  uuid,
  failure           jsonb,
  -- Decided exactly when no longer pending. A row with a decision time and a
  -- pending status — or the reverse — is a half-applied transition.
  CONSTRAINT pending_actions_decided_iff_not_pending
    CHECK ((status = 'pending') = (decided_at IS NULL)),
  -- Only an execution names a turn.
  CONSTRAINT pending_actions_turn_iff_executed
    CHECK ((status = 'executed') = (executed_turn_id IS NOT NULL))
);
SELECT add_bitemporal_columns('pending_actions');

CREATE INDEX pending_actions_open_idx
  ON pending_actions (t_created)
  WHERE status = 'pending';
