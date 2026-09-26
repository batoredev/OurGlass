/**
 * A file's text, extracted locally — no model involved (docs/PHASE-6-DESIGN.md §2).
 *
 * Deterministic on purpose: the same file must produce the same text every
 * time, which is `wat.md`'s test for "this belongs in code, not in a model".
 * The model sees what this returns, bounded by MAX_READ_CHARS, and nothing
 * else of the file.
 */
import { MAX_READ_CHARS, type DocumentKind } from "@ourglass/shared";
import { getDocumentProxy } from "unpdf";
import { UnreadableFileError } from "./errors.js";
import { docxText, xlsxText } from "./ooxml.js";

/** §5: bounds CPU on a Worker; a 1,000-page PDF is read to page 100 and says so. */
export const MAX_PDF_PAGES = 100;

export interface ExtractedText {
  /** Normalised and at most MAX_READ_CHARS long. May be "" (a scanned PDF). */
  readonly text: string;
  /** True when the file held more than was kept. The reply says so. */
  readonly truncated: boolean;
  /** Page count, for PDFs. */
  readonly pages: number | null;
}

export type TextKind = Exclude<DocumentKind, "image">;

/** Tidy whitespace without losing the line structure a model reads tables by. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*\t[ \t]*/g, "\t")
    .replace(/ {2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cut at a word boundary under the cap. */
export function capText(text: string, max: number = MAX_READ_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const slice = text.slice(0, max);
  const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
  return { text: (lastBreak > max * 0.8 ? slice.slice(0, lastBreak) : slice).trimEnd(), truncated: true };
}

async function pdfText(bytes: Uint8Array): Promise<{ raw: string; pages: number; morePages: boolean }> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // A COPY: pdf.js may transfer (detach) the buffer it is given, and the
    // caller still needs these bytes for the hash and the upload.
    pdf = await getDocumentProxy(bytes.slice());
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : "";
    throw new UnreadableFileError(name === "PasswordException" ? "password_protected" : "damaged");
  }
  try {
    const pages = pdf.numPages;
    let raw = "";
    for (let number = 1; number <= Math.min(pages, MAX_PDF_PAGES); number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ("str" in item) raw += item.str + (item.hasEOL ? "\n" : "");
      }
      raw += "\n\n";
      // Stop reading pages once there is more than will be kept.
      if (raw.length > MAX_READ_CHARS * 1.2) {
        return { raw, pages, morePages: number < pages };
      }
    }
    return { raw, pages, morePages: pages > MAX_PDF_PAGES };
  } catch {
    throw new UnreadableFileError("damaged");
  } finally {
    // Frees pdf.js's per-document state. Guarded: the serverless build unpdf
    // ships does not expose it on every runtime, and cleanup must never be
    // the thing that fails an upload.
    const cleanup = (pdf as { destroy?: () => Promise<void> }).destroy;
    if (typeof cleanup === "function") await cleanup.call(pdf).catch(() => undefined);
  }
}

/**
 * THROWS `UnreadableFileError` for a damaged, encrypted or oversized file —
 * a sentence the caller puts in front of the user. Never any other error for
 * bad input: a parser's own message can quote the file.
 */
export async function extractText(bytes: Uint8Array, kind: TextKind): Promise<ExtractedText> {
  // Walk a little past the cap so `truncated` is known, not guessed.
  const budget = Math.ceil(MAX_READ_CHARS * 1.2);
  let raw: string;
  let pages: number | null = null;
  let morePages = false;

  switch (kind) {
    case "pdf": {
      const result = await pdfText(bytes);
      raw = result.raw;
      pages = result.pages;
      morePages = result.morePages;
      break;
    }
    case "docx":
      raw = docxText(bytes, budget);
      break;
    case "xlsx":
      raw = xlsxText(bytes, budget);
      break;
    case "text":
      raw = new TextDecoder("utf-8").decode(bytes);
      break;
  }

  const capped = capText(normalizeText(raw));
  return { text: capped.text, truncated: capped.truncated || morePages, pages };
}
