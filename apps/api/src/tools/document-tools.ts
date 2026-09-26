/**
 * save_document and link_document — Phase 6 ingestion (docs/PHASE-6-DESIGN.md §8).
 *
 * Driven ONLY by the ingest pipeline (src/ingest/ingest.ts), never emitted by
 * the Interpret planner: the planner never sees a file, so it cannot name one.
 * They run through executeTurn like every other write, which is what makes an
 * upload one undoable turn in action_log.
 *
 * ┌─ VALIDATION REPEATS WHAT THE PIPELINE ALREADY CHECKED — ON PURPOSE ────┐
 * │ The tool layer is the authority (§37), whoever the caller is. The       │
 * │ reading is re-parsed here with the same validator the provider used, so │
 * │ a future caller that skips a step still cannot store an action-shaped   │
 * │ reading, an unbounded text, or a link to a row that does not exist.     │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import type { LoggedMutation, Result, ToolContext, ToolDefinition, ToolError } from "@ourglass/shared";
import {
  DOCUMENT_KINDS,
  MAX_READ_CHARS,
  MAX_UPLOAD_BYTES,
  cleanText,
  err,
  ok,
  parseReading,
  type DocumentKind,
  type DocumentReading,
} from "@ourglass/shared";
import { documents } from "@ourglass/db";
import { registerInverseHandler } from "./inverses.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `<yyyy>/<mm>/<uuid>.<ext>` — never anything derived from the uploaded name. */
const STORAGE_KEY_RE = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(pdf|docx|xlsx|txt|png|jpg|gif|webp)$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_FILENAME = 200;
const MAX_TRACE_JSON = 4_000;
const MAX_READ_FAILURE = 300;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ---------------------------------------------------------------------------
// save_document
// ---------------------------------------------------------------------------

export interface SaveDocumentInput {
  readonly id: string | null;
  readonly storageKey: string;
  readonly filename: string;
  readonly kind: DocumentKind;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly extractedText: string | null;
  readonly textTruncated: boolean;
  readonly reading: DocumentReading | null;
  readonly readFailure: string | null;
  readonly trace: unknown;
  readonly sourceMessageId: string | null;
}

export interface SaveDocumentOutput {
  readonly id: string;
  readonly filename: string;
}

