/**
 * Stored text never reaches a model — Phase 6 security review, test gap (b).
 *
 * ================================ WHY THIS EXISTS ==========================
 * `messages.body` (what anyone typed or pasted), `documents.extracted_text`
 * and `documents.reading` (what a FILE said) are attacker-reachable text.
 * Today no prompt contains them: a file reaches exactly one model call, the
 * Read stage, whose output is descriptive only, and the orchestrator reads
 * recent messages for their timestamps. The next "what did that brief say?"
 * or "remember what we just discussed" feature would make stored bodies an
 * injection path without touching any of the code that defends the upload.
 *
 * So every READ of those tables is listed here with why it is safe, and the
 * model-facing directories may not name file text at all. A new read fails
 * this test until someone writes down where the text goes — the moment to
 * route it through the same data-not-instructions boundary as uploads
 * (ROADMAP Stage 1a and 1c do exactly that, and must update this list).
 * ===========================================================================
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APPS = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** file -> the repository reads it makes, and why none of them reaches a model. */
const ALLOWED_READS: Readonly<Record<string, { reads: readonly string[]; why: string }>> = {
  "api/src/assistant/orchestrator.ts": {
    reads: ["messages.listRecent"],
    why:
      "previousAssistantTurnAt reads role and t_created only; with AI_CONVERSATION_CONTEXT=on, " +
      "renderConversation quotes the last few bodies to Interpret — uploads excluded, every " +
      "intent grounded in the current message (conversation-context.ts)",
  },
  "api/src/ingest/ingest.ts": {
    reads: ["documents.findCurrentBySha256"],
    why: "the duplicate check; only the filename is used, in a template reply",
  },
  "api/src/tools/document-tools.ts": {
    reads: ["documents.findCurrentBySha256", "documents.findCurrentLink"],
    why: "the save and link tools' own duplicate checks — no model involved",
  },
  "edge/app/api/messages/route.ts": {
    reads: ["messages.listRecent"],
    why: "the chat history, sent to the signed-in browser",
  },
  "edge/app/api/documents/route.ts": {
    reads: ["documents.listRecent"],
    why: "the Files page, sent to the signed-in browser",
  },
  "edge/app/api/documents/[id]/file/route.ts": {
    reads: ["documents.getById"],
    why: "the download route — bytes to the browser, sandboxed",
  },
};

/** Where prompts are built. File text must not even be named here. */
const MODEL_FACING = [join(APPS, "api", "src", "assistant"), join(APPS, "api", "src", "ai")];
const FILE_TEXT = /\b(extracted_text|extractedText|extracted_reading)\b/;

const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "out"]);
const READ = /\b(messages|documents)\.(get|list|find|search|read)\w*(?=\()/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const relativeName = (file: string) => relative(APPS, file).split("\\").join("/");

describe("reads of stored message and document text", () => {
  const found: Record<string, string[]> = {};
  for (const file of [join(APPS, "api", "src"), join(APPS, "edge"), join(APPS, "web")].flatMap(sourceFiles)) {
    const reads = [...new Set([...code(file).matchAll(READ)].map((match) => match[0]))].sort();
    if (reads.length > 0) found[relativeName(file)] = reads;
  }

  it("are exactly the ones whose destination is written down", () => {
    const expected = Object.fromEntries(
      Object.entries(ALLOWED_READS).map(([file, entry]) => [file, [...entry.reads].sort()]),
    );
    expect(found).toEqual(expected);
  });

  it("the model-facing code never names file text", () => {
    const offenders = MODEL_FACING.flatMap(sourceFiles)
      .filter((file) => FILE_TEXT.test(code(file)))
      .map(relativeName);
    expect(offenders).toEqual([]);
  });

  it("the model-facing code never imports the documents repository", () => {
    const offenders = MODEL_FACING.flatMap(sourceFiles)
      .filter((file) => /import\s*\{[^}]*\bdocuments\b[^}]*\}\s*from\s*"@ourglass\/db"/.test(code(file)))
      .map(relativeName);
    expect(offenders).toEqual([]);
  });
});
