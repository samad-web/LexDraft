import { useNavigate } from 'react-router-dom';
import type { CreditBalance } from '@lexdraft/types';
import { useCredits } from '@/hooks/useCredits';
import { useAuthStore } from '@/store/auth';
import { isNativeApp } from '@/lib/google';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '').replace('.5', '½').replace(/^0½$/, '½'));

/** Low / out-of-credits warning (credits-not-pages.md): <= 20% of the month's
 *  credits left, or none. Same levels as the server's bell + WhatsApp alerts. */
export function creditsWarning(b: CreditBalance | undefined): { level: '20' | '0'; text: string } | null {
  if (!b || b.unlimited) return null;
  if (b.allowance <= 0 && b.topup <= 0 && b.balance <= 0) return null; // no plan yet: not a "low" state
  if (b.balance <= 0) return { level: '0', text: 'Your AI credits are over.' };
  if (b.allowance > 0 && b.balance <= b.allowance * 0.2) {
    return { level: '20', text: `AI credits running low: ${fmt(b.balance)} left this month.` };
  }
  return null;
}

/** App-wide banner. Website: "Buy credits". Android app: the fact only (Play payments policy). */
export function CreditsLowBanner(): JSX.Element | null {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { data } = useCredits();
  const w = user ? creditsWarning(data) : null;
  if (!w) return null;
  const native = isNativeApp();
  return (
    <div role={w.level === '0' ? 'alert' : 'status'} className={`trial-banner trial-banner--${w.level === '0' ? 'critical' : 'warn'}`}>
      <span className="trial-banner-label">{w.text}</span>
      {!native && (<>
        <span className="trial-banner-note">{w.level === '0' ? 'Buy credits to keep drafting.' : 'Buy credits now to avoid a break.'}</span>
        <button type="button" className="trial-banner-btn" onClick={() => navigate('/app/billing')}>Buy credits</button>
      </>)}
    </div>
  );
}
