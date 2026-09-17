/**
 * Permission grants and pending actions — migration 011,
 * docs/PHASE-7-PERMISSIONS-DESIGN.md.
 *
 * NEVER CALLED WITH MODEL OUTPUT. Grants and confirmations are a control plane
 * outside the model (design §1); the only writers are the control-plane tools
 * in apps/api, reached from explicit user actions, and the orchestrator's hold
 * step, which records calls the planner — not the model — produced.
 */
import type { Queryable } from "../client.js";

export type PermissionDecision = "allow" | "confirm";

export interface PermissionGrant {
  id: string;
  action_type: string;
  decision: PermissionDecision;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

export type PendingActionStatus = "pending" | "executed" | "declined" | "failed";

export interface PendingAction {
  id: string;
  /** The held intent's tool calls, as `{ name, input }` objects. */
  calls: unknown;
  risk_level: string;
  summary: string;
  source_message_id: string | null;
  status: PendingActionStatus;
  expires_at: Date;
  decided_at: Date | null;
  executed_turn_id: string | null;
  failure: unknown;
  t_created: Date;
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

/** The one current grant for an action type, or null (the unique index allows one). */
export async function currentGrant(
  tx: Queryable,
  actionType: string,
): Promise<PermissionGrant | null> {
  const { rows } = await tx.query<PermissionGrant>(
    `SELECT * FROM permission_grants WHERE action_type = $1 AND t_invalid IS NULL`,
    [actionType],
  );
  return rows[0] ?? null;
}

/** Every current grant, keyed for the gate's lookups. */
export async function listCurrentGrants(tx: Queryable): Promise<PermissionGrant[]> {
  const { rows } = await tx.query<PermissionGrant>(
    `SELECT * FROM permission_grants WHERE t_invalid IS NULL ORDER BY action_type`,
  );
  return rows;
}

export async function createGrant(
  tx: Queryable,
  input: { actionType: string; decision: PermissionDecision },
): Promise<PermissionGrant> {
  const { rows } = await tx.query<PermissionGrant>(
    `INSERT INTO permission_grants (action_type, decision)
     VALUES ($1, $2::permission_decision)
     RETURNING *`,
    [input.actionType, input.decision],
  );
  return rows[0]!;
}

/**
 * Revocation. INVALIDATE, NEVER DELETE — a revoke is undoable and auditable.
 * Idempotent: re-invalidating must not move the recorded instant.
 */
export async function invalidateGrant(tx: Queryable, id: string): Promise<void> {
  await tx.query(
    `UPDATE permission_grants SET t_invalid = COALESCE(t_invalid, now()) WHERE id = $1`,
    [id],
  );
}

/** The inverse of revocation. */
export async function revalidateGrant(tx: Queryable, id: string): Promise<void> {
  await tx.query(`UPDATE permission_grants SET t_invalid = NULL WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Pending actions
// ---------------------------------------------------------------------------

/**
 * Hold an intent's calls for confirmation.
 *
 * The expiry is computed from the DATABASE clock (`now() + ttl`), not passed
 * in. Everything that later checks it — `decidePendingAction`'s
 * `expires_at > now()` — reads the database clock too, so one clock decides
 * both ends. A caller-supplied instant from an injected turn clock would make
 * a request born already-expired whenever that clock is behind the server's.
 */
export async function createPendingAction(
  tx: Queryable,
  input: {
    calls: readonly unknown[];
    riskLevel: string;
    summary: string;
    ttlSeconds: number;
    sourceMessageId?: string | null;
  },
): Promise<PendingAction> {
  const { rows } = await tx.query<PendingAction>(
    `INSERT INTO pending_actions (calls, risk_level, summary, expires_at, source_message_id)
     VALUES ($1::jsonb, $2, $3, now() + make_interval(secs => $4::double precision), $5::uuid)
     RETURNING *`,
    [
      JSON.stringify(input.calls),
      input.riskLevel,
      input.summary,
      input.ttlSeconds,
      input.sourceMessageId ?? null,
    ],
  );
  return rows[0]!;
}

export async function getPendingAction(tx: Queryable, id: string): Promise<PendingAction | null> {
  const { rows } = await tx.query<PendingAction>(`SELECT * FROM pending_actions WHERE id = $1`, [
    id,
  ]);
  return rows[0] ?? null;
}

/** Most recent first: open requests and the recent decisions beside them. */
export async function listRecentPendingActions(tx: Queryable, limit = 50): Promise<PendingAction[]> {
  const { rows } = await tx.query<PendingAction>(
    `SELECT * FROM pending_actions ORDER BY t_created DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

/**
 * Move a PENDING, UNEXPIRED row to a decision — or change nothing.
 *
 * `WHERE status = 'pending' AND expires_at > now()` is the correctness
 * guarantee, not the caller's earlier read: a concurrent second release blocks
 * on the row lock, then matches zero rows. Returns null in that case, and the
 * caller must treat null as "someone else decided it" (design §5).
 */
export async function decidePendingAction(
  tx: Queryable,
  id: string,
  decision: { status: "executed"; turnId: string } | { status: "declined" },
): Promise<PendingAction | null> {
  const { rows } = await tx.query<PendingAction>(
    `UPDATE pending_actions
        SET status = $2::pending_action_status,
            decided_at = now(),
            executed_turn_id = $3::uuid
      WHERE id = $1 AND status = 'pending' AND expires_at > now()
      RETURNING *`,
    [id, decision.status, decision.status === "executed" ? decision.turnId : null],
  );
  return rows[0] ?? null;
}

/**
 * Record that a release was attempted and a held call no longer validated.
 * Written OUTSIDE the failed turn (whose transaction rolled back), and only
 * from pending, so it can never overwrite a real decision.
 */
export async function markPendingActionFailed(
  tx: Queryable,
  id: string,
  failure: unknown,
): Promise<PendingAction | null> {
  const { rows } = await tx.query<PendingAction>(
    `UPDATE pending_actions
        SET status = 'failed', decided_at = now(), failure = $2::jsonb
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [id, JSON.stringify(failure)],
  );
  return rows[0] ?? null;
}

/** The inverse of a decision: back to pending. Used by undo only. */
export async function reopenPendingAction(tx: Queryable, id: string): Promise<void> {
  await tx.query(
    `UPDATE pending_actions
        SET status = 'pending', decided_at = NULL, executed_turn_id = NULL, failure = NULL
      WHERE id = $1`,
    [id],
  );
}
