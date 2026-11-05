/**
 * Your data: export everything, and delete permanently (ROADMAP Stage 0).
 *
 * The rows are removed by `dataControl` in @ourglass/db (read its header for
 * what a purge does to the action log, and what it cannot find). This layer
 * adds the one thing the database cannot do: removing a file's BYTES from
 * storage, in the order that can be retried.
 *
 * BYTES FIRST, INSIDE THE TRANSACTION. The document rows are locked, the
 * stored objects are deleted, then the rows. If storage refuses, the
 * transaction rolls back: every row is still there, and running the delete
 * again finishes the job (a storage delete of a gone object succeeds). The
 * other order would leave bytes that no row points to and nothing can find.
 *
 * Not tools, never reachable from a model: the routes that call these are
 * the owner's own request, confirmed in the page.
 */
import { dataControl, type DataExport, type PurgeCounts } from "@ourglass/db";
import type { DatabaseTransaction } from "@ourglass/shared";
import type { ObjectStore } from "../storage/object-store.js";

export interface DataControlDeps {
  readonly db: { withTransaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> };
  /** Null when uploads are not set up; then nothing is in storage to delete unless rows say so. */
  readonly store: ObjectStore | null;
}

export type DeleteResult =
  | { readonly ok: true; readonly counts: PurgeCounts; readonly files: number }
  | { readonly ok: false; readonly reason: "not_found" | "self" | "storage_unavailable" | "storage_failed" };

/** One consistent snapshot of every table. */
export async function exportEverything(deps: DataControlDeps, now: Date = new Date()): Promise<DataExport> {
  return deps.db.withTransaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    return dataControl.exportAll(tx, now);
  });
}

export async function deletePersonPermanently(deps: DataControlDeps, personId: string): Promise<DeleteResult> {
  const result = await deps.db.withTransaction((tx) => dataControl.purgePerson(tx, personId));
  return result.ok ? { ok: true, counts: result.counts, files: 0 } : { ok: false, reason: result.reason };
}

class StorageRefused extends Error {
  constructor(readonly reason: "storage_unavailable" | "storage_failed") {
    super(reason);
  }
}

async function removeBytes(store: ObjectStore | null, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  if (store === null) throw new StorageRefused("storage_unavailable");
  for (const key of keys) {
    try {
      await store.delete(key);
    } catch (error: unknown) {
      console.error("[data] storage delete failed:", error instanceof Error ? error.message : error);
      throw new StorageRefused("storage_failed");
    }
  }
}

export async function deleteDocumentPermanently(deps: DataControlDeps, documentId: string): Promise<DeleteResult> {
  try {
    return await deps.db.withTransaction(async (tx) => {
      const doc = await dataControl.lockDocument(tx, documentId);
      if (!doc) return { ok: false, reason: "not_found" } as const;
      await removeBytes(deps.store, [doc.storageKey]);
      return { ok: true, counts: await dataControl.purgeDocumentRows(tx, doc.id), files: 1 } as const;
    });
  } catch (error: unknown) {
    if (error instanceof StorageRefused) return { ok: false, reason: error.reason };
    throw error;
  }
}

export async function deleteEverything(deps: DataControlDeps): Promise<DeleteResult> {
  try {
    return await deps.db.withTransaction(async (tx) => {
      const keys = await dataControl.lockAllDocumentKeys(tx);
      await removeBytes(deps.store, keys);
      return { ok: true, counts: await dataControl.purgeAll(tx), files: keys.length } as const;
    });
  } catch (error: unknown) {
    if (error instanceof StorageRefused) return { ok: false, reason: error.reason };
    throw error;
  }
}
