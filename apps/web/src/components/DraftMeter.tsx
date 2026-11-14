import { useCredits } from '@/hooks/useCredits';

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '').replace('.5', '½').replace(/^0½$/, '½'));

/**
 * "42 credits left · 33 of 75 used this month · resets 1 Dec", with a notice
 * at 80% and at 100% of the month's credits. 1 credit = one 400-word page.
 * Shown on the plan page and in the composer, including in the Android app
 * (it has no buy buttons, so the notice never says "upgrade" there).
 */
export function CreditMeter({ compact = false }: { compact?: boolean }) {
  const { data } = useCredits();
  if (!data || data.unlimited) return null;
  const total = data.allowance + data.topup;
  if (total <= 0 && data.balance <= 0) return null;
  const usedPct = data.allowance > 0 ? Math.min(100, Math.round((data.usedThisCycle / data.allowance) * 100)) : 100;
  const reset = data.resetsAt ? ` · resets ${shortDate(data.resetsAt)}` : '';
  const label = `${fmt(data.balance)} credit${data.balance === 1 ? '' : 's'} left · ${fmt(data.usedThisCycle)} of ${fmt(data.allowance)} used this month${reset}`;
  return (
    <div className={`cm-meter${compact ? ' cm-meter--compact' : ''}`}>
      <div className="cm-meter-row">
        <span>{label}</span>
      </div>
      <div
        className="cm-meter-track"
        role="progressbar"
        aria-label="AI credits used this month"
        aria-valuemin={0}
        aria-valuemax={data.allowance}
        aria-valuenow={data.usedThisCycle}
        aria-valuetext={label}
      >
        <span className="cm-meter-fill" style={{ width: `${usedPct}%` }} />
      </div>
      {!compact && usedPct >= 80 && (
        <p className="cm-meter-note" role="status">
          {data.balance <= 0
            ? `Credits finished.${data.resetsAt ? ` They renew on ${shortDate(data.resetsAt)}.` : ''} Drafted pages past your credits stay locked until then.`
            : usedPct >= 100
              ? `This month's credits are used up; ${fmt(data.balance)} Brief Pack credit${data.balance === 1 ? '' : 's'} left.`
              : `${fmt(data.balance)} credit${data.balance === 1 ? '' : 's'} left this month.`}
        </p>
      )}
    </div>
  );
}