async function validateSave(raw: unknown, ctx: ToolContext): Promise<Result<SaveDocumentInput, ToolError[]>> {
  const input = (raw ?? {}) as Record<string, unknown>;
  const errors: ToolError[] = [];
  const fail = (field: string, code: string, message: string) => errors.push({ field, code, message });

  if (input["id"] !== undefined && input["id"] !== null && !isUuid(input["id"])) {
    fail("id", "invalid_uuid", "id must be a UUID, or omitted.");
  }
  if (typeof input["storage_key"] !== "string" || !STORAGE_KEY_RE.test(input["storage_key"])) {
    fail("storage_key", "invalid_storage_key", "storage_key must be <yyyy>/<mm>/<uuid>.<ext>.");
  }
  const filename =
    typeof input["filename"] === "string" ? cleanText(input["filename"], MAX_FILENAME) : "";
  if (filename === "") fail("filename", "missing_filename", "filename is required.");
  if (!(DOCUMENT_KINDS as readonly unknown[]).includes(input["kind"])) {
    fail("kind", "invalid_kind", `kind must be one of ${DOCUMENT_KINDS.join(", ")}.`);
  }
  if (typeof input["content_type"] !== "string" || input["content_type"].length === 0 || input["content_type"].length > 200) {
    fail("content_type", "invalid_content_type", "content_type is required.");
  }
  const byteSize = input["byte_size"];
  if (typeof byteSize !== "number" || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_UPLOAD_BYTES) {
    fail("byte_size", "invalid_byte_size", `byte_size must be 1..${MAX_UPLOAD_BYTES}.`);
  }
  if (typeof input["sha256"] !== "string" || !SHA256_RE.test(input["sha256"])) {
    fail("sha256", "invalid_sha256", "sha256 must be 64 lowercase hex characters.");
  }

  const extracted = input["extracted_text"] ?? null;
  if (extracted !== null && (typeof extracted !== "string" || extracted.length > MAX_READ_CHARS)) {
    fail("extracted_text", "invalid_extracted_text", `extracted_text must be a string of at most ${MAX_READ_CHARS} characters.`);
  }

  // Re-parsed, not trusted: see the header.
  let reading: DocumentReading | null = null;
  if (input["reading"] !== undefined && input["reading"] !== null) {
    reading = parseReading(input["reading"]);
    if (reading === null) fail("reading", "invalid_reading", "reading is not a DocumentReading.");
  }

  const readFailure = input["read_failure"] ?? null;
  if (readFailure !== null && (typeof readFailure !== "string" || readFailure.length > MAX_READ_FAILURE)) {
    fail("read_failure", "invalid_read_failure", "read_failure must be a short string.");
  }

  const trace = input["trace"] ?? null;
  if (trace !== null && (typeof trace !== "object" || JSON.stringify(trace).length > MAX_TRACE_JSON)) {
    fail("trace", "invalid_trace", "trace must be a small object.");
  }

  const sourceMessageId = input["source_message_id"] ?? null;
  if (sourceMessageId !== null && !isUuid(sourceMessageId)) {
    fail("source_message_id", "invalid_uuid", "source_message_id must be a UUID.");
  }

  if (errors.length > 0) return err(errors);

  if (sourceMessageId !== null) {
    const { rows } = await ctx.tx.query(`SELECT 1 FROM messages WHERE id = $1`, [sourceMessageId]);
    if (rows.length === 0) {
      return err([{ field: "source_message_id", code: "unknown_message", message: "No such message." }]);
    }
  }
  // §23 for files, enforced here as well as by the pipeline's early check: two
  // uploads of one file racing each other must still produce one document.
  const existing = await documents.findCurrentBySha256(ctx.tx, input["sha256"] as string);
  if (existing) {
    return err([
      { field: "sha256", code: "duplicate_document", message: `That file is already saved as "${existing.filename}".` },
    ]);
  }

  return ok({
    id: isUuid(input["id"]) ? input["id"] : null,
    storageKey: input["storage_key"] as string,
    filename,
    kind: input["kind"] as DocumentKind,
    contentType: input["content_type"] as string,
    byteSize: byteSize as number,
    sha256: input["sha256"] as string,
    extractedText: extracted as string | null,
    textTruncated: input["text_truncated"] === true,
    reading,
    readFailure: readFailure as string | null,
    trace,
    sourceMessageId: sourceMessageId as string | null,
  });
}

async function commitSave(
  input: SaveDocumentInput,
  ctx: ToolContext,
): Promise<{ output: SaveDocumentOutput; mutations: readonly LoggedMutation[] }> {
  const row = await documents.createDocument(ctx.tx, input);
  return {
    output: { id: row.id, filename: row.filename },
    mutations: [
      {
        targetTable: "documents",
        targetId: row.id,
        // Metadata only: the text and the reading stay in their row, not
        // duplicated into the ledger.
        forwardPatch: { filename: row.filename, kind: row.kind, sha256: row.sha256 },
        inversePatch: { id: row.id },
        invertibility: "full",
      },
    ],
  };
}

export const saveDocumentTool: ToolDefinition<SaveDocumentInput, SaveDocumentOutput> = {
  name: "save_document",
  description:
    "Record an uploaded file whose bytes are already in storage, with its extracted text and " +
    "reading. Driven only by the ingest pipeline.",
  validate: validateSave,
  commit: commitSave,
};

// ---------------------------------------------------------------------------
// link_document
// ---------------------------------------------------------------------------

const TARGET_VIEWS = {
  person: "people_current",
  organization: "organizations_current",
  project: "projects_current",
} as const;

