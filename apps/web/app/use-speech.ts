"use client";

/**
 * The React side of spoken replies (speech.ts holds the decisions).
 *
 * Whether the browser can speak, and whether the person turned it on, are
 * both read through `useSyncExternalStore` with a server snapshot of false —
 * the same idiom as dictation — so the static HTML renders no toggle and it
 * appears on hydration, without setting state inside an effect.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { loadSpeakPreference, saveSpeakPreference, speak, speechKit } from "./speech";

const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** This visit's choice, when storage cannot remember it. */
let chosen: boolean | null = null;
const enabledSnapshot = () => chosen ?? loadSpeakPreference(storage());
const supportedSnapshot = () => speechKit(globalThis) !== null;
const off = () => false;

export function useSpeech() {
  const supported = useSyncExternalStore(subscribe, supportedSnapshot, off);
  const enabled = useSyncExternalStore(subscribe, enabledSnapshot, off);
  const [speaking, setSpeaking] = useState(false);

  // Leaving the page stops the voice.
  useEffect(() => () => speechKit(globalThis)?.synth.cancel(), []);

  const stop = useCallback(() => {
    speechKit(globalThis)?.synth.cancel();
    setSpeaking(false);
  }, []);

  const setEnabled = useCallback(
    (on: boolean) => {
      chosen = on;
      saveSpeakPreference(storage(), on);
      for (const listener of listeners) listener();
      if (!on) stop();
    },
    [stop],
  );

  /** Reads a reply aloud if the person turned spoken replies on. */
  const say = useCallback(
    (reply: string) => {
      const kit = speechKit(globalThis);
      if (!kit || !enabled) return;
      const lang = typeof navigator === "undefined" ? "en" : navigator.language;
      if (speak(kit, reply, lang, () => setSpeaking(false))) setSpeaking(true);
    },
    [enabled],
  );

  return { supported, enabled, setEnabled, speaking, say, stop };
}
