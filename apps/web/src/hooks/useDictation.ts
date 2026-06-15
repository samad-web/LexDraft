import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal Web Speech API surface — progressive enhancement. Browsers that lack
// it report `supported: false` and the hook no-ops.
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface Dictation {
  supported: boolean;
  listening: boolean;
  /** Start a one-shot dictation; `onResult` fires with the final transcript. */
  start: (onResult: (text: string) => void) => void;
  stop: () => void;
  /** Start if idle, stop if already listening. */
  toggle: (onResult: (text: string) => void) => void;
}

/**
 * Shared voice-dictation hook (used by the Diary assistant bar and the Draft
 * prompt/missing-field panels). One active session at a time. Defaults to the
 * en-IN locale, which suits Indian-English legal dictation.
 */
export function useDictation(lang = 'en-IN'): Dictation {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = getRecognitionCtor() !== null;

  // Stop any in-flight recognition when the consumer unmounts.
  useEffect(() => () => recRef.current?.stop(), []);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(
    (onResult: (text: string) => void) => {
      const Ctor = getRecognitionCtor();
      if (!Ctor) return;
      const rec = new Ctor();
      rec.lang = lang;
      rec.interimResults = false;
      rec.continuous = false;
      rec.onresult = (ev) => {
        const transcript = ev.results?.[0]?.[0]?.transcript ?? '';
        if (transcript) onResult(transcript);
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      recRef.current = rec;
      setListening(true);
      try {
        rec.start();
      } catch {
        setListening(false);
      }
    },
    [lang],
  );

  const toggle = useCallback(
    (onResult: (text: string) => void) => {
      if (listening) {
        stop();
        return;
      }
      start(onResult);
    },
    [listening, start, stop],
  );

  return { supported, listening, start, stop, toggle };
}
