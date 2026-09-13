/**
 * The §26 relevance gate — including the NEGATIVE evals the phase's
 * definition of done requires.
 *
 * ================================ READ THIS ================================
 * Spec §26 lists three BAD outputs by name. Those are not style notes; they
 * are the acceptance criterion, and §4 violations are test failures.
 *
 *   BAD  "You have 17 tasks! Here's how to optimize your day!"
 *   BAD  "You should study now."
 *   BAD  "Would you like me to create a plan?" after every statement.
 *
 * The usual way to defend that is a prompt instruction, which cannot be
 * tested — so the gate is STRUCTURAL instead, and these tests assert the
 * structure rather than inspecting prose:
 *
 *   1. A line must cite a specific row id. No row, no line. (Eliminates
 *      "you have 17 tasks", which cites a COUNT.)
 *   2. The trigger must have just become true, not merely still be true.
 *   3. At most one per turn, never alongside a question.
 *   4. Never advice — enforced by construction, since the renderer has no
 *      branch that produces an opinion.
 * ===========================================================================
 */
import { describe, expect, it } from "vitest";
import { renderProactiveLine, selectProactiveLine, type ProactiveCandidate } from "./proactive.js";

const conflict: ProactiveCandidate = {
  kind: "conflict",
  rowId: "44444444-4444-4444-4444-444444444444",
  conflict: {
    kind: "time_overlap",
    existingEventId: "44444444-4444-4444-4444-444444444444",
    existingTitle: "Hult meeting",
    existingStartsAt: "2026-09-14T17:00:00+05:30",
  },
};

const overdue: ProactiveCandidate = {
  kind: "overdue",
  rowId: "55555555-5555-5555-5555-555555555555",
  objectText: "the article",
  ownerName: "Barkha",
  overdueByMs: 5 * 3_600_000,
};

/** Stand-in for the orchestrator's timezone-aware formatter. */
const fmt = (iso: string): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));

describe("the relevance gate (§26)", () => {
  it("says NOTHING when the turn already asks a question", () => {
    // RULE 3. The user is already being asked for one thing; a second is the
    // confirmation fatigue §27 forbids. This is the most common way a
    // proactive feature becomes annoying, so it is checked first.
    expect(selectProactiveLine([conflict, overdue], { turnAsksQuestion: true })).toBeNull();
  });

  it("says nothing when there is no candidate", () => {
    expect(selectProactiveLine([], { turnAsksQuestion: false })).toBeNull();
  });

  it("emits AT MOST ONE line even when several qualify", () => {
    // RULE 3 again, enforced by the return TYPE rather than by asking every
    // caller to slice correctly — "two proactive lines" is unrepresentable.
    const chosen = selectProactiveLine([conflict, overdue], { turnAsksQuestion: false });
    expect(chosen).not.toBeNull();
    expect(Array.isArray(chosen)).toBe(false);
  });

  it("prefers the conflict, because it is about the sentence just said", () => {
    // §26: "proactivity should be driven by actual relevance." A conflict
    // concerns the utterance being processed; an overdue notice concerns
    // something from before. The conflict is also immediately actionable.
    const chosen = selectProactiveLine([overdue, conflict], { turnAsksQuestion: false });
    expect(chosen?.kind).toBe("conflict");
  });

  it("every candidate carries a specific row id — rule 1, by construction", () => {
    // "You have 17 tasks!" cites a COUNT, not a row, so it cannot be built as
    // a ProactiveCandidate at all. This asserts the property the type is
    // supposed to guarantee, so a future variant without `rowId` fails here.
    for (const candidate of [conflict, overdue]) {
      expect(candidate.rowId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
  });
});

describe("rendering (§24, §26, §31)", () => {
  it("names BOTH sides of a conflict and does NOT choose", () => {
    // §24 is explicit: "Do not automatically choose." The line must surface
    // the collision and leave the decision with the user.
    const line = renderProactiveLine(conflict, fmt);
    expect(line).toContain("Hult meeting");
    expect(line).toMatch(/5:00\s?PM/i);
    expect(line).toMatch(/move it or keep both\?/i);
  });

  it("states an overdue commitment as a fact, with who and how late", () => {
    // §26's own good example: "Barkha's article is five hours overdue and you
    // haven't marked it as received."
    const line = renderProactiveLine(overdue, fmt);
    expect(line).toContain("Barkha");
    expect(line).toContain("the article");
    expect(line).toContain("5 hours");
    expect(line).toMatch(/not marked complete/i);
  });

  it("omits the owner cleanly when the name is unknown", () => {
    // The LEFT JOIN can yield a null name if the person row was invalidated.
    // Losing the whole notice over a missing name would be worse than
    // rendering it without one — but it must not read as broken.
    const line = renderProactiveLine({ ...overdue, ownerName: null }, fmt);
    expect(line).not.toContain("null");
    expect(line).not.toContain("undefined");
    expect(line.startsWith("the article")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // THE NEGATIVE EVALS — §4 and §26's "bad" column
  // -------------------------------------------------------------------------

  it("NEVER produces advice, an offer, or a productivity summary", () => {
    // §4 forbids unsolicited advice and §26 names three bad shapes. This is
    // the closest a test can get to "the assistant did not become a life
    // coach": assert the vocabulary those shapes require is absent from
    // everything the renderer can emit.
    const everything = [conflict, overdue, { ...overdue, ownerName: null }]
      .map((candidate) => renderProactiveLine(candidate, fmt))
      .join(" ");

    // "You should…", "Here's how to optimize…", "Would you like me to…"
    expect(everything).not.toMatch(/you should/i);
    expect(everything).not.toMatch(/optimi[sz]e/i);
    expect(everything).not.toMatch(/would you like me to/i);
    expect(everything).not.toMatch(/here'?s how/i);
    // A count-based summary ("you have 17 tasks") — no digit should ever be
    // followed by "tasks" or "items".
    expect(everything).not.toMatch(/\d+\s+(tasks|items)/i);
    // §31: concise. No exclamation marks anywhere in this register.
    expect(everything).not.toContain("!");
  });

  it("keeps each line to a single short sentence or two — §31", () => {
    for (const candidate of [conflict, overdue]) {
      const line = renderProactiveLine(candidate, fmt);
      expect(line.length).toBeLessThan(140);
    }
  });

  it("renders durations in whole units, never a decimal", () => {
    // "3.7 hours overdue" reads as machine output. Matches respond.ts's
    // register.
    const line = renderProactiveLine({ ...overdue, overdueByMs: 3.7 * 3_600_000 }, fmt);
    expect(line).not.toMatch(/\d+\.\d/);
  });
});
