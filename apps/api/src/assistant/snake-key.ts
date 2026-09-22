/**
 * A registry key in the wire format: "bookTitle", "Book Title", "book-title"
 * -> "book_title".
 *
 * MECHANICAL, SO NOT THE MODEL'S JOB. The tool layer requires snake_case type
 * and field keys, and the extraction contract only names the field. Claude
 * happens to write snake_case; qwen3:8b wrote `bookTitle` live (2026-09-22),
 * the tool rejected it, and "track my reading" failed with a validator
 * message as the reply. A case conversion is exactly the kind of step that
 * should produce the same output every run.
 *
 * It normalises CASE AND SEPARATORS only. It never invents a key: an empty or
 * digit-led result still reaches the tool, whose validation rejects it — one
 * authority for what a legal key is.
 */
export function toSnakeKey(raw: string): string {
  return raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}
