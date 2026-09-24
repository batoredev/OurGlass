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
    case "no-speech":
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it in your browser settings to dictate.";
    case "audio-capture":
      return "No microphone found.";
    case "network":
      return "Dictation needs a network connection.";
    case "language-not-supported":
      return "Dictation is not available for this language.";
    default:
      return "Dictation stopped. You can type instead.";
  }
}
