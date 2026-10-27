import { Skeleton } from '@lexdraft/ui';
import type { FreePlanSwitchState } from '@lexdraft/types';
import { useFreePlanSwitches, useSetFreePlanSwitch } from '../queries';
import { useUIStore } from '@/store/ui';

// =============================================================================
// Free launch plan - solo advocates and law students use LexDraft free until
// 1 June 2027. Each switch opens or locks a feature group for every free
// account at once (api: lib/free-plan.ts, permissions.service). Paid and
// trialling firms are unaffected.
// =============================================================================

export function FreePlanView() {
  const { data: switches = [], isLoading } = useFreePlanSwitches();
  const setSwitch = useSetFreePlanSwitch();
  const showToast = useUIStore((s) => s.showToast);

  const toggle = (s: FreePlanSwitchState) => {
    setSwitch.mutate(
      { key: s.key, enabled: !s.enabled },
      {
        onSuccess: () => showToast({ type: 'cobalt', text: `${s.label} ${s.enabled ? 'locked' : 'opened'} for free accounts` }),
        onError: (err) => showToast({ type: 'vermillion', text: (err as Error)?.message || 'Couldn’t change the switch' }),
      },
    );
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <header>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Free plan</div>
        <h1 className="display-md">Free launch plan</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 8, maxWidth: 640, lineHeight: 1.55 }}>
          Solo advocates and law students are free until 1 June 2027, with unlimited AI drafting and 1 GB of
          file storage. Law firms get a 14-day trial of every feature. These switches open or lock a feature
          for every free account at once; the change applies within a minute.
        </p>
      </header>

      <section className="card" style={{ padding: 24 }}>
        <h2 className="heading-lg" style={{ marginBottom: 16 }}>Features on the free plan</h2>
        <div className="col" style={{ gap: 10 }}>
          {isLoading
            ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={56} />)
            : switches.map((s) => (
              <div
                key={s.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '12px 14px',
                  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{s.label}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{s.description}</div>
                </div>
                <span className="badge mono" style={{ fontSize: 9 }}>{s.enabled ? 'OPEN' : 'LOCKED'}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.enabled}
                  aria-label={`${s.label} for free accounts`}
                  className="btn btn-sm"
                  style={{ minWidth: 92 }}
                  disabled={setSwitch.isPending}
                  onClick={() => toggle(s)}
                >
                  {s.enabled ? 'Lock' : 'Open'}
                </button>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
