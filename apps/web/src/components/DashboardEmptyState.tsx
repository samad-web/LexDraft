import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';

/**
 * Empty-state coaching panel for the three dashboard views (Solo, Practice,
 * Firm). Shows a checklist of high-leverage onboarding steps so a fresh tenant
 * has somewhere to start instead of a sea of zeros.
 *
 * Completion is derived from current data (entity counts) — never persisted
 * server-side. Once a tenant has even one of {client, matter, hearing, doc}
 * the panel hides entirely, so this is a *first-run* affordance, not a
 * permanent checklist.
 *
 * A "Dismiss for this session" link sets a sessionStorage flag so the panel
 * stays out of the way for the rest of the tab's lifetime; signing in again
 * (or opening a new tab) brings it back if the dashboard is still empty.
 */

export type DashboardEmptyStatePlan = 'Solo' | 'Practice' | 'Firm';

export interface DashboardEmptyStateStep {
  /** Short imperative — "Add your first client". */
  label: string;
  /** Sub-line shown under the label. Optional. */
  hint?: string;
  /** Destination route, e.g. "/app/clients". */
  link: string;
  /** Visible label for the action link. Defaults to "Open". */
  linkLabel?: string;
  /** True when the step's underlying entity has been created. */
  completed: boolean;
  /**
   * When set, replaces the action link with a static muted hint — used for
   * non-admin members who can't perform the action themselves (e.g. "Ask your
   * admin to invite the team").
   */
  disabledHint?: string;
}

interface Props {
  plan: DashboardEmptyStatePlan;
  /** First name of the current user — used in the Solo greeting. */
  firstName?: string;
  /** Firm display name — used in Practice / Firm greetings. */
  firmName?: string;
  steps: DashboardEmptyStateStep[];
}

const SESSION_KEY = 'lexdraft.dashboardEmptyState.dismissed';

export function DashboardEmptyState({ plan, firstName, firmName, steps }: Props) {
  // Session-scoped dismissal: useState seeded from sessionStorage so the panel
  // stays hidden across re-renders + route changes within the same tab.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      return false;
    }
  });

  // Defensive: if the page was opened in a tab where the user previously
  // dismissed the panel and then their dashboard re-emptied (rare — only via
  // bulk deletion), respect the existing flag without overwriting it.
  useEffect(() => {
    if (!dismissed) return;
    try {
      if (window.sessionStorage.getItem(SESSION_KEY) !== '1') {
        window.sessionStorage.setItem(SESSION_KEY, '1');
      }
    } catch {
      // sessionStorage unavailable (private mode / cookies blocked); ignore.
    }
  }, [dismissed]);

  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      window.sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  const completedCount = steps.filter((s) => s.completed).length;
  const totalCount = steps.length;

  const headline =
    plan === 'Solo'
      ? `Welcome to LexDraft${firstName ? `, ${firstName}` : ''}.`
      : plan === 'Practice'
        ? `Welcome to LexDraft Practice tier${firmName ? `, ${firmName}` : ''}.`
        : `Welcome to LexDraft Firm tier${firmName ? `, ${firmName}` : ''}.`;

  const subhead =
    plan === 'Solo'
      ? "Let's get you to your first draft."
      : plan === 'Practice'
        ? 'Set up your chambers so the team can hit the ground running.'
        : 'A few setup steps unlock your full analytics surface.';

  const footnote =
    plan === 'Solo'
      ? "Each step takes under a minute. Dismiss the checklist whenever you're ready — it'll come back if your dashboard goes empty again."
      : 'These steps appear only on a fresh chambers — they disappear once your dashboard starts filling up.';

  return (
    <section
      className="card dashboard-empty-state"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-default)',
        padding: 'var(--space-7)',
        marginBottom: 'var(--space-7)',
      }}
      aria-labelledby="dashboard-empty-headline"
    >
      <div
        className="row dashboard-empty-state-header"
        style={{
          alignItems: 'flex-start',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
          paddingBottom: 'var(--space-5)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="eyebrow"
            style={{ marginBottom: 'var(--space-2)' }}
          >
            Get started · {completedCount} of {totalCount} done
          </div>
          <h2
            id="dashboard-empty-headline"
            className="heading-xl"
            style={{ marginBottom: 'var(--space-2)' }}
          >
            {headline}
          </h2>
          <p
            className="body-md"
            style={{ color: 'var(--text-secondary)', maxWidth: 640 }}
          >
            {subhead}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="dashboard-empty-state-dismiss"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius-sm)',
          }}
          aria-label="Dismiss onboarding checklist for this session"
        >
          Dismiss for this session
        </button>
      </div>

      <ol
        className="col dashboard-empty-state-steps"
        style={{
          gap: 'var(--space-3)',
          listStyle: 'none',
          padding: 0,
          margin: 0,
        }}
      >
        {steps.map((step, i) => (
          <li key={`${step.label}-${i}`}>
            <StepRow index={i + 1} step={step} />
          </li>
        ))}
      </ol>

      <p
        className="body-sm"
        style={{
          marginTop: 'var(--space-6)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-subtle)',
          color: 'var(--text-tertiary)',
        }}
      >
        {footnote}
      </p>

      <style>{`
        @media (max-width: 720px) {
          .dashboard-empty-state { padding: var(--space-5) !important; }
          .dashboard-empty-state-header { flex-direction: column !important; }
          .dashboard-empty-state-header .dashboard-empty-state-dismiss { align-self: flex-start; padding-left: 0 !important; padding-right: 0 !important; }
          .dashboard-empty-state-row { grid-template-columns: 32px 1fr !important; }
          .dashboard-empty-state-row .dashboard-empty-state-action { grid-column: 1 / -1 !important; padding-left: 0 !important; padding-top: var(--space-2) !important; }
        }
        .dashboard-empty-state-dismiss:hover { color: var(--text-primary); }
      `}</style>
    </section>
  );
}

