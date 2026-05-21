import { useEffect, useState } from 'react';

/**
 * Single source of truth for Web Speech support detection.
 *
 * We DO NOT sniff user agents. Some Chromium browsers ship with the Web
 * Speech API disabled (e.g. headless distros, embedded webviews, certain
 * Linux builds), so the only reliable signal is whether the relevant
 * globals are present at runtime.
 *
 * `mic.granted/prompt/denied` mirrors the PermissionStatus state for the
 * `microphone` permission. The Permissions API isn't supported everywhere
 * (notably Safari), so `mic` falls back to 'prompt' there — getUserMedia
 * will surface the real outcome on first request.
 */

export type MicPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

export interface BrowserCapabilities {
  /** SpeechRecognition + SpeechSynthesis both present. */
  speechFullSupport: boolean;
  /** SpeechRecognition specifically (input side). */
  speechToText: boolean;
  /** SpeechSynthesis specifically (output side). */
  textToSpeech: boolean;
  /** Best-guess at whether the browser is the Chrome / Chromium family
   *  that Web Speech actually works well on. The user-facing copy uses
   *  this to nudge Safari/Firefox users into Chrome — but the real
   *  block-or-not decision is driven by `speechFullSupport`. */
  isChromium: boolean;
  mic: MicPermission;
}

function detectChromium(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Chrome, Edge (Chromium), Brave, Arc, Opera all share Chrome/<version> +
  // the (window as any).chrome global. Firefox spoofing aside, this is good
  // enough for the nudge UI.
  return /Chrome\/\d+/.test(ua) && (window as unknown as { chrome?: unknown }).chrome !== undefined;
}

function detectSpeech(): { stt: boolean; tts: boolean } {
  if (typeof window === 'undefined') return { stt: false, tts: false };
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const stt = !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  const tts = typeof window.speechSynthesis !== 'undefined'
    && typeof window.SpeechSynthesisUtterance !== 'undefined';
  return { stt, tts };
}

async function queryMicPermission(): Promise<MicPermission> {
  if (typeof navigator === 'undefined' || !navigator.permissions) return 'unknown';
  try {
    // The Permissions API requires the descriptor be cast — TS lib lacks
    // 'microphone' on PermissionName in some versions.
    const status = await navigator.permissions.query(
      { name: 'microphone' as PermissionName },
    );
    return status.state as MicPermission;
  } catch {
    return 'unknown';
  }
}

export function useBrowserCapabilities(): BrowserCapabilities {
  const [caps, setCaps] = useState<BrowserCapabilities>(() => {
    const speech = detectSpeech();
    return {
      speechFullSupport: speech.stt && speech.tts,
      speechToText: speech.stt,
      textToSpeech: speech.tts,
      isChromium: detectChromium(),
      mic: 'unknown',
    };
  });

  useEffect(() => {
    let cancelled = false;
    void queryMicPermission().then((mic) => {
      if (!cancelled) setCaps((prev) => ({ ...prev, mic }));
    });

    // The mic permission can flip while the page is open (user toggled it
    // in browser settings). Subscribe so the BrowserGate banner updates
    // without a refresh.
    if (typeof navigator !== 'undefined' && navigator.permissions) {
      let handle: PermissionStatus | null = null;
      navigator.permissions
        .query({ name: 'microphone' as PermissionName })
        .then((status) => {
          handle = status;
          status.onchange = (): void => {
            setCaps((prev) => ({ ...prev, mic: status.state as MicPermission }));
          };
        })
        .catch(() => undefined);
      return (): void => {
        cancelled = true;
        if (handle) handle.onchange = null;
      };
    }

    return (): void => { cancelled = true; };
  }, []);

  return caps;
}

// ---- localStorage keys + helpers ------------------------------------------

const TEXT_ONLY_KEY = 'lexdraft.mockArguments.textOnly';

export function getTextOnlyChoice(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(TEXT_ONLY_KEY) === '1';
}

export function setTextOnlyChoice(textOnly: boolean): void {
  if (typeof localStorage === 'undefined') return;
  if (textOnly) localStorage.setItem(TEXT_ONLY_KEY, '1');
  else localStorage.removeItem(TEXT_ONLY_KEY);
}
