/**
 * The pure halves of the pipeline (association, the reply) and the STRUCTURAL
 * half of the injection defence: what ingest.ts is and is not wired to.
 *
 * The behavioural half — a hostile document ingested against real Postgres,
 * mutation-verified — is ingest.integration.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DocumentReading } from "@ourglass/shared";
import { describe, expect, it } from "vitest";
import { associate, matchMention, namedInNote, normalizeName, type NamedRow } from "./associate.js";
import { listNames, renderIngestReply } from "./reply.js";
import { toBase64 } from "./ingest.js";

const ROWS: NamedRow[] = [
  { kind: "person", id: "p-barkha", name: "Barkha" },
  { kind: "person", id: "p-dev", name: "Dev Mehta" },
  { kind: "person", id: "p-arun-1", name: "Arun" },
  { kind: "person", id: "p-arun-2", name: "Arun" },
  { kind: "person", id: "p-self", name: "Meera" },
  { kind: "organization", id: "o-hult", name: "Hult" },
  { kind: "project", id: "pr-poster", name: "Hult poster" },
];

const READING: DocumentReading = {
  title: "Hult poster brief",
  summary: "Brief.",
  people: ["Barkha", "Dev", "Arun", "Meera", "Zoya"],
  organizations: ["Hult"],
  projects: [],
  events: [{ name: "Open house", when: "Sat 18 Oct, 5 pm", venue: "Studio 2" }],
  deadlines: [{ what: "Final poster", when: "Fri 17 Oct, 6 pm" }],
};

describe("association — code, exact, never a guess", () => {
  it("normalizes case, accents, possessives and punctuation", () => {
    expect(normalizeName("  Barkha's  ")).toBe("barkha");
    expect(normalizeName("Café—Hult!")).toBe("cafe hult");
  });

  it("links whole names the NOTE contains, and refuses an ambiguous one", () => {
    // Two Aruns: no link, rather than a guess.
    const matched = namedInNote("This is the final Hult poster brief for Barkha and Arun", ROWS);
    expect(matched.map((row) => row.id).sort()).toEqual(["o-hult", "p-barkha", "pr-poster"]);
  });

  it("does not match a name inside another word", () => {
    expect(namedInNote("the Hultberg account", ROWS)).toEqual([]);
  });

  it("matches a mention exactly, or by an UNAMBIGUOUS word prefix", () => {
    const people = ROWS.filter((row) => row.kind === "person");
    expect(matchMention("Dev", people)?.id).toBe("p-dev");
    expect(matchMention("Barkha Sharma", people)?.id).toBe("p-barkha");
    expect(matchMention("Arun", people)).toBeNull();
    expect(matchMention("Zoya", ROWS)).toBeNull();
  });

  it("labels the note CONFIRMED and the file INFERRED, never links the reader to themselves, never creates", () => {
    const links = associate("final brief for Barkha", READING, ROWS, "p-self");
    const byId = Object.fromEntries(links.map((link) => [link.id, link.inference]));
    expect(byId).toEqual({ "p-barkha": "CONFIRMED", "p-dev": "INFERRED", "o-hult": "INFERRED" });
    // Zoya is named in the file and unknown: nothing is created for her.
    expect(links.every((link) => ROWS.some((row) => row.id === link.id))).toBe(true);
  });
});

describe("renderIngestReply — a template, never a model", () => {
  it("states what was saved, linked and found — and what was NOT done", () => {
    const reply = renderIngestReply({
      kind: "saved",
      filename: "hult-brief.pdf",
      reading: READING,
      links: ["Hult", "Barkha"],
      truncated: false,
    });
    expect(reply).toBe(
      'Saved "hult-brief.pdf" — Hult poster brief. Linked to Hult and Barkha. ' +
        "It mentions Final poster, due Fri 17 Oct, 6 pm; Open house, Sat 18 Oct, 5 pm, Studio 2. " +
        "I haven't added any of it to your list — tell me if you want something tracked.",
    );
  });

  it("says nothing about the list when there was nothing it could have added", () => {
    const reply = renderIngestReply({
      kind: "saved",
      filename: "notes.txt",
      reading: { ...READING, events: [], deadlines: [] },
      links: [],
      truncated: true,
    });
    expect(reply).toBe('Saved "notes.txt" — Hult poster brief. It\'s long, so I read the first part.');
  });

  it("is honest about an unread file and why", () => {
    expect(renderIngestReply({ kind: "unread", filename: "scan.pdf", reason: "no_text", links: [] })).toMatch(
      /^Saved "scan.pdf", but I couldn't read it: it has no text in it/,
    );
    expect(renderIngestReply({ kind: "unread", filename: "x.png", reason: "no_model", links: [] })).toContain(
      "no AI model is set up",
    );
  });

  it("strips control characters from a hostile filename", () => {
    const reply = renderIngestReply({ kind: "duplicate", existingFilename: "a\u202Egnp.exe" });
    expect(reply).not.toContain("\u202E");
  });

  it("keeps names' case — unlike the field-label joiner", () => {
    expect(listNames(["Hult", "Barkha", "Dev"])).toBe("Hult, Barkha and Dev");
  });
});

describe("toBase64", () => {
  it("round-trips bytes across its chunk boundary", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).map((_, index) => index % 256);
    expect(Buffer.from(toBase64(bytes), "base64").equals(Buffer.from(bytes))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// THE STRUCTURAL HALF OF §1. Read the source: the pipeline must not be wired
// to anything that turns words into actions.
// ---------------------------------------------------------------------------

describe("ingest.ts — where file content can flow (PHASE-6-DESIGN §1)", () => {
  // CODE only: the comments name runTurn on purpose, to explain the shape.
  const source = readFileSync(fileURLToPath(new URL("./ingest.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const imports = [...source.matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map((match) => match[1]!);

  it("imports nothing from the assistant — no Interpret, no Respond, no runTurn", () => {
    // Guard the guard: an import scan that finds nothing proves nothing.
    expect(imports.length).toBeGreaterThanOrEqual(5);
    expect(imports.filter((path) => path.startsWith("../assistant"))).toEqual([]);
    expect(source).not.toMatch(/\brunTurn\b|\.extract\(|\.respond\(|\.interpret\(/);
  });

  it("emits exactly the two document tools, and no other", () => {
    const emitted = [...source.matchAll(/\bname:\s*"([a-z_]+)"/g)].map((match) => match[1]).sort();
    expect(emitted).toEqual(["link_document", "save_document"]);
  });
});
