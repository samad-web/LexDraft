// =============================================================================
// RefusalMessage — how the engine's legal refusal reads on screen.
//
// A refusal is NOT an error and must not look like one: no red box, no "request
// failed". It reads like a competent junior flagging a problem before you file —
// the reason in plain terms, the arithmetic available if you want it, and the
// fields to correct pointed out. This is the moment the tool proves it knows law.
//
// Deliberately DISTINCT from FormIncompleteMessage (the 422 UI): a legal block
// and an incomplete form are different messages with different tone, and they do
// NOT share a component.
// =============================================================================

import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { EngineRefusal } from '@/hooks/useEngineDraft';

interface Props {
  refusal: EngineRefusal;
  /** Human labels for the implicated inbound field keys, for the "check…" line. */
  fieldLabels?: Record<string, string>;
  /** Highlight the implicated fields in the form. */
  onHighlightFields?: (fields: string[]) => void;
}

/** Turn an inbound field key/path into something an advocate reads. */
function humanField(key: string, labels?: Record<string, string>): string {
  if (labels?.[key]) return labels[key]!;
  // nested path like "cheques[].date" -> "cheque date"
  const cleaned = key.replace(/\[\]/g, '').replace(/[._]/g, ' ').replace(/\bdate\b/, 'date');
  return cleaned;
}

export function RefusalMessage({ refusal, fieldLabels, onHighlightFields }: Props) {
  const [showComputation, setShowComputation] = useState(false);
  const fields = refusal.fields_implicated ?? [];

  return (
    <div className="engine-refusal" role="status" aria-live="polite">
      <div className="engine-refusal__head">
        <span className="engine-refusal__icon" aria-hidden>
          <Icon name="flag" size={18} />
        </span>
        <div>
          <p className="engine-refusal__lead">
            This can’t be filed as it stands. Here’s why.
          </p>
          {/* The engine's exact advocate-facing reason, in plain terms. */}
          <p className="engine-refusal__reason">{refusal.reason}</p>
        </div>
      </div>

      {/* The arithmetic, only if the advocate wants it — a junior showing the
          working when asked, not burying the point in numbers up front. */}
      {refusal.computation && (
        <div className="engine-refusal__computation">
          <button
            type="button"
            className="engine-refusal__link"
            onClick={() => setShowComputation((s) => !s)}
            aria-expanded={showComputation}
          >
            {showComputation ? 'Hide the working' : 'Show the working'}
          </button>
          {showComputation && <pre className="engine-refusal__pre">{refusal.computation}</pre>}
        </div>
      )}

      {/* What to correct — the implicated fields, highlightable in the form. */}
      {fields.length > 0 && (
        <div className="engine-refusal__fields">
          <span>Check{' '}
            {fields.map((f, i) => (
              <span key={f}>
                <button
                  type="button"
                  className="engine-refusal__fieldchip"
                  onClick={() => onHighlightFields?.([f])}
                >
                  {humanField(f, fieldLabels)}
                </button>
                {i < fields.length - 1 ? (i === fields.length - 2 ? ' and ' : ', ') : ''}
              </span>
            ))}
            .
          </span>
          {onHighlightFields && fields.length > 1 && (
            <button
              type="button"
              className="engine-refusal__link"
              onClick={() => onHighlightFields(fields)}
            >
              Highlight all
            </button>
          )}
        </div>
      )}

      {/* A quiet provenance footer — which document rule, for the advocate who
          wants to look it up. Not shouted. */}
      <p className="engine-refusal__foot">
        {refusal.pipeline} · spec {refusal.spec}
        {refusal.remedy_hint && refusal.remedy_hint !== 'none' && (
          <> · suggested next step: {refusal.remedy_hint.replace(/_/g, ' ')}</>
        )}
      </p>
    </div>
  );
}
