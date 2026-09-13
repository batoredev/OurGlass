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
  /**
   * OPTIONAL client-generated id. Omit it and the column DEFAULT
   * `gen_random_uuid()` fires exactly as before — every pre-Phase-3 caller is
   * unaffected.
   *
   * It exists for the same-turn dependency case in PHASE-3-DESIGN §3.3: "Barkha
   * needs to give me the article by 6. Remind me at 5 to ask her." is ONE turn in
   * which the reminder references the commitment the same turn creates. The
   * orchestrator cannot fill `create_reminder.commitment_id` with an id the server
   * has not generated yet, and `executeTurn` passes `call.input` through verbatim
   * with no placeholder substitution. So the caller generates the UUID up front
   * and reuses it across the dependent calls.
   *
   * The caller is responsible for supplying a real UUID; a malformed string is
   * rejected by Postgres's `uuid` cast, not silently coerced. The tool layer
   * validates the shape at its boundary as well.
   */
  id?: string | null;
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
    // COALESCE rather than two separate INSERT statements: one SQL text, one plan,
    // and the DEFAULT's generator named exactly once. An omitted id takes
    // gen_random_uuid() — the identical behaviour to the column default.
    `INSERT INTO commitments
       (id, owner_id, recipient_id, object_text, expected_at, project_id, status)
     VALUES (COALESCE($7::uuid, gen_random_uuid()), $1, $2, $3, $4, $5,
             COALESCE($6::commitment_status, 'pending'))
     RETURNING *`,
    [
      input.ownerId,
      input.recipientId ?? null,
      input.objectText,
      input.expectedAt ?? null,
      input.projectId ?? null,
      input.status ?? null,
      input.id ?? null,
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

/**
 * Open commitments for one owner/recipient pair — the candidate set for completion
 * matching (PHASE-3-DESIGN §4.1).
 *
 * `IS NOT DISTINCT FROM` rather than `=` because `recipient_id` is NULLABLE and
 * `NULL = NULL` is NULL, not true. With `=`, a self-owned commitment ("I need to
 * finish the poster", recipient NULL) would match nothing and every completion of
 * one would fall through to "ask". This is the SQL-level twin of the `?? null` fix
 * already commented in `hasHardVeto`.
 *
 * The four excluded statuses are the TERMINAL ones. `blocked`, `waiting`,
 * `waiting_on_someone` and `in_progress` are all still open — a blocked commitment
 * can absolutely be completed, and excluding it would make "I finally sent it"
 * unmatchable.
 *
 * Reads `commitments_current`, so `t_invalid IS NOT NULL` rows are already absent
 * and an undone commitment is never a completion candidate.
 */
export async function listOpenForOwner(
  tx: Queryable,
  ownerId: string,
  recipientId: string | null,
): Promise<CurrentCommitment[]> {
  const { rows } = await tx.query<CurrentCommitment>(
    `SELECT * FROM commitments_current
      WHERE owner_id = $1
        AND (recipient_id IS NOT DISTINCT FROM $2)
        AND status NOT IN ('completed','completed_late','cancelled','superseded')
      ORDER BY expected_at NULLS LAST`,
    [ownerId, recipientId],
  );
  return rows;
}

/** One newly-overdue commitment, with its owner's name for the reply. */
export interface OverdueCommitment {
  id: string;
  object_text: string;
  expected_at: Date;
  owner_name: string | null;
}

/**
 * Commitments whose deadline fell inside `(since, now]` and which are still
 * open — spec §26's proactive trigger.
 *
 * ⚠ A HALF-OPEN WINDOW, NOT "is overdue", and the difference is the whole of
 * §26's good/bad distinction. "Is overdue" stays true every turn until the
 * thing is completed, so surfacing it repeatedly is the nagging §26 forbids.
 * Crossing the deadline happens EXACTLY ONCE, and this window catches only
 * that crossing. A caller that cannot supply a real `since` must pass `now`,
 * which yields nothing — silence is correct when we cannot tell whether the
 * user has already been told.
 *
 * `expected_at > $1 AND <= $2` — exclusive at the lower bound so consecutive
 * calls cannot report the same crossing twice.
 *
 * The join is LEFT: an owner row could be invalidated after the commitment
 * was created, and losing the whole notice because a name is missing would be
 * worse than rendering it without one.
 */
export async function listOverdueBetween(
  tx: Queryable,
  since: Date,
  now: Date,
  limit = 10,
): Promise<OverdueCommitment[]> {
  const { rows } = await tx.query<OverdueCommitment>(
    `SELECT c.id, c.object_text, c.expected_at, p.display_name AS owner_name
       FROM commitments_current c
       LEFT JOIN people_current p ON p.id = c.owner_id
      WHERE c.expected_at IS NOT NULL
        AND c.expected_at > $1::timestamptz
        AND c.expected_at <= $2::timestamptz
        AND c.status NOT IN ('completed','completed_late','cancelled','superseded')
      ORDER BY c.expected_at
      LIMIT $3`,
    [since, now, limit],
  );
  return rows;
}

/** The terminal statuses. A commitment in one of these cannot be completed again. */
export const TERMINAL_STATUSES = [
  "completed",
  "completed_late",
  "cancelled",
  "superseded",
] as const satisfies readonly CommitmentStatus[];

export function isTerminalStatus(status: CommitmentStatus): boolean {
  return (TERMINAL_STATUSES as readonly CommitmentStatus[]).includes(status);
}

export interface CompleteCommitmentResult {
  commitment: Commitment;
  /** PRE-update status. Feed this to the inverse; never re-read it from `commitment`. */
  previousStatus: CommitmentStatus;
  /** PRE-update completed_at. NULL on a first completion. */
  previousCompletedAt: Date | null;
}

/**
 * Mark a commitment complete. THE STATUS IS DECIDED BY THE CALLER, not here.
 *
 * Lateness derivation lives in the tool layer (PHASE-3-DESIGN §2) and has exactly
 * ONE source. This function does not look at `expected_at` and does not choose
 * between `completed` and `completed_late` — if it did, there would be two
 * derivation sites and one of them would drift. It writes what it is told.
 *
 * THE SELF-JOIN IS THE WHOLE POINT AND IS NOT STYLISTIC.
 *
 * `RETURNING *` on an UPDATE yields POST-update state. Reading `prev_status` from
 * it would capture 'completed' — the value just written — so the inverse would
 * restore 'completed' instead of 'pending', and undoing a completion would be a
 * no-op that reports success. `RETURNING c.*` plus `old.status` from the joined
 * subquery is the pre-update read, in one statement.
 *
 * This is PRECISELY docs/DECISIONS.md Phase 1 build finding #4, one table over:
 * `mergePerson` in people.ts had exactly this bug and was fixed with exactly this
 * `FROM (SELECT ...) AS old` join. Read that function before changing this one.
 *
 * REJECTED: a separate `SELECT` before the `UPDATE`. Correct under read-committed
 * inside one transaction, and it reads more simply — but only CONDITIONALLY
 * correct: it depends on nobody ever moving the SELECT outside the transaction.
 * The self-join is unconditionally correct and is already this repo's pattern
 * across three call sites (§1.1).
 *
 * Does NOT guard against re-completing a terminal commitment. That is the TOOL's
 * `validate` step, which rejects with `already_completed` naming the existing
 * timestamp (§1.2) — a bitemporal system's core promise is that a recorded instant
 * does not move, and silently overwriting `completed_at` is the same correctness
 * bug as Phase 1 finding #5. Use `isTerminalStatus` / `getById` to check first.
 */
export async function completeCommitment(
  tx: Queryable,
  id: string,
  input: { status: "completed" | "completed_late"; completedAt: Date | string },
): Promise<CompleteCommitmentResult> {
  const { rows } = await tx.query<
    Commitment & { prev_status: CommitmentStatus; prev_completed_at: Date | null }
  >(
    `UPDATE commitments AS c
        SET status       = $2::commitment_status,
            completed_at = $3::timestamptz
       FROM (SELECT id, status, completed_at FROM commitments WHERE id = $1) AS old
      WHERE c.id = old.id
      RETURNING c.*,
                old.status       AS prev_status,
                old.completed_at AS prev_completed_at`,
    [id, input.status, input.completedAt],
  );
  const row = rows[0];
  if (!row) throw new Error(`no commitment with id ${id}`);
  const { prev_status, prev_completed_at, ...commitment } = row;
  return {
    commitment: commitment as Commitment,
    previousStatus: prev_status,
    previousCompletedAt: prev_completed_at,
  };
}

/**
 * The exact inverse of `completeCommitment`. BOTH PRIOR VALUES ARE REQUIRED.
 *
 * No defaults, mirroring `unmergePerson`'s signature and for the same reason stated
 * in its comment. Defaults would restore "never completed, pending", which is right
 * ONLY for undoing a FIRST completion. A commitment completed, undone, re-completed
 * and undone again must restore the CAPTURED prior state. A default silently
 * converts a wrong restore into a plausible one — the worst kind, because nothing
 * looks broken.
 *
 * INVALIDATE, NEVER DELETE: this resets columns, it does not remove a row. It is
 * also NOT `invalidateCommitment` — undoing a completion must leave the commitment
 * live and open, not invalidate it.
 */
export async function uncompleteCommitment(
  tx: Queryable,
  id: string,
  previousStatus: CommitmentStatus,
  previousCompletedAt: Date | null,
): Promise<void> {
  await tx.query(
    `UPDATE commitments
        SET status = $2::commitment_status, completed_at = $3::timestamptz
      WHERE id = $1`,
    [id, previousStatus, previousCompletedAt],
  );
}

/**
 * The columns `update_commitment` may write (PHASE-3-DESIGN §1.4).
 *
 * A CLOSED ALLOWLIST, and it is a security control, not a convenience. The inverse
 * path builds a SET list from keys read out of `action_log.inverse_patch`, which is
 * JSONB read back FROM THE DATABASE and is therefore untrusted input by the letter
 * of .claude/rules/security.md. Interpolating a key from there into SQL is
 * injection. Every key is checked against this map and mapped to a fixed literal.
 */
const UPDATABLE_COLUMNS = {
  status: "status",
  expectedAt: "expected_at",
  objectText: "object_text",
  projectId: "project_id",
  recipientId: "recipient_id",
} as const;

export type UpdatableField = keyof typeof UPDATABLE_COLUMNS;

/**
 * A partial update. Only the keys PRESENT are written, and only those keys' prior
 * values come back — capturing the whole row would make undo restore fields a
 * DIFFERENT turn had legitimately changed in between (§1.4 constraint 2).
 *
 * `status` here excludes the two completed values. This type cannot express that
 * exclusion usefully at the repository layer (the tool's `validate` rejects them
 * with `use_complete_commitment`), because the UNDO path must be able to restore a
 * commitment TO `completed` — undoing an update that ran after a completion. So the
 * repository accepts any status and the tool constrains the forward direction.
 * Stated because the asymmetry looks like an oversight and is not.
 */
export type CommitmentFieldPatch = Partial<{
  status: CommitmentStatus;
  expectedAt: Date | string | null;
  objectText: string;
  projectId: string | null;
  recipientId: string | null;
}>;

export interface UpdateCommitmentResult {
  commitment: Commitment;
  /** PRE-update values of EXACTLY the fields that were written. Feed to the inverse. */
  previousFields: CommitmentFieldPatch;
}

function assertUpdatableField(key: string): asserts key is UpdatableField {
  if (!Object.prototype.hasOwnProperty.call(UPDATABLE_COLUMNS, key)) {
    // Loud, not silent-skip: a key that is not updatable reaching here means the
    // caller built a patch this layer does not understand, and quietly dropping it
    // would make an undo restore an incomplete state while reporting success.
    throw new Error(`not an updatable commitment field: ${key}`);
  }
}

/**
 * Update only the fields present in `patch`, capturing exactly their prior values.
 *
 * Same `FROM (SELECT ...) AS old` capture as `completeCommitment`, for the same
 * reason: `RETURNING *` is post-update state and would make the inverse restore the
 * values just written.
 *
 * The SET list and the captured column list are built from the CLOSED allowlist
 * above — never from interpolated caller keys. Values are always parameterised.
 */
export async function updateCommitment(
  tx: Queryable,
  id: string,
  patch: CommitmentFieldPatch,
): Promise<UpdateCommitmentResult> {
  const keys = Object.keys(patch).filter(
    (k) => (patch as Record<string, unknown>)[k] !== undefined,
  );
  if (keys.length === 0) {
    throw new Error("updateCommitment requires at least one field to update");
  }
  for (const key of keys) assertUpdatableField(key);
  const fields = keys as UpdatableField[];

  // $1 is the id; values start at $2. Column names come from the allowlist, so no
  // caller-supplied string ever reaches the SQL text.
  const setList = fields
    .map((f, i) => `${UPDATABLE_COLUMNS[f]} = $${i + 2}`)
    .join(", ");
  const captureList = fields.map((f) => UPDATABLE_COLUMNS[f]).join(", ");
  const returnList = fields
    .map((f) => `old.${UPDATABLE_COLUMNS[f]} AS prev_${UPDATABLE_COLUMNS[f]}`)
    .join(", ");
  const values = fields.map((f) => (patch as Record<string, unknown>)[f] ?? null);

  const { rows } = await tx.query<Commitment & Record<string, unknown>>(
    `UPDATE commitments AS c
        SET ${setList}
       FROM (SELECT id, ${captureList} FROM commitments WHERE id = $1) AS old
      WHERE c.id = old.id
      RETURNING c.*, ${returnList}`,
    [id, ...values],
  );
  const row = rows[0];
  if (!row) throw new Error(`no commitment with id ${id}`);

  const previousFields: Record<string, unknown> = {};
  const commitment: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith("prev_")) continue;
    commitment[k] = v;
  }
  for (const f of fields) {
    previousFields[f] = row[`prev_${UPDATABLE_COLUMNS[f]}`] ?? null;
  }
  return {
    commitment: commitment as unknown as Commitment,
    previousFields: previousFields as CommitmentFieldPatch,
  };
}

