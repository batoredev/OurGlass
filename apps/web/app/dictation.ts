/**
 * Dictation, the parts that are not React — Stage 15 (spec §1's "eventually",
 * scoped by docs/REMAINING-EXECUTION-PLAN.md to speech INTO THE COMPOSER).
 *
 * The browser's own SpeechRecognition, not a hosted transcription API: it costs
 * nothing, adds no backend, and sends no audio anywhere this app controls. The
 * trade is uneven support — Chrome and Safari have it behind a vendor prefix,
 * Firefox does not have it at all — which is why `speechRecognitionCtor`
 * returns null rather than throwing, and the button is not rendered when it
 * does. A dead microphone button is worse than no microphone button.
 *
 * NOT IN SCOPE, deliberately: voice replies, a wake word, continuous listening.
 * None is in the spec, and each is easy to add and hard to remove.
 */

/** The slice of the SpeechRecognition API this app uses. */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

/** Only what `onresult` is read for: the joined final transcript. */
export interface SpeechResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
  resultIndex: number;
}

type Ctor = new () => SpeechRecognitionLike;

/**
 * The constructor this browser offers, or null.
 *
 * Takes the global rather than reading `window` so it is testable in Node, and
 * so a server render cannot touch a browser API.
 */
export function speechRecognitionCtor(globalObject: unknown): Ctor | null {
  if (typeof globalObject !== "object" || globalObject === null) return null;
  const candidate =
    (globalObject as { SpeechRecognition?: unknown }).SpeechRecognition ??
    (globalObject as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  return typeof candidate === "function" ? (candidate as Ctor) : null;
}

/** Every final transcript in the event, joined — interim results are ignored. */
export function finalTranscript(event: SpeechResultEvent): string {
  let text = "";
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (!result || result.isFinal === false) continue;
    text += result[0]?.transcript ?? "";
  }
  return text.trim();
}

/**
 * Dictated text added to what the user has already typed.
 *
 * Appends rather than replaces, with exactly one space at the seam: dictation
 * is a second way to fill the SAME box, so it must not destroy a half-typed
 * sentence.
 */
export function appendTranscript(existing: string, transcript: string): string {
  const addition = transcript.trim();
  if (addition === "") return existing;
  if (existing.trim() === "") return addition;
  return `${existing.replace(/\s+$/, "")} ${addition}`;
}

/**
 * What to tell the user when dictation stops badly.
 *
 * Plain sentences, because this is shown where replies are shown. The codes are
 * the Web Speech API's `SpeechRecognitionErrorEvent.error` values.
 */
export function dictationErrorMessage(code: string | undefined): string | null {
  switch (code) {
    // Not a failure worth a message: the user said nothing.
    case "aborted":
      return null;
    case "no-speech":
      // Used to be silent, so a press that heard nothing looked like a dead
      // button. Say so.
      return "I didn't catch anything — press the mic and try again.";
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it in your browser settings to dictate.";
    case "audio-capture":
      return "No microphone found.";
    case "network":
      // What Brave reports: it ships the API without Google's speech service.
      // The hook switches to recorded dictation when it sees this.
      return "This browser's voice service didn't respond, so I've switched to recorded voice input. Press the mic again.";
    case "language-not-supported":
      return "Dictation is not available for this language.";
    default:
      return "Dictation stopped. You can type instead.";
  }
}

/**
 * How this browser dictates: its own SpeechRecognition ("browser"), or by
 * recording a clip the API transcribes ("recorder"), or not at all.
 *
 * Brave is sent straight to "recorder": it exposes SpeechRecognition, so the
 * button showed, but every attempt failed with `network` — the API without
 * the speech service behind it. Firefox has no SpeechRecognition and also
 * records.
 */
export type DictationMode = "browser" | "recorder";

export function chooseDictationMode(globalObject: unknown): DictationMode | null {
  if (typeof globalObject !== "object" || globalObject === null) return null;
  const brave = (globalObject as { navigator?: { brave?: unknown } }).navigator?.brave !== undefined;
  if (speechRecognitionCtor(globalObject) !== null && !brave) return "browser";
  return canRecord(globalObject) ? "recorder" : null;
}

/** Can this browser record a clip for /api/transcribe? */
export function canRecord(globalObject: unknown): boolean {
  if (typeof globalObject !== "object" || globalObject === null) return false;
  const g = globalObject as {
    navigator?: { mediaDevices?: { getUserMedia?: unknown } };
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
  };
  return (
    typeof g.navigator?.mediaDevices?.getUserMedia === "function" &&
    (typeof g.AudioContext === "function" || typeof g.webkitAudioContext === "function")
  );
}

/** The longest clip the recorder keeps; the API refuses much beyond this. */
export const MAX_DICTATION_MS = 45_000;

/** The sample rate recordings are made at: plenty for speech, small to send. */
export const DICTATION_SAMPLE_RATE = 16_000;

/**
 * Samples recorded at the device's own rate, averaged down to `toRate`.
 *
 * Recording AT 16 kHz is not portable — Firefox refuses to connect a
 * microphone to an AudioContext of a different rate — so the clip is taken at
 * the native rate (usually 44.1 or 48 kHz) and reduced here. Averaging each
 * window is a crude low-pass, which is enough for speech.
 */
export function downsample(chunks: readonly Float32Array[], fromRate: number, toRate: number): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const input = new Float32Array(total);
  let at = 0;
  for (const chunk of chunks) {
    input.set(chunk, at);
    at += chunk.length;
  }
  if (fromRate <= toRate) return input;
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.floor(total / ratio));
  for (let i = 0; i < output.length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(total, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j] ?? 0;
    output[i] = end > start ? sum / (end - start) : 0;
  }
  return output;
}

/**
 * Is this clip silence — a muted, dead or not-yet-started microphone?
 *
 * Measured, not guessed: a real voice through a laptop mic peaks well above
 * 0.02 of full scale; the silent clip that exposed this was exactly 0.
 * Background hiss sits below the threshold, so it is refused too.
 */
export const SILENCE_PEAK = 0.02;

export function isSilent(samples: Float32Array): boolean {
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i] ?? 0) >= SILENCE_PEAK) return false;
  }
  return true;
}

/**
 * 16-bit mono PCM WAV from Float32 sample chunks.
 *
 * WAV because it is the one format every browser can produce by hand and the
 * transcription model is documented to accept; MediaRecorder's output varies
 * by browser (webm, ogg, mp4) and not all of it is.
 */
export function encodeWav(chunks: readonly Float32Array[], sampleRate: number): Uint8Array<ArrayBuffer> {
  const samples = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, chunk[i] ?? 0));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}
