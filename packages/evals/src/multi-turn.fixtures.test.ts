/**
 * The multi-turn eval set is consistent with the rule the app enforces — free,
 * runs in CI. A label that quotes an earlier turn would score a model "wrong"
 * for doing what the app requires, or "right" for an intent the app drops.
 */
import { describe, expect, it } from "vitest";
import { groundInUtterance, renderConversation } from "@ourglass/api/assistant";
import { MULTI_TURN_FIXTURES } from "./multi-turn.fixtures.js";

describe("multi-turn eval set", () => {
  it("has unique ids and at least one safety case", () => {
    const ids = MULTI_TURN_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MULTI_TURN_FIXTURES.some((fixture) => fixture.safety)).toBe(true);
  });

  it.each(MULTI_TURN_FIXTURES.map((fixture) => [fixture.id, fixture] as const))(
    "%s: every expected intent quotes the current message, and the context renders",
    (_id, fixture) => {
      const result = groundInUtterance(
        { extraction: fixture.expected, trace: { model: "label", latencyMs: 0, usage: { inputTokens: 0, outputTokens: 0 }, stopReason: null } },
        fixture.utterance,
      );
      expect(result.dropped).toBe(0);
      const now = new Date("2026-11-08T09:00:00.000Z");
      const context = renderConversation(
        fixture.previous.map((message, index) => ({ id: `p${index}`, ...message, trace: null, t_created: now })),
        "current",
        now,
      );
      expect(context).toContain("EARLIER IN THIS CONVERSATION");
    },
  );
});
