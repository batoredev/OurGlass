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
 * never unbounded memory. Memory is not the only cost: fflate keeps DECODING
 * past a full buffer, so an 819 KB entry declaring 1 KB spent 4.8 s inflating
 * 800 MB into nothing (Phase 6 security review). So an entry's COMPRESSED size
 * must also be one its declared size could produce, and its ratio is capped.
 *
 * LINEAR TIME, WHATEVER THE INPUT. The XML is walked by `xmlTokens`, which
 * finds every `<` and `>` by index and never backtracks. The regex walk it
 * replaced was quadratic on crafted input: a 227-byte .docx of 80k `<` took
 * 12 s, a 679-byte .xlsx cell 18 s (Phase 6 security review). extract.test.ts
 * pins each of those shapes to a time budget.
 */
import { unzipSync, type Unzipped } from "fflate";
import { UnreadableFileError } from "./errors.js";

/** Total declared size of the parts we inflate. */
export const MAX_UNZIPPED_BYTES = 30 * 1024 * 1024;
/** A real .docx has a few dozen entries; tens of thousands is an attack or junk. */
export const MAX_ZIP_ENTRIES = 5_000;
/**
 * Declared size over compressed size. Office XML compresses 5–100x; DEFLATE
 * itself tops out near 1032x, which only a bomb approaches.
 */
export const MAX_COMPRESSION_RATIO = 1_000;
/** One cell or shared string. A spreadsheet cell is a value, not a document. */
export const MAX_CELL_CHARS = 10_000;

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

/**
 * The most a STORED (uncompressed) DEFLATE stream adds to its data: 5 bytes
 * per 65,535-byte block, plus slack for headers. A compressed size above this
 * cannot come from the declared size — the archive is lying about it.
 */
function maxCompressedSize(declared: number): number {
  return declared + 5 * Math.ceil(declared / 65_535) + 64;
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
        // The CPU bound: inflating can only do as much work as the
        // compressed bytes allow, so those bytes must fit the declaration.
        if (file.size > maxCompressedSize(file.originalSize)) throw new UnreadableFileError("damaged");
        if (file.size > 0 && file.originalSize / file.size > MAX_COMPRESSION_RATIO) {
          throw new UnreadableFileError("too_large");
        }
        return true;
      },
    });
  } catch (error: unknown) {
    if (error instanceof UnreadableFileError) throw error;
    throw new UnreadableFileError("damaged");
  }
}

// ---------------------------------------------------------------------------
// XML tokens — linear, no regex over the document
// ---------------------------------------------------------------------------

export type XmlToken =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tag";
      /** As written, prefix included: "w:t". */
      readonly name: string;
      /** After the prefix: "t". */
      readonly local: string;
      readonly closing: boolean;
      readonly selfClosing: boolean;
      /** Raw attribute text; read it with `attributes`. */
      readonly attrs: string;
    };

const LT = 0x3c;
const GT = 0x3e;
const QUOTE = 0x22;
const APOS = 0x27;

function isNameEnd(code: number): boolean {
  // whitespace, "/", ">" — the characters that end a tag name.
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x2f || code === GT;
}

/**
 * Every tag and text run of an XML part, in order. Text is still encoded (run
 * it through `decodeXml`); CDATA arrives as text already decoded-equivalent.
 * Comments and processing instructions are skipped. An unterminated tag ends
 * the walk: what follows it cannot be read reliably.
 *
 * Each character is examined a bounded number of times — the property the
 * regex walk lacked.
 */
