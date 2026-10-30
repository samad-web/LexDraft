import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { LimitationCalculation, LimitationFilingType } from '@lexdraft/types';
import { Icon } from '@lexdraft/ui';
import {
  useCalculateLimitation,
  useComputeFromRule,
  useLimitationFilingTypes,
  useLimitationRules,
  type ComputeDeadlineResult,
} from '@/hooks/useLimitations';

/**
 * Limitation calculator - pick a filing type, enter the trigger date, get
 * the deadline plus any compound milestones (e.g. NI §138 ladder).
 *
 * Two modes:
 *   - "Filing type" mode (legacy): pick a cause-of-action from the curated
 *     FILING_TYPES catalog. Handles ladder rules (NI §138) and warnings.
 *   - "Matter type" mode (statute-aware, post-0022): pick a matter type from
 *     the rules table; the engine returns the deadline plus the statutory
 *     basis (statute + section) so it can be persisted alongside the row.
 */
type Mode = 'filing' | 'matter';

export function LimitationCalculator() {
  const types = useLimitationFilingTypes();
  const calc = useCalculateLimitation();
  const rules = useLimitationRules();
  const ruleCalc = useComputeFromRule();

  const [mode, setMode] = useState<Mode>('filing');
  const [filingTypeId, setFilingTypeId] = useState<string>('');
  const [matterType, setMatterType] = useState<string>('');
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

  const selectedRule = useMemo(
    () => rules.data?.find((r) => r.matterType === matterType),
    [rules.data, matterType],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (!triggerDate) return;
    if (mode === 'filing') {
      if (!filingTypeId) return;
      calc.mutate({ filingTypeId, triggerDate });
    } else {
      if (!matterType) return;
      ruleCalc.mutate({ matterType, computedFrom: triggerDate });
    }
  }

  return (
    <div className="card ct-calc">
      <div className="ct-card-head" style={{ marginBottom: 16 }}>
        <span className="ct-icon-tile" aria-hidden><Icon name="limitation" size={15} /></span>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
        <div className="ct-eyebrow" style={{ marginBottom: 2 }}>Calculator</div>
        <h2 className="ct-card-title">Compute a deadline</h2>
        <p className="ct-card-sub" style={{ maxWidth: 620 }}>
          Pick the cause of action and the trigger date. The calculator returns the statutory deadline,
          any compound milestones, and a citation. Always verify against the bare Act for the specific facts.
        </p>
        </div>
        <div className="ct-seg" role="tablist" aria-label="Calculate by">
          <button type="button" role="tab" aria-selected={mode === 'filing'} onClick={() => setMode('filing')}>
            By filing type
          </button>
          <button type="button" role="tab" aria-selected={mode === 'matter'} onClick={() => setMode('matter')}>
            By matter type
          </button>
        </div>
      </div>

      <form onSubmit={onSubmit} className="ct-calc-form">
        {mode === 'filing' && (
          <label>
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
        )}

        {mode === 'matter' && (
          <label>
            <span className="eyebrow">Matter type</span>
            <select
              value={matterType}
              onChange={(e) => setMatterType(e.target.value)}
              required
              className="input"
              style={selectStyle}
            >
              <option value="">Select a matter type…</option>
              {(rules.data ?? []).map((r) => (
                <option key={r.matterType} value={r.matterType}>
                  {r.matterType}
                </option>
              ))}
            </select>
            {selectedRule && (
              <span className="body-xs muted" style={{ marginTop: 2 }}>
                Statute: <strong>{selectedRule.statute}</strong> · <span className="mono">{selectedRule.section}</span>
              </span>
            )}
          </label>
        )}

        <label>
          <span className="eyebrow">
            {mode === 'filing'
              ? selected?.triggerLabel ?? 'Trigger date'
              : selectedRule?.computedFrom ?? 'Cause-of-action date'}
          </span>
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
          disabled={
            !triggerDate ||
            (mode === 'filing' ? !filingTypeId || calc.isPending : !matterType || ruleCalc.isPending)
          }
        >
          {(mode === 'filing' ? calc.isPending : ruleCalc.isPending) ? 'Calculating…' : 'Calculate'}
        </button>
      </form>

      {mode === 'filing' && calc.isError && (
        <p className="ct-notice is-danger" style={{ marginTop: 14, marginBottom: 0 }}>
          Could not calculate. {(calc.error as Error)?.message ?? ''}
        </p>
      )}
      {mode === 'matter' && ruleCalc.isError && (
        <p className="ct-notice is-danger" style={{ marginTop: 14, marginBottom: 0 }}>
          Could not calculate. {(ruleCalc.error as Error)?.message ?? ''}
        </p>
      )}

      {mode === 'filing' && calc.data && <Result result={calc.data} />}
      {mode === 'matter' && ruleCalc.data && <RuleResult result={ruleCalc.data} />}
    </div>
  );
}

function RuleResult({ result }: { result: ComputeDeadlineResult }) {
  const expired = result.daysRemaining < 0;
  const critical = !expired && result.daysRemaining <= 7;
  const warning = !expired && !critical && result.daysRemaining <= 30;
  return (
    <div className="ct-calc-result">
      <div className="ct-calc-stats">
        <Stat label="Deadline" value={result.deadline} mono />
        <Stat
          label="Days remaining"
          value={`${result.daysRemaining}d`}
          mono
          tone={expired || critical ? 'danger' : warning ? 'warning' : 'default'}
        />
        <Stat label="Basis" value={`${result.basisStatute}, ${result.basisSection}`} small />
      </div>
      {result.notes && <Notice tone="info">{result.notes}</Notice>}
      {expired && <Notice tone="danger">This deadline has already passed. Consider whether condonation under §5 of the Limitation Act is available.</Notice>}
      {!expired && critical && <Notice tone="warning">Deadline is within 7 days - file urgently.</Notice>}
    </div>
  );
}

function Result({ result }: { result: LimitationCalculation }) {
  const expired = result.daysRemaining < 0;
  const critical = !expired && result.daysRemaining <= 7;
  const warning = !expired && !critical && result.daysRemaining <= 30;

  return (
    <div className="ct-calc-result">
      <div className="ct-calc-stats">
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
        <div className="ct-steps">
          {result.steps.map((s, i) => (
            <div key={i} className="ct-step">
              <div className="col" style={{ gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 500, fontSize: 13.5 }}>{s.label}</span>
                {s.notes && <span className="body-xs muted">{s.notes}</span>}
              </div>
              <span className="ct-step-d">{s.date}</span>
              <span className="ct-step-n">+{s.daysFromTrigger}d</span>
            </div>
          ))}
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
  const tone = props.tone === 'danger' ? ' is-critical' : props.tone === 'warning' ? ' is-warning' : '';
  return (
    <div className={`ct-calc-stat${tone}`}>
      <span className="ct-eyebrow">{props.label}</span>
      <span className={`ct-calc-stat-v${props.small ? ' is-small' : ''}`}>{props.value}</span>
    </div>
  );
}

function Notice(props: { tone: 'info' | 'warning' | 'danger'; children: React.ReactNode }) {
  return (
    <div className={`ct-notice${props.tone === 'info' ? '' : ` is-${props.tone}`}`} role={props.tone === 'danger' ? 'alert' : undefined}>
      {props.children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {};
