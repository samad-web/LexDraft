import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal Web Speech API surface — progressive enhancement. Browsers that lack
// it report `supported: false` and the hook no-ops.
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: {
    resultIndex?: number;
    results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
  }) => void) | null;
  onerror: ((e?: { error?: string }) => void) | null;
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
  /** Start dictating; `onResult` fires with each finished phrase until `stop()`. */
  start: (onResult: (text: string) => void) => void;
  stop: () => void;
  /** Start if idle, stop if already listening. */
  toggle: (onResult: (text: string) => void) => void;
}

/**
 * Shared voice-dictation hook (used by the Diary assistant bar, the Draft
 * panels, case notes and the new-case form). One active session at a time.
 * Defaults to the en-IN locale, which suits Indian-English legal dictation.
 *
 * Manual stop only: recognition runs in continuous mode and, because browsers
 * still end a session on their own after a pause or a network blip, it is
 * restarted automatically until the advocate taps stop. Each finished phrase
 * is delivered as it is recognised, so text appears while they keep talking.
 */
export function useDictation(lang = 'en-IN'): Dictation {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // True while the advocate wants to keep listening; cleared only by stop().
  const wantRef = useRef(false);
  const supported = getRecognitionCtor() !== null;

  const stop = useCallback(() => {
    wantRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    setListening(false);
    try { rec?.stop(); } catch { /* already stopped */ }
  }, []);

  // Stop any in-flight recognition when the consumer unmounts.
  useEffect(() => () => {
    wantRef.current = false;
    try { recRef.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const start = useCallback(
    (onResult: (text: string) => void) => {
      const Ctor = getRecognitionCtor();
      if (!Ctor) return;
      // Only one session at a time - end any previous one first.
      stop();
      wantRef.current = true;

      const launch = () => {
        const rec = new Ctor();
        rec.lang = lang;
        rec.interimResults = false;
        rec.continuous = true;
        rec.onresult = (ev) => {
          for (let i = ev.resultIndex ?? 0; i < ev.results.length; i += 1) {
            const r = ev.results[i];
            if (!r || r.isFinal === false) continue;
            const transcript = (r[0]?.transcript ?? '').trim();
            if (transcript) onResult(transcript);
          }
        };
        rec.onerror = (e) => {
          // Mic permission refused / no mic: restarting would loop forever.
          if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed' || e?.error === 'audio-capture') {
            wantRef.current = false;
          }
        };
        rec.onend = () => {
          if (recRef.current !== rec) return; // superseded or stopped
          if (wantRef.current) {
            // The browser ended the session on its own (silence, timeout) -
            // pick straight back up so only the advocate's tap stops it.
            try { launch(); } catch { stop(); }
            return;
          }
          recRef.current = null;
          setListening(false);
        };
        recRef.current = rec;
        rec.start();
      };

      setListening(true);
      try {
        launch();
      } catch {
        stop();
      }
    },
    [lang, stop],
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
