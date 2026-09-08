/**
 * THE ONLY FILE IN THE REPO THAT TOUCHES THE RAW `projects` TABLE.
 *
 * Same two-read-shape discipline as `people.ts` — read that file's header.
 *
 * The project case is genuinely SMALLER than the person case, for a structural
 * reason worth stating so nobody over-presses on it: `commitments.project_id` is a
 * real FK, so a merged project cannot dangle into nothing, whereas a Phase 5
 * `person_ref` is an unconstrained JSONB value. Smaller, not absent — an implementer
 * dereferencing `project_id` still reaches for whatever exists, and what exists
 * without this file is the filtering view.
 */
import type { Queryable } from "../client.js";

export interface Project {
  id: string;
  name: string;
  merged_into_id: string | null;
  notes: string | null;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

export async function createProject(
  tx: Queryable,
  input: { name: string; notes?: string | null },
): Promise<Project> {
  const { rows } = await tx.query<Project>(
    `INSERT INTO projects (name, notes) VALUES ($1, $2) RETURNING *`,
    [input.name, input.notes ?? null],
  );
  return rows[0]!;
}

/** READ SHAPE 1 — list. Merged projects absent. Filters; does not resolve. */
export async function list(tx: Queryable): Promise<Project[]> {
  const { rows } = await tx.query<Project>(
    `SELECT * FROM projects_current ORDER BY name`,
  );
  return rows;
}

/** READ SHAPE 2 — dereference by id. Follows the pointer transitively. */
export async function resolveProject(
  tx: Queryable,
  id: string,
): Promise<Project | null> {
  const { rows } = await tx.query<Project>(`SELECT (resolve_project($1)).*`, [id]);
  const row = rows[0];
  if (!row || row.id === null) return null;
  return row;
}

export async function resolveProjectId(
  tx: Queryable,
  id: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ resolved: string | null }>(
    `SELECT resolve_merged('projects'::regclass, $1) AS resolved`,
    [id],
  );
  return rows[0]?.resolved ?? null;
}

/** Non-destructive merge. See `people.ts` for why the lossy alternative is rejected. */
export async function mergeProject(
  tx: Queryable,
  loserId: string,
  winnerId: string,
  validAt?: Date,
): Promise<{
  loser: Project;
  previousMergedIntoId: string | null;
  previousTInvalid: Date | null;
}> {
  if (loserId === winnerId) {
    throw new Error("cannot merge a project into itself");
  }
  // Capture the PRE-merge values in the same statement. `RETURNING *` on an UPDATE
  // yields the row AFTER the update, so `merged_into_id` would already be the new
  // winner and the old value would be lost — making the inverse silently wrong on a
  // RE-merge (A into B, later A into C: undoing the second must restore B, not NULL).
  // §4.2's last invariant forbids logging a wrong inverse.
  //
  // NOTE: t_invalid is overwritten UNCONDITIONALLY here, unlike the invalidate*
  // functions which preserve an existing value. That is correct and deliberate: this
  // statement CAPTURES the prior t_invalid as prev_t_invalid in the same query, and
  // unmerge* restores it. The write is lossless because the old value is carried out.
  // Do not "fix" this to COALESCE(t_invalid, ...) to match the invalidate* form —
  // that would make a re-merge unable to record its own new t_invalid.
  const { rows } = await tx.query<Project & { prev_merged_into_id: string | null; prev_t_invalid: Date | null }>(
    `UPDATE projects AS t
        SET merged_into_id = $2,
            t_invalid = COALESCE($3::timestamptz, now())
       FROM (SELECT id, merged_into_id, t_invalid FROM projects WHERE id = $1) AS old
      WHERE t.id = old.id
      RETURNING t.*,
                old.merged_into_id AS prev_merged_into_id,
                old.t_invalid      AS prev_t_invalid`,
    [loserId, winnerId, validAt ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error(`no project with id ${loserId}`);
  const { prev_merged_into_id, prev_t_invalid, ...loser } = row;
  return {
    loser: loser as Project,
    previousMergedIntoId: prev_merged_into_id,
    previousTInvalid: prev_t_invalid,
  };
}

/**
 * The exact inverse of `mergeProject` — restores BOTH columns it set, to the values
 * it captured. Pass the `previousMergedIntoId` and `previousTInvalid` that
 * `mergeProject` returned; do not let them default.
 *
 * The defaults restore "never merged, currently valid", which is correct only for
 * undoing a FIRST merge. Undoing a RE-merge with the defaults would un-merge the row
 * from everything — silently producing the duplicate-in-the-list symptom that §2.3
 * names as the signal this mitigation has failed.
 *
 * INVALIDATE, NEVER DELETE: this resets columns rather than reinserting a row.
 */
export async function unmergeProject(
  tx: Queryable,
  loserId: string,
  previousMergedIntoId: string | null = null,
  previousTInvalid: Date | null = null,
): Promise<void> {
  await tx.query(
    `UPDATE projects SET merged_into_id = $2, t_invalid = $3 WHERE id = $1`,
    [loserId, previousMergedIntoId, previousTInvalid],
  );
}
