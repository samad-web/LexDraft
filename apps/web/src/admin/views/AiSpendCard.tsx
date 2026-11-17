import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminAiSpend } from '@lexdraft/types';
import { api } from '@/lib/api';
import { useUIStore } from '@/store/ui';

const KEY = ['admin', 'ai-spend'] as const;
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * AI spend guard (admin-ai-spend-guard.md): month-to-date spend vs budget,
 * alerts, and the platform AI pause. Top-ups stay in the Anthropic Console.
 * `compact` = overview tile without the settings form.
 */
export function AiSpendCard({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const { data, isLoading, isError } = useQuery({ queryKey: KEY, queryFn: () => api.get<AdminAiSpend>('/admin/ai-spend') });
  const [budget, setBudget] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<string | null>(null);
  const [autopause, setAutopause] = useState<boolean | null>(null);

  const save = useMutation({
    mutationFn: (body: { budgetUsd: number | null; alertPcts: number[]; autopause: boolean }) => api.patch<AdminAiSpend>('/admin/ai-spend', body),
    onSuccess: (d) => { qc.setQueryData(KEY, d); setBudget(null); setAlerts(null); setAutopause(null); showToast({ type: 'sage', text: 'AI budget saved' }); },
  });
  const pause = useMutation({
    mutationFn: (body: { paused: boolean; reason: string }) => api.post<AdminAiSpend>('/admin/ai-spend/pause', body),
    onSuccess: (d) => { qc.setQueryData(KEY, d); showToast({ type: 'sage', text: d.paused ? 'AI paused for everyone' : 'AI is on again' }); },
  });

  if (isLoading) return <section className="card" style={{ padding: 24 }} aria-busy="true"><div className="body-sm muted">Loading AI spend…</div></section>;
  if (isError || !data) return <section className="card" style={{ padding: 24 }}><div role="alert" className="body-sm">Could not load AI spend.</div></section>;

  const spent = data.provider ? data.provider.usd : data.estimate.usd;
  const pct = data.usedPct;
  const budgetVal = budget ?? (data.budgetUsd == null ? '' : String(data.budgetUsd));
  const alertsVal = alerts ?? data.alertPcts.join(', ');
  const autoVal = autopause ?? data.autopause;
  const budgetN = budgetVal.trim() === '' ? null : Number(budgetVal);
  const alertList = alertsVal.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
  const valid = (budgetN === null || (Number.isFinite(budgetN) && budgetN > 0)) && alertList.length > 0
    && alertList.length <= 5 && alertList.every((n) => n >= 1 && n <= 200);

  const togglePause = () => {
    const next = !data.paused;
    const reason = window.prompt(next
      ? 'Pause AI for every firm? Advocates will see "AI paused" until you turn it back on. Reason (kept in the audit log):'
      : 'Turn AI back on for everyone? Reason (kept in the audit log):');
    if (reason && reason.trim().length >= 3) pause.mutate({ paused: next, reason: reason.trim() });
  };

  return (
    <section className="card" style={{ padding: 24 }} aria-labelledby="ai-spend-h">
      <div className="row" style={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h2 id="ai-spend-h" className="heading-lg">AI spend this month</h2>
        <span className="spacer" />
        {data.paused && <span className="badge" role="status">AI PAUSED</span>}
      </div>

      <div className="row" style={{ gap: 28, margin: '12px 0 8px', flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">{data.provider ? 'Anthropic bill' : 'DifAi estimate'}</div>
          <div className="mono tabular" style={{ fontSize: 28, fontWeight: 600 }}>{usd(spent)}</div>
          <div className="body-sm muted">
            {data.provider
              ? `as of ${data.provider.asOf ? new Date(data.provider.asOf).toLocaleString('en-IN') : '—'} · estimate ${usd(data.estimate.usd)}`
              : `≈ ₹${data.estimate.inr.toLocaleString('en-IN')} · ${data.providerError ?? ''}`}
          </div>
        </div>
        <div>
          <div className="eyebrow">Budget</div>
          <div className="mono tabular" style={{ fontSize: 28, fontWeight: 600 }}>{data.budgetUsd == null ? '—' : usd(data.budgetUsd)}</div>
          <div className="body-sm muted">{pct == null ? 'No budget set' : `${pct}% used`}</div>
        </div>
      </div>

      {pct != null && (
        <div role="progressbar" aria-label="AI budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct)}
          style={{ height: 8, border: '1px solid var(--line, currentColor)', borderRadius: 4, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: 'var(--ink, currentColor)' }} />
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className={data.paused ? 'btn btn-primary' : 'btn'} onClick={togglePause} disabled={pause.isPending}>
          {pause.isPending ? 'Saving…' : data.paused ? 'Turn AI back on' : 'Pause AI for everyone'}
        </button>
        <a className="btn" href="https://platform.claude.com/settings/billing" target="_blank" rel="noreferrer noopener">Top up in Anthropic Console ↗</a>
      </div>
      {pause.isError && <div role="alert" className="body-sm" style={{ marginTop: 8 }}>{pause.error.message}</div>}

      {!compact && (
        <form className="col" style={{ gap: 8, marginTop: 20 }}
          onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate({ budgetUsd: budgetN, alertPcts: alertList, autopause: autoVal }); }}>
          <label className="body-sm">Monthly AI budget (USD, empty = none)
            <input className="input" type="number" min={1} step="any" value={budgetVal} onChange={(e) => setBudget(e.target.value)} />
          </label>
          <label className="body-sm">Alert at (% of budget, comma separated)
            <input className="input" value={alertsVal} onChange={(e) => setAlerts(e.target.value)} placeholder="80, 100" />
          </label>
          <label className="body-sm row" style={{ gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={autoVal} onChange={(e) => setAutopause(e.target.checked)} />
            Pause AI automatically at 100% of the budget
          </label>
          {save.isError && <div role="alert" className="body-sm">{save.error.message}</div>}
          <button type="submit" className="btn btn-primary" disabled={!valid || save.isPending}>{save.isPending ? 'Saving…' : 'Save budget'}</button>
        </form>
      )}
    </section>
  );
}

/** Pause AI for one firm (Firm detail). */
export function FirmAiPauseToggle({ firmId, paused }: { firmId: string; paused: boolean }) {
  const qc = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const m = useMutation({
    mutationFn: (next: boolean) => api.patch<{ aiPaused: boolean }>(`/admin/firms/${firmId}/ai-pause`, { paused: next }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['admin'] });
      showToast({ type: 'sage', text: r.aiPaused ? 'AI paused for this firm' : 'AI is on for this firm' });
    },
  });
  return (
    <section className="card" style={{ padding: 24 }}>
      <h2 className="heading-lg" style={{ marginBottom: 8 }}>AI for this firm</h2>
      <p className="body-sm muted" style={{ marginBottom: 12 }}>{paused ? 'Paused: members see "AI paused" and no credits are taken.' : 'On.'}</p>
      <button type="button" className="btn" disabled={m.isPending}
        onClick={() => { if (window.confirm(paused ? 'Turn AI back on for this firm?' : 'Pause AI for this firm?')) m.mutate(!paused); }}>
        {m.isPending ? 'Saving…' : paused ? 'Turn AI back on' : 'Pause AI for this firm'}
      </button>
      {m.isError && <div role="alert" className="body-sm" style={{ marginTop: 8 }}>{m.error.message}</div>}
    </section>
  );
}
