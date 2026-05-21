import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

/**
 * App-wide trial countdown banner. Renders when the signed-in user's firm
 * is on a trial (planStatus='trial' with a trial_ends_at on the clock).
 *
 * Three visual treatments based on urgency:
 *   - > 3 days remaining       → soft, informational ("X days left in trial")
 *   - 1–3 days remaining       → warning chrome ("Trial ends in N days")
 *   - already expired (server  → vermillion ("Trial has ended") — also
 *     bounces 402, so this state should be brief; useful when the local
 *     /me cache is stale.
 *
 * Demo tenants get distinct copy ("Demo session") so the user knows
 * they're in a sandbox.
 */
export function TrialBanner(): JSX.Element | null {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  if (!user || user.planStatus !== 'trial' || !user.trialEndsAt) return null;

  const endsAt = new Date(user.trialEndsAt);
  if (Number.isNaN(endsAt.getTime())) return null;
  const msLeft = endsAt.getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  const expired = msLeft <= 0;

  const isDemo = !!user.isDemo;
  const urgency = expired ? 'critical' : daysLeft <= 3 ? 'warn' : 'soft';

  const palette =
    urgency === 'critical' ? { bg: 'var(--danger-bg, #fff1f1)', fg: 'var(--danger)' }
    : urgency === 'warn'   ? { bg: 'var(--warning-bg, #fff7e6)', fg: 'var(--warning, #b8860b)' }
    :                        { bg: 'var(--bg-surface-2)',        fg: 'var(--text-primary)' };

  const label = isDemo
    ? expired
      ? 'Your demo session has ended.'
      : daysLeft === 1
        ? 'Your demo session ends today.'
        : `Demo session — ${daysLeft} days remaining.`
    : expired
      ? 'Your 14-day trial has ended.'
      : daysLeft === 1
        ? 'Your trial ends today.'
        : `${daysLeft} days left in your trial.`;

  return (
    <div
      role={urgency === 'critical' ? 'alert' : 'status'}
      style={{
        background: palette.bg,
        color: palette.fg,
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 13,
        borderBottom: `1px solid ${palette.fg}`,
      }}
    >
      <span style={{ fontWeight: 500 }}>{label}</span>
      <span className="muted" style={{ color: palette.fg, opacity: 0.85 }}>
        {isDemo ? 'Convert to a real account to keep your work.' : 'Pick a plan any time to keep your work.'}
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => navigate('/app/settings')}
          style={{
            background: 'transparent',
            borderColor: palette.fg,
            color: palette.fg,
          }}
        >
          {isDemo ? 'Convert' : 'See plans'}
        </button>
      </span>
    </div>
  );
}
