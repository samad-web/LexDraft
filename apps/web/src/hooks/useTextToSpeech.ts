import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Streaming-friendly Text-to-Speech wrapper around SpeechSynthesis.
 *
 * The AI turn arrives token-by-token, but `speechSynthesis.speak()` only
 * accepts complete utterances. The hook batches incoming text into
 * sentence-sized chunks (split on . ! ? ; followed by whitespace) and
 * enqueues each one as a separate SpeechSynthesisUtterance — that way the
 * voice keeps speaking smoothly without waiting for the LLM to finish.
 *
 * Public surface:
 *
 *   - `append(chunk)`  push a token-stream delta; the hook decides when to
 *                       flush a complete sentence to the synth engine.
 *   - `flush()`        force-speak any buffered fragment that hasn't been
 *                       sentence-terminated (call when the stream is done).
 *   - `pause/resume/skip`  user controls.
 *   - `cancelAll()`    nuke the queue immediately — used by the mic's
 *                       interrupt-to-talk path.
 *
 * No-op when `speechSynthesis` is unavailable; consumers should still
 * render the UI (no error) since the text view continues to work.
 */

export interface UseTextToSpeech {
  speaking: boolean;
  paused: boolean;
  supported: boolean;
  /** True when a system voice exists for the requested `lang` (exact or
   *  same-base match). False means the engine has no real voice for this
   *  locale; on most platforms it will silently skip non-ASCII glyphs and
   *  only voice the digits/punctuation — which sounds like the AI is
   *  reading out "260/242" instead of the actual sentence. Callers
   *  should suppress TTS when this is false and surface a notice. */
  voiceAvailable: boolean;
  append: (chunk: string) => void;
  flush: () => void;
  pause: () => void;
  resume: () => void;
  /** Skip the currently-spoken utterance, continue with the next queued one. */
  skip: () => void;
  /** Hard-cancel everything — used by mic interrupt. */
  cancelAll: () => void;
}

// Browsers vary on how aggressively they boundary-detect long utterances.
// Hard cap each utterance at ~280 chars so the engine doesn't garble mid
// sentence on Safari / older Chrome.
const MAX_UTTERANCE_CHARS = 280;

