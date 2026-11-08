/**
 * Replies tailored to each person — ROADMAP Stage 4, the deterministic half.
 *
 * A draft is written by Interpret from the owner's words; it cannot know how
 * the owner writes to THIS person. Their own sent emails can: the greeting
 * they use with them ("Hi Barkha,") and how they sign off ("Thanks,\nVaibhav").
 * Learned by counting, never by a model, from the owner's own emails only —
 * and applied only where the draft has none of its own.
 *
 * The other half — tone and wording adjusted by a model, and translation —
 * needs an eval set scored against owner-approved drafts and paid runs; it is
 * not built. What IS recorded is the measure: how many words the owner
 * changed before sending (migration 019, `wordEditDistance`).
 */

export interface EmailStyle {
  /** "Hi {name}," — `{name}` stands for the recipient's first name. */
  readonly greeting: string | null;
  readonly signOff: string | null;
  /** How many emails it was learned from, for the record. */
  readonly from: number;
}

const GREETING = /^(hi|hello|hey|dear|good (morning|afternoon|evening))\b[^\n]{0,40}$/i;
const MAX_SIGN_OFF_LINE = 40;
/** How a sign-off starts. A short last line that does not start like this is the message, not a sign-off. */
const CLOSING = /^(thanks|thank you|many thanks|best|all the best|cheers|regards|kind regards|warm regards|best regards|sincerely|yours|love|talk soon|see you|take care)\b/i;

function lines(body: string): string[] {
  return body.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim());
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** The greeting line of a body, with the recipient's first name as {name}. */
function greetingOf(body: string, name: string): string | null {
  const first = lines(body).find((line) => line !== "");
  if (!first || !GREETING.test(first)) return null;
  const who = firstName(name);
  return who === "" ? first : first.replace(new RegExp(`\\b${who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), "{name}");
}

/** The last paragraph, when it is a short sign-off (one or two short lines). */
function signOffOf(body: string): string | null {
  const all = lines(body);
  while (all.length > 0 && all[all.length - 1] === "") all.pop();
  const lastBlank = all.lastIndexOf("");
  const block = all.slice(lastBlank + 1);
  if (lastBlank < 0 || block.length === 0 || block.length > 2) return null;
  if (block.some((line) => line.length > MAX_SIGN_OFF_LINE || /[?]/.test(line))) return null;
  if (!CLOSING.test(block[0]!)) return null;
  return block.join("\n");
}

function mostCommon(values: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  // One email is an accident; two is a habit.
  return bestCount >= 2 ? best : null;
}

/** The owner's habit, from their own sent emails — each with the name of the person it went to. */
export function learnStyle(sent: readonly { readonly body: string; readonly recipientName: string }[]): EmailStyle {
  return {
    greeting: mostCommon(sent.map((email) => greetingOf(email.body, email.recipientName))),
    signOff: mostCommon(sent.map((email) => signOffOf(email.body))),
    from: sent.length,
  };
}

/** The draft, with the owner's greeting and sign-off added where it has none. */
export function tailorBody(body: string, recipientName: string, style: EmailStyle): string {
  let out = body.trim();
  if (style.greeting && greetingOf(out, recipientName) === null) {
    out = `${style.greeting.replace("{name}", firstName(recipientName))}\n\n${out}`;
  }
  if (style.signOff && signOffOf(out) === null) out = `${out}\n\n${style.signOff}`;
  return out;
}

/** A follow-up about what is open, in the owner's style — a suggestion, never sent by itself. */
export function followUpDraft(
  recipientName: string,
  open: readonly { readonly what: string; readonly due: string | null; readonly theyOwe: boolean }[],
  style: EmailStyle,
): string | null {
  if (open.length === 0) return null;
  const theirs = open.filter((item) => item.theyOwe).map((item) => `${item.what}${item.due ? ` (due ${item.due})` : ""}`);
  const mine = open.filter((item) => !item.theyOwe).map((item) => item.what);
  const sentences: string[] = [];
  if (theirs.length > 0) sentences.push(`Just checking in on ${list(theirs)} — how is it going?`);
  if (mine.length > 0) sentences.push(`${list(mine)} ${mine.length === 1 ? "is" : "are"} on my list; I'll come back to you on ${mine.length === 1 ? "it" : "them"} soon.`);
  return tailorBody(sentences.join(" "), recipientName, {
    greeting: style.greeting ?? "Hi {name},",
    signOff: style.signOff ?? "Thanks,",
    from: style.from,
  });
}

function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Words changed between a draft and what was sent (Levenshtein over words). */
export function wordEditDistance(draft: string, sent: string): number {
  const a = draft.split(/\s+/).filter(Boolean).slice(0, 2_000);
  const b = sent.split(/\s+/).filter(Boolean).slice(0, 2_000);
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * The style for one recipient: their own thread when it shows a habit (two or
 * more emails), otherwise the owner's habit across everyone.
 */
export function styleFor(
  toThem: readonly { readonly body: string; readonly recipientName: string }[],
  toEveryone: readonly { readonly body: string; readonly recipientName: string }[],
): EmailStyle {
  const own = learnStyle(toThem);
  if (own.greeting !== null || own.signOff !== null) return own;
  return learnStyle(toEveryone);
}
