/**
 * Word (.docx) and Excel (.xlsx) to plain text (docs/PHASE-6-DESIGN.md §2, §5).
 *
 * Both formats are a zip of XML parts. This reads exactly the parts that hold
 * text and walks their XML with a tag tokenizer — no DOM, no dependency beyond
 * `fflate` for the unzip.
 *
 * ┌─ WHY NOT mammoth / SheetJS ────────────────────────────────────────────┐
 * │ The output feeds one model call that summarises. Formatting, images,   │
 * │ formulas and styles are all discarded, so a full document model buys   │
 * │ nothing — and neither library bounds DECOMPRESSED size, which is the    │
 * │ one property a parser of hostile uploads must have. SheetJS's npm       │
 * │ release is also stale and carries advisories; its fixes ship only from  │
 * │ its own CDN, outside Dependabot's view.                                 │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ZIP BOMBS. Every part is checked against its DECLARED uncompressed size
 * before anything is inflated, and fflate inflates into a buffer of exactly
 * that size — so an archive that lies about its sizes gets truncated output,
 * never unbounded memory.
 */
import { unzipSync, type Unzipped } from "fflate";
import { UnreadableFileError } from "./errors.js";

/** Total declared size of the parts we inflate. */
export const MAX_UNZIPPED_BYTES = 30 * 1024 * 1024;
/** A real .docx has a few dozen entries; tens of thousands is an attack or junk. */
export const MAX_ZIP_ENTRIES = 5_000;

const utf8 = new TextDecoder("utf-8");

/** Entry names, without inflating anything. Null when it is not a readable zip. */
export function listZipEntries(bytes: Uint8Array): Set<string> | null {
  const names = new Set<string>();
  try {
    unzipSync(bytes, {
      filter: (file) => {
        names.add(file.name);
        if (names.size > MAX_ZIP_ENTRIES) throw new UnreadableFileError("too_large");
        return false;
      },
    });
  } catch {
    return null;
  }
  return names;
}

function readParts(bytes: Uint8Array, wanted: (name: string) => boolean): Unzipped {
  let declared = 0;
  let entries = 0;
  try {
    return unzipSync(bytes, {
      filter: (file) => {
        entries += 1;
        if (entries > MAX_ZIP_ENTRIES) throw new UnreadableFileError("too_large");
        if (!wanted(file.name)) return false;
        declared += file.originalSize;
        if (declared > MAX_UNZIPPED_BYTES) throw new UnreadableFileError("too_large");
        return true;
      },
    });
  } catch (error: unknown) {
    if (error instanceof UnreadableFileError) throw error;
    throw new UnreadableFileError("damaged");
  }
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** The five XML entities and numeric references. Nothing else exists in these parts. */
export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, ref: string) => {
    if (ref.startsWith("#x")) return safeCodePoint(Number.parseInt(ref.slice(2), 16), whole);
    if (ref.startsWith("#")) return safeCodePoint(Number.parseInt(ref.slice(1), 10), whole);
    return NAMED_ENTITIES[ref] ?? whole;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

function attr(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes);
  return match ? decodeXml(match[1]!) : null;
}

