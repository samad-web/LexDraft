// =============================================================================
// ReviewBanner — the on-screen "advocate must review before filing" banner.
//
// The engine puts this banner in the .docx; it must ALSO be on screen. If the
// advocate can read a draft in the app with no indication it needs review, the
// banner isn't doing its job. So it sits above the draft, persistent, until the
// advocate explicitly signs off — at which point it clears (server-side sign-off
// records who + when + fact-sheet version; a later fact change makes it stale and
// the banner returns).
// =============================================================================

import { useState } from 'react';
import { Icon } from '@lexdraft/ui';

interface Props {
  /** The banner text from the engine (empty once signed off). */
  bannerText: string;
  /** The table marker, when a figure comes from an unverified table. Distinct
   *  from the review banner — both can show. */
  unverifiedMarker?: string;
  /** Whether this document can be signed off (false while any narrative slot is
   *  unfilled — n/a for s.138, which has none). */
  canSignOff: boolean;
  signingOff?: boolean;
  onSignOff?: () => void;
  /** A sign-off conflict message (e.g. an unfilled slot), if the last attempt
   *  was refused. */
  signOffError?: string | null;
}

export function ReviewBanner({
  bannerText,
  unverifiedMarker,
  canSignOff,
  signingOff,
  onSignOff,
  signOffError,
}: Props) {
  const [confirming, setConfirming] = useState(false);

  // Signed off (banner cleared): show a quiet finalised state instead of nothing,
  // so the advocate can see the document IS final (and re-open review if needed).
  if (!bannerText) {
    return (
      <div className="engine-banner engine-banner--final" role="status">
        <Icon name="check" size={16} aria-hidden />
        <span>Reviewed and signed off — this draft is marked final.</span>
      </div>
    );
  }

  return (
    <div className="engine-banner engine-banner--draft" role="status" aria-live="polite">
      <div className="engine-banner__row">
        <Icon name="eye" size={16} aria-hidden />
        <span className="engine-banner__text">{bannerText}</span>
        {onSignOff && (
          confirming ? (
            <span className="engine-banner__confirm">
              <button
                type="button"
                className="engine-banner__signoff"
                disabled={!canSignOff || signingOff}
                onClick={onSignOff}
              >
                {signingOff ? 'Signing off…' : 'Confirm sign-off'}
              </button>
              <button
                type="button"
                className="engine-banner__cancel"
                onClick={() => setConfirming(false)}
                disabled={signingOff}
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="engine-banner__signoff"
              disabled={!canSignOff}
              onClick={() => setConfirming(true)}
              title={canSignOff ? undefined : 'Complete every drafted paragraph before signing off'}
            >
              Mark reviewed & final
            </button>
          )
        )}
      </div>
      {unverifiedMarker && (
        <div className="engine-banner__marker">
          <Icon name="shield" size={14} aria-hidden />
          <span>{unverifiedMarker}</span>
        </div>
      )}
      {signOffError && <p className="engine-banner__error">{signOffError}</p>}
    </div>
  );
}
