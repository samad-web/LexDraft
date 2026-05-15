import { useMemo, useState } from 'react';
import {
  usePracticeProfitability,
  usePracticeWorkload,
  type ProfitabilityMatter,
  type WorkloadMember,
} from '@/hooks/usePracticeAnalytics';

type TabId = 'workload' | 'profitability';

interface TabDef {
  id: TabId;
  label: string;
  hint: string;
}

const TABS: ReadonlyArray<TabDef> = [
  { id: 'workload',      label: 'Workload fairness',  hint: 'Open matters and hearings split across your team.' },
  { id: 'profitability', label: 'Profitability',      hint: 'Realised revenue against expenses, per matter.' },
];

function formatInr(inr: number): string {
  if (Math.abs(inr) >= 10_000_000) return `${inr < 0 ? '-' : ''}₹${Math.abs(inr / 10_000_000).toFixed(2)} Cr`;
  if (Math.abs(inr) >= 100_000)    return `${inr < 0 ? '-' : ''}₹${Math.abs(inr / 100_000).toFixed(2)} L`;
  return `₹${inr.toLocaleString('en-IN')}`;
}

export function PracticeAnalyticsView() {
  const [tab, setTab] = useState<TabId>('workload');
  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0]!;

  return (
    <div className="col stagger" style={{ gap: 20 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Practice insights</div>
          <h1 className="heading-xl">Practice analytics</h1>
          <p className="body-sm muted" style={{ marginTop: 6, maxWidth: 560 }}>
            {activeTab.hint}
          </p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Practice analytics tabs"
        className="row"
        style={{
          gap: 4,
          padding: 4,
          background: 'var(--bg-surface-2)',
          borderRadius: 'var(--radius-md)',
          alignSelf: 'flex-start',
        }}
      >
        {TABS.map((t) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => setTab(t.id)}
              className="btn"
              style={{
                background: selected ? 'var(--bg-surface)' : 'transparent',
                border: selected ? '1px solid var(--border-subtle)' : '1px solid transparent',
                fontWeight: selected ? 600 : 400,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'workload' ? <WorkloadTab /> : <ProfitabilityTab />}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Workload tab
// -----------------------------------------------------------------------------

function WorkloadTab() {
  const { data, isLoading, isError, error } = usePracticeWorkload();

  if (isError) {
    return (
      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <div className="heading-sm" style={{ marginBottom: 6 }}>Couldn’t load workload</div>
        <p className="body-sm muted">{(error as Error | null)?.message ?? 'Try again in a moment.'}</p>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="card">
        <span className="muted">Loading workload<span className="blink" /></span>
      </div>
    );
  }

  const members: WorkloadMember[] = data.members;
  const maxMatters = members.reduce((m, x) => Math.max(m, x.openMatters), 0);

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="stat-row">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Active members</div>
          <div className="heading-xl tabular">{data.totals.memberCount}</div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Active matters</div>
          <div className="heading-xl tabular">{data.totals.activeMatters}</div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Hearings this week</div>
          <div className="heading-xl tabular">{data.totals.hearingsThisWeek}</div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Hearings next week</div>
          <div className="heading-xl tabular">{data.totals.hearingsNextWeek}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Open matters</th>
              <th>Distribution</th>
              <th>Hearings (this wk)</th>
              <th>Hearings (next wk)</th>
              <th>Open tasks</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="col" style={{ padding: '28px 8px', alignItems: 'center', gap: 6 }}>
                    <div className="heading-sm">No active members</div>
                    <p className="body-sm muted">Invite teammates from Manage to populate this view.</p>
                  </div>
                </td>
              </tr>
            )}
            {members.map((m) => {
              const pct = maxMatters === 0 ? 0 : (m.openMatters / maxMatters) * 100;
              const rowStyle = m.isOverloaded
                ? { background: 'var(--warning-bg)' }
                : undefined;
              return (
                <tr key={m.userId} style={rowStyle}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{m.name}</div>
                    {m.isOverloaded && (
                      <div className="body-xs muted" style={{ marginTop: 2 }}>
                        Carrying noticeably more than the median.
                      </div>
                    )}
                  </td>
                  <td className="body-sm muted">{m.role}</td>
                  <td className="mono tabular">{m.openMatters}</td>
                  <td style={{ minWidth: 140 }}>
                    <div
                      style={{
                        position: 'relative',
                        height: 8,
                        background: 'var(--bg-surface-2)',
                        borderRadius: 'var(--radius-full)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: m.isOverloaded ? 'var(--warning)' : 'var(--text-primary)',
                          borderRadius: 'var(--radius-full)',
                          transition: 'width 240ms ease',
                        }}
                      />
                    </div>
                  </td>
                  <td className="mono tabular">{m.hearingsThisWeek}</td>
                  <td className="mono tabular">{m.hearingsNextWeek}</td>
                  <td className="mono tabular">{m.openTasks}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="body-xs muted">
        Per-member matter and hearing counts are an even split of the firm-wide totals while
        the underlying tables don’t carry an assignee. Open-task counts come from
        the task assignee field directly.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Profitability tab
// -----------------------------------------------------------------------------

function ProfitabilityTab() {
  const [since, setSince] = useState<string>('');
  const { data, isLoading, isError, error } = usePracticeProfitability(
    since ? { since } : undefined,
  );

  const matters: ProfitabilityMatter[] = data?.matters ?? [];
  const totals = useMemo(() => {
    return matters.reduce(
      (acc, m) => {
        acc.paid += m.paidInr;
        acc.expenses += m.expensesInr;
        acc.net += m.netInr;
        if (m.isUnprofitable) acc.unprofitable += 1;
        return acc;
      },
      { paid: 0, expenses: 0, net: 0, unprofitable: 0 },
    );
  }, [matters]);

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <label className="col" style={{ gap: 4 }}>
          <span className="eyebrow">Opened since</span>
          <input
            type="date"
            className="input"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            aria-label="Filter by matter open date"
            style={{ minWidth: 180 }}
          />
        </label>
        {since && (
          <button type="button" className="btn" onClick={() => setSince('')}>
            Clear
          </button>
        )}
      </div>

      {isError && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <div className="heading-sm" style={{ marginBottom: 6 }}>Couldn’t load profitability</div>
          <p className="body-sm muted">{(error as Error | null)?.message ?? 'Try again in a moment.'}</p>
        </div>
      )}

      {isLoading && (
        <div className="card">
          <span className="muted">Loading profitability<span className="blink" /></span>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className="stat-row">
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Paid (sum)</div>
              <div className="heading-xl tabular">{formatInr(totals.paid)}</div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Expenses (sum)</div>
              <div className="heading-xl tabular">{formatInr(totals.expenses)}</div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Net (sum)</div>
              <div
                className="heading-xl tabular"
                style={{ color: totals.net < 0 ? 'var(--danger)' : undefined }}
              >
                {formatInr(totals.net)}
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Unprofitable matters</div>
              <div className="heading-xl tabular">{totals.unprofitable}</div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Matter</th>
                  <th>Client</th>
                  <th>Paid</th>
                  <th>Expenses</th>
                  <th>Net</th>
                  <th>Margin</th>
                  <th>Last invoice</th>
                </tr>
              </thead>
              <tbody>
                {matters.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <div className="col" style={{ padding: '28px 8px', alignItems: 'center', gap: 6 }}>
                        <div className="heading-sm">No matters to score</div>
                        <p className="body-sm muted">
                          Either there are no matters yet, or none fall inside the chosen date window.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
                {matters.map((m) => {
                  const rowStyle = m.isUnprofitable
                    ? { background: 'var(--danger-bg)' }
                    : undefined;
                  const marginText =
                    m.marginPct === null ? '-' : `${m.marginPct}%`;
                  return (
                    <tr key={m.caseId} style={rowStyle}>
                      <td>
                        <div style={{ fontWeight: 500 }}>
                          <em className="case-name">{m.title}</em>
                        </div>
                      </td>
                      <td className="body-sm muted">{m.client}</td>
                      <td className="mono tabular">{formatInr(m.paidInr)}</td>
                      <td className="mono tabular">{formatInr(m.expensesInr)}</td>
                      <td
                        className="mono tabular"
                        style={{ color: m.netInr < 0 ? 'var(--danger)' : undefined }}
                      >
                        {formatInr(m.netInr)}
                      </td>
                      <td className="mono tabular">{marginText}</td>
                      <td className="body-sm muted">{m.lastInvoiceAt ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="body-xs muted">
            Invoices are matched to matters by client name; expenses by matter title.
            Once a real case_id column lands on both, these numbers tighten up.
          </p>
        </>
      )}
    </div>
  );
}
