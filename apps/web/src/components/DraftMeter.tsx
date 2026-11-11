import { useAiQuota } from '@/hooks/useBilling';

/** Above this many drafts a limit reads as "unlimited" (old free-plan stand-in). */
const UNLIMITED = 100_000;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * "12 of 50 drafts used · resets 1 Dec", with a soft notice from 80%.
 * Shown on the plan page and in the composer, including in the Android app
 * (it has no buy buttons, so the notice never says "upgrade" there).
 */
export function DraftMeter({ compact = false }: { compact?: boolean }) {
  const { data } = useAiQuota();
  if (!data || data.cap <= 0 || data.cap >= UNLIMITED) return null;
  const pct = Math.min(100, Math.round((data.used / data.cap) * 100));
  const near = pct >= 80;
  const label = `${data.used} of ${data.cap} drafts used · resets ${shortDate(data.cycleEnd)}`;
  return (
    <div className={`cm-meter${compact ? ' cm-meter--compact' : ''}`}>
      <div className="cm-meter-row">
        <span>{label}</span>
      </div>
      <div
        className="cm-meter-track"
        role="progressbar"
        aria-label="Drafts used this month"
        aria-valuemin={0}
        aria-valuemax={data.cap}
        aria-valuenow={data.used}
        aria-valuetext={label}
      >
        <span className="cm-meter-fill" style={{ width: `${pct}%` }} />
      </div>
      {near && !compact && (
        <p className="cm-meter-note" role="status">
          {data.used >= data.cap
            ? `Drafting limit reached. It renews on ${shortDate(data.cycleEnd)}.`
            : `You have ${data.remaining} draft${data.remaining === 1 ? '' : 's'} left this month.`}
        </p>
      )}
    </div>
  );
}
