import { describe, expect, it } from "vitest";
import { followUpDraft, learnStyle, styleFor, tailorBody, wordCount, wordEditDistance } from "./style.js";

const toBarkha = (body: string) => ({ body, recipientName: "Barkha" });
const PAST = [
  toBarkha("Hi Barkha,\n\nCould you send the outline?\n\nThanks,\nVaibhav"),
  toBarkha("Hi Barkha,\n\nThe poster looks great.\n\nThanks,\nVaibhav"),
  toBarkha("Barkha — one more thing about Friday."),
];

describe("learnStyle — the owner's habit, by counting", () => {
  it("learns the greeting (with the name as a slot) and the sign-off seen at least twice", () => {
    expect(learnStyle(PAST)).toEqual({ greeting: "Hi {name},", signOff: "Thanks,\nVaibhav", from: 3 });
  });

  it("learns nothing from a single email — one is an accident, two is a habit", () => {
    expect(learnStyle(PAST.slice(0, 1))).toEqual({ greeting: null, signOff: null, from: 1 });
  });

  it("generalises across recipients: 'Hi Arun,' and 'Hi Dev,' are one habit", () => {
    const style = learnStyle([
      { body: "Hi Arun,\n\nSchema?", recipientName: "Arun" },
      { body: "Hi Dev,\n\nQuote?", recipientName: "Dev" },
    ]);
    expect(style.greeting).toBe("Hi {name},");
  });

  it("prefers the recipient's own thread, then everyone's", () => {
    const everyone = [
      { body: "Hello Arun,\n\nx", recipientName: "Arun" },
      { body: "Hello Dev,\n\ny", recipientName: "Dev" },
    ];
    expect(styleFor(PAST, everyone).greeting).toBe("Hi {name},");
    expect(styleFor([], everyone).greeting).toBe("Hello {name},");
  });
});

describe("tailorBody — added only where the draft has none", () => {
  const style = { greeting: "Hi {name},", signOff: "Thanks,\nVaibhav", from: 2 };

  it("adds the greeting and sign-off around a bare draft", () => {
    expect(tailorBody("The meeting moved to 4.", "Barkha Sharma", style)).toBe("Hi Barkha,\n\nThe meeting moved to 4.\n\nThanks,\nVaibhav");
  });

  it("leaves a draft that already greets and signs off alone", () => {
    const written = "Dear Barkha,\n\nThe meeting moved to 4.\n\nBest,\nV";
    expect(tailorBody(written, "Barkha", style)).toBe(written);
  });

  it("changes nothing without a learned style", () => {
    expect(tailorBody("The meeting moved.", "Barkha", { greeting: null, signOff: null, from: 0 })).toBe("The meeting moved.");
  });
});

describe("followUpDraft", () => {
  it("asks about what they owe and mentions what you owe, in the owner's style", () => {
    const text = followUpDraft(
      "Barkha",
      [
        { what: "the article", due: "8 Nov", theyOwe: true },
        { what: "feedback on the outline", due: null, theyOwe: false },
      ],
      { greeting: "Hi {name},", signOff: "Thanks,\nVaibhav", from: 3 },
    );
    expect(text).toBe(
      "Hi Barkha,\n\nJust checking in on the article (due 8 Nov) — how is it going? feedback on the outline is on my list; I'll come back to you on it soon.\n\nThanks,\nVaibhav",
    );
  });

  it("is null when nothing is open, and plain without a learned style", () => {
    expect(followUpDraft("Dev", [], { greeting: null, signOff: null, from: 0 })).toBeNull();
    expect(followUpDraft("Dev", [{ what: "the quote", due: null, theyOwe: true }], { greeting: null, signOff: null, from: 0 })).toBe(
      "Hi Dev,\n\nJust checking in on the quote — how is it going?\n\nThanks,",
    );
  });
});

describe("wordEditDistance — Stage 4's measure", () => {
  it("counts words changed, added and removed", () => {
    expect(wordEditDistance("the meeting moved to 4", "the meeting moved to 4")).toBe(0);
    expect(wordEditDistance("the meeting moved to 4", "the call moved to 5 pm")).toBe(3);
    expect(wordCount("  Hi Barkha,\n\nThanks ")).toBe(3);
  });
});
