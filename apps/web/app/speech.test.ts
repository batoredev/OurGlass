import { describe, expect, it } from "vitest";
import {
  MAX_SPOKEN_CHARS,
  SPEAK_PREFERENCE_KEY,
  loadSpeakPreference,
  saveSpeakPreference,
  speak,
  speechKit,
  spokenText,
  type UtteranceLike,
} from "./speech";

class FakeUtterance implements UtteranceLike {
  lang = "";
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function fakeKit() {
  const calls: string[] = [];
  const spoken: FakeUtterance[] = [];
  const synth = {
    speaking: false,
    speak: (utterance: unknown) => {
      calls.push("speak");
      spoken.push(utterance as FakeUtterance);
    },
    cancel: () => calls.push("cancel"),
  };
  return { kit: { synth, Utterance: FakeUtterance }, calls, spoken };
}

describe("speechKit", () => {
  it("is null where the browser has no voice, so no toggle is shown", () => {
    expect(speechKit(undefined)).toBeNull();
    expect(speechKit({})).toBeNull();
    expect(speechKit({ speechSynthesis: {}, SpeechSynthesisUtterance: FakeUtterance })).toBeNull();
  });

  it("finds the browser's synthesizer", () => {
    const { kit } = fakeKit();
    expect(speechKit({ speechSynthesis: kit.synth, SpeechSynthesisUtterance: FakeUtterance })).not.toBeNull();
  });
});

describe("speak", () => {
  it("stops what was being read, then reads the new reply in the reader's language", () => {
    const { kit, calls, spoken } = fakeKit();
    let done = false;
    expect(speak(kit, "Noted: Barkha owes you the article ↗", "en-IN", () => (done = true))).toBe(true);
    expect(calls).toEqual(["cancel", "speak"]);
    expect(spoken[0]).toMatchObject({ text: "Noted: Barkha owes you the article", lang: "en-IN" });
    spoken[0]!.onend?.();
    expect(done).toBe(true);
  });

  it("says nothing for an empty reply", () => {
    const { kit, calls } = fakeKit();
    expect(speak(kit, "  ✓ ", "en", () => undefined)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("cuts a runaway reply at a word", () => {
    const text = spokenText("word ".repeat(400));
    expect(text.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS + 1);
    expect(text.endsWith("word…")).toBe(true);
  });
});

describe("the preference", () => {
  it("is off unless turned on, and survives storage that throws", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
    expect(loadSpeakPreference(storage)).toBe(false);
    saveSpeakPreference(storage, true);
    expect(store.get(SPEAK_PREFERENCE_KEY)).toBe("on");
    expect(loadSpeakPreference(storage)).toBe(true);
    saveSpeakPreference(storage, false);
    expect(loadSpeakPreference(storage)).toBe(false);

    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSpeakPreference(broken)).toBe(false);
    expect(() => saveSpeakPreference(broken, true)).not.toThrow();
    expect(loadSpeakPreference(undefined)).toBe(false);
  });
});
