/**
 * The reply to an upload — a pure template, NEVER a model (docs/PHASE-6-DESIGN.md §1, §6).
 *
 * Respond never sees file content, and this is why it does not need to: every
 * sentence here is assembled from the validated reading, whose strings are
 * already cleaned and capped by `parseReading`. A hostile file's words can
 * appear here only as quoted data inside a fixed sentence.
 *
 * §31 concision: at most three mentioned items, and the reply says what was
 * NOT done — "interpret first, act only when appropriate" (§32) — only when
 * there was something it could have done.
 */
import { cleanText, type DocumentReading } from "@ourglass/shared";

export type UnreadReason =
  | "no_model"
  | "no_image_model"
  | "model_failed"
  | "no_text"
  | "password_protected"
  | "damaged"
  | "too_large"
  | "image_too_large";

export type IngestReplyCase =
  | {
      readonly kind: "saved";
      readonly filename: string;
      readonly reading: DocumentReading;
      readonly links: readonly string[];
      readonly truncated: boolean;
    }
  | { readonly kind: "unread"; readonly filename: string; readonly reason: UnreadReason; readonly links: readonly string[] }
  | { readonly kind: "duplicate"; readonly existingFilename: string }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "store_failed" };

const UNREAD_SENTENCES: Readonly<Record<UnreadReason, string>> = {
  no_model: "no AI model is set up to read files.",
  no_image_model: "no AI model that reads images is set up (Claude or Gemini can; the local model can't).",
  model_failed: "the AI models didn't answer just now. It's saved, so nothing is lost.",
  no_text: "it has no text in it (a scan?). A screenshot or photo of it, I can read.",
  password_protected: "it's password-protected.",
  damaged: "the file looks damaged.",
  too_large: "it unpacks to more than I'll read.",
  image_too_large: "the image is over 7 MB. A smaller copy or a screenshot would work.",
};

const MAX_MENTIONED = 3;

/** "A", "A and B", "A, B and C" — names keep their case, unlike respond.ts's field labels. */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function quoted(filename: string): string {
  return `"${cleanText(filename, 80)}"`;
}

function mentioned(reading: DocumentReading): string[] {
  const items = [
    ...reading.deadlines.map((deadline) => `${deadline.what}, due ${deadline.when}`),
    ...reading.events.map((event) => [event.name, event.when, event.venue].filter((part) => part !== "").join(", ")),
  ];
  return items.slice(0, MAX_MENTIONED);
}

export function renderIngestReply(input: IngestReplyCase): string {
  switch (input.kind) {
    case "saved": {
      const parts = [`Saved ${quoted(input.filename)}${input.reading.title ? ` — ${input.reading.title}` : ""}.`];
      if (input.links.length > 0) parts.push(`Linked to ${listNames(input.links)}.`);
      const items = mentioned(input.reading);
      if (items.length > 0) parts.push(`It mentions ${items.join("; ")}.`);
      if (input.truncated) parts.push("It's long, so I read the first part.");
      if (items.length > 0) parts.push("I haven't added any of it to your list — tell me if you want something tracked.");
      return parts.join(" ");
    }
    case "unread": {
      const parts = [`Saved ${quoted(input.filename)}, but I couldn't read it: ${UNREAD_SENTENCES[input.reason]}`];
      if (input.links.length > 0) parts.push(`Linked to ${listNames(input.links)}.`);
      return parts.join(" ");
    }
    case "duplicate":
      return `You already sent me this one — it's saved as ${quoted(input.existingFilename)}.`;
    case "rejected":
      return input.reason;
    case "store_failed":
      return "I couldn't store that file just now — nothing was saved. Try again in a moment.";
  }
}
