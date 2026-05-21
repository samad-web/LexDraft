import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Wraps the Web Speech API's SpeechRecognition with the lifecycle our
 * Live argument view needs:
 *
 *   - interim transcripts stream in `interim` while the user is speaking,
 *   - the finalised text accumulates into `final` once the engine commits a
 *     phrase (so we keep partial chunks across pauses inside one tap),
 *   - tapping stop returns the combined transcript and resets state for the
 *     next turn,
 *   - interrupt-to-talk (the spec calls this out): another hook (TTS)
 *     subscribes to `onStart` to cut its own playback when the mic opens.
 *
 * The SpeechRecognition object isn't standardised across browsers — Chrome
 * exposes it as `webkitSpeechRecognition`. The hook detects either at
 * construct time and refuses to start when neither is present (the caller
 * should have already checked `useBrowserCapabilities.speechToText`).
 */

/** SpeechRecognitionResult is array-like; index 0 is the most-likely
 *  alternative, and `length` indicates how many alternatives were returned.
 *  We only read index 0. */
interface SpeechResultLike {
  isFinal: boolean;
  length: number;
  [n: number]: { transcript: string; confidence?: number };
}
interface SpeechResultsLike {
  length: number;
  [n: number]: SpeechResultLike;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: { results: SpeechResultsLike; resultIndex?: number }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  /** Audio capture began (mic actually opened). */
  onaudiostart: (() => void) | null;
  /** Audio capture ended. */
  onaudioend: (() => void) | null;
  /** Engine detected speech onset within the captured audio. */
  onspeechstart: (() => void) | null;
  /** Engine considers the speech utterance ended (silence threshold). */
  onspeechend: (() => void) | null;
}

interface CtorLike { new(): SpeechRecognitionLike }

function resolveSpeechRecognition(): CtorLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: CtorLike; webkitSpeechRecognition?: CtorLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechToText {
  /** True while the engine is actively listening. */
  listening: boolean;
  /** True between onaudiostart and onaudioend — i.e. while the OS reports
   *  the microphone is open and streaming audio to the engine. Useful for
   *  surfacing "mic is on" even before any speech is detected. */
  audioActive: boolean;
  /** True between onspeechstart and onspeechend — i.e. when the engine
   *  detected vocal activity in the audio. If audioActive is true but
   *  this stays false, the mic is open but isn't hearing speech (input
   *  device muted, wrong default device, speaking too quietly). */
  speechDetected: boolean;
  /** Final-only transcript accumulated across pauses inside one session. */
  final: string;
  /** Streaming interim transcript — replaces between events, do not append. */
  interim: string;
  /** Combined `(final + ' ' + interim).trim()` for live display. */
  combined: string;
  /** Last error emitted by the engine (`'no-speech' | 'not-allowed' | ...`). */
  error: string | null;
  /** Begin listening. Resolves once the engine has emitted its `start` event. */
  start: (opts?: { lang?: string }) => Promise<void>;
  /** Stop listening and return the captured transcript. Resets `final/interim`. */
  stop: () => Promise<string>;
  /** Hard abort — drops any pending audio without committing partials. */
  cancel: () => void;
  /** Manually clear the accumulated transcript (between sends). */
  reset: () => void;
}

