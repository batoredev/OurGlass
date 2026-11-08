/**
 * Export, and PERMANENT delete — the owner's control over everything stored
 * (ROADMAP Stage 0; owner default 2026-11-05: "add permanent delete and export
 * alongside undo").
 *
 * ================================ READ THIS ================================
 * UNDO IS NOT DELETE. Undo invalidates: the row stays, with `t_invalid` set,
 * and `action_log` keeps both patches — which hold COPIES of the row's data.
 * A purge removes the rows themselves AND scrubs the log:
 *   - log entries that target a purged row are deleted;
 *   - any other entry whose patches mention a purged id is redacted to
 *     `{"purged":true}` and marked non-invertible, so the turn it belongs to
 *     can no longer be undone (its inverse would refer to rows that are gone).
 *
 * These are NOT tools. No model can call them: they run only from the
 * owner's own request through an authorised route, after an explicit
 * confirmation (ai-systems rule: irreversible actions are gated outside the
 * model).
 *
 * WHAT A PERSON PURGE DOES NOT FIND: text that names them inside something
 * else — a message you typed, a memory about someone else, a document, a
 * meeting title. Those are matched by reference (ids), never by name; a name
 * search would delete things that merely contain the same word.
 * ===========================================================================
 */
import type { Queryable } from "../client.js";

/** Columns never exported: vectors and search indexes are derived data; the refresh token is a credential. */
const NOT_EXPORTED: ReadonlySet<string> = new Set(["embedding", "object_embedding", "body_tsv", "refresh_token_enc"]);

/**
 * Every table holding the owner's data, in export order. data-control.integration
 * .test.ts fails when a migration adds a table that is not here, so a new table
 * is a decision about export and delete, not an accident.
 */
export const EXPORTED_TABLES = [
  "users",
  "people",
  "organizations",
  "projects",
  "commitments",
  "commitment_notes",
  "reminders",
  "workflows",
  "events",
  "checklist_marks",
  "memories",
  "relationships",
  "thoughts",
  "entity_types",
  "entity_type_fields",
  "entity_records",
  "documents",
  "document_links",
  "messages",
  "pending_actions",
  "sent_emails",
  "permission_grants",
  "google_accounts",
  "action_log",
] as const;

/** Tables deliberately not exported. */
export const NOT_EXPORTED_TABLES = ["pgmigrations"] as const;

export interface DataExport {
  readonly format: "ourglass-export";
  readonly version: 1;
  readonly exportedAt: string;
  /** Every row, current and undone; undone rows carry `t_invalid`. */
  readonly tables: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  readonly notes: readonly string[];
}

export async function exportAll(tx: Queryable, now: Date = new Date()): Promise<DataExport> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of EXPORTED_TABLES) {
    // Sequential: one transaction is one client (pg deprecates concurrent queries on it).
    const { rows } = await tx.query<Record<string, unknown>>(`SELECT * FROM ${table}`);
    tables[table] = rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) if (!NOT_EXPORTED.has(key)) out[key] = value;
      return out;
    });
  }
  return {
    format: "ourglass-export",
    version: 1,
    exportedAt: now.toISOString(),
    tables,
    notes: [
      "Uploaded files' bytes are not included; each document row has its filename and extracted text.",
      "Search vectors are left out (they are derived), and so is the Google sign-in token.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ids(tx: Queryable, sql: string, params: readonly unknown[]): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(sql, params as unknown[]);
  return rows.map((row) => row.id);
}

async function deleteWhereIdIn(tx: Queryable, table: string, list: readonly string[]): Promise<number> {
  if (list.length === 0) return 0;
  const { rowCount } = await tx.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [list]);
  return rowCount ?? 0;
}

/**
 * The log, scrubbed of purged rows: entries that targeted one are deleted;
 * entries that merely mention one (in either patch) are redacted.
 */
async function scrubActionLog(tx: Queryable, purged: readonly string[]): Promise<{ deleted: number; redacted: number }> {
  if (purged.length === 0) return { deleted: 0, redacted: 0 };
  const deleted = await tx.query(`DELETE FROM action_log WHERE target_id = ANY($1::uuid[])`, [purged]);
  const redacted = await tx.query(
    `UPDATE action_log
        SET forward_patch = '{"purged":true}'::jsonb,
            inverse_patch = '{"purged":true}'::jsonb,
            invertibility = 'none'
      WHERE forward_patch <> '{"purged":true}'::jsonb
        AND EXISTS (
          SELECT 1 FROM unnest($1::text[]) AS purged(id)
           WHERE action_log.forward_patch::text LIKE '%' || purged.id || '%'
              OR action_log.inverse_patch::text LIKE '%' || purged.id || '%'
        )`,
    [purged],
  );
  return { deleted: deleted.rowCount ?? 0, redacted: redacted.rowCount ?? 0 };
}

/** Rows whose JSON mentions any of these ids (uuids are unique strings, so this is exact). */
function mentionsAny(column: string): string {
  return `EXISTS (SELECT 1 FROM unnest($1::text[]) AS ref(id) WHERE ${column}::text LIKE '%' || ref.id || '%')`;
}

