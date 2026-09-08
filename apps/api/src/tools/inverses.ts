/**
 * Inverse-application dispatch, keyed by target table.
 *
 * Each tool that mutates a table registers how to apply that table's
 * inverse_patch. This keeps the executor (executor.ts) ignorant of any
 * specific table's column names — it only knows "call the registered
 * handler for this targetTable with this inverse_patch". Tools register
 * their handler as a side effect of module load (see tools/create-commitment.ts
 * etc. calling registerInverseHandler at the bottom of the file), which the
 * registry index (./index.ts) triggers by importing every tool module.
 *
 * inverse_patch shapes are intentionally provisional pending schema2's
 * published column names — see the per-tool comments once table shape
 * lands. The dispatcher itself does not care about the shape.
 */
import type { DatabaseTransaction } from "@ourglass/shared";

export type InverseHandler = (
  tx: DatabaseTransaction,
  targetId: string | null,
  inversePatch: unknown,
) => Promise<void>;

const handlers = new Map<string, InverseHandler>();

export function registerInverseHandler(targetTable: string, handler: InverseHandler): void {
  if (handlers.has(targetTable)) {
    throw new Error(`Inverse handler for table "${targetTable}" is already registered`);
  }
  handlers.set(targetTable, handler);
}

export async function applyInverseForTable(
  tx: DatabaseTransaction,
  targetTable: string,
  targetId: string | null,
  inversePatch: unknown,
): Promise<void> {
  const handler = handlers.get(targetTable);
  if (!handler) {
    throw new Error(
      `No inverse handler registered for table "${targetTable}" — every tool that mutates ` +
        `a table must register one (see registerInverseHandler)`,
    );
  }
  await handler(tx, targetId, inversePatch);
}

/** Test-only: clears all registered handlers so tests can start clean. */
export function __resetInverseHandlersForTests(): void {
  handlers.clear();
}
