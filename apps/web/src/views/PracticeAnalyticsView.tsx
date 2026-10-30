import { useMemo, useState } from 'react';
import { Skeleton } from '@lexdraft/ui';
import {
  usePracticeProfitability,
  usePracticeWorkload,
  type ProfitabilityMatter,
  type WorkloadMember,
} from '@/hooks/usePracticeAnalytics';
import { PageHeader } from '@/components/PageHeader';

function AnalyticsTabSkeleton() {
  return (
    <div className="col" style={{ gap: 16 }} aria-busy="true" aria-label="Loading analytics">
      <div className="fm-kpis">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="fm-kpi" style={{ gap: 12 }}>
            <Skeleton width="60%" height={11} />
            <Skeleton width="40%" height={34} />
          </div>
        ))}
      </div>
      <div className="fm-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Skeleton width="35%" height={14} />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Skeleton width={120} height={13} />
            <Skeleton height={10} style={{ flex: 1 }} />
            <Skeleton width={48} height={13} />
          </div>
        ))}
      </div>
    </div>
  );
}

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
  return `${inr < 0 ? '-' : ''}₹${Math.abs(inr).toLocaleString('en-IN')}`;
}

export function PracticeAnalyticsView() {
  const [tab, setTab] = useState<TabId>('workload');
  const activeTab = TABS.find((t) => t.id === tab) ?? TABS[0]!;

  return (
    <div className="col stagger fm-view fm-practice">
      <PageHeader title="Workload & Profitability" description={activeTab.hint} />

      <div
        role="tablist"
        aria-label="Practice analytics tabs"
        className="fm-seg"
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
      <div className="fm-error" role="alert">
        <span className="fm-error-mark" aria-hidden>!</span>
        <div>
          <strong>Couldn’t load workload</strong>
          <div className="muted">{(error as Error | null)?.message ?? 'Try again in a moment.'}</div>
        </div>
      </div>
    );
  }
  if (isLoading || !data) {
    return <AnalyticsTabSkeleton />;
  }

  const members: WorkloadMember[] = data.members;
  const maxMatters = members.reduce((m, x) => Math.max(m, x.openMatters), 0);

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="fm-kpis">
        <div className="fm-kpi">
          <span className="fm-kpi-label">Active members</span>
          <span className="fm-kpi-value">{data.totals.memberCount}</span>
        </div>
        <div className="fm-kpi">
          <span className="fm-kpi-label">Active matters</span>
          <span className="fm-kpi-value">{data.totals.activeMatters}</span>
        </div>
        <div className="fm-kpi">
          <span className="fm-kpi-label">Hearings this week</span>
          <span className="fm-kpi-value">{data.totals.hearingsThisWeek}</span>
        </div>
        <div className="fm-kpi">
          <span className="fm-kpi-label">Hearings next week</span>
          <span className="fm-kpi-value">{data.totals.hearingsNextWeek}</span>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="tbl fm-tbl">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th className="num">Open matters</th>
              <th>Distribution</th>
              <th className="num">Hearings (this wk)</th>
              <th className="num">Hearings (next wk)</th>
              <th className="num">Open tasks</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr>
                <td colSpan={7} data-span="all">
                  <div className="col" style={{ padding: '28px 8px', alignItems: 'center', gap: 6 }}>
                    <div className="heading-sm">No active members</div>
                    <p className="body-sm muted">Invite teammates from Manage to populate this view.</p>
                  </div>
                </td>
              </tr>
            )}
            {members.map((m) => {
              const pct = maxMatters === 0 ? 0 : (m.openMatters / maxMatters) * 100;
              return (
                <tr key={m.userId} className={m.isOverloaded ? 'is-flagged' : undefined}>
                  <td>
                    <div className="fm-cell-title">
                      {m.name}
                      {m.isOverloaded && <span className="fm-pill is-solid" style={{ marginLeft: 8 }}>Overloaded</span>}
                    </div>
                    {m.isOverloaded && (
                      <div className="fm-cell-sub">
                        Carrying noticeably more than the median.
                      </div>
                    )}
                  </td>
                  <td className="muted">{m.role}</td>
                  <td className="num" style={{ fontFamily: 'var(--font-title)', fontSize: 16, fontWeight: 600 }}>{m.openMatters}</td>
                  <td>
                    <div className="fm-dist">
                      <div className={`fm-bar${m.isOverloaded ? '' : ' is-soft'}`} aria-hidden>
                        <span style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="num">{m.hearingsThisWeek}</td>
                  <td className="num">{m.hearingsNextWeek}</td>
                  <td className="num">{m.openTasks}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="fm-footnote">
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
        <label className="fm-date-filter">
          <span className="fm-eyebrow">Opened since</span>
          <input
            type="date"
            className="input"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            aria-label="Filter by matter open date"
          />
        </label>
        {since && (
          <button type="button" className="btn" onClick={() => setSince('')}>
            Clear
          </button>
        )}
      </div>

      {isError && (
        <div className="fm-error" role="alert">
          <span className="fm-error-mark" aria-hidden>!</span>
          <div>
            <strong>Couldn’t load profitability</strong>
            <div className="muted">{(error as Error | null)?.message ?? 'Try again in a moment.'}</div>
          </div>
        </div>
      )}

      {isLoading && <AnalyticsTabSkeleton />}

      {!isLoading && !isError && (
        <>
          <div className="fm-kpis">
            <div className="fm-kpi">
              <span className="fm-kpi-label">Paid (sum)</span>
              <span className="fm-kpi-value">{formatInr(totals.paid)}</span>
            </div>
            <div className="fm-kpi">
              <span className="fm-kpi-label">Expenses (sum)</span>
              <span className="fm-kpi-value">{formatInr(totals.expenses)}</span>
            </div>
            <div className="fm-kpi">
              <span className="fm-kpi-label">Net (sum)</span>
              <span className="fm-kpi-value">{formatInr(totals.net)}</span>
              {totals.net < 0 && <span className="fm-kpi-hint"><strong>Net loss</strong> across these matters</span>}
            </div>
            <div className="fm-kpi">
              <span className="fm-kpi-label">Unprofitable matters</span>
              <span className="fm-kpi-value">{totals.unprofitable}</span>
              <span className="fm-kpi-hint">of {matters.length} scored</span>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="tbl fm-tbl">
              <thead>
                <tr>
                  <th>Matter</th>
                  <th>Client</th>
                  <th className="num">Paid</th>
                  <th className="num">Expenses</th>
                  <th className="num">Net</th>
                  <th className="num">Margin</th>
                  <th>Last invoice</th>
                </tr>
              </thead>
              <tbody>
                {matters.length === 0 && (
                  <tr>
                    <td colSpan={7} data-span="all">
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
                  const marginText =
                    m.marginPct === null ? '-' : `${m.marginPct}%`;
                  return (
                    <tr key={m.caseId} className={m.isUnprofitable ? 'is-flagged' : undefined}>
                      <td>
                        <em className="case-name fm-matter">{m.title}</em>
                        {m.isUnprofitable && (
                          <div style={{ marginTop: 4 }}><span className="fm-pill is-strong">Unprofitable</span></div>
                        )}
                      </td>
                      <td className="muted">{m.client}</td>
                      <td className="num">{formatInr(m.paidInr)}</td>
                      <td className="num">{formatInr(m.expensesInr)}</td>
                      <td className={`num${m.netInr < 0 ? ' fm-neg' : ''}`} style={{ fontFamily: 'var(--font-title)', fontSize: 15.5, fontWeight: 600 }}>
                        {formatInr(m.netInr)}
                      </td>
                      <td className="num">{marginText}</td>
                      <td><span className="fm-date">{m.lastInvoiceAt ?? '-'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="fm-footnote">
            Invoices are matched to matters by client name; expenses by matter title.
            Once a real case_id column lands on both, these numbers tighten up.
          </p>
        </>
      )}
    </div>
  );
}