export type PurgeCounts = Readonly<Record<string, number>>;

// ---------------------------------------------------------------------------
// One person
// ---------------------------------------------------------------------------

export type PurgePersonResult =
  | { readonly ok: true; readonly displayName: string; readonly counts: PurgeCounts }
  | { readonly ok: false; readonly reason: "not_found" | "self" };

/**
 * The person (and any duplicate merged into them), every commitment either way
 * between you, its notes, reminders, rules and checklist ticks, every memory
 * and relationship about them, their file links, tracker records and held
 * actions that refer to them, and the emails sent to them.
 */
export async function purgePerson(tx: Queryable, personId: string): Promise<PurgePersonResult> {
  const head = await tx.query<{ display_name: string }>(`SELECT display_name FROM people WHERE id = $1 FOR UPDATE`, [
    personId,
  ]);
  if (head.rows.length === 0) return { ok: false, reason: "not_found" };

  const personIds = await ids(
    tx,
    `WITH RECURSIVE everyone(id) AS (
       SELECT id FROM people WHERE id = $1
       UNION
       SELECT p.id FROM people p JOIN everyone e ON p.merged_into_id = e.id
     ) SELECT id FROM everyone`,
    [personId],
  );
  const self = await tx.query(`SELECT 1 FROM users WHERE person_id = ANY($1::uuid[])`, [personIds]);
  if (self.rows.length > 0) return { ok: false, reason: "self" };

  const commitmentIds = await ids(
    tx,
    `SELECT id FROM commitments WHERE owner_id = ANY($1::uuid[]) OR recipient_id = ANY($1::uuid[])`,
    [personIds],
  );
  const reminderIds = await ids(tx, `SELECT id FROM reminders WHERE commitment_id = ANY($1::uuid[])`, [commitmentIds]);
  const workflowIds = await ids(tx, `SELECT id FROM workflows WHERE subject_commitment_id = ANY($1::uuid[])`, [
    commitmentIds,
  ]);
  const noteIds = await ids(tx, `SELECT id FROM commitment_notes WHERE commitment_id = ANY($1::uuid[])`, [commitmentIds]);
  const markIds = await ids(tx, `SELECT id FROM checklist_marks WHERE item_kind = 'reminder' AND item_id = ANY($1::uuid[])`, [
    reminderIds,
  ]);
  const memoryIds = await ids(
    tx,
    `SELECT id FROM memories WHERE subject_kind = 'person' AND subject_id = ANY($1::uuid[])`,
    [personIds],
  );
  const relationshipIds = await ids(
    tx,
    `SELECT id FROM relationships
      WHERE subject_id = ANY($1::uuid[]) OR (object_kind = 'person' AND object_id = ANY($1::uuid[]))`,
    [personIds],
  );
  const linkIds = await ids(
    tx,
    `SELECT id FROM document_links WHERE target_kind = 'person' AND target_id = ANY($1::uuid[])`,
    [personIds],
  );
  const recordIds = await ids(tx, `SELECT id FROM entity_records WHERE ${mentionsAny("payload")}`, [personIds]);
  const pendingIds = await ids(tx, `SELECT id FROM pending_actions WHERE ${mentionsAny("calls")}`, [
    [...personIds, ...commitmentIds],
  ]);
  const emailIds = await ids(tx, `SELECT id FROM sent_emails WHERE person_id = ANY($1::uuid[])`, [personIds]);

  // Children before parents: every foreign key here is NO ACTION.
  const counts: Record<string, number> = {};
  counts["checklist_marks"] = await deleteWhereIdIn(tx, "checklist_marks", markIds);
  counts["pending_actions"] = await deleteWhereIdIn(tx, "pending_actions", pendingIds);
  counts["document_links"] = await deleteWhereIdIn(tx, "document_links", linkIds);
  counts["entity_records"] = await deleteWhereIdIn(tx, "entity_records", recordIds);
  counts["sent_emails"] = await deleteWhereIdIn(tx, "sent_emails", emailIds);
  counts["workflows"] = await deleteWhereIdIn(tx, "workflows", workflowIds);
  counts["reminders"] = await deleteWhereIdIn(tx, "reminders", reminderIds);
  counts["commitment_notes"] = await deleteWhereIdIn(tx, "commitment_notes", noteIds);
  counts["memories"] = await deleteWhereIdIn(tx, "memories", memoryIds);
  counts["relationships"] = await deleteWhereIdIn(tx, "relationships", relationshipIds);
  counts["commitments"] = await deleteWhereIdIn(tx, "commitments", commitmentIds);
  counts["people"] = await deleteWhereIdIn(tx, "people", personIds);

  const log = await scrubActionLog(tx, [
    ...personIds,
    ...commitmentIds,
    ...reminderIds,
    ...workflowIds,
    ...noteIds,
    ...markIds,
    ...memoryIds,
    ...relationshipIds,
    ...linkIds,
    ...recordIds,
    ...pendingIds,
    ...emailIds,
  ]);
  counts["action_log_deleted"] = log.deleted;
  counts["action_log_redacted"] = log.redacted;
  return { ok: true, displayName: head.rows[0]!.display_name, counts };
}

