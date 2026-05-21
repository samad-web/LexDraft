import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import {
  setTextOnlyChoice,
  type BrowserCapabilities,
} from '@/hooks/useBrowserCapabilities';

/**
 * Shown above the landing CTA when the user's browser can't (or shouldn't)
 * run the voice flow. Three cases:
 *
 *   1. No Web Speech support — block voice entirely, offer "Continue in
 *      text-only mode" + a link to copy in Chrome.
 *   2. Chrome / Chromium but mic permission previously denied — smaller
 *      banner explaining how to re-enable it.
 *   3. Everything works — render nothing.
 *
 * The text-only opt-out is persisted in localStorage; once set, this gate
 * stops appearing for the user so the landing isn't nagging them every visit.
 */

interface BrowserGateProps {
  caps: BrowserCapabilities;
  /** Caller hides the gate after the user accepts text-only mode. */
  onTextOnly: () => void;
}

export function BrowserGate({ caps, onTextOnly }: BrowserGateProps): JSX.Element | null {
  const [copied, setCopied] = useState(false);

  // Mic-denied banner only fires when Web Speech IS supported — otherwise
  // the user is going to text-only anyway and the denial is irrelevant.
  if (caps.speechFullSupport && caps.mic === 'denied') {
    return (
      <div className="card" style={{
        padding: 16, display: 'flex', flexDirection: 'column', gap: 8,
        background: 'var(--surface-2, rgba(0,0,0,0.04))', borderLeft: '3px solid var(--amber, #c79100)',
      }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="bell" />
          <strong>Microphone access is blocked.</strong>
        </div>
        <div style={{ fontSize: 13 }}>
          To enable voice mode, click the lock icon in the address bar →{' '}
          <em>Site settings</em> → set <em>Microphone</em> to <em>Allow</em>, then refresh.
          You can keep using text-only in the meantime.
        </div>
      </div>
    );
  }

  // The big block: missing Web Speech support entirely.
  if (!caps.speechFullSupport) {
    const copyLink = async (): Promise<void> => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // Clipboard blocked — fall through silently; the URL is still in
        // the address bar.
      }
    };
    return (
      <div className="card" style={{
        padding: 20, display: 'flex', flexDirection: 'column', gap: 12,
        borderLeft: '3px solid var(--cobalt, #2855c4)',
      }}>
        <h3 style={{ margin: 0 }}>Mock Arguments works best in Chrome</h3>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          Voice recognition and AI voice replies need Chrome's Web Speech API.
          Open this page in Chrome (or any Chromium-based browser with Web
          Speech enabled — Edge, Brave, Arc) for the full courtroom experience.
          You can still practice typing-only here.
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => { void copyLink(); }}>
            <Icon name="upload" />
            {copied ? 'Link copied' : 'Copy link & open in Chrome'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setTextOnlyChoice(true);
              onTextOnly();
            }}
          >
            Continue in text-only mode
          </button>
        </div>
      </div>
    );
  }

  return null;
}
