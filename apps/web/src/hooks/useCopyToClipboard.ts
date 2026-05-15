import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Click-to-copy state machine. `copy(text)` writes to the clipboard and
 * flips `copied` to true for ~`feedbackMs` so the UI can flash a
 * confirmation. Auto-resets, so the caller doesn't have to clear it.
 *
 * Falls back to a `document.execCommand` path on browsers that don't
 * expose `navigator.clipboard` (older Safari, non-HTTPS contexts) - the
 * advocate-on-mobile-in-court case really cares.
 */
export function useCopyToClipboard(feedbackMs = 1500): {
  copied: boolean;
  copy: (text: string) => Promise<boolean>;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear on unmount so we don't setState on a torn-down component.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      } else {
        // Legacy fallback. Off-screen textarea + execCommand. Works on
        // older browsers and inside iframes without clipboard permission.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      ok = false;
    }

    if (ok) {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), feedbackMs);
    }
    return ok;
  }, [feedbackMs]);

  return { copied, copy };
}