// ---------------------------------------------------------------------------
// One document
// ---------------------------------------------------------------------------

export interface DocumentToPurge {
  readonly id: string;
  readonly storageKey: string;
  readonly filename: string;
}

/** Locks the row, so the bytes can be removed before the row is (see apps/api data control). */
export async function lockDocument(tx: Queryable, documentId: string): Promise<DocumentToPurge | null> {
  const { rows } = await tx.query<{ id: string; storage_key: string; filename: string }>(
    `SELECT id, storage_key, filename FROM documents WHERE id = $1 FOR UPDATE`,
    [documentId],
  );
  const row = rows[0];
  return row ? { id: row.id, storageKey: row.storage_key, filename: row.filename } : null;
}

/** Messages nothing else points at (a memory or note can cite the message it came from). */
const UNREFERENCED_MESSAGE = `
  NOT EXISTS (SELECT 1 FROM memories WHERE source_message_id = messages.id)
  AND NOT EXISTS (SELECT 1 FROM relationships WHERE source_message_id = messages.id)
  AND NOT EXISTS (SELECT 1 FROM commitment_notes WHERE source_message_id = messages.id)
  AND NOT EXISTS (SELECT 1 FROM pending_actions WHERE source_message_id = messages.id)
  AND NOT EXISTS (SELECT 1 FROM documents WHERE source_message_id = messages.id)`;

/**
 * The document row, its links, the upload's own two messages (the "📎 name"
 * message and the reply that quoted the file), and its log entries. The
 * caller removes the stored bytes.
 */
export async function purgeDocumentRows(tx: Queryable, documentId: string): Promise<PurgeCounts> {
  const doc = await tx.query<{ source_message_id: string | null }>(
    `SELECT source_message_id FROM documents WHERE id = $1`,
    [documentId],
  );
  if (doc.rows.length === 0) return {};
  const sourceMessageId = doc.rows[0]!.source_message_id;

  const linkIds = await ids(tx, `SELECT id FROM document_links WHERE document_id = $1`, [documentId]);
  const counts: Record<string, number> = {};
  counts["document_links"] = await deleteWhereIdIn(tx, "document_links", linkIds);
  counts["documents"] = await deleteWhereIdIn(tx, "documents", [documentId]);
  const messageIds = await ids(
    tx,
    `SELECT id FROM messages
      WHERE (id = $1::uuid OR trace->>'documentId' = $2::text) AND ${UNREFERENCED_MESSAGE}`,
    [sourceMessageId, documentId],
  );
  counts["messages"] = await deleteWhereIdIn(tx, "messages", messageIds);

  const log = await scrubActionLog(tx, [documentId, ...linkIds, ...messageIds]);
  counts["action_log_deleted"] = log.deleted;
  counts["action_log_redacted"] = log.redacted;
  return counts;
}

// ---------------------------------------------------------------------------
// Everything
// ---------------------------------------------------------------------------

/** Every stored object's key, locked, so the bytes can go before the rows. */
export async function lockAllDocumentKeys(tx: Queryable): Promise<string[]> {
  const { rows } = await tx.query<{ storage_key: string }>(`SELECT storage_key FROM documents FOR UPDATE`);
  return rows.map((row) => row.storage_key);
}

/**
 * Every row of the owner's data. KEPT: the account itself (`users` and your
 * own person row, cleared of details) and your settings — the permission
 * rules and the Google connection, which Settings disconnects.
 */
export async function purgeAll(tx: Queryable): Promise<PurgeCounts> {
  const selfIds = await ids(tx, `SELECT person_id AS id FROM users WHERE person_id IS NOT NULL`, []);
  const counts: Record<string, number> = {};
  const wipe = async (table: string, where = ""): Promise<void> => {
    const { rowCount } = await tx.query(`DELETE FROM ${table} ${where}`, where === "" ? [] : [selfIds]);
    counts[table] = rowCount ?? 0;
  };
  // Children before parents.
  await wipe("checklist_marks");
  await wipe("pending_actions");
  await wipe("document_links");
  await wipe("documents");
  await wipe("entity_records");
  await wipe("entity_type_fields");
  await wipe("entity_types");
  await wipe("sent_emails");
  await wipe("workflows");
  await wipe("reminders");
  await wipe("commitment_notes");
  await wipe("memories");
  await wipe("relationships");
  await wipe("thoughts");
  await wipe("events");
  await wipe("commitments");
  // Your own person row stays (the account points at it), with nothing on it.
  await tx.query(
    `UPDATE people SET organization_id = NULL, merged_into_id = NULL, notes = NULL, email = NULL
      WHERE id = ANY($1::uuid[])`,
    [selfIds],
  );
  await tx.query(`UPDATE people SET merged_into_id = NULL WHERE NOT (id = ANY($1::uuid[]))`, [selfIds]);
  await wipe("people", "WHERE NOT (id = ANY($1::uuid[]))");
  await tx.query(`UPDATE projects SET merged_into_id = NULL`);
  await wipe("projects");
  await tx.query(`UPDATE organizations SET merged_into_id = NULL`);
  await wipe("organizations");
  await wipe("messages");
  await wipe("action_log");
  return counts;
}
