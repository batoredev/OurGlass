/**
 * What a file IS, decided from its bytes (docs/PHASE-6-DESIGN.md §2).
 *
 * NEVER from the filename or the browser's declared type. Both are chosen by
 * whoever produced the file: "poster.png" can be an executable, and
 * `Content-Type: image/png` is one header away from anything. Magic numbers
 * are what the parsers downstream will actually meet, so they are what
 * decides which parser runs.
 */
import type { DocumentKind } from "@ourglass/shared";
import { listZipEntries } from "./ooxml.js";

export interface SniffedFile {
  readonly kind: DocumentKind;
  /** The type we store and serve — derived here, never taken from the client. */
  readonly contentType: string;
  /** For the storage key only. */
  readonly ext: string;
}

export type SniffResult =
  | { readonly ok: true; readonly file: SniffedFile }
  | { readonly ok: false; readonly reason: string };

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
/** OLE compound file: .doc, .xls, .ppt before 2007. */
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** How much of a would-be text file is checked for NUL bytes. The whole file is decoded later. */
const TEXT_PROBE_BYTES = 8192;

const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Sniff a file. A refusal carries a sentence written for the user, because
 * "unsupported file" alone leaves them guessing what WOULD work.
 */
export function sniffFile(bytes: Uint8Array): SniffResult {
  if (bytes.length === 0) return { ok: false, reason: "That file is empty." };

  if (startsWith(bytes, ascii("%PDF-"))) {
    return { ok: true, file: { kind: "pdf", contentType: "application/pdf", ext: "pdf" } };
  }
  if (startsWith(bytes, PNG)) {
    return { ok: true, file: { kind: "image", contentType: "image/png", ext: "png" } };
  }
  if (startsWith(bytes, JPEG)) {
    return { ok: true, file: { kind: "image", contentType: "image/jpeg", ext: "jpg" } };
  }
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) {
    return { ok: true, file: { kind: "image", contentType: "image/gif", ext: "gif" } };
  }
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
    return { ok: true, file: { kind: "image", contentType: "image/webp", ext: "webp" } };
  }
  // ISO base media ("....ftyp<brand>"): HEIC is what an iPhone camera saves,
  // and neither vision model accepts it. Named, because "unsupported" alone
  // would leave someone re-sending the same photo.
  if (startsWith(bytes, ascii("ftyp"), 4)) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (/^(heic|heix|hevc|mif1|msf1|avif)$/.test(brand)) {
      return {
        ok: false,
        reason: "I can't read HEIC/AVIF photos yet. A screenshot of it, or the photo saved as JPEG, works.",
      };
    }
    return { ok: false, reason: "I can't read video or audio files." };
  }
  if (startsWith(bytes, OLE)) {
    return {
      ok: false,
      reason: "That's an older Word/Excel format (.doc/.xls). Saved as .docx or .xlsx, I can read it.",
    };
  }
  if (startsWith(bytes, ZIP)) {
    const entries = listZipEntries(bytes);
    if (entries === null) return { ok: false, reason: "That file looks damaged — I couldn't open it." };
    if (entries.has("word/document.xml")) {
      return { ok: true, file: { kind: "docx", contentType: DOCX_TYPE, ext: "docx" } };
    }
    if (entries.has("xl/workbook.xml")) {
      return { ok: true, file: { kind: "xlsx", contentType: XLSX_TYPE, ext: "xlsx" } };
    }
    return {
      ok: false,
      reason: "I can read PDFs, Word (.docx) and Excel (.xlsx) files, text files and images — not other zip files.",
    };
  }

  // Plain text last: it has no signature, so it is whatever is left that
  // decodes as UTF-8 with no NUL bytes. A NUL in the first 8 KB means binary.
  if (!bytes.subarray(0, TEXT_PROBE_BYTES).includes(0)) {
    try {
      utf8.decode(bytes);
      return { ok: true, file: { kind: "text", contentType: "text/plain; charset=utf-8", ext: "txt" } };
    } catch {
      // Not UTF-8: fall through to the refusal.
    }
  }
  return {
    ok: false,
    reason: "I can read PDFs, Word (.docx) and Excel (.xlsx) files, text files and images (PNG, JPEG, WebP, GIF).",
  };
}
