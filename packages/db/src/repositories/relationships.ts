/**
 * relationships — the §15 graph, §16 provenance, and §17 correction
 * (docs/PHASE-4-DESIGN.md §4). Resolving finding F9.
 *
 * The TABLE has existed since migration 004, with `inference_level`,
 * `source_message_id`, both traversal indexes, a `relationships_current` view,
 * and a comment describing exactly how §17 correction should work. What did
 * not exist was any code reading or writing it — so §15, §16 and §17 were
 * schema-only for three phases. This file is the code path.
 *
 * ┌─ THE RULE THIS FILE EXISTS TO ENFORCE ─────────────────────────────────┐
 * │ CORRECTION IS A SUPERSEDE, NEVER AN UPDATE AND NEVER A DELETE.         │
 * │ "Arun handles the backend." -> "No, Karthik handles it now."           │
 * │ produces TWO rows, one current. The old edge's t_invalid is set to the │
 * │ NEW edge's t_valid, so the timeline has no gap and no overlap.         │
 * │ An UPDATE would leave current state correct and destroy the history    │
 * │ §17 explicitly requires preserving.                                    │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { Queryable } from "../client.js";
import type { InferenceLevel } from "./memories.js";

/**
 * Polymorphic target kind. Mirrors migration 004's CHECK constraint; no FK is
 * possible because the target may live in any of three tables.
 */
export type RelationshipObjectKind = "person" | "organization" | "project";

