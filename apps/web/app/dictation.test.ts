import { describe, expect, it } from "vitest";
import {
  appendTranscript,
  canRecord,
  chooseDictationMode,
  dictationErrorMessage,
  downsample,
  encodeWav,
  finalTranscript,
  isSilent,
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
  it("says nothing when the user cancelled, but says so when nothing was heard", () => {
    expect(dictationErrorMessage("aborted")).toBeNull();
    // Silence used to show nothing, which made the mic look broken.
    expect(dictationErrorMessage("no-speech")).toMatch(/didn't catch anything/i);
  });

  it("does not blame the network for a browser with no speech service (Brave)", () => {
    expect(dictationErrorMessage("network")).toMatch(/switched to recorded voice input/i);
    expect(dictationErrorMessage("network")).not.toMatch(/needs a network connection/i);
  });

  it("explains a blocked microphone in terms of what to do", () => {
    expect(dictationErrorMessage("not-allowed")).toMatch(/blocked/i);
    expect(dictationErrorMessage("audio-capture")).toMatch(/no microphone/i);
    expect(dictationErrorMessage("anything else")).toMatch(/type instead/i);
  });
});

describe("chooseDictationMode", () => {
  const recorder = { navigator: { mediaDevices: { getUserMedia() {} } }, AudioContext: function AudioContext() {} };
  const speech = { webkitSpeechRecognition: function Recognition() {} };

  it("uses the browser's own recognition where it has one (Chrome, Edge, Safari)", () => {
    expect(chooseDictationMode({ ...speech, ...recorder })).toBe("browser");
  });

  it("records in Brave even though it exposes SpeechRecognition", () => {
    // Brave's SpeechRecognition fails every time with `network`.
    const brave = { ...speech, ...recorder, navigator: { ...recorder.navigator, brave: {} } };
    expect(chooseDictationMode(brave)).toBe("recorder");
  });

  it("records where there is no SpeechRecognition (Firefox), and offers nothing if it cannot record", () => {
    expect(chooseDictationMode(recorder)).toBe("recorder");
    expect(chooseDictationMode({})).toBeNull();
    expect(canRecord({ navigator: {} })).toBe(false);
  });
});

describe("recorded clips", () => {
  it("encodes 16-bit mono PCM WAV with a correct header", () => {
    const wav = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5])], 16_000);
    const view = new DataView(wav.buffer);
    const ascii = (from: number, to: number) => String.fromCharCode(...wav.subarray(from, to));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 12)).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8); // four samples, two bytes each
    expect(wav.byteLength).toBe(44 + 8);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
  });

  it("calls a clip of zeros or faint hiss silent, and a voice not", () => {
    expect(isSilent(new Float32Array(16_000))).toBe(true);
    expect(isSilent(new Float32Array([0.001, -0.005, 0.01]))).toBe(true);
    expect(isSilent(new Float32Array([0, 0.3, -0.2]))).toBe(false);
  });

  it("downsamples by averaging, and passes through when no reduction is needed", () => {
    const out = downsample([new Float32Array([1, 1, 1, 0, 0, 0])], 48_000, 16_000);
    expect(Array.from(out)).toEqual([1, 0]);
    expect(Array.from(downsample([new Float32Array([0.25, 0.5])], 16_000, 16_000))).toEqual([0.25, 0.5]);
  });
});
