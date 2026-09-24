/**
 * Deterministic checks that stop an extraction from writing what the user did
 * not say. Both come from the 99-fixture eval (docs/AI_EVALS.md), and both are
 * checks in CODE rather than prompt wording, so they hold for every model.
 *
 * Pure: they read the intent's own `sourceText`, never the database, so they
 * are unit-tested here and the planner only decides what to do with the answer.
 */

/** Openers that make a sentence a question on their own. */
const WH_OPENERS = new Set(["what", "which", "who", "whom", "whose", "when", "where", "why", "how"]);

/**
 * Openers that make a question only with a question mark. "Is Karthik blocked?"
 * asks; "Has Barkha sent it?" asks. Modal requests — can, could, would, will —
 * are deliberately ABSENT: "Could you note that Barkha owes me the article?"
 * is a polite instruction, and it should write.
 */
const AUX_OPENERS = new Set(["is", "are", "was", "were", "do", "does", "did", "has", "have", "had"]);

/**
 * Whether a `sourceText` asks rather than states.
 *
 * WHY IT MATTERS: an `information` intent is a statement that someone owes
 * something. When a model files a QUESTION as one — "What's blocked right
 * now?" came back from qwen3:8b as information with `newStatus: blocked` — the
 * planner's status path finds no match and falls through to CREATING a
 * commitment. A question must never write; it is an inspection.
 *
 * Judged on the intent's own span, not the whole utterance, so "Barkha owes me
 * the article. What else is due?" still records the first sentence.
 */
export function isQuestion(sourceText: string): boolean {
  const text = sourceText.trim();
  const first = /^[A-Za-z]+/.exec(text)?.[0]?.toLowerCase();
  if (!first) return false;
  if (WH_OPENERS.has(first)) return true;
  return AUX_OPENERS.has(first) && text.endsWith("?");
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/** "pagesRead", "pages_read", "Pages read" -> ["pages", "read"]; short words dropped. */
function fieldTokens(field: { readonly fieldKey: string; readonly label: string }): string[] {
  const fromKey = field.fieldKey.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return [...words(`${fromKey} ${field.label}`)].filter((token) => token.length >= 3);
}

/**
 * How many of the proposed fields the user actually named.
 *
 * WHY IT MATTERS: asked to "add Dune to my books, finished", qwen3:8b defined a
 * whole new tracker with `title` and `status` fields — and invented the status
 * options too. None of those words was said. §27: never guess when guessing
 * causes a meaningful mistake, and a schema is exactly that — every future
 * record is validated against it.
 *
 * A field counts as named when any word of its key or label (3+ letters)
 * appears in the text, allowing a plural either way ("books" / "book"). The
 * planner asks only when NONE is named, so a model paraphrasing one field
 * ("time" for "duration") is not over-asked about the rest.
 */
export function namedFieldCount(
  fields: readonly { readonly fieldKey: string; readonly label: string }[],
  sourceText: string,
): number {
  const said = words(sourceText);
  const heard = (token: string) =>
    said.has(token) || said.has(`${token}s`) || (token.endsWith("s") && said.has(token.slice(0, -1)));
  return fields.filter((field) => fieldTokens(field).some(heard)).length;
}
