import { describe, expect, it } from "vitest";
import {
  appendTranscript,
  dictationErrorMessage,
  finalTranscript,
  speechRecognitionCtor,
  type SpeechResultEvent,
} from "./dictation";

const event = (results: { transcript: string; isFinal?: boolean }[], resultIndex = 0): SpeechResultEvent =>
  ({
    resultIndex,
    results: results.map((result) => Object.assign([{ transcript: result.transcript }], { isFinal: result.isFinal })),
  }) as unknown as SpeechResultEvent;

describe("speechRecognitionCtor", () => {
  it("finds the standard and the webkit-prefixed constructor", () => {
    class Fake {}
    expect(speechRecognitionCtor({ SpeechRecognition: Fake })).toBe(Fake);
    expect(speechRecognitionCtor({ webkitSpeechRecognition: Fake })).toBe(Fake);
  });

  it("returns null where the API does not exist — Firefox, and the server", () => {
    // The button is only rendered when this is non-null, so this IS the
    // feature detection: get it wrong and every Firefox user sees a dead mic.
    expect(speechRecognitionCtor({})).toBeNull();
    expect(speechRecognitionCtor(undefined)).toBeNull();
    expect(speechRecognitionCtor({ SpeechRecognition: "not a constructor" })).toBeNull();
  });
});

describe("finalTranscript", () => {
  it("joins the final results and ignores interim ones", () => {
    expect(finalTranscript(event([{ transcript: "remind me " }, { transcript: "at five" }]))).toBe("remind me at five");
    expect(
      finalTranscript(event([{ transcript: "kept", isFinal: true }, { transcript: "dropped", isFinal: false }])),
    ).toBe("kept");
  });

  it("starts at resultIndex, so nothing is transcribed twice", () => {
    expect(finalTranscript(event([{ transcript: "already said" }, { transcript: "new" }], 1))).toBe("new");
  });
});

describe("appendTranscript", () => {
  it("adds to what was typed, with one space at the seam", () => {
    expect(appendTranscript("Remind me", "at five")).toBe("Remind me at five");
    expect(appendTranscript("Remind me ", "at five")).toBe("Remind me at five");
    expect(appendTranscript("", "at five")).toBe("at five");
  });

  it("never destroys a half-typed sentence", () => {
    // Dictation fills the same box as the keyboard; replacing would lose work.
    expect(appendTranscript("Barkha owes me", "the article by six")).toBe("Barkha owes me the article by six");
    expect(appendTranscript("kept", "   ")).toBe("kept");
  });
});

describe("dictationErrorMessage", () => {
  it("says nothing when the user simply did not speak", () => {
    expect(dictationErrorMessage("no-speech")).toBeNull();
    expect(dictationErrorMessage("aborted")).toBeNull();
  });

  it("explains a blocked microphone in terms of what to do", () => {
    expect(dictationErrorMessage("not-allowed")).toMatch(/blocked/i);
    expect(dictationErrorMessage("audio-capture")).toMatch(/no microphone/i);
    expect(dictationErrorMessage("anything else")).toMatch(/type instead/i);
  });
});
