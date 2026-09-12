/**
 * users — the account row, and the bridge from "me" to a `people` row.
 *
 * This repository did not exist before Phase 3, which is docs/PHASE-3-DESIGN.md §0
 * finding F2: `users.timezone` was added in migration 002 explicitly so Phase 2
 * could read an IANA zone for chrono (`resolveTime(text, instant, timezone,
 * direction)`), and NOTHING EVER READ IT. Every test passed a timezone literal. The
 * orchestrator is the first caller that cannot.
 *
 * It also resolves F3: `users.person_id` (migration 007) is the only path from a
 * first-person mention to a `people.id`. `commitments.owner_id` is NOT NULL and
 * references `people(id)`, so the user must BE a person to be either side of a
 * commitment. The resolver's first-person short-circuit consumes `person_id` from
 * here.
 *
 * CONFIG BOUNDARY (PHASE-1-DESIGN §5): no `process.env`, no default timezone
 * invented at a call site. A missing user row is a DEPLOYMENT fault and callers
 * must treat it as one — `getUser` returns null and `runTurn` is specified to throw
 * before Interpret rather than fabricate 'Asia/Kolkata' (§3.2.1). The column's
 * DEFAULT in migration 002 is the ONE place a zone is assumed, and it is assumed at
 * bootstrap, once, visibly.
 */
import type { Queryable } from "../client.js";
import type { Person } from "./people.js";

