"use client";

/**
 * The React side of dictation: two ways to turn speech into composer text.
 *
 *   browser   the browser's own SpeechRecognition (Chrome, Edge, Safari):
 *             free, nothing leaves through this app.
 *   recorder  record a WAV clip and let POST /api/transcribe write it down
 *             (Brave, Firefox, or any browser whose speech service fails).
 *             One Gemini request per clip.
 *
 * Brave is why `recorder` exists: it exposes SpeechRecognition, so the button
 * appeared, but every attempt failed with `network` — the API with no speech
 * service behind it — and the page said "needs a network connection". A
 * `network` failure in any browser now switches to `recorder` for the rest of
 * the page's life.
 *
 * Kept out of `conversation.tsx` so the composer keeps reading as a form, and
 * out of `dictation.ts` so that module stays free of React and testable in
 * Node. All decisions live there; this owns only the objects' lifetimes.
 *
 * The mode comes from `useSyncExternalStore` with a SERVER SNAPSHOT OF null,
 * the same idiom `useReaderNow` uses for the clock in conversation.tsx: the
 * static HTML has no button, and it appears on hydration.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiFetch } from "../lib/session";
import {
  DICTATION_SAMPLE_RATE,
  MAX_DICTATION_MS,
  appendTranscript,
  canRecord,
  chooseDictationMode,
  dictationErrorMessage,
  downsample,
  encodeWav,
  finalTranscript,
  isSilent,
  speechRecognitionCtor,
  type SpeechRecognitionLike,
} from "./dictation";

export interface Dictation {
  /** Whether to render the button at all. */
  readonly supported: boolean;
  readonly listening: boolean;
  /** A recorded clip is being turned into text. */
  readonly transcribing: boolean;
  /** Start listening, or stop if already listening. */
  readonly toggle: () => void;
  /** Stop and discard — used when the turn is sent. */
  readonly stop: () => void;
}

const HEARD_NOTHING = "I didn't catch anything — press the mic and try again.";
const SILENT_MIC =
  "I couldn't hear any sound. Check that the right microphone is selected and not muted, then try again.";

interface Recording {
  readonly stream: MediaStream;
  readonly context: AudioContext;
  readonly processor: ScriptProcessorNode;
  readonly chunks: Float32Array[];
  readonly timer: ReturnType<typeof setTimeout>;
}

