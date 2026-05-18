import { useState, type ReactNode } from 'react';
import { Icon } from '@lexdraft/ui';
import { useCan } from '@/hooks/useFirmAdmin';

interface GatePeekProps {
  /** Feature key from the platform catalog (e.g. 'drafting.ai'). */
  feature: string;
  /** What the user sees when they have access — the live UI. */
  children: ReactNode;
  /** Short marketing copy shown in the upsell dialog. */
  peekTitle: string;
  peekBody: string;
  /** Plan tier that unlocks this feature — appears on the badge ("Practice", "Firm"). */
  unlocksOnPlan?: string;
}

/**
 * Renders the live UI when the user has the feature, and a *visual peek*
 * with a "Pro" badge overlay when they don't. Clicking the peek opens a
 * small upgrade dialog explaining what they'd unlock.
 *
 * Use for features whose mere existence is worth advertising (the AI
 * drafting button, advanced analytics). Use plain <Gate> when the
 * feature shouldn't exist for non-eligible users at all (admin
 * surfaces, billing screens).
 */
export function GatePeek({
  feature,
  children,
  peekTitle,
  peekBody,
  unlocksOnPlan = 'Practice',
}: GatePeekProps) {
  const allowed = useCan(feature);
  const [open, setOpen] = useState(false);

  if (allowed) return <>{children}</>;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        style={{
          position: 'relative',
          opacity: 0.55,
          cursor: 'pointer',
          // Pointer-events disabled on children so the wrapper's onClick wins,
          // but kept on the badge for hover affordance.
        }}
        aria-label={`${peekTitle} — locked, click to learn about upgrading`}
      >
        <div style={{ pointerEvents: 'none' }}>{children}</div>
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--bg-base)',
            background: 'var(--text-primary)',
            borderRadius: 'var(--radius-full)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
          }}
        >
          <Icon name="shield" size={10} /> {unlocksOnPlan}
        </span>
      </div>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="gate-peek-title"
          onClick={() => setOpen(false)}
          className="modal-overlay is-visible"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="modal-shell is-visible"
            style={{ ['--modal-width' as string]: '460px' }}
          >
            <span aria-hidden className="modal-grabber" />
            <div className="col" style={{ alignItems: 'center', gap: 12 }}>
              <span
                aria-hidden
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--bg-surface-2)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-primary)',
                }}
              >
                <Icon name="shield" size={20} />
              </span>
              <h3 id="gate-peek-title" className="display" style={{ fontSize: 20, textAlign: 'center' }}>
                {peekTitle}
              </h3>
              <p className="body-sm muted" style={{ textAlign: 'center', maxWidth: 380 }}>
                {peekBody}
              </p>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--text-tertiary)',
                  marginTop: 4,
                }}
              >
                Available on {unlocksOnPlan}+
              </span>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Maybe later
              </button>
              <a className="btn btn-primary" href="/app/settings#billing">
                See plans
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
