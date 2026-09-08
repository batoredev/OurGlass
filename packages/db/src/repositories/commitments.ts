/**
 * Commitments — the primary abstraction (spec §6: COMMITMENT, not Task).
 *
 * OWNERSHIP DIRECTION IS TWO EXPLICIT COLUMNS, never one person_id plus a direction
 * flag. Spec §7 calls this "one of the major differentiating features". "I owe Barkha
 * the article" and "Barkha owes me the article" differ only in which column holds
 * which id — the direction is structural and is never inferred at read time.
 *
 * `object_text` is a CONTENT field, not an entity reference (§3): it stays a raw
 * string ("the article") and is never resolved into anything. Only entity
 * REFERENCES — owner_id, recipient_id, project_id — take resolved UUIDs.
 */
import type { Queryable } from "../client.js";

export type CommitmentStatus =
  | "pending"
  | "in_progress"
  | "waiting"
  | "waiting_on_someone"
  | "completed"
  | "completed_late"
  | "cancelled"
  | "blocked"
  | "superseded";

export interface Commitment {
  id: string;
  owner_id: string;
  recipient_id: string | null;
  object_text: string;
  object_embedding: string | null;
  expected_at: Date | null;
  completed_at: Date | null;
  status: CommitmentStatus;
  project_id: string | null;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

/**
 * `commitments_current` adds `display_status`, computed from (expected_at, now()).
 *
 * `due_soon` and `overdue` are NEVER stored (docs/DECISIONS.md #2). Storing them
 * would mean a scheduled job writing status changes — and if those writes land in
 * `action_log`, "undo that" can reverse a clock tick; if they don't, `action_log` is
 * no longer complete history and the Activity surface shows changes with no actor.
 * Both branches are wrong. Do not add a stored column for this.
 */
export interface CurrentCommitment extends Commitment {
  display_status: CommitmentStatus | "due_soon" | "overdue";
}

export interface CreateCommitmentInput {
  ownerId: string;
  recipientId?: string | null;
  objectText: string;
  expectedAt?: Date | string | null;
  projectId?: string | null;
  status?: CommitmentStatus;
}

export async function createCommitment(
  tx: Queryable,
  input: CreateCommitmentInput,
): Promise<Commitment> {
  const { rows } = await tx.query<Commitment>(
    `INSERT INTO commitments
       (owner_id, recipient_id, object_text, expected_at, project_id, status)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::commitment_status, 'pending'))
     RETURNING *`,
    [
      input.ownerId,
      input.recipientId ?? null,
      input.objectText,
      input.expectedAt ?? null,
      input.projectId ?? null,
      input.status ?? null,
    ],
  );
  return rows[0]!;
}

export async function getById(
  tx: Queryable,
  id: string,
): Promise<Commitment | null> {
  const { rows } = await tx.query<Commitment>(
    `SELECT * FROM commitments WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Current commitments with the computed `display_status`. */
export async function listCurrent(
  tx: Queryable,
): Promise<CurrentCommitment[]> {
  const { rows } = await tx.query<CurrentCommitment>(
    `SELECT * FROM commitments_current ORDER BY expected_at NULLS LAST`,
  );
  return rows;
}

/**
 * "What does Barkha owe me" / "what do I owe Barkha" — the two directions are two
 * different queries against two different columns, which is the point of the schema.
 *
 * Takes an already-resolved id. If the caller holds a possibly-merged id, resolve it
 * through `people.resolvePersonId` FIRST — this function does not resolve, because a
 * repository that silently resolved would hide which reads need it.
 */
export async function listByOwner(
  tx: Queryable,
  ownerId: string,
): Promise<CurrentCommitment[]> {
  const { rows } = await tx.query<CurrentCommitment>(
    `SELECT * FROM commitments_current WHERE owner_id = $1
      ORDER BY expected_at NULLS LAST`,
    [ownerId],
  );
  return rows;
}

export async function listByRecipient(
  tx: Queryable,
  recipientId: string,
): Promise<CurrentCommitment[]> {
  const { rows } = await tx.query<CurrentCommitment>(
    `SELECT * FROM commitments_current WHERE recipient_id = $1
      ORDER BY expected_at NULLS LAST`,
    [recipientId],
  );
  return rows;
}

/**
 * INVALIDATE, NEVER DELETE. This is the inverse of `createCommitment` and is what
 * undo calls. `DELETE` appears in no function in this package.
 *
 * IDEMPOTENT ON AN ALREADY-INVALID ROW. `t_invalid` means "when the fact stopped
 * being true IN THE WORLD" (§2.1) — it is not a tombstone flag, so re-invalidating
 * must not move it. The default path is `COALESCE(t_invalid, now())`, which keeps an
 * existing value; only an EXPLICIT `at` overwrites, because passing a timestamp is
 * the caller asserting when the fact actually ceased.
 *
 * Why this is not merely defensive: today the double-undo unique index keeps undo
 * from reaching this twice for one turn, so the bug is latent. It goes live the first
 * time anything else invalidates a commitment before its creating turn is undone —
 * a future `update_commitment` or `complete_commitment` — at which point undo would
 * silently overwrite a legitimate earlier `t_invalid` with `now()` and lose when the
 * commitment really stopped being true. Found by review, not by a failing test.
 */
export async function invalidateCommitment(
  tx: Queryable,
  id: string,
  at?: Date,
): Promise<void> {
  await tx.query(
    `UPDATE commitments
        SET t_invalid = COALESCE($2::timestamptz, t_invalid, now())
      WHERE id = $1`,
    [id, at ?? null],
  );
}

/** Un-invalidate — the inverse of `invalidateCommitment`, used by undo-of-an-undo. */
export async function revalidateCommitment(
  tx: Queryable,
  id: string,
): Promise<void> {
  await tx.query(`UPDATE commitments SET t_invalid = NULL WHERE id = $1`, [id]);
}
