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

/** §5: bounds CPU per request; a 1,000-page PDF is read to page 100 and says so. */
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

/**
 * Tidy whitespace without losing the line structure a model reads tables by:
 * a BOM goes, CR/CRLF become LF, a run of spaces and tabs becomes one tab if it
 * held a tab and one space if not, whitespace before a line break goes, three
 * or more line breaks become two, and the ends are trimmed.
 *
 * ONE PASS, on purpose. It replaced a chain of regexes, two of which were
 * quadratic on crafted input — 160 KB of spaces took 40 s (Phase 6 security
 * review). It also makes the text storable: NUL is dropped (Postgres `text`
 * refuses it) and a lone surrogate becomes U+FFFD (`jsonb` refuses it), either
 * of which used to fail the save after the model had been paid for.
 */
export function normalizeText(raw: string): string {
  let out = "";
  let newlines = 0;
  // Widened by `as`: the closures below write it, which narrowing cannot see.
  let gap = "" as "" | " " | "\t";
  let runStart = -1;
  const flushRun = (end: number): void => {
    if (runStart !== -1) out += raw.slice(runStart, end);
    runStart = -1;
  };
  /** Before visible text: the line breaks and gap held back, unless at the start. */
  const emitPending = (): void => {
    if (out !== "") out += (newlines >= 2 ? "\n\n" : newlines === 1 ? "\n" : "") + gap;
    newlines = 0;
    gap = "";
  };

  for (let i = raw.charCodeAt(0) === 0xfeff ? 1 : 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code === 0x0a || code === 0x0d) {
      flushRun(i);
      if (code === 0x0d && raw.charCodeAt(i + 1) === 0x0a) i += 1;
      newlines += 1;
      gap = "";
    } else if (code === 0x20 || code === 0x09) {
      flushRun(i);
      gap = code === 0x09 || gap === "\t" ? "\t" : " ";
    } else if (code === 0x00) {
      flushRun(i);
    } else if (code >= 0xd800 && code <= 0xdfff) {
      flushRun(i);
      const next = raw.charCodeAt(i + 1);
      const pair = code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
      emitPending();
      out += pair ? raw.slice(i, i + 2) : "\uFFFD";
      if (pair) i += 1;
    } else if (runStart === -1) {
      emitPending();
      runStart = i;
    }
  }
  flushRun(raw.length);
  // Other Unicode whitespace (NBSP, ideographic space) at the ends, as before.
  return out.trim();
}

/** Cut at a word boundary under the cap, never between the halves of a surrogate pair. */
export function capText(text: string, max: number = MAX_READ_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let slice = text.slice(0, max);
  const last = slice.charCodeAt(slice.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) slice = slice.slice(0, -1);
  const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
  return { text: (lastBreak > max * 0.8 ? slice.slice(0, lastBreak) : slice).trimEnd(), truncated: true };
}

/**
 * Wall-clock budget for reading a PDF's pages (Phase 6 security review: pdf.js
 * had none). Checked between pages; a PDF that runs out is read as far as it
 * got, and the reply says it read the first part.
 */
export const PDF_TIME_BUDGET_MS = 8_000;

async function pdfText(
  bytes: Uint8Array,
  budgetMs: number,
): Promise<{ raw: string; pages: number; morePages: boolean }> {
  const deadline = Date.now() + budgetMs;
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
      if (number > 1 && Date.now() > deadline) return { raw, pages, morePages: true };
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
export async function extractText(
  bytes: Uint8Array,
  kind: TextKind,
  options: { readonly pdfBudgetMs?: number } = {},
): Promise<ExtractedText> {
  // Walk a little past the cap so `truncated` is known, not guessed.
  const budget = Math.ceil(MAX_READ_CHARS * 1.2);
  let raw: string;
  let pages: number | null = null;
  let morePages = false;

  switch (kind) {
    case "pdf": {
      const result = await pdfText(bytes, options.pdfBudgetMs ?? PDF_TIME_BUDGET_MS);
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