export function useSpeechToText(): UseSpeechToText {
  const [listening, setListening] = useState(false);
  const [audioActive, setAudioActive] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [final, setFinal] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const stopPromiseRef = useRef<{ resolve: (s: string) => void } | null>(null);

  const reset = useCallback((): void => {
    setFinal('');
    setInterim('');
    setError(null);
  }, []);

  const buildRecogniser = useCallback((lang: string): SpeechRecognitionLike | null => {
    const Ctor = resolveSpeechRecognition();
    if (!Ctor) return null;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;
    r.maxAlternatives = 1;
    return r;
  }, []);

  const start = useCallback(async (opts?: { lang?: string }): Promise<void> => {
    if (recogRef.current) return; // already running — caller's no-op
    const r = buildRecogniser(opts?.lang ?? 'en-IN');
    if (!r) {
      setError('Speech recognition not supported in this browser');
      return;
    }
    setError(null);
    setFinal('');
    setInterim('');
    setAudioActive(false);
    setSpeechDetected(false);

    r.onresult = (ev): void => {
      // The engine's `results` list is cumulative across events within one
      // recognition session — results that were finalised in a prior event
      // are STILL in the list with `isFinal=true`. The original
      // implementation iterated all results and APPENDED finals each
      // event, which meant every finalised phrase got re-added on every
      // subsequent event and the on-screen text became
      // "hello hello hello world world…".
      //
      // Fix: rebuild this engine's full transcript from scratch on every
      // event. Since each tap-to-talk starts a fresh recognition
      // instance, the results list represents the entire current tap —
      // assigning the rebuilt string directly is correct and never
      // duplicates.
      let nextFinal = '';
      let nextInterim = '';
      for (let i = 0; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (!result) continue;
        const alt = result[0];
        if (!alt) continue;
        const text = alt.transcript;
        if (result.isFinal) nextFinal += text + ' ';
        else nextInterim += text;
      }
      setFinal(nextFinal.replace(/\s+/g, ' ').trim());
      setInterim(nextInterim.trim());
    };
    r.onerror = (ev): void => {
      // `no-speech` is benign — engines emit it after a long silence and
      // then fire `onend`; we suppress the noisy banner for it. Everything
      // else (`not-allowed`, `service-not-allowed`, `audio-capture`,
      // `network`, `aborted`) IS surfaced so the UI can render a hint.
      if (ev.error !== 'no-speech') setError(ev.error);
    };
    r.onaudiostart  = (): void => { setAudioActive(true); };
    r.onaudioend    = (): void => { setAudioActive(false); };
    r.onspeechstart = (): void => { setSpeechDetected(true); };
    r.onspeechend   = (): void => { setSpeechDetected(false); };
    r.onend = (): void => {
      setListening(false);
      setAudioActive(false);
      setSpeechDetected(false);
      const pending = stopPromiseRef.current;
      stopPromiseRef.current = null;
      // The pending resolver in stop() reads the latest final/interim
      // refs and ignores whatever arg we pass — string here is just to
      // satisfy the signature.
      if (pending) pending.resolve('');
      recogRef.current = null;
    };
    r.onstart = (): void => {
      setListening(true);
    };

    recogRef.current = r;
    try {
      r.start();
    } catch (err) {
      // Some browsers throw if start() is called too soon after a previous
      // stop. Reset and surface a friendly error.
      recogRef.current = null;
      setListening(false);
      setError(err instanceof Error ? err.message : 'Could not start microphone');
    }
  }, [buildRecogniser]);

  // The closure for `stop` reads the latest `final` from a ref-backed
  // accessor. Keeping the closed-over `final` would make stop() return
  // stale text since React state is snapshotted at hook-call time.
  const finalRef = useRef(final);
  const interimRef = useRef(interim);
  useEffect(() => { finalRef.current = final; }, [final]);
  useEffect(() => { interimRef.current = interim; }, [interim]);

  const stop = useCallback(async (): Promise<string> => {
    const r = recogRef.current;
    if (!r) {
      // Already stopped — return the latest snapshot so callers don't have
      // to special-case the rapid-tap path.
      const snapshot = `${finalRef.current} ${interimRef.current}`.replace(/\s+/g, ' ').trim();
      reset();
      return snapshot;
    }
    return new Promise<string>((resolve) => {
      stopPromiseRef.current = { resolve: (): void => {
        const snapshot = `${finalRef.current} ${interimRef.current}`.replace(/\s+/g, ' ').trim();
        reset();
        resolve(snapshot);
      } };
      try { r.stop(); } catch { /* swallow — onend still fires */ }
    });
  }, [reset]);

  const cancel = useCallback((): void => {
    const r = recogRef.current;
    if (r) try { r.abort(); } catch { /* ignore */ }
    recogRef.current = null;
    stopPromiseRef.current = null;
    setListening(false);
    setAudioActive(false);
    setSpeechDetected(false);
    reset();
  }, [reset]);

  // Stop the engine if the component unmounts mid-listen.
  useEffect(() => {
    return (): void => {
      const r = recogRef.current;
      if (r) try { r.abort(); } catch { /* ignore */ }
    };
  }, []);

  const combined = (final + (interim ? ` ${interim}` : '')).replace(/\s+/g, ' ').trim();

  return {
    listening, audioActive, speechDetected,
    final, interim, combined, error,
    start, stop, cancel, reset,
  };
}