/** Every <t>…</t> (any namespace prefix) inside a fragment, concatenated. */
function textRuns(fragment: string): string {
  let out = "";
  for (const match of fragment.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) {
    out += decodeXml(match[1]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// .docx
// ---------------------------------------------------------------------------

/**
 * The body text of a Word document: paragraphs on lines, table cells split by
 * tabs.
 *
 * Only `<w:t>` content is text. Field codes (`<w:instrText>`), deleted runs
 * and XML attributes are not, and a naive "strip all tags" would include the
 * first and miss the structure. The tag names are matched EXACTLY — `w:t`
 * must not match `w:tbl`, `w:tc` or `w:tr`.
 */
export function docxText(bytes: Uint8Array, maxChars: number): string {
  const parts = readParts(bytes, (name) => name === "word/document.xml");
  const xml = parts["word/document.xml"];
  if (!xml) throw new UnreadableFileError("damaged");

  const source = utf8.decode(xml);
  let out = "";
  let inText = false;
  // <w:tabs> holds tab-stop DEFINITIONS (<w:tab w:pos="720"/>) in paragraph
  // properties; only a <w:tab/> outside it is a tab character.
  let inTabStops = false;
  // Every table cell holds its own <w:p>, so inside a cell a paragraph end is
  // a space: the ROW ends the line, and cells are split by tabs.
  let cellDepth = 0;
  const token = /<(\/?)w:(t|p|tabs|tab|br|cr|tc|tr)(?=[\s>/])[^>]*?(\/?)>|([^<]+)|<[^>]*>/g;
  for (const match of source.matchAll(token)) {
    const [, closing, tag, selfClosing, chars] = match;
    const opens = closing !== "/" && selfClosing !== "/";
    if (chars !== undefined) {
      if (inText) out += decodeXml(chars);
    } else if (tag === "t") {
      inText = opens;
    } else if (tag === "tabs") {
      inTabStops = opens;
    } else if (tag === "tc" && opens) {
      cellDepth += 1;
    } else if (!opens) {
      if (tag === "p") out += cellDepth > 0 ? " " : "\n";
      else if (tag === "tc") {
        cellDepth = Math.max(0, cellDepth - 1);
        out += "\t";
      } else if (tag === "tr") out += "\n";
      else if (tag === "tab" && !inTabStops) out += "\t";
      else if (tag === "br" || tag === "cr") out += "\n";
    }
    // Early stop: the caller keeps at most maxChars, and a 30 MB document
    // should not be walked to the end to produce text nobody reads.
    if (out.length > maxChars) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// .xlsx
// ---------------------------------------------------------------------------

/** Built-in number formats that render a serial as a date or date-time (ECMA-376 §18.8.30). */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22]);
const BUILTIN_TIME_FORMATS = new Set([18, 19, 20, 21, 45, 46, 47]);
const MAX_COLUMNS = 50;

type CellFormat = "date" | "time" | "other";

/** A custom format code's meaning, once quoted literals and [colour]/[locale] blocks are removed. */
function classifyFormatCode(code: string): CellFormat {
  const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").toLowerCase();
  if (/[yd]/.test(bare)) return "date";
  if (/[hs]/.test(bare)) return "time";
  return "other";
}

/** cellXfs index -> what a numeric cell with that style means. */
function cellFormats(stylesXml: string | undefined): CellFormat[] {
  if (!stylesXml) return [];
  const custom = new Map<number, CellFormat>();
  for (const match of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attr(match[1]!, "numFmtId"));
    const code = attr(match[1]!, "formatCode");
    if (Number.isInteger(id) && code !== null) custom.set(id, classifyFormatCode(code));
  }
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  const formats: CellFormat[] = [];
  for (const match of cellXfs.matchAll(/<xf\b([^>]*)(?:\/>|>)/g)) {
    const id = Number(attr(match[1]!, "numFmtId") ?? "0");
    formats.push(
      BUILTIN_DATE_FORMATS.has(id)
        ? "date"
        : BUILTIN_TIME_FORMATS.has(id)
          ? "time"
          : (custom.get(id) ?? "other"),
    );
  }
  return formats;
}

/** An Excel serial as the date a person would read. */
function serialToText(serial: number, format: CellFormat, date1904: boolean): string {
  if (!Number.isFinite(serial)) return String(serial);
  // 25569 = days from 1899-12-30 (Excel's effective epoch) to 1970-01-01.
  const days = serial + (date1904 ? 1462 : 0) - 25569;
  const ms = Math.round(days * 86_400_000);
  const iso = new Date(ms).toISOString();
  const hasTime = Math.abs(serial % 1) > 1e-9;
  if (format === "time") return iso.slice(11, 16);
  return hasTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

/** "BC12" -> 1-based column 55. */
function columnIndex(ref: string | null): number | null {
  const letters = ref ? /^[A-Z]+/.exec(ref)?.[0] : undefined;
  if (!letters) return null;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index;
}

function sheetPaths(parts: Unzipped): { name: string; path: string }[] {
  const workbook = parts["xl/workbook.xml"] ? utf8.decode(parts["xl/workbook.xml"]) : "";
  const rels = parts["xl/_rels/workbook.xml.rels"] ? utf8.decode(parts["xl/_rels/workbook.xml.rels"]) : "";
  const targets = new Map<string, string>();
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(match[1]!, "Id");
    const target = attr(match[1]!, "Target");
    if (id && target) {
      targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
    }
  }
  const sheets: { name: string; path: string }[] = [];
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(match[1]!, "name") ?? "Sheet";
    const rid = attr(match[1]!, "r:id");
    const path = rid ? targets.get(rid) : undefined;
    if (path && parts[path]) sheets.push({ name, path });
  }
  return sheets;
}

/**
 * Every sheet as "# Sheet: name" then one line per non-empty row, cells in
 * their real columns separated by " | ".
 *
 * Dates are the reason this is more than a tag strip: a schedule stores
 * "12 Oct" as 45577, and a model handed 45577 reads a number. Cells whose
 * style is a date format are rendered as ISO dates.
 */
export function xlsxText(bytes: Uint8Array, maxChars: number): string {
  const parts = readParts(
    bytes,
    (name) =>
      name === "xl/workbook.xml" ||
      name === "xl/_rels/workbook.xml.rels" ||
      name === "xl/sharedStrings.xml" ||
      name === "xl/styles.xml" ||
      /^xl\/worksheets\/[^/]+\.xml$/.test(name),
  );
  if (!parts["xl/workbook.xml"]) throw new UnreadableFileError("damaged");

  const workbook = utf8.decode(parts["xl/workbook.xml"]);
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook);
  const shared: string[] = [];
  if (parts["xl/sharedStrings.xml"]) {
    for (const match of utf8.decode(parts["xl/sharedStrings.xml"]).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      shared.push(textRuns(match[1]!));
    }
  }
  const formats = cellFormats(parts["xl/styles.xml"] ? utf8.decode(parts["xl/styles.xml"]) : undefined);

  let out = "";
  for (const sheet of sheetPaths(parts)) {
    out += `${out === "" ? "" : "\n"}# Sheet: ${sheet.name}\n`;
    const xml = utf8.decode(parts[sheet.path]!);
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      let nextColumn = 1;
      for (const cell of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attributes = cell[1]!;
        const body = cell[2] ?? "";
        const column = columnIndex(attr(attributes, "r")) ?? nextColumn;
        nextColumn = column + 1;
        if (column > MAX_COLUMNS) continue;

        const type = attr(attributes, "t");
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = "";
        if (type === "s") value = shared[Number(raw)] ?? "";
        else if (type === "inlineStr") value = textRuns(body);
        else if (type === "b") value = raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : "";
        else if (raw !== undefined) {
          const style = formats[Number(attr(attributes, "s") ?? "0")] ?? "other";
          value =
            type !== "str" && type !== "e" && style !== "other"
              ? serialToText(Number(raw), style, date1904)
              : decodeXml(raw);
        }
        cells[column - 1] = value.replace(/\s+/g, " ").trim();
      }
      const line = Array.from(cells, (value) => value ?? "").join(" | ").replace(/(\s\|\s*)+$/, "");
      if (line.replace(/[|\s]/g, "") !== "") out += `${line}\n`;
      if (out.length > maxChars) return out;
    }
  }
  return out;
}