// Sentence terminator followed by whitespace OR end-of-string. We also
// flush on `;` since the AI tends to use it as a phrase break.
const SENTENCE_END = /([.!?;]+["')\]]*)\s+/g;

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  // Two-tier preference walk:
  //   1. exact BCP-47 match ('ta-IN' → Tamil-India voice)
  //   2. same primary subtag, any region ('ta-LK' Tamil-Sri-Lanka also fine)
  // We intentionally do NOT fall back to an English voice when no match
  // exists. Assigning an en-IN voice while the text is in Tamil/Hindi
  // forces the engine to phonemise the foreign script as English —
  // returns an unintelligible garble. Returning null instead lets
  // enqueueSentence leave utterance.voice unset; the engine then picks
  // based on utterance.lang, which on modern platforms can resolve to a
  // server-side or default-OS voice for the target locale.
  const exact = voices.find((v) => v.lang === lang);
  if (exact) return exact;
  const baseTag = lang.split(/[-_]/)[0]!.toLowerCase();
  const sameBase = voices.find((v) => v.lang.split(/[-_]/)[0]!.toLowerCase() === baseTag);
  if (sameBase) return sameBase;
  return null;
}

export function useTextToSpeech(opts?: { lang?: string }): UseTextToSpeech {
  const lang = opts?.lang ?? 'en-IN';
  const [voiceAvailable, setVoiceAvailable] = useState<boolean>(false);
  const supported = typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);

  const bufferRef = useRef<string>('');
  const queueRef = useRef<SpeechSynthesisUtterance[]>([]);
  const playingRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Voices load asynchronously on first page load. Refresh the pick when
  // the engine fires `voiceschanged`, and again when `lang` changes so
  // mid-session language switches re-pick the matching voice.
  useEffect(() => {
    if (!supported) return;
    const refresh = (): void => {
      const v = pickVoice(lang);
      voiceRef.current = v;
      setVoiceAvailable(v != null);
    };
    refresh();
    speechSynthesis.addEventListener('voiceschanged', refresh);
    return (): void => speechSynthesis.removeEventListener('voiceschanged', refresh);
  }, [supported, lang]);

  // Cancel any in-flight utterances on unmount so the voice doesn't keep
  // talking after the Live view closes.
  useEffect(() => {
    return (): void => {
      if (supported) try { speechSynthesis.cancel(); } catch { /* ignore */ }
    };
  }, [supported]);

  const playNext = useCallback((): void => {
    if (!supported) return;
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setSpeaking(false);
      return;
    }
    playingRef.current = next;
    setSpeaking(true);
    speechSynthesis.speak(next);
  }, [supported]);

  const enqueueSentence = useCallback((sentence: string): void => {
    if (!supported) return;
    const trimmed = sentence.trim();
    if (!trimmed) return;
    const utterance = new SpeechSynthesisUtterance(trimmed);
    // Always set utterance.lang. Chrome's SpeechSynthesis derives its
    // phoneme set from this property even when a voice is assigned —
    // without it, Tamil/Hindi/etc. text gets pronounced as English and
    // comes out as gibberish. Set it BEFORE voice so engines that key
    // off lang internally see the correct locale.
    utterance.lang = lang;
    // Only assign a voice when pickVoice found a real match for the
    // language. If it returned null, leaving voice unset lets the
    // engine pick based on lang (often a built-in OS voice for the
    // locale, or a server-side fallback on Edge/Chrome).
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.onend = (): void => {
      playingRef.current = null;
      playNext();
    };
    utterance.onerror = (): void => {
      playingRef.current = null;
      playNext();
    };
    queueRef.current.push(utterance);
    playNext();
  }, [playNext, supported, lang]);

  const flushSentences = useCallback((): void => {
    const buf = bufferRef.current;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    SENTENCE_END.lastIndex = 0;
    while ((match = SENTENCE_END.exec(buf)) !== null) {
      const end = match.index + match[0].length;
      enqueueSentence(buf.slice(lastIndex, end));
      lastIndex = end;
    }
    // Also flush if the buffer grew past MAX_UTTERANCE_CHARS without a
    // terminator — better an arbitrary break than silence.
    if (buf.length - lastIndex > MAX_UTTERANCE_CHARS) {
      const cutAt = buf.lastIndexOf(' ', lastIndex + MAX_UTTERANCE_CHARS);
      const breakAt = cutAt > lastIndex ? cutAt : lastIndex + MAX_UTTERANCE_CHARS;
      enqueueSentence(buf.slice(lastIndex, breakAt));
      lastIndex = breakAt;
    }
    bufferRef.current = buf.slice(lastIndex);
  }, [enqueueSentence]);

  const append = useCallback((chunk: string): void => {
    if (!supported || !chunk) return;
    bufferRef.current += chunk;
    flushSentences();
  }, [flushSentences, supported]);

  const flush = useCallback((): void => {
    if (!supported) return;
    const tail = bufferRef.current.trim();
    if (tail) enqueueSentence(tail);
    bufferRef.current = '';
  }, [enqueueSentence, supported]);

  const pause = useCallback((): void => {
    if (!supported) return;
    try { speechSynthesis.pause(); setPaused(true); } catch { /* ignore */ }
  }, [supported]);

  const resume = useCallback((): void => {
    if (!supported) return;
    try { speechSynthesis.resume(); setPaused(false); } catch { /* ignore */ }
  }, [supported]);

  const skip = useCallback((): void => {
    if (!supported) return;
    // Cancel only the active utterance. The next one in `queueRef` starts
    // via the `onend` chain — except cancel() drops both, so we re-enqueue
    // any remaining ones after a tick.
    const remaining = [...queueRef.current];
    queueRef.current = [];
    playingRef.current = null;
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
    setSpeaking(false);
    setPaused(false);
    queueRef.current = remaining;
    playNext();
  }, [playNext, supported]);

  const cancelAll = useCallback((): void => {
    if (!supported) return;
    queueRef.current = [];
    playingRef.current = null;
    bufferRef.current = '';
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
    setSpeaking(false);
    setPaused(false);
  }, [supported]);

  return { speaking, paused, supported, voiceAvailable, append, flush, pause, resume, skip, cancelAll };
}
