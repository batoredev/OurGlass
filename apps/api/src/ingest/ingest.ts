/**
 * One uploaded file, end to end (docs/PHASE-6-DESIGN.md §2).
 *
 * ================================ READ THIS ================================
 * FILE CONTENT FLOWS TO EXACTLY ONE MODEL CALL: `deps.reader.read`. Nothing
 * here calls the extractor, the responder or `runTurn`, and nothing passes
 * the file's text or the reading's strings into a tool call except as a
 * stored value. That is the whole injection defence (§1), and it is a
 * property of this file's IMPORTS as much as of its code — ingest.test.ts
 * asserts both.
 * ===========================================================================
 *
 * Same shape as runTurn, on purpose: the user message is written FIRST (it
 * must survive a failure, and it is the provenance a document points at),
 * the writes go through executeTurn as one undoable turn, and the reply is a
 * deterministic template persisted as the assistant message.
 */
import {
  MAX_UPLOAD_BYTES,
  cleanText,
  type AIProviderName,
  type DocumentReading,
  type ImageMediaType,
} from "@ourglass/shared";
import { documents, messages, organizations, people, projects, users } from "@ourglass/db";
import { executeTurn, type Deps as ExecutorDeps } from "../tools/index.js";
import type { ReadInput, ReadResult } from "../ai/provider.js";
import type { ObjectStore } from "../storage/object-store.js";
import { associate, type LinkCandidate, type NamedRow } from "./associate.js";
import { UnreadableFileError } from "./errors.js";
import { extractText } from "./extract.js";
import { renderIngestReply, type IngestReplyCase, type UnreadReason } from "./reply.js";
import { sniffFile } from "./sniff.js";

/**
 * Claude's limit is 10 MB BASE64 per image (verified 2026-09-25), ~7.5 MB
 * raw. Over it the API answers a terminal bad_request that would never fall
 * back, so the image is saved and honestly left unread instead.
 */
export const MAX_READ_IMAGE_BYTES = 7 * 1024 * 1024;
/** A note is a sentence or two ("this is the final Hult brief"), not a document. */
export const MAX_NOTE_CHARS = 1_000;

/** Anything that can read a file — in the app, the AIModelRouter. */
export interface DocumentReader {
  read(input: ReadInput): Promise<ReadResult & { readonly provider?: AIProviderName }>;
}

export interface IngestDeps extends ExecutorDeps {
  readonly store: ObjectStore;
  /** Null when no model is configured: the file is still saved, and the reply says why it is unread. */
  readonly reader: DocumentReader | null;
}

export interface IngestRequest {
  readonly bytes: Uint8Array;
  /** As uploaded. Display only — never a path, never sent to a model. */
  readonly filename: string;
  /** The user's own words sent with the file. May be "". Used for association only. */
  readonly note: string;
  readonly userId: string;
  readonly now?: Date;
}

export type IngestOutcome = "saved" | "unread" | "duplicate" | "rejected" | "failed";

