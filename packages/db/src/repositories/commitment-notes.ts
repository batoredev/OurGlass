/**
 * commitment_notes — §20 context attachment, with message provenance.
 *
 * docs/PHASE-3-DESIGN.md §0 finding F4: `commitments` has no `notes` column
 * (migration 003, verified — while `people`, `organizations` and `projects` all
 * have one in 002), and there was no `commitment_notes` table. §20's "She had a
 * family emergency" had nowhere to land.
 *
 * A TABLE, NOT A COLUMN (§10, F4's concrete shape). A `notes text` column would be
 * OVERWRITTEN by the second piece of context and would carry no provenance.
 * PHASES.md puts "context attachment (§20) as a note with message provenance"
 * explicitly in scope, and `relationships.source_message_id` (migration 004) is the
 * established pattern for it. One commitment accumulates many notes over its life:
 * that is a one-to-many, so it is a table.
 *
 * Its tool is `attach_context`, `invertibility: 'full'`, inverse = invalidate.
 */
import type { Queryable } from "../client.js";

export interface CommitmentNote {
  id: string;
  commitment_id: string;
  /** Raw content field (§3). Never resolved into an entity reference. */
  body: string;
  /** WHICH message said this. §20's "do not make judgmental statements" is only
   *  auditable if the source is recoverable. */
  source_message_id: string | null;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

export interface CreateCommitmentNoteInput {
  id?: string | null;
  commitmentId: string;
  body: string;
  sourceMessageId?: string | null;
}

export async function createNote(
  tx: Queryable,
  input: CreateCommitmentNoteInput,
): Promise<CommitmentNote> {
  const { rows } = await tx.query<CommitmentNote>(
    `INSERT INTO commitment_notes (id, commitment_id, body, source_message_id)
     VALUES (COALESCE($4::uuid, gen_random_uuid()), $1::uuid, $2, $3::uuid)
     RETURNING *`,
    [
      input.commitmentId,
      input.body,
      input.sourceMessageId ?? null,
      input.id ?? null,
    ],
  );
  return rows[0]!;
}

export async function getById(
  tx: Queryable,
  id: string,
): Promise<CommitmentNote | null> {
  const { rows } = await tx.query<CommitmentNote>(
    `SELECT * FROM commitment_notes WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * The notes on one commitment, NEWEST FIRST — matching
 * `commitment_notes_commitment_idx` (migration 009), which is
 * `(commitment_id, t_created DESC)`. The index and this ORDER BY must stay in
 * agreement; changing one without the other silently drops the index scan.
 */
export async function listByCommitment(
  tx: Queryable,
  commitmentId: string,
): Promise<CommitmentNote[]> {
  const { rows } = await tx.query<CommitmentNote>(
    `SELECT * FROM commitment_notes_current
      WHERE commitment_id = $1
      ORDER BY t_created DESC, id DESC`,
    [commitmentId],
  );
  return rows;
}

/**
 * INVALIDATE, NEVER DELETE — the inverse of `createNote` and what undo calls.
 * Idempotent on an already-invalid row, for the same reason as every other
 * invalidate in this package: `t_invalid` records when the fact stopped being true
 * in the world, so re-invalidating must not move it.
 */
export async function invalidateNote(
  tx: Queryable,
  id: string,
  at?: Date,
): Promise<void> {
  await tx.query(
    `UPDATE commitment_notes
        SET t_invalid = COALESCE($2::timestamptz, t_invalid, now())
      WHERE id = $1`,
    [id, at ?? null],
  );
}

/** Un-invalidate — used by undo-of-an-undo. */
export async function revalidateNote(
  tx: Queryable,
  id: string,
): Promise<void> {
  await tx.query(`UPDATE commitment_notes SET t_invalid = NULL WHERE id = $1`, [
    id,
  ]);
}
