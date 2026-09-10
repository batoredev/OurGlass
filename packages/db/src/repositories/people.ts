/**
 * THE ONLY FILE IN THE REPO THAT TOUCHES THE RAW `people` TABLE.
 *
 * This is the residual-risk mitigation named in docs/PHASE-1-DESIGN.md §2.3. Merge is
 * non-destructive — it sets the loser's `t_invalid` and `merged_into_id` and repoints
 * NO foreign keys and rewrites NO JSONB — which means a stored UUID may name a person
 * who has since been merged away. There are therefore TWO distinct reads, and using
 * the wrong one is a silent bug that renders a blank cell:
 *
 *   list()            -> `people_current`. FILTERS. Merged people are ABSENT, which is
 *                        correct: the People list shows ONE row after a merge.
 *   resolvePerson(id) -> `resolve_person`. RESOLVES. Follows `merged_into_id`
 *                        transitively to the survivor. Never blank for a live id.
 *
 * A `person_ref` in a Phase 5 JSONB payload, or a dereference of
 * `commitments.owner_id` / `recipient_id`, MUST use the second. Writing it against
 * the first reproduces exactly the dangling-reference bug the forwarding pointer
 * exists to prevent — and it fails only for merged people, the rarest path and the
 * last one anyone tests.
 *
 * A literal Postgres REVOKE was considered and rejected (§2.3): the migration runner
 * and the tool layer share one role, and splitting roles is real infrastructure for
 * one invariant. This file plus its regression tests is a WEAKER mitigation than
 * REVOKE, deliberately. If a person ever appears twice in Phase 5, the answer is the
 * second role and we will have earned the evidence.
 */
import type { Queryable } from "../client.js";

