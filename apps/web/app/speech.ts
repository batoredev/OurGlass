/**
 * Spoken replies, the parts that are not React — ROADMAP Stage 1d (category 4;
 * owner default 2026-11-05: "spoken replies in scope, as an opt-in browser
 * voice").
 *
 * The browser's own speechSynthesis: no hosted voice, no cost, nothing sent
 * anywhere this app controls. OFF until the person turns it on, remembered on
 * this browser only (a per-viewer convenience, so localStorage), and always
 * stoppable. Only the assistant's reply is read — never a file's text.
 */

/** The slice of speechSynthesis this app uses. */
export interface SynthLike {
  speak(utterance: unknown): void;
  cancel(): void;
  readonly speaking: boolean;
}

export interface UtteranceLike {
  text: string;
  lang: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

type UtteranceCtor = new (text: string) => UtteranceLike;

export interface SpeechKit {
  readonly synth: SynthLike;
  readonly Utterance: UtteranceCtor;
}

/** The browser's synthesizer and utterance constructor, or null when it has none. */
export function speechKit(globalObject: unknown): SpeechKit | null {
  if (typeof globalObject !== "object" || globalObject === null) return null;
  const synth = (globalObject as { speechSynthesis?: unknown }).speechSynthesis;
  const Utterance = (globalObject as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
  if (typeof synth !== "object" || synth === null || typeof Utterance !== "function") return null;
  if (typeof (synth as SynthLike).speak !== "function" || typeof (synth as SynthLike).cancel !== "function") return null;
  return { synth: synth as SynthLike, Utterance: Utterance as UtteranceCtor };
}

/** A reply is a sentence or two; a runaway one is cut rather than read for a minute. */
export const MAX_SPOKEN_CHARS = 600;

/** What is read aloud: the reply, without symbols a voice would spell out. */
export function spokenText(reply: string): string {
  const text = reply
    .replace(/[↗→↓✓📎]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= MAX_SPOKEN_CHARS ? text : `${text.slice(0, MAX_SPOKEN_CHARS).replace(/\s+\S*$/, "")}…`;
}

/** Speaks one reply, replacing anything still being read. Returns false when there was nothing to say. */
export function speak(kit: SpeechKit, reply: string, lang: string, onDone: () => void): boolean {
  const text = spokenText(reply);
  if (text === "") return false;
  kit.synth.cancel();
  const utterance = new kit.Utterance(text);
  utterance.lang = lang;
  utterance.onend = onDone;
  utterance.onerror = onDone;
  kit.synth.speak(utterance);
  return true;
}

export const SPEAK_PREFERENCE_KEY = "ourglass.speakReplies";

/** Storage can throw (private windows, blocked site data): off, then. */
export function loadSpeakPreference(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return storage?.getItem(SPEAK_PREFERENCE_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveSpeakPreference(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, on: boolean): void {
  try {
    if (on) storage?.setItem(SPEAK_PREFERENCE_KEY, "on");
    else storage?.removeItem(SPEAK_PREFERENCE_KEY);
  } catch {
    // Not remembered on this browser; the toggle still works for this visit.
  }
}