type TargetKind = keyof typeof TARGET_VIEWS;
type Inference = "CONFIRMED" | "INFERRED";

export interface LinkDocumentInput {
  readonly documentId: string;
  readonly targetKind: TargetKind;
  readonly targetId: string;
  readonly inferenceLevel: Inference;
}

export interface LinkDocumentOutput {
  readonly id: string;
  readonly targetKind: TargetKind;
  readonly targetId: string;
}

async function validateLink(raw: unknown, ctx: ToolContext): Promise<Result<LinkDocumentInput, ToolError[]>> {
  const input = (raw ?? {}) as Record<string, unknown>;
  const documentId = input["document_id"];
  const targetKind = input["target_kind"];
  const targetId = input["target_id"];
  const inference = input["inference_level"];

  if (!isUuid(documentId)) {
    return err([{ field: "document_id", code: "invalid_uuid", message: "document_id must be a UUID." }]);
  }
  if (typeof targetKind !== "string" || !(targetKind in TARGET_VIEWS)) {
    return err([{ field: "target_kind", code: "invalid_target_kind", message: "target_kind must be person, organization or project." }]);
  }
  if (!isUuid(targetId)) {
    return err([{ field: "target_id", code: "invalid_uuid", message: "target_id must be a UUID." }]);
  }
  if (inference !== "CONFIRMED" && inference !== "INFERRED") {
    return err([{ field: "inference_level", code: "invalid_inference", message: "inference_level must be CONFIRMED or INFERRED." }]);
  }

  const { rows: doc } = await ctx.tx.query(`SELECT 1 FROM documents_current WHERE id = $1`, [documentId]);
  if (doc.length === 0) {
    return err([{ field: "document_id", code: "unknown_document", message: "No such document." }]);
  }
  // The polymorphic target has no FK (migration 013), so existence is checked
  // HERE — and against the _current view, so a merged-away or undone row
  // cannot be linked.
  const view = TARGET_VIEWS[targetKind as TargetKind];
  const { rows: target } = await ctx.tx.query(`SELECT 1 FROM ${view} WHERE id = $1`, [targetId]);
  if (target.length === 0) {
    return err([{ field: "target_id", code: "unknown_target", message: `No current ${targetKind} with that id.` }]);
  }
  if (await documents.findCurrentLink(ctx.tx, documentId, targetKind as TargetKind, targetId)) {
    return err([{ field: "target_id", code: "already_linked", message: "The document is already linked to that." }]);
  }

  return ok({ documentId, targetKind: targetKind as TargetKind, targetId, inferenceLevel: inference });
}

async function commitLink(
  input: LinkDocumentInput,
  ctx: ToolContext,
): Promise<{ output: LinkDocumentOutput; mutations: readonly LoggedMutation[] }> {
  const row = await documents.createLink(ctx.tx, input);
  return {
    output: { id: row.id, targetKind: input.targetKind, targetId: input.targetId },
    mutations: [
      {
        targetTable: "document_links",
        targetId: row.id,
        forwardPatch: { documentId: input.documentId, targetKind: input.targetKind, targetId: input.targetId },
        inversePatch: { id: row.id },
        invertibility: "full",
      },
    ],
  };
}

export const linkDocumentTool: ToolDefinition<LinkDocumentInput, LinkDocumentOutput> = {
  name: "link_document",
  description:
    "Associate a saved document with an existing person, organization or project (§33). " +
    "Never creates the target.",
  validate: validateLink,
  commit: commitLink,
};

// ---------------------------------------------------------------------------
// Inverses. INVALIDATE, never delete. The bytes stay in storage (§3), so a
// redo would lose nothing.
// ---------------------------------------------------------------------------
registerInverseHandler("documents", async (tx, targetId) => {
  if (!targetId) return;
  await documents.invalidateDocument(tx, targetId);
});

registerInverseHandler("document_links", async (tx, targetId) => {
  if (!targetId) return;
  await documents.invalidateLink(tx, targetId);
});
