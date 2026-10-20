/**
 * thoughts — the priority board (migration 014).
 *
 * Written only by the thought tools (apps/api/src/tools/thought-tools.ts), so
 * every change is validated, logged in action_log and undoable. INVALIDATE,
 * never delete: a removed thought keeps its row with t_invalid set.
 */
import type { Queryable } from "../client.js";

export type ThoughtPriority = "high" | "mid" | "low";

export const THOUGHT_PRIORITIES: readonly ThoughtPriority[] = ["high", "mid", "low"];

export function isThoughtPriority(value: unknown): value is ThoughtPriority {
  return typeof value === "string" && (THOUGHT_PRIORITIES as readonly string[]).includes(value);
}

export interface Thought {
  id: string;
  body: string;
  priority: ThoughtPriority;
  t_valid: Date;
  t_invalid: Date | null;
  t_created: Date;
  t_expired: Date | null;
}

export async function createThought(
  tx: Queryable,
  input: { id?: string | null; body: string; priority: ThoughtPriority },
): Promise<Thought> {
  const { rows } = await tx.query<Thought>(
    `INSERT INTO thoughts (id, body, priority)
     VALUES (COALESCE($3::uuid, gen_random_uuid()), $1, $2::thought_priority)
     RETURNING *`,
    [input.body, input.priority, input.id ?? null],
  );
  return rows[0]!;
}

/** Current thoughts, newest first within each priority. */
export async function listCurrent(tx: Queryable): Promise<Thought[]> {
  const { rows } = await tx.query<Thought>(
    `SELECT * FROM thoughts_current
      ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'mid' THEN 1 ELSE 2 END, t_created DESC`,
  );
  return rows;
}

export async function getCurrent(tx: Queryable, id: string): Promise<Thought | null> {
  const { rows } = await tx.query<Thought>(`SELECT * FROM thoughts_current WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function setPriority(tx: Queryable, id: string, priority: ThoughtPriority): Promise<void> {
  await tx.query(`UPDATE thoughts SET priority = $2::thought_priority WHERE id = $1`, [id, priority]);
}

/** INVALIDATE, NEVER DELETE. Idempotent on an already-invalid row. */
export async function invalidateThought(tx: Queryable, id: string): Promise<void> {
  await tx.query(`UPDATE thoughts SET t_invalid = COALESCE(t_invalid, now()) WHERE id = $1`, [id]);
}

/** The inverse of a removal. */
export async function revalidateThought(tx: Queryable, id: string): Promise<void> {
  await tx.query(`UPDATE thoughts SET t_invalid = NULL WHERE id = $1`, [id]);
}
