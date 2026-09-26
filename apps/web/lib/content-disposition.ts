/**
 * How a saved file is handed back (GET /api/documents/:id/file).
 *
 * Only images display inline; everything else downloads, so a PDF or a Word
 * file opens in the reader the user chose rather than inside this app's
 * origin. RFC 6266 / 5987: an ASCII fallback plus the exact name, encoded —
 * the uploaded name is attacker-controlled, so quotes, backslashes and
 * control characters never reach the header raw.
 */
export function contentDisposition(kind: string, filename: string): string {
  const disposition = kind === "image" ? "inline" : "attachment";
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