export interface User {
  id: string;
  display_name: string;
  timezone: string;
  /** The `people` row that IS this account. NULL only for a pre-007 or half-built row. */
  person_id: string | null;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

/**
 * The account plus its person row in one read — what the orchestrator actually
 * needs per turn (timezone for chrono, selfPersonId for the resolver).
 */
export interface UserWithPerson {
  user: User;
  /** NULL when `person_id` is unset. Callers that need "me" to resolve must check. */
  self: Person | null;
}

export async function getUser(tx: Queryable, id: string): Promise<User | null> {
  const { rows } = await tx.query<User>(
    `SELECT * FROM users_current WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Read the account and its self-person together.
 *
 * Goes through `resolve_person`, NOT `people_current` — READ SHAPE 2, not 1
 * (people.ts's header). If the self person were ever merged into another row,
 * `people_current` would return zero rows and "me" would silently stop resolving;
 * `resolve_person` follows the forwarding pointer to the survivor. That is exactly
 * the dangling-reference class the pointer exists to prevent, and the self person
 * is the single most load-bearing id in the system.
 */
export async function getUserWithPerson(
  tx: Queryable,
  id: string,
): Promise<UserWithPerson | null> {
  const user = await getUser(tx, id);
  if (!user) return null;
  if (user.person_id === null) return { user, self: null };
  const { rows } = await tx.query<Person>(`SELECT (resolve_person($1)).*`, [
    user.person_id,
  ]);
  const row = rows[0];
  // `(f(x)).*` on a NULL composite expands to ONE all-NULL row, not zero rows
  // (migration 002's contract comment). An id check, never a row count.
  const self = !row || row.id === null ? null : row;
  return { user, self };
}

/** Input to `ensureUser`. */
export interface EnsureUserInput {
  displayName: string;
  /** IANA zone. Omit to take migration 002's column DEFAULT rather than guess here. */
  timezone?: string;
}

/**
 * The single row every deployment needs — the one `users` row and its person.
 *
 * IDEMPOTENT. Returns the existing user when it is already linked, so re-running a
 * seed is a no-op rather than a second account. There is no natural key on `users`
 * (`display_name` is not unique and should not be), so identity is "the single
 * current row", which is honest for a single-user product and is what
 * PHASE-1-DESIGN §2.2 describes: single-user in behaviour, multi-user in schema.
 *
 * MUST RUN INSIDE A TRANSACTION. It does read-then-write across three statements
 * and the reads must share a snapshot with the writes. Callers hand it `ctx.tx`,
 * never a bare pool, for the same reason every tool does (§4.1). On a pool, a crash
 * between statements leaves a half-built user (row created, `person_id` NULL) —
 * exactly the state `getUserWithPerson` has to return `self: null` for.
 */
export async function ensureUser(
  tx: Queryable,
  input: EnsureUserInput,
): Promise<UserWithPerson> {
  const existing = await tx.query<User>(
    // The bootstrap row is "the oldest current user". Ordering by t_created makes
    // this deterministic if a second row ever appears, rather than returning
    // whichever row the planner happened to emit first.
    `SELECT * FROM users_current ORDER BY t_created LIMIT 1`,
  );
  let user = existing.rows[0] ?? null;

  if (!user) {
    const inserted = await tx.query<User>(
      // COALESCE so an omitted timezone takes the column DEFAULT ('Asia/Kolkata',
      // migration 002) rather than a literal repeated here. One source for the
      // default, and this file is not it.
      `INSERT INTO users (display_name, timezone)
       VALUES ($1, COALESCE($2, 'Asia/Kolkata'))
       RETURNING *`,
      [input.displayName, input.timezone ?? null],
    );
    user = inserted.rows[0]!;
  }

  if (user.person_id !== null) {
    // Already linked. Resolve through the pointer in case the person was merged.
    const linked = await getUserWithPerson(tx, user.id);
    if (linked && linked.self) return linked;
    // `person_id` names a row `resolve_person` cannot reach. The FK guarantees the
    // row EXISTS, so this means the merge chain raised or the survivor is itself
    // invalid. Fall through and relink rather than return a user whose "me" cannot
    // resolve: losing the old link is recoverable, whereas silently returning
    // `self: null` sends every subsequent "me" to `reject`.
  }

  const personRows = await tx.query<Person>(
    `INSERT INTO people (display_name) VALUES ($1) RETURNING *`,
    [input.displayName],
  );
  const self = personRows.rows[0]!;

  const updated = await tx.query<User>(
    `UPDATE users SET person_id = $2 WHERE id = $1 RETURNING *`,
    [user.id, self.id],
  );
  return { user: updated.rows[0]!, self };
}

/**
 * Point an existing account at an existing person. Separate from `ensureUser`
 * because linking to a person that ALREADY exists (the user is already in the graph
 * under their real name) is a different operation from bootstrapping one.
 *
 * Returns the PREVIOUS `person_id` so a caller can log an exact inverse, matching
 * `mergePerson`'s contract. Captured with the same `FROM (SELECT ...) AS old`
 * self-join: `RETURNING *` on an UPDATE yields POST-update state, so reading
 * `person_id` from it would return the value just written — Phase 1 build finding
 * #4, one table over.
 */
export async function setUserPerson(
  tx: Queryable,
  userId: string,
  personId: string | null,
): Promise<{ user: User; previousPersonId: string | null }> {
  const { rows } = await tx.query<User & { prev_person_id: string | null }>(
    `UPDATE users AS u
        SET person_id = $2
       FROM (SELECT id, person_id FROM users WHERE id = $1) AS old
      WHERE u.id = old.id
      RETURNING u.*, old.person_id AS prev_person_id`,
    [userId, personId],
  );
  const row = rows[0];
  if (!row) throw new Error(`no user with id ${userId}`);
  const { prev_person_id, ...user } = row;
  return { user: user as User, previousPersonId: prev_person_id };
}

/**
 * Invalidate a user. INVALIDATE, NEVER DELETE — `DELETE` appears in no repository
 * function in this package.
 *
 * IDEMPOTENT ON AN ALREADY-INVALID ROW, for the same reason as `invalidatePerson`:
 * `t_invalid` records when the fact stopped being true in the world, so
 * re-invalidating must not move it. Only an explicit `at` overwrites.
 */
export async function invalidateUser(
  tx: Queryable,
  id: string,
  at?: Date,
): Promise<void> {
  await tx.query(
    `UPDATE users
        SET t_invalid = COALESCE($2::timestamptz, t_invalid, now())
      WHERE id = $1`,
    [id, at ?? null],
  );
}