export function* xmlTokens(source: string): Generator<XmlToken> {
  const length = source.length;
  let i = 0;
  while (i < length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) {
      yield { type: "text", text: source.slice(i) };
      return;
    }
    if (lt > i) yield { type: "text", text: source.slice(i, lt) };

    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      if (end === -1) return;
      i = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      if (end === -1) return;
      // Escaped so the caller's decodeXml returns it unchanged.
      yield { type: "text", text: source.slice(lt + 9, end).replaceAll("&", "&amp;") };
      i = end + 3;
      continue;
    }

    // The tag's end: the first ">" outside a quoted attribute value.
    let j = lt + 1;
    let quote = 0;
    for (; j < length; j += 1) {
      const code = source.charCodeAt(j);
      if (quote !== 0) {
        if (code === quote) quote = 0;
      } else if (code === QUOTE || code === APOS) {
        quote = code;
      } else if (code === GT) {
        break;
      } else if (code === LT) {
        break;
      }
    }
    if (j >= length) return;
    if (source.charCodeAt(j) === LT) {
      // A bare "<" (which XML forbids in text): keep it as text and carry on
      // from the next "<". Each character is still scanned at most twice.
      yield { type: "text", text: source.slice(lt, j) };
      i = j;
      continue;
    }
    i = j + 1;

    const first = source.charCodeAt(lt + 1);
    if (first === 0x3f /* ? */ || first === 0x21 /* ! */) continue; // <?xml …?>, <!DOCTYPE …>

    const closing = first === 0x2f; /* / */
    const nameStart = closing ? lt + 2 : lt + 1;
    let nameEnd = nameStart;
    while (nameEnd < j && !isNameEnd(source.charCodeAt(nameEnd))) nameEnd += 1;
    const name = source.slice(nameStart, nameEnd);
    if (name === "") continue;
    const selfClosing = source.charCodeAt(j - 1) === 0x2f;
    const colon = name.indexOf(":");
    yield {
      type: "tag",
      name,
      local: colon === -1 ? name : name.slice(colon + 1),
      closing,
      selfClosing: selfClosing && !closing,
      attrs: source.slice(nameEnd, selfClosing ? j - 1 : j),
    };
  }
}

/** A tag's attributes by name, values decoded. One pass over the attribute text. */
export function attributes(attrs: string): Map<string, string> {
  const out = new Map<string, string>();
  const length = attrs.length;
  let i = 0;
  while (i < length) {
    const eq = attrs.indexOf("=", i);
    if (eq === -1) break;
    // The name is the last word before "=": stray text before it is ignored.
    const name = attrs.slice(i, eq).trim().split(/\s+/).pop() ?? "";
    let k = eq + 1;
    while (k < length && (attrs.charCodeAt(k) === 0x20 || attrs.charCodeAt(k) === 0x09)) k += 1;
    const quote = attrs[k];
    if (quote !== '"' && quote !== "'") break;
    const close = attrs.indexOf(quote, k + 1);
    if (close === -1) break;
    if (name !== "" && !out.has(name)) out.set(name, decodeXml(attrs.slice(k + 1, close)));
    i = close + 1;
  }
  return out;
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

/**
 * The five XML entities and numeric references. Nothing else exists in these
 * parts. Linear: each `&` is looked at once, and a reference ends at the next
 * `;` within a short window.
 */
export function decodeXml(text: string): string {
  if (!text.includes("&")) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const amp = text.indexOf("&", i);
    if (amp === -1) break;
    out += text.slice(i, amp);
    // The longest reference is "&#x10FFFF;", so the ";" is looked for in a
    // fixed window — never to the end of the text, which on "&&&&…" would be
    // quadratic again.
    const window = text.slice(amp + 1, amp + 11);
    const semi = window.indexOf(";");
    const decoded = semi === -1 ? null : decodeReference(window.slice(0, semi));
    if (decoded === null) {
      out += "&";
      i = amp + 1;
    } else {
      out += decoded;
      i = amp + 1 + semi + 1;
    }
  }
  return out + text.slice(i);
}

