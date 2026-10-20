/**
 * checklist_marks — the user's own tick on a meeting or reminder (migration 015).
 *
 * Written only by set_checklist_mark. INVALIDATE, never delete.
 */
import type { Queryable } from "../client.js";

export type ChecklistMarkKind = "meeting" | "reminder";

export interface ChecklistMark {
  id: string;
  item_kind: ChecklistMarkKind;
  item_id: string;
  done: boolean;
  t_invalid: Date | null;
}

export async function getCurrent(tx: Queryable, kind: ChecklistMarkKind, itemId: string): Promise<ChecklistMark | null> {
  const { rows } = await tx.query<ChecklistMark>(
    `SELECT * FROM checklist_marks WHERE item_kind = $1 AND item_id = $2 AND t_invalid IS NULL`,
    [kind, itemId],
  );
  return rows[0] ?? null;
}

/** Current marks for these items, keyed "kind:id". */
export async function listCurrentFor(
  tx: Queryable,
  items: readonly { kind: ChecklistMarkKind; id: string }[],
): Promise<Map<string, boolean>> {
  if (items.length === 0) return new Map();
  const { rows } = await tx.query<ChecklistMark>(
    `SELECT * FROM checklist_marks WHERE t_invalid IS NULL AND item_id = ANY($1::uuid[])`,
    [items.map((item) => item.id)],
  );
  return new Map(rows.map((row) => [`${row.item_kind}:${row.item_id}`, row.done]));
}

export async function insert(
  tx: Queryable,
  input: { kind: ChecklistMarkKind; itemId: string; done: boolean },
): Promise<ChecklistMark> {
  const { rows } = await tx.query<ChecklistMark>(
    `INSERT INTO checklist_marks (item_kind, item_id, done) VALUES ($1, $2, $3) RETURNING *`,
    [input.kind, input.itemId, input.done],
  );
  return rows[0]!;
}

export async function invalidate(tx: Queryable, id: string): Promise<void> {
  await tx.query(`UPDATE checklist_marks SET t_invalid = COALESCE(t_invalid, now()) WHERE id = $1`, [id]);
}

export async function revalidate(tx: Queryable, id: string): Promise<void> {
  await tx.query(`UPDATE checklist_marks SET t_invalid = NULL WHERE id = $1`, [id]);
}
