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
  // The free launch plan rides the trial clock (till 1 June 2027); a 14-day
  // trial never runs this long.
  const freePlan = !isDemo && daysLeft > 30;
  const urgency = expired ? 'critical' : daysLeft <= 3 ? 'warn' : 'soft';

  const label = isDemo
    ? expired
      ? 'Your demo session has ended.'
      : daysLeft === 1
        ? 'Your demo session ends today.'
        : `Demo session: ${daysLeft} days remaining.`
    : freePlan
      ? `Free plan · free till ${endsAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.`
    : expired
      ? 'Your 14-day trial has ended.'
      : daysLeft === 1
        ? 'Your trial ends today.'
        : `${daysLeft} days left in your trial.`;

  // Ink strip that joins the sidebar; red only once the trial has ended.
  return (
    <div role={urgency === 'critical' ? 'alert' : 'status'} className={`trial-banner trial-banner--${urgency}`}>
      <span className="trial-banner-label">{label}</span>
      <span className="trial-banner-note">
        {isDemo ? 'Convert to a real account to keep your work.' : freePlan ? 'Upgrade any time to unlock every feature.' : 'Pick a plan any time to keep your work.'}
      </span>
      <button type="button" className="trial-banner-btn" onClick={() => navigate('/app/billing')}>
        {isDemo ? 'Convert' : freePlan ? 'Upgrade' : 'See plans'}
      </button>
    </div>
  );
}
