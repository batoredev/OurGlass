"use client";

/**
 * The React side of dictation: one recognition object, one listening flag.
 *
 * Kept out of `conversation.tsx` so the composer keeps reading as a form, and
 * out of `dictation.ts` so that module stays free of React and testable in
 * Node. All decisions live there; this owns only the object's lifetime.
 *
 * `supported` comes from `useSyncExternalStore` with a SERVER SNAPSHOT OF
 * false, the same idiom `useReaderNow` uses for the clock in
 * conversation.tsx. The server has no `window`, so the button must be absent
 * from the HTML and appear on hydration; React handles that difference here,
 * whereas `setState` in a mount effect would be a cascading render (and the
 * lint rules say so).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  appendTranscript,
  dictationErrorMessage,
  finalTranscript,
  speechRecognitionCtor,
  type SpeechRecognitionLike,
} from "./dictation";

export interface Dictation {
  /** Whether to render the button at all. */
  readonly supported: boolean;
  readonly listening: boolean;
  /** Start listening, or stop if already listening. */
  readonly toggle: () => void;
  /** Stop without waiting for a result — used when the turn is sent. */
  readonly stop: () => void;
}

export function useDictation(options: {
  onTranscript: (append: (existing: string) => string) => void;
  onError: (message: string) => void;
}): Dictation {
  const supported = useSyncExternalStore(
    // Support cannot change while the page is open, so there is nothing to
    // subscribe to — the unsubscribe function is the whole contract.
    () => () => {},
    () => speechRecognitionCtor(globalThis) !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  // The callbacks live in a ref so the recognition object is built once and
  // still calls today's handlers — rebuilding it mid-utterance would drop audio.
  // Written in an effect, never during render.
  const handlers = useRef(options);
  useEffect(() => {
    handlers.current = options;
  });

  useEffect(() => {
    const Ctor = speechRecognitionCtor(globalThis);
    if (!Ctor) return;

    const instance = new Ctor();
    // One utterance per press, final results only: this fills a text box, and
    // continuous listening is out of scope (see dictation.ts).
    instance.continuous = false;
    instance.interimResults = false;
    instance.lang = navigator.language || "en-US";
    instance.onresult = (event) => {
      const text = finalTranscript(event);
      if (text !== "") handlers.current.onTranscript((existing) => appendTranscript(existing, text));
    };
    instance.onerror = (event) => {
      const message = dictationErrorMessage(event.error);
      if (message) handlers.current.onError(message);
    };
    // `onend` fires however listening stopped — result, error, or silence — so
    // the flag cannot be left stuck on.
    instance.onend = () => setListening(false);

    recognition.current = instance;
    return () => {
      instance.onresult = null;
      instance.onerror = null;
      instance.onend = null;
      instance.abort();
      recognition.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognition.current?.stop();
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    const instance = recognition.current;
    if (!instance) return;
    if (listening) {
      instance.stop();
      setListening(false);
      return;
    }
    try {
      instance.start();
      setListening(true);
    } catch {
      // `start()` throws if it is already running — treat it as listening
      // rather than reporting an error the user cannot act on.
      setListening(true);
    }
  }, [listening]);

  return { supported, listening, toggle, stop };
}