function decodeReference(ref: string): string | null {
  if (/^#x[0-9a-fA-F]{1,6}$/.test(ref)) return safeCodePoint(Number.parseInt(ref.slice(2), 16));
  if (/^#[0-9]{1,7}$/.test(ref)) return safeCodePoint(Number.parseInt(ref.slice(1), 10));
  // Own keys only: "&constructor;" must not decode to Object's source text.
  return Object.hasOwn(NAMED_ENTITIES, ref) ? NAMED_ENTITIES[ref]! : null;
}

/**
 * A character Postgres can store. NUL is refused by `text`, a lone surrogate by
 * `jsonb` (where the document row is logged), and either would fail the save
 * after the model was paid for (Phase 6 security review).
 */
function safeCodePoint(code: number): string | null {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null;
  if (code === 0) return "";
  if (code >= 0xd800 && code <= 0xdfff) return "\uFFFD";
  return String.fromCodePoint(code);
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

  let out = "";
  let inText = false;
  // <w:tabs> holds tab-stop DEFINITIONS (<w:tab w:pos="720"/>) in paragraph
  // properties; only a <w:tab/> outside it is a tab character.
  let inTabStops = false;
  // Every table cell holds its own <w:p>, so inside a cell a paragraph end is
  // a space: the ROW ends the line, and cells are split by tabs.
  let cellDepth = 0;
  for (const token of xmlTokens(utf8.decode(xml))) {
    if (token.type === "text") {
      if (inText) out += decodeXml(token.text);
    } else {
      const opens = !token.closing && !token.selfClosing;
      switch (token.name) {
        case "w:t":
          inText = opens;
          break;
        case "w:tabs":
          inTabStops = opens;
          break;
        case "w:tc":
          if (opens) cellDepth += 1;
          else {
            cellDepth = Math.max(0, cellDepth - 1);
            out += "\t";
          }
          break;
        case "w:p":
          if (!opens) out += cellDepth > 0 ? " " : "\n";
          break;
        case "w:tr":
          if (!opens) out += "\n";
          break;
        case "w:tab":
          if (!opens && !inTabStops) out += "\t";
          break;
        case "w:br":
        case "w:cr":
          if (!opens) out += "\n";
          break;
      }
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
  // Linear patterns over one short attribute value.
  const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").toLowerCase();
  if (/[yd]/.test(bare)) return "date";
  if (/[hs]/.test(bare)) return "time";
  return "other";
}

/** cellXfs index -> what a numeric cell with that style means. */
function cellFormats(stylesXml: string | undefined): CellFormat[] {
  if (!stylesXml) return [];
  const custom = new Map<number, CellFormat>();
  const styleIds: number[] = [];
  let inCellXfs = false;
  for (const token of xmlTokens(stylesXml)) {
    if (token.type !== "tag") continue;
    if (token.local === "cellXfs") {
      inCellXfs = !token.closing && !token.selfClosing;
    } else if (token.local === "numFmt" && !token.closing) {
      const attrs = attributes(token.attrs);
      const id = Number(attrs.get("numFmtId"));
      const code = attrs.get("formatCode");
      if (Number.isInteger(id) && code !== undefined) custom.set(id, classifyFormatCode(code));
    } else if (token.local === "xf" && inCellXfs && !token.closing) {
      styleIds.push(Number(attributes(token.attrs).get("numFmtId") ?? "0"));
    }
  }
  // Resolved after the walk: <numFmts> precedes <cellXfs> in the schema, but
  // nothing here should depend on a writer honouring that.
  return styleIds.map((id) =>
    BUILTIN_DATE_FORMATS.has(id) ? "date" : BUILTIN_TIME_FORMATS.has(id) ? "time" : (custom.get(id) ?? "other"),
  );
}

/** An Excel serial as the date a person would read. */
function serialToText(serial: number, format: CellFormat, date1904: boolean): string {
  if (!Number.isFinite(serial)) return String(serial);
  // 25569 = days from 1899-12-30 (Excel's effective epoch) to 1970-01-01.
  const days = serial + (date1904 ? 1462 : 0) - 25569;
  const ms = Math.round(days * 86_400_000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return String(serial);
  const iso = date.toISOString();
  const hasTime = Math.abs(serial % 1) > 1e-9;
  if (format === "time") return iso.slice(11, 16);
  return hasTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

/** "BC12" -> 1-based column 55. */
function columnIndex(ref: string | undefined): number | null {
  const letters = ref ? /^[A-Z]{1,3}/.exec(ref)?.[0] : undefined;
  if (!letters) return null;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index;
}

function sheetPaths(parts: Unzipped): { name: string; path: string }[] {
  const targets = new Map<string, string>();
  const rels = parts["xl/_rels/workbook.xml.rels"];
  if (rels) {
    for (const token of xmlTokens(utf8.decode(rels))) {
      if (token.type !== "tag" || token.local !== "Relationship" || token.closing) continue;
      const attrs = attributes(token.attrs);
      const id = attrs.get("Id");
      const target = attrs.get("Target");
      if (id && target) {
        targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
      }
    }
  }
  const sheets: { name: string; path: string }[] = [];
  for (const token of xmlTokens(utf8.decode(parts["xl/workbook.xml"]!))) {
    if (token.type !== "tag" || token.local !== "sheet" || token.closing) continue;
    const attrs = attributes(token.attrs);
    const rid = attrs.get("r:id");
    const path = rid ? targets.get(rid) : undefined;
    if (path && parts[path]) sheets.push({ name: attrs.get("name") ?? "Sheet", path });
  }
  return sheets;
}

function isDate1904(workbookXml: string): boolean {
  for (const token of xmlTokens(workbookXml)) {
    if (token.type === "tag" && token.local === "workbookPr" && !token.closing) {
      const value = attributes(token.attrs).get("date1904");
      return value === "1" || value === "true";
    }
  }
  return false;
}

/** Every <si> of the shared-strings part: all its <t> runs, concatenated. */
function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  let current: string | null = null;
  let inT = false;
  for (const token of xmlTokens(xml)) {
    if (token.type === "text") {
      if (current !== null && inT && current.length < MAX_CELL_CHARS) current += decodeXml(token.text);
    } else if (token.local === "si") {
      if (token.selfClosing) out.push("");
      else if (!token.closing) current = "";
      else if (current !== null) {
        out.push(current.slice(0, MAX_CELL_CHARS));
        current = null;
      }
    } else if (token.local === "t") {
      inT = !token.closing && !token.selfClosing;
    }
  }
  return out;
}

/** A cell's text: spaces collapsed, ends trimmed. One pass, no regex. */
function tidyCell(value: string): string {
  let out = "";
  let space = false;
  for (const char of value.length > MAX_CELL_CHARS ? value.slice(0, MAX_CELL_CHARS) : value) {
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      space = out !== "";
    } else {
      if (space) out += " ";
      space = false;
      out += char;
    }
  }
  return out;
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

  const date1904 = isDate1904(utf8.decode(parts["xl/workbook.xml"]));
  const shared = sharedStrings(parts["xl/sharedStrings.xml"] ? utf8.decode(parts["xl/sharedStrings.xml"]) : undefined);
  const formats = cellFormats(parts["xl/styles.xml"] ? utf8.decode(parts["xl/styles.xml"]) : undefined);

  let out = "";
  for (const sheet of sheetPaths(parts)) {
    out += `${out === "" ? "" : "\n"}# Sheet: ${sheet.name}\n`;

    let cells: string[] | null = null;
    let nextColumn = 1;
    // The cell being read.
    let cell: { column: number; type: string | undefined; style: number } | null = null;
    let raw: string | null = null; // <v> text
    let inline = ""; // <is><t> text
    let inV = false;
    let inT = false;

    const finishCell = (): void => {
      if (cells === null || cell === null) return;
      let value = "";
      if (cell.column <= MAX_COLUMNS) {
        if (cell.type === "s") value = raw === null ? "" : (shared[Number(raw)] ?? "");
        else if (cell.type === "inlineStr") value = inline;
        else if (cell.type === "b") value = raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : "";
        else if (raw !== null) {
          const style = formats[cell.style] ?? "other";
          value =
            cell.type !== "str" && cell.type !== "e" && style !== "other"
              ? serialToText(Number(raw), style, date1904)
              : raw;
        }
        cells[cell.column - 1] = tidyCell(value);
      }
      cell = null;
    };

    for (const token of xmlTokens(utf8.decode(parts[sheet.path]!))) {
      if (token.type === "text") {
        if (cell === null) continue;
        if (inV && (raw ?? "").length < MAX_CELL_CHARS) raw = (raw ?? "") + decodeXml(token.text);
        else if (inT && inline.length < MAX_CELL_CHARS) inline += decodeXml(token.text);
        continue;
      }
      const opens = !token.closing && !token.selfClosing;
      switch (token.local) {
        case "row":
          if (opens) {
            cells = [];
            nextColumn = 1;
          } else if (cells !== null) {
            finishCell();
            // Trailing empty cells are not part of the row.
            while (cells.length > 0 && (cells[cells.length - 1] ?? "") === "") cells.pop();
            if (cells.some((value) => value !== undefined && value !== "")) {
              out += `${Array.from(cells, (value) => value ?? "").join(" | ")}\n`;
            }
            cells = null;
          }
          break;
        case "c":
          if (cells === null || token.closing) {
            finishCell();
            break;
          }
          finishCell();
          {
            const attrs = attributes(token.attrs);
            const column = columnIndex(attrs.get("r")) ?? nextColumn;
            nextColumn = column + 1;
            cell = { column, type: attrs.get("t"), style: Number(attrs.get("s") ?? "0") };
            raw = null;
            inline = "";
            inV = false;
            inT = false;
            if (token.selfClosing) finishCell();
          }
          break;
        case "v":
          inV = opens;
          if (opens && raw === null) raw = "";
          break;
        case "t":
          inT = opens;
          break;
      }
      if (out.length > maxChars) return out;
    }
  }
  return out;
}