export function useDictation(options: {
  onTranscript: (append: (existing: string) => string) => void;
  onError: (message: string) => void;
}): Dictation {
  const detected = useSyncExternalStore(
    // Support cannot change while the page is open, so there is nothing to
    // subscribe to — the unsubscribe function is the whole contract.
    () => () => {},
    () => chooseDictationMode(globalThis),
    () => null,
  );
  // Set when the browser's own service fails with `network`.
  const [forcedRecorder, setForcedRecorder] = useState(false);
  const mode = forcedRecorder ? "recorder" : detected;
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const recording = useRef<Recording | null>(null);
  // Per press, for the browser path: did a result or a reported error arrive?
  const heard = useRef(false);
  const errored = useRef(false);

  // The callbacks live in a ref so the recognition object is built once and
  // still calls today's handlers. Written in an effect, never during render.
  const handlers = useRef(options);
  useEffect(() => {
    handlers.current = options;
  });

  // ---- browser mode: one SpeechRecognition object for the page ------------
  useEffect(() => {
    if (detected !== "browser") return;
    const Ctor = speechRecognitionCtor(globalThis);
    if (!Ctor) return;

    const instance = new Ctor();
    // One utterance per press, final results only: this fills a text box.
    instance.continuous = false;
    instance.interimResults = false;
    instance.lang = navigator.language || "en-US";
    instance.onresult = (event) => {
      const text = finalTranscript(event);
      if (text !== "") {
        heard.current = true;
        handlers.current.onTranscript((existing) => appendTranscript(existing, text));
      }
    };
    instance.onerror = (event) => {
      errored.current = true;
      if (event.error === "network" && canRecord(globalThis)) setForcedRecorder(true);
      const message = dictationErrorMessage(event.error);
      if (message) handlers.current.onError(message);
    };
    // `onend` fires however listening stopped, so the flag cannot stick on.
    // Ending with neither words nor an error is a silent miss — say so.
    instance.onend = () => {
      if (!heard.current && !errored.current) handlers.current.onError(HEARD_NOTHING);
      setListening(false);
    };

    recognition.current = instance;
    return () => {
      instance.onresult = null;
      instance.onerror = null;
      instance.onend = null;
      instance.abort();
      recognition.current = null;
    };
  }, [detected]);

  // ---- recorder mode -------------------------------------------------------
  const releaseRecording = useCallback((): Recording | null => {
    const current = recording.current;
    if (!current) return null;
    recording.current = null;
    clearTimeout(current.timer);
    current.processor.onaudioprocess = null;
    current.processor.disconnect();
    current.stream.getTracks().forEach((track) => track.stop());
    void current.context.close();
    return current;
  }, []);

  const finishRecording = useCallback(async () => {
    const done = releaseRecording();
    setListening(false);
    if (!done) return;
    const samples = downsample(done.chunks, done.context.sampleRate, DICTATION_SAMPLE_RATE);
    if (samples.length < DICTATION_SAMPLE_RATE * 0.3) {
      handlers.current.onError(HEARD_NOTHING);
      return;
    }
    // NEVER SEND SILENCE. Given a silent clip the model does not say "no
    // speech" — it writes a plausible sentence ("Remind me to buy eggs."), a
    // different one each time. A muted or dead microphone stops here.
    if (isSilent(samples)) {
      handlers.current.onError(SILENT_MIC);
      return;
    }
    setTranscribing(true);
    try {
      const response = await apiFetch("/api/transcribe", {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: encodeWav([samples], DICTATION_SAMPLE_RATE),
      });
      const body = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!response.ok) {
        handlers.current.onError(body?.error ?? `Voice input failed (${response.status}). You can type instead.`);
        return;
      }
      const text = body?.text?.trim() ?? "";
      if (text === "") handlers.current.onError(HEARD_NOTHING);
      else handlers.current.onTranscript((existing) => appendTranscript(existing, text));
    } catch (error: unknown) {
      handlers.current.onError(error instanceof Error ? error.message : "Voice input failed. You can type instead.");
    } finally {
      setTranscribing(false);
    }
  }, [releaseRecording]);

  const startRecording = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (error: unknown) {
      const name = (error as { name?: string }).name;
      handlers.current.onError(
        dictationErrorMessage(name === "NotFoundError" ? "audio-capture" : "not-allowed") ?? HEARD_NOTHING,
      );
      return;
    }
    const Context =
      globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    const context = new Context();
    // A context can start SUSPENDED (autoplay policy), and the await on
    // getUserMedia above can outlive the click that would have allowed it.
    // A suspended context records zeros: the first Brave test uploaded 6.7 s
    // of pure silence, and the model invented a sentence from it.
    if (context.state === "suspended") await context.resume().catch(() => undefined);
    const source = context.createMediaStreamSource(stream);
    // ScriptProcessorNode: deprecated, but present in every browser and
    // needs no separately-served worklet module (which the CSP would have to
    // allow). A clip under a minute is well within what it handles.
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(context.destination);
    recording.current = {
      stream,
      context,
      processor,
      chunks,
      timer: setTimeout(() => void finishRecording(), MAX_DICTATION_MS),
    };
    setListening(true);
  }, [finishRecording]);

  // Release the microphone if the page goes away mid-recording.
  useEffect(() => () => void releaseRecording(), [releaseRecording]);

  // ---- controls --------------------------------------------------------------
  const stop = useCallback(() => {
    recognition.current?.stop();
    releaseRecording();
    setListening(false);
  }, [releaseRecording]);

  const toggle = useCallback(() => {
    if (transcribing) return;
    if (mode === "recorder") {
      if (recording.current) void finishRecording();
      else void startRecording();
      return;
    }
    const instance = recognition.current;
    if (!instance) return;
    if (listening) {
      instance.stop();
      setListening(false);
      return;
    }
    heard.current = false;
    errored.current = false;
    try {
      instance.start();
      setListening(true);
    } catch {
      // `start()` throws if it is already running — treat it as listening.
      setListening(true);
    }
  }, [mode, listening, transcribing, finishRecording, startRecording]);

  return { supported: mode !== null, listening, transcribing, toggle, stop };
}