export interface IngestResponse {
  readonly outcome: IngestOutcome;
  readonly documentId: string | null;
  /** The undoable turn. Null when nothing was written. */
  readonly turnId: string | null;
  readonly reply: string;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Chunked so a 7 MB image never becomes one giant argument list. Works on Node and Workers alike. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function storageKey(now: Date, ext: string): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${now.getUTCFullYear()}/${month}/${crypto.randomUUID()}.${ext}`;
}

async function knownRows(deps: IngestDeps, userId: string): Promise<{ rows: NamedRow[]; selfId: string | null }> {
  return deps.db.withTransaction(async (tx) => {
    // SEQUENTIAL, not Promise.all: one transaction is one client, and pg
    // deprecates concurrent queries on a client (an error from pg@9).
    const account = await users.getUserWithPerson(tx, userId);
    const everyone = await people.list(tx);
    const orgs = await organizations.list(tx);
    const work = await projects.list(tx);
    return {
      selfId: account?.self?.id ?? null,
      rows: [
        ...everyone.map((row) => ({ kind: "person" as const, id: row.id, name: row.display_name })),
        ...orgs.map((row) => ({ kind: "organization" as const, id: row.id, name: row.name })),
        ...work.map((row) => ({ kind: "project" as const, id: row.id, name: row.name })),
      ],
    };
  });
}

export async function ingestDocument(req: IngestRequest, deps: IngestDeps): Promise<IngestResponse> {
  const now = req.now ?? new Date();
  const filename = cleanText(req.filename, 200) || "file";
  const note = cleanText(req.note, MAX_NOTE_CHARS);

  // ---- The user message, FIRST (as runTurn's step 1) -----------------------
  const userMessage = await deps.db.withTransaction((tx) =>
    messages.createMessage(tx, { role: "user", body: note === "" ? `📎 ${filename}` : `${note}\n📎 ${filename}` }),
  );

  const finish = async (
    outcome: IngestOutcome,
    replyCase: IngestReplyCase,
    extra: { documentId?: string | null; turnId?: string | null; trace?: unknown } = {},
  ): Promise<IngestResponse> => {
    const reply = renderIngestReply(replyCase);
    const turnId = extra.turnId ?? null;
    // Never loses a committed write: a failed assistant-message insert is
    // logged, and the reply still goes back (runTurn's persistAssistantMessage).
    try {
      await deps.db.withTransaction((tx) =>
        messages.createMessage(tx, {
          role: "assistant",
          body: reply,
          turnId,
          degraded: outcome !== "saved",
          // Operational facts only — never the file's words.
          trace: { stage: "read", outcome, documentId: extra.documentId ?? null, read: extra.trace ?? null },
        }),
      );
    } catch (error: unknown) {
      console.error("[ingest] failed to persist the assistant message:", error);
    }
    return { outcome, documentId: extra.documentId ?? null, turnId, reply };
  };

  // ---- What is it? ----------------------------------------------------------
  if (req.bytes.length > MAX_UPLOAD_BYTES) {
    return finish("rejected", { kind: "rejected", reason: "That file is over 10 MB — too large for me to take." });
  }
  const sniffed = sniffFile(req.bytes);
  if (!sniffed.ok) return finish("rejected", { kind: "rejected", reason: sniffed.reason });
  const { kind, contentType, ext } = sniffed.file;

  // ---- §23 for files: the same bytes are one document -----------------------
  const sha256 = await sha256Hex(req.bytes);
  const existing = await deps.db.withTransaction((tx) => documents.findCurrentBySha256(tx, sha256));
  if (existing) {
    return finish("duplicate", { kind: "duplicate", existingFilename: existing.filename }, { documentId: existing.id });
  }

  // ---- Store the bytes -------------------------------------------------------
  const key = storageKey(now, ext);
  try {
    await deps.store.put(key, req.bytes, contentType);
  } catch (error: unknown) {
    console.error("[ingest] storage failed:", error instanceof Error ? error.message : error);
    return finish("failed", { kind: "store_failed" });
  }

  // ---- Text, locally; then the ONE model call --------------------------------
  let extractedText: string | null = null;
  let truncated = false;
  let readInput: ReadInput | null = null;
  let unread: UnreadReason | null = null;

  if (kind === "image") {
    if (req.bytes.length > MAX_READ_IMAGE_BYTES) unread = "image_too_large";
    else readInput = { kind: "image", mediaType: contentType as ImageMediaType, base64: toBase64(req.bytes) };
  } else {
    try {
      const extracted = await extractText(req.bytes, kind);
      extractedText = extracted.text;
      truncated = extracted.truncated;
      if (extracted.text === "") unread = "no_text";
      else readInput = { kind: "text", text: extracted.text };
    } catch (error: unknown) {
      if (!(error instanceof UnreadableFileError)) throw error;
      unread = error.reason;
    }
  }

  let reading: DocumentReading | null = null;
  let trace: Record<string, unknown> | null = null;
  if (readInput) {
    if (!deps.reader) {
      unread = "no_model";
    } else {
      try {
        const result = await deps.reader.read(readInput);
        reading = result.reading;
        trace = { provider: result.provider ?? null, ...result.trace };
      } catch (error: unknown) {
        // Degrade, do not fail: the bytes are safe, and the file can be read
        // later. The router has already logged every attempt with its category.
        //
        // NOTHING TRIED is not the same as EVERYTHING FAILED: with only a
        // text model configured, an image never reaches a model at all, and
        // "the models didn't answer" would send the user to wait for an
        // outage that is not happening.
        const tried = (error as { failures?: unknown }).failures;
        const nothingTried = Array.isArray(tried) && tried.length === 0;
        unread = nothingTried ? (readInput.kind === "image" ? "no_image_model" : "no_model") : "model_failed";
        trace = { failed: true, error: error instanceof Error ? error.name : "unknown" };
      }
    }
  }

  // ---- Association: code, never a model (§6) --------------------------------
  const known = await knownRows(deps, req.userId);
  const links: LinkCandidate[] = associate(note, reading, known.rows, known.selfId);

  // ---- One undoable turn -----------------------------------------------------
  const documentId = crypto.randomUUID();
  const outcome = await executeTurn(
    [
      {
        name: "save_document",
        input: {
          id: documentId,
          storage_key: key,
          filename,
          kind,
          content_type: contentType,
          byte_size: req.bytes.length,
          sha256,
          extracted_text: extractedText,
          text_truncated: truncated,
          reading,
          read_failure: unread,
          trace,
          source_message_id: userMessage.id,
        },
      },
      ...links.map((link) => ({
        name: "link_document",
        input: {
          document_id: documentId,
          target_kind: link.kind,
          target_id: link.id,
          inference_level: link.inference,
        },
      })),
    ],
    deps,
  );
  if (!outcome.ok) {
    // A concurrent upload of the same bytes won the race: §23 still holds.
    const duplicate = outcome.errors.find((error) => error.code === "duplicate_document");
    if (duplicate) {
      const winner = await deps.db.withTransaction((tx) => documents.findCurrentBySha256(tx, sha256));
      return finish("duplicate", { kind: "duplicate", existingFilename: winner?.filename ?? filename });
    }
    console.error("[ingest] save rejected:", outcome.errors.map((error) => error.code).join(", "));
    return finish("failed", { kind: "store_failed" });
  }

  await deps.db.withTransaction((tx) => messages.setTurnId(tx, userMessage.id, outcome.turnId));

  const linkNames = links.map((link) => link.name);
  const replyCase: IngestReplyCase =
    reading !== null
      ? { kind: "saved", filename, reading, links: linkNames, truncated }
      : { kind: "unread", filename, reason: unread ?? "model_failed", links: linkNames };
  return finish(reading !== null ? "saved" : "unread", replyCase, { documentId, turnId: outcome.turnId, trace });
}
