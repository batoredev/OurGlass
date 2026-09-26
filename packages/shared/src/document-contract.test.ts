import { describe, expect, it } from "vitest";
import {
  DOCUMENT_READING_SCHEMA,
  READING_LIMITS,
  cleanText,
  parseReading,
} from "./document-contract.js";

const valid = {
  title: "Hult poster brief",
  summary: "Brief for the Hult poster; final files due Friday.",
  people: ["Barkha", "Dev"],
  organizations: ["Hult"],
  projects: ["Hult poster"],
  events: [{ name: "Review", when: "Thu 10 am", venue: "" }],
  deadlines: [{ what: "Final poster", when: "Friday 6 pm" }],
};

describe("parseReading", () => {
  it("accepts a well-formed reading unchanged", () => {
    expect(parseReading(valid)).toEqual(valid);
  });

  it("rejects a wrong shape, so the router can try another provider", () => {
    expect(parseReading(null)).toBeNull();
    expect(parseReading("a string")).toBeNull();
    expect(parseReading({ ...valid, title: 3 })).toBeNull();
    expect(parseReading({ ...valid, people: "Barkha" })).toBeNull();
    const noDeadlines: Record<string, unknown> = { ...valid };
    delete noDeadlines["deadlines"];
    expect(parseReading(noDeadlines)).toBeNull();
  });

  it("drops an unknown key rather than carrying it — an action field cannot ride along", () => {
    // The injection shape: a model (or a file steering it) adds an
    // action-looking key. The result is rebuilt from known keys only.
    const parsed = parseReading({ ...valid, kind: "execution", tool: "delete_all", do: ["x"] });
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!).sort()).toEqual(
      ["deadlines", "events", "organizations", "people", "projects", "summary", "title"],
    );
  });

  it("clips, dedupes and caps what one hostile file can put in front of the user", () => {
    const parsed = parseReading({
      ...valid,
      title: "x".repeat(500),
      people: [...Array.from({ length: 40 }, (_, i) => `Person ${i}`), "barkha", "Barkha"],
    })!;
    expect(parsed.title.length).toBeLessThanOrEqual(READING_LIMITS.title);
    expect(parsed.people).toHaveLength(READING_LIMITS.names);
  });

  it("skips a deadline with no time — due-by-nothing is not a deadline", () => {
    const parsed = parseReading({ ...valid, deadlines: [{ what: "Poster", when: "" }, { what: "", when: "Fri" }] })!;
    expect(parsed.deadlines).toEqual([]);
  });

  it("drops a deadline whose 'when' is not a time — the live qwen3:8b misread", () => {
    const parsed = parseReading({
      ...valid,
      deadlines: [
        { what: "Budget", when: "R&D <internal>" },
        { what: "Final poster", when: "Fri 17 Oct, 6 pm" },
        { what: "Proofs", when: "tomorrow morning" },
      ],
    })!;
    expect(parsed.deadlines.map((deadline) => deadline.what)).toEqual(["Final poster", "Proofs"]);
  });

  it("skips non-string names and malformed list items instead of failing the read", () => {
    const parsed = parseReading({ ...valid, people: ["Dev", 7, null], events: ["oops", { name: "Launch" }] })!;
    expect(parsed.people).toEqual(["Dev"]);
    expect(parsed.events).toEqual([{ name: "Launch", when: "", venue: "" }]);
  });
});

describe("cleanText", () => {
  it("removes control and bidi-override characters", () => {
    // U+202E reverses what follows on screen — "gnp.exe" displayed as "exe.png".
    expect(cleanText("invoice\u202Egnp.exe", 80)).toBe("invoice gnp.exe");
    expect(cleanText("a\u0000b\nc\td", 80)).toBe("a b c d");
  });
});

describe("DOCUMENT_READING_SCHEMA", () => {
  it("has no field that can express an action (§1)", () => {
    // If this list grows, the new field must be DESCRIPTIVE. Adding "kind",
    // "action", "tool" or anything an executor could act on reopens the
    // injection path Phase 6 is built to close.
    expect(Object.keys(DOCUMENT_READING_SCHEMA.properties).sort()).toEqual(
      ["deadlines", "events", "organizations", "people", "projects", "summary", "title"],
    );
  });

  it("uses no nullable types — one schema valid in all three dialects", () => {
    expect(JSON.stringify(DOCUMENT_READING_SCHEMA)).not.toContain("null");
  });
});