export interface Relationship {
  id: string;
  subject_id: string;
  /** Free text by design — 'works_on', 'handles', 'works_with'. §15 lists no closed set. */
  rel_type: string;
  object_kind: RelationshipObjectKind;
  object_id: string;
  inference_level: InferenceLevel;
  /** §16 provenance — WHICH message asserted this edge. */
  source_message_id: string | null;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

export interface CreateRelationshipInput {
  id?: string | null;
  subjectId: string;
  relType: string;
  objectKind: RelationshipObjectKind;
  objectId: string;
  inferenceLevel: InferenceLevel;
  sourceMessageId?: string | null;
  /**
   * When the edge became true IN THE WORLD, which is not always now — "Karthik
   * took over last month" is a correction whose validity starts last month.
   * Omit to take the column default.
   */
  validFrom?: Date | null;
}

export async function createRelationship(
  tx: Queryable,
  input: CreateRelationshipInput,
): Promise<Relationship> {
  const { rows } = await tx.query<Relationship>(
    `INSERT INTO relationships
       (id, subject_id, rel_type, object_kind, object_id, inference_level, source_message_id,
        t_valid)
     VALUES (COALESCE($8::uuid, gen_random_uuid()), $1::uuid, $2, $3, $4::uuid,
             $5::inference_level, $6::uuid, COALESCE($7::timestamptz, now()))
     RETURNING *`,
    [
      input.subjectId,
      input.relType,
      input.objectKind,
      input.objectId,
      input.inferenceLevel,
      input.sourceMessageId ?? null,
      input.validFrom ?? null,
      input.id ?? null,
    ],
  );
  return rows[0]!;
}

export async function getById(tx: Queryable, id: string): Promise<Relationship | null> {
  const { rows } = await tx.query<Relationship>(`SELECT * FROM relationships WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** "What does Arun work on?" — outbound edges. Uses `relationships_subject_idx`. */
export async function listBySubject(tx: Queryable, subjectId: string): Promise<Relationship[]> {
  const { rows } = await tx.query<Relationship>(
    `SELECT * FROM relationships_current WHERE subject_id = $1 ORDER BY t_valid DESC`,
    [subjectId],
  );
  return rows;
}

/** "Who works on backend?" — inbound edges. Uses `relationships_object_idx`. */
export async function listByObject(
  tx: Queryable,
  objectKind: RelationshipObjectKind,
  objectId: string,
): Promise<Relationship[]> {
  const { rows } = await tx.query<Relationship>(
    `SELECT * FROM relationships_current
      WHERE object_kind = $1 AND object_id = $2
      ORDER BY t_valid DESC`,
    [objectKind, objectId],
  );
  return rows;
}

/**
 * The full history of one edge shape, current and superseded, oldest first.
 *
 * This is what makes §17 auditable rather than merely implemented: "who
 * handled backend in September?" is answerable only if the superseded rows
 * are still readable and still carry their validity window.
 */
export async function listHistory(
  tx: Queryable,
  objectKind: RelationshipObjectKind,
  objectId: string,
  relType: string,
): Promise<Relationship[]> {
  const { rows } = await tx.query<Relationship>(
    `SELECT * FROM relationships
      WHERE object_kind = $1 AND object_id = $2 AND rel_type = $3
      ORDER BY t_valid`,
    [objectKind, objectId, relType],
  );
  return rows;
}

export interface SupersedeResult {
  readonly superseded: Relationship;
  readonly replacement: Relationship;
  /** Prior `t_invalid` of the superseded row — NULL unless it was already closed. */
  readonly previousInvalidAt: Date | null;
}

/**
 * §17 CORRECTION. "Arun handles the backend." -> "No, Karthik handles it now."
 *
 * Closes the old edge AT THE NEW EDGE'S VALIDITY START and inserts the
 * replacement, in one transaction. Two rows, one current, no gap, no overlap.
 *
 * ⚠ `t_invalid(old) := t_valid(new)`, NOT `now()`. The two differ whenever the
 * correction describes a change that already happened ("Karthik took over last
 * month"). Using `now()` would assert that Arun held the role until the moment
 * the user happened to mention it — a fact the system invented. That is the
 * single easiest thing to get wrong in this file.
 *
 * Returns the prior `t_invalid` so a tool can log an exact inverse: undoing a
 * correction must restore whatever the old row had, not assume NULL.
 */
export async function supersedeRelationship(
  tx: Queryable,
  oldId: string,
  replacement: CreateRelationshipInput,
): Promise<SupersedeResult> {
  const existing = await getById(tx, oldId);
  if (!existing) throw new Error(`no relationship with id ${oldId}`);

  const created = await createRelationship(tx, replacement);

  const { rows } = await tx.query<Relationship>(
    // The new edge's t_valid, read back from the row just inserted rather than
    // from the input — `validFrom` may have been omitted and defaulted, and
    // the stored value is the one the timeline must line up with.
    `UPDATE relationships SET t_invalid = $2::timestamptz WHERE id = $1 RETURNING *`,
    [oldId, created.t_valid],
  );

  return {
    superseded: rows[0]!,
    replacement: created,
    previousInvalidAt: existing.t_invalid,
  };
}

/**
 * The inverse of a supersede: reopen the old edge and invalidate the
 * replacement. Both prior values are passed with NO DEFAULT, for the same
 * reason as `uncompleteCommitment` — defaulting would restore "was never
 * closed", correct only for undoing a FIRST correction.
 */
export async function unsupersedeRelationship(
  tx: Queryable,
  oldId: string,
  replacementId: string,
  previousInvalidAt: Date | null,
): Promise<void> {
  await tx.query(`UPDATE relationships SET t_invalid = $2::timestamptz WHERE id = $1`, [
    oldId,
    previousInvalidAt,
  ]);
  await tx.query(`UPDATE relationships SET t_invalid = COALESCE(t_invalid, now()) WHERE id = $1`, [
    replacementId,
  ]);
}

/**
 * INVALIDATE, NEVER DELETE — §28's "Forget that Arun works on backend".
 * Idempotent on an already-invalid row: `t_invalid` records when the edge
 * stopped being true, so re-invalidating must not move it.
 */
export async function invalidateRelationship(tx: Queryable, id: string, at?: Date): Promise<void> {
  await tx.query(
    `UPDATE relationships SET t_invalid = COALESCE($2::timestamptz, t_invalid, now())
      WHERE id = $1`,
    [id, at ?? null],
  );
}

/** The inverse of invalidation. Takes the prior value with NO DEFAULT. */
export async function revalidateRelationship(
  tx: Queryable,
  id: string,
  previousInvalidAt: Date | null,
): Promise<void> {
  await tx.query(`UPDATE relationships SET t_invalid = $2::timestamptz WHERE id = $1`, [
    id,
    previousInvalidAt,
  ]);
}
