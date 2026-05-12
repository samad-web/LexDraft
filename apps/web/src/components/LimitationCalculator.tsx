import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { LimitationCalculation, LimitationFilingType } from '@lexdraft/types';
import {
  useCalculateLimitation,
  useLimitationFilingTypes,
} from '@/hooks/useLimitations';

/**
 * Limitation calculator — pick a filing type, enter the trigger date, get
 * the deadline plus any compound milestones (e.g. NI §138 ladder).
 */
export function LimitationCalculator() {
  const types = useLimitationFilingTypes();
  const calc = useCalculateLimitation();

  const [filingTypeId, setFilingTypeId] = useState<string>('');
  const [triggerDate, setTriggerDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );

  const grouped = useMemo(() => {
    const out = new Map<string, LimitationFilingType[]>();
    for (const t of types.data ?? []) {
      const arr = out.get(t.category) ?? [];
      arr.push(t);
      out.set(t.category, arr);
    }
    return out;
  }, [types.data]);

  const selected = useMemo(
    () => types.data?.find((t) => t.id === filingTypeId),
    [types.data, filingTypeId],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (!filingTypeId || !triggerDate) return;
    calc.mutate({ filingTypeId, triggerDate });
  }

  return (
    <div className="card" style={{ padding: 'var(--space-6, 24px)' }}>
      <div style={{ marginBottom: 'var(--space-4, 16px)' }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Calculator</div>
        <h2 className="heading-md" style={{ margin: 0 }}>Compute a deadline</h2>
        <p className="body-sm muted" style={{ marginTop: 4, maxWidth: 540 }}>
          Pick the cause of action and the trigger date. The calculator returns the statutory deadline,
          any compound milestones, and a citation. Always verify against the bare Act for the specific facts.
        </p>
      </div>

      <form onSubmit={onSubmit} className="row" style={{ gap: 'var(--space-3, 12px)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="col" style={{ flex: '2 1 320px', gap: 6 }}>
          <span className="eyebrow">Filing type</span>
          <select
            value={filingTypeId}
            onChange={(e) => setFilingTypeId(e.target.value)}
            required
            className="input"
            style={selectStyle}
          >
            <option value="">Select a cause of action…</option>
            {Array.from(grouped.entries()).map(([category, items]) => (
              <optgroup key={category} label={category}>
                {items.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="col" style={{ flex: '1 1 200px', gap: 6 }}>
          <span className="eyebrow">{selected?.triggerLabel ?? 'Trigger date'}</span>
          <input
            type="date"
            value={triggerDate}
            onChange={(e) => setTriggerDate(e.target.value)}
            required
            className="input"
            style={selectStyle}
          />
        </label>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={!filingTypeId || !triggerDate || calc.isPending}
        >
          {calc.isPending ? 'Calculating…' : 'Calculate'}
        </button>
      </form>

      {calc.isError && (
        <p style={{ marginTop: 'var(--space-3, 12px)', color: 'var(--danger)' }}>
          Could not calculate. {(calc.error as Error)?.message ?? ''}
        </p>
      )}

      {calc.data && <Result result={calc.data} />}
    </div>
  );
}

function Result({ result }: { result: LimitationCalculation }) {
  const expired = result.daysRemaining < 0;
  const critical = !expired && result.daysRemaining <= 7;
  const warning = !expired && !critical && result.daysRemaining <= 30;

  return (
    <div className="col" style={{ gap: 'var(--space-4, 16px)', marginTop: 'var(--space-5, 20px)' }}>
      <div className="row" style={{ gap: 'var(--space-4, 16px)', flexWrap: 'wrap' }}>
        <Stat
          label="Deadline"
          value={result.deadline}
          mono
        />
        <Stat
          label="Days remaining"
          value={`${result.daysRemaining}d`}
          mono
          tone={expired ? 'danger' : critical ? 'danger' : warning ? 'warning' : 'default'}
        />
        <Stat label="Reference" value={result.filingType.reference} small />
      </div>

      {result.steps.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Milestone</th>
                <th style={{ width: 130 }}>Date</th>
                <th style={{ width: 130, textAlign: 'right' }}>From trigger</th>
              </tr>
            </thead>
            <tbody>
              {result.steps.map((s, i) => (
                <tr key={i}>
                  <td>
                    <div className="col" style={{ gap: 2 }}>
                      <span style={{ fontWeight: 500 }}>{s.label}</span>
                      {s.notes && <span className="body-xs muted">{s.notes}</span>}
                    </div>
                  </td>
                  <td className="mono tabular">{s.date}</td>
                  <td className="mono tabular" style={{ textAlign: 'right' }}>+{s.daysFromTrigger}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(result.warnings.length > 0 || (result.filingType.notes && result.filingType.notes.length > 0)) && (
        <div className="col" style={{ gap: 8 }}>
          {result.warnings.map((w, i) => (
            <Notice key={`w${i}`} tone={/passed/i.test(w) ? 'danger' : 'warning'}>{w}</Notice>
          ))}
          {(result.filingType.notes ?? []).map((n, i) => (
            <Notice key={`n${i}`} tone="info">{n}</Notice>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat(props: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
  tone?: 'default' | 'danger' | 'warning';
}) {
  const colors = {
    default: 'var(--text-primary)',
    danger:  'var(--danger)',
    warning: 'var(--warning)',
  } as const;
  return (
    <div className="col" style={{ gap: 4, minWidth: 140 }}>
      <span className="eyebrow">{props.label}</span>
      <span
        className={props.mono ? 'mono tabular' : ''}
        style={{
          fontSize: props.small ? 14 : 22,
          fontWeight: 600,
          color: colors[props.tone ?? 'default'],
        }}
      >
        {props.value}
      </span>
    </div>
  );
}

function Notice(props: { tone: 'info' | 'warning' | 'danger'; children: React.ReactNode }) {
  const bg = props.tone === 'danger'
    ? 'rgba(220, 38, 38, 0.06)'
    : props.tone === 'warning'
      ? 'rgba(180, 83, 9, 0.06)'
      : 'rgba(37, 99, 235, 0.06)';
  const fg = props.tone === 'danger'
    ? 'var(--danger)'
    : props.tone === 'warning'
      ? 'var(--warning)'
      : 'var(--text-primary)';
  return (
    <div
      className="body-sm"
      style={{
        padding: '8px 12px',
        borderRadius: 6,
        background: bg,
        color: fg,
        border: '1px solid var(--border, transparent)',
      }}
    >
      {props.children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--border, #d4d4d8)',
  borderRadius: 6,
  background: 'var(--card, #fff)',
  color: 'inherit',
  fontSize: 14,
};
