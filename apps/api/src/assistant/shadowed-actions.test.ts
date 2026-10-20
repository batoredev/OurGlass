import { describe, expect, it } from "vitest";
import type { ExtractedIntent } from "@ourglass/shared";
import { withoutShadowedActions } from "./orchestrator.js";

const moorthy = { name: "Moorthy", kind: "person" as const, inferenceLevel: "CONFIRMED" as const };
const draft: ExtractedIntent = {
  kind: "action",
  inferenceLevel: "CONFIRMED",
  sourceText: "Email Moorthy that the meeting moved to 7",
  recipient: moorthy,
  emailDraft: { subject: "Meeting moved", body: "Hi Moorthy," },
};
const bare: ExtractedIntent = {
  kind: "action",
  inferenceLevel: "CONFIRMED",
  sourceText: "ask him to bring the budget",
  recipient: moorthy,
  time: { kind: "deterministic", sourcePhrase: "7 pm" },
};

describe("withoutShadowedActions", () => {
  it("drops a bodiless action beside a draft to the same person (Flash-Lite, live 2026-10-20)", () => {
    expect(withoutShadowedActions([bare, draft])).toEqual([draft]);
  });

  it("keeps a real reminder that happens to name the same person", () => {
    const reminder = { ...bare, reminderBody: "call Moorthy" };
    expect(withoutShadowedActions([draft, reminder])).toEqual([draft, reminder]);
  });

  it("changes nothing in a turn with no email draft", () => {
    expect(withoutShadowedActions([bare])).toEqual([bare]);
  });
});