function StepRow({ index, step }: { index: number; step: DashboardEmptyStateStep }) {
  const { label, hint, link, linkLabel, completed, disabledHint } = step;

  return (
    <div
      className="dashboard-empty-state-row"
      style={{
        display: 'grid',
        gridTemplateColumns: '40px 1fr auto',
        alignItems: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-4) var(--space-5)',
        background: completed ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 32,
          height: 32,
          borderRadius: 'var(--radius-full)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          fontWeight: 600,
          background: completed ? 'var(--text-primary)' : 'transparent',
          color: completed ? 'var(--text-inverse)' : 'var(--text-secondary)',
          border: completed ? '1px solid var(--text-primary)' : '1px solid var(--border-default)',
          transition: 'background 150ms, color 150ms, border-color 150ms',
        }}
      >
        {completed ? <Icon name="check" size={14} /> : index}
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          className="heading-sm"
          style={{
            color: completed ? 'var(--text-tertiary)' : 'var(--text-primary)',
            textDecoration: completed ? 'line-through' : 'none',
            textDecorationColor: 'var(--text-disabled)',
            marginBottom: hint ? 2 : 0,
          }}
        >
          {label}
        </div>
        {hint && (
          <div
            className="body-sm"
            style={{ color: completed ? 'var(--text-disabled)' : 'var(--text-secondary)' }}
          >
            {hint}
          </div>
        )}
      </div>

      <div className="dashboard-empty-state-action">
        {disabledHint ? (
          <span
            className="body-sm"
            style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}
          >
            {disabledHint}
          </span>
        ) : (
          <Link
            to={link}
            className="btn btn-sm"
            style={{
              textDecoration: 'none',
              opacity: completed ? 0.85 : 1,
            }}
          >
            {completed ? 'Revisit' : (linkLabel ?? 'Open')}
            <Icon name="arrow" size={12} />
          </Link>
        )}
      </div>
    </div>
  );
}