export interface Person {
  id: string;
  display_name: string;
  organization_id: string | null;
  merged_into_id: string | null;
  notes: string | null;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

export interface CreatePersonInput {
  displayName: string;
  organizationId?: string | null;
  notes?: string | null;
}

export async function createPerson(
  tx: Queryable,
  input: CreatePersonInput,
): Promise<Person> {
  const { rows } = await tx.query<Person>(
    `INSERT INTO people (display_name, organization_id, notes)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.displayName, input.organizationId ?? null, input.notes ?? null],
  );
  // INSERT ... RETURNING always yields exactly one row or throws.
  return rows[0]!;
}

/**
 * READ SHAPE 1 — LIST / ENUMERATE. "Show me the people."
 * Merged-away people are absent. This FILTERS; it does not resolve.
 */
export async function list(tx: Queryable): Promise<Person[]> {
  const { rows } = await tx.query<Person>(
    `SELECT * FROM people_current ORDER BY display_name`,
  );
  return rows;
}

/**
 * Case-insensitive current-person lookup for Phase 2's resolver. This is a
 * candidate lookup, not a claim that a display name is globally unique: callers
 * must still apply the three-band policy before they use an id.
 */
export async function findByDisplayName(tx: Queryable, displayName: string): Promise<Person[]> {
  const { rows } = await tx.query<Person>(
    `SELECT * FROM people_current
      WHERE lower(display_name) = lower($1)
      ORDER BY display_name`,
    [displayName.trim()],
  );
  return rows;
}

/**
 * READ SHAPE 2 — DEREFERENCE BY ID. "Who is this UUID?"
 *
 * Follows `merged_into_id` transitively to the survivor. A merged UUID returns the
 * person it was merged INTO, not the merged-away row and not null.
 *
 * Returns null when the id never existed. This normalises the two different SQL
 * shapes the underlying function can produce — a NULL composite for an unknown id
 * versus a real row — so no caller has to know the difference.
 *
 * Raises if the merge chain exceeds 16 hops or contains a cycle. Failing loudly
 * beats looping: merges are undoable and redoable, which is exactly how a cycle gets
 * created by accident.
 */
export async function resolvePerson(
  tx: Queryable,
  id: string,
): Promise<Person | null> {
  const { rows } = await tx.query<Person>(
    `SELECT (resolve_person($1)).*`,
    [id],
  );
  const row = rows[0];
  // `(f(x)).*` on a NULL composite expands to one all-NULL row rather than zero
  // rows, so an id check is required — a row-count check would report a phantom hit.
  if (!row || row.id === null) return null;
  return row;
}

/**
 * Resolve to the surviving id only, without fetching the row. Cheaper when the
 * caller just needs to normalise a foreign key before writing it.
 */
export async function resolvePersonId(
  tx: Queryable,
  id: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ resolved: string | null }>(
    `SELECT resolve_merged('people'::regclass, $1) AS resolved`,
    [id],
  );
  return rows[0]?.resolved ?? null;
}

/**
 * Merge `loserId` into `winnerId`. PURELY NON-DESTRUCTIVE.
 *
 * Sets the loser's `t_invalid` and `merged_into_id`. Repoints no FKs, rewrites no
 * JSONB, deletes nothing. That is what makes `merge_person` honestly
 * `invertibility = 'full'`: the inverse is two column resets. The obvious
 * alternative (`UPDATE commitments SET owner_id = winner`) is LOSSY — its inverse
 * requires enumerating every row touched — and per docs/DECISIONS.md #9 a wrong
 * merge is the worst failure mode in this system, so its undo must be cheap and
 * exact.
 *
 * The caller is responsible for logging the inverse to `action_log`; this function
 * returns the state needed to build it.
 */
export async function mergePerson(
  tx: Queryable,
  loserId: string,
  winnerId: string,
  validAt?: Date,
): Promise<{
  loser: Person;
  previousMergedIntoId: string | null;
  previousTInvalid: Date | null;
}> {
  if (loserId === winnerId) {
    throw new Error("cannot merge a person into themselves");
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
  const { rows } = await tx.query<Person & { prev_merged_into_id: string | null; prev_t_invalid: Date | null }>(
    `UPDATE people AS t
        SET merged_into_id = $2,
            t_invalid = COALESCE($3::timestamptz, now())
       FROM (SELECT id, merged_into_id, t_invalid FROM people WHERE id = $1) AS old
      WHERE t.id = old.id
      RETURNING t.*,
                old.merged_into_id AS prev_merged_into_id,
                old.t_invalid      AS prev_t_invalid`,
    [loserId, winnerId, validAt ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error(`no person with id ${loserId}`);
  const { prev_merged_into_id, prev_t_invalid, ...loser } = row;
  return {
    loser: loser as Person,
    previousMergedIntoId: prev_merged_into_id,
    previousTInvalid: prev_t_invalid,
  };
}

/**
 * The exact inverse of `mergePerson` — restores BOTH columns it set, to the values
 * it captured. Pass the `previousMergedIntoId` and `previousTInvalid` that
 * `mergePerson` returned; do not let them default.
 *
 * The defaults restore "never merged, currently valid", which is correct only for
 * undoing a FIRST merge. Undoing a RE-merge with the defaults would un-merge the row
 * from everything — silently producing the duplicate-in-the-list symptom that §2.3
 * names as the signal this mitigation has failed.
 *
 * INVALIDATE, NEVER DELETE: this resets columns rather than reinserting a row.
 */
export async function unmergePerson(
  tx: Queryable,
  loserId: string,
  previousMergedIntoId: string | null = null,
  previousTInvalid: Date | null = null,
): Promise<void> {
  await tx.query(
    `UPDATE people SET merged_into_id = $2, t_invalid = $3 WHERE id = $1`,
    [loserId, previousMergedIntoId, previousTInvalid],
  );
}

/**
 * Invalidate a person. INVALIDATE, NEVER DELETE — `DELETE` appears in no repository
 * function in this package, which is what makes memory correction and undo work.
 *
 * IDEMPOTENT ON AN ALREADY-INVALID ROW, for the same reason as
 * `invalidateCommitment` — see that function's comment. `t_invalid` records when the
 * fact stopped being true in the world, so re-invalidating must not move it. Only an
 * explicit `at` overwrites.
 *
 * NOTE: this is NOT the inverse of a merge. `mergePerson` sets `t_invalid` AND
 * `merged_into_id` and captures both prior values; its inverse is `unmergePerson`.
 * Using this to undo a merge would leave the forwarding pointer set.
 */
export async function invalidatePerson(
  tx: Queryable,
  id: string,
  at?: Date,
): Promise<void> {
  await tx.query(
    `UPDATE people
        SET t_invalid = COALESCE($2::timestamptz, t_invalid, now())
      WHERE id = $1`,
    [id, at ?? null],
  );
}