/**
 * The exact inverse of `updateCommitment` — restores the captured prior values of
 * exactly the fields that were changed.
 *
 * `fields` arrives from `action_log.inverse_patch`, i.e. JSONB READ BACK FROM THE
 * DATABASE. Untrusted input (.claude/rules/security.md): every key is validated
 * against the closed allowlist and mapped to a fixed column literal before it can
 * reach the SQL text. Never interpolate a key from here.
 *
 * An empty patch is a no-op rather than an error: an undo that restores nothing is
 * strange but harmless, whereas throwing mid-undo would abort the rest of a turn's
 * inverses.
 */
export async function restoreCommitmentFields(
  tx: Queryable,
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  for (const key of keys) assertUpdatableField(key);
  const allowed = keys as UpdatableField[];

  // Casts are needed because a JSONB round-trip yields strings: `status` must be
  // cast to the enum and the instants/uuids to their types, or Postgres rejects the
  // parameter. Built from the allowlist, never from the key text.
  const typed = allowed
    .map((f, i) => {
      const col = UPDATABLE_COLUMNS[f];
      const p = `$${i + 2}`;
      if (col === "status") return `${col} = ${p}::commitment_status`;
      if (col === "expected_at") return `${col} = ${p}::timestamptz`;
      if (col === "project_id" || col === "recipient_id") return `${col} = ${p}::uuid`;
      return `${col} = ${p}`;
    })
    .join(", ");

  await tx.query(
    `UPDATE commitments SET ${typed} WHERE id = $1`,
    [id, ...allowed.map((f) => fields[f] ?? null)],
  );
}

/** Un-invalidate — the inverse of `invalidateCommitment`, used by undo-of-an-undo. */
export async function revalidateCommitment(
  tx: Queryable,
  id: string,
): Promise<void> {
  await tx.query(`UPDATE commitments SET t_invalid = NULL WHERE id = $1`, [id]);
}
