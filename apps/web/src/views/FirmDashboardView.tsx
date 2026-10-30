import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, Skeleton } from '@lexdraft/ui';
import { useFirmDashboard } from '@/hooks/useFirmDashboard';
import { useCan, useFirmPracticeGroups } from '@/hooks/useFirmAdmin';
import { useUIStore } from '@/store/ui';
import { InviteMemberModal } from '@/components/InviteMemberModal';
import { MonthCalendarModal } from '@/components/MonthCalendarModal';
import { DashboardEmptyState, type DashboardEmptyStateStep } from '@/components/DashboardEmptyState';
import { CaptureLeadCta } from '@/components/CaptureLeadCta';
import { downloadCsv } from '@/lib/export-doc';
import type {
  CaseStageSlice,
  FirmMember,
  MonthlyRevenuePoint,
  PracticeAreaSlice,
  TopClient,
} from '@lexdraft/types';

export function FirmDashboardView() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useFirmDashboard();
  const isFirmAdmin = useCan('admin.users');
  // Same trade-off as the Practice view: 403 for non-admins is harmless here,
  // .data stays undefined and the step renders un-completed with a "ask your
  // admin" hint.
  const practiceGroups = useFirmPracticeGroups();
  const showToast = useUIStore((s) => s.showToast);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  if (isLoading) {
    return <Loading />;
  }
  if (isError || !data) {
    return <ErrorState message={(error as Error | null)?.message ?? 'Failed to load firm dashboard.'} />;
  }

  const seatPct = Math.round((data.firm.seatsUsed / data.firm.seats) * 100);

  // Empty-state: firm has no matters, no hearings today, no active clients.
  // The firm summary doesn't carry a doc count so we use the three signals it
  // does carry; matters + clients + hearings being zero across the entire firm
  // is a strong "this is a fresh tenant" tell.
  const isEmptyChambers =
    data.stats.activeMatters === 0 &&
    data.hearingsToday.length === 0 &&
    data.stats.clientsActive === 0 &&
    data.stats.totalMatters === 0;

  // Step completion derived from current data only. Branding has no tenant
  // read endpoint yet → step 5 stays un-auto-completable; the panel as a whole
  // disappears once any of {matter, client, hearing} comes alive.
  const firmSteps: DashboardEmptyStateStep[] = [
    {
      label: 'Add your team',
      hint: isFirmAdmin
        ? 'Invite partners, leads, and associates so the firm roster reflects reality.'
        : 'Your firm admin invites members from the Manage screen.',
      link: '/app/manage',
      linkLabel: 'Invite members',
      completed: data.members.length > 1,
      disabledHint: isFirmAdmin ? undefined : 'Ask your admin to invite the team',
    },
    {
      label: 'Create practice groups',
      hint: 'Group members by practice area - analytics roll up by these groupings.',
      link: '/app/manage',
      linkLabel: 'Open Manage',
      completed: (practiceGroups.data?.length ?? 0) > 0,
      disabledHint: isFirmAdmin ? undefined : 'Ask your admin to set up practice groups',
    },
    {
      label: 'Open your first matter',
      hint: 'Hearings, time entries, and invoices all attach to a matter.',
      link: '/app/cases',
      linkLabel: 'Open matter',
      completed: data.stats.totalMatters > 0,
    },
    {
      label: 'Issue your first invoice',
      hint: 'Unlocks revenue analytics - the headline KPI strip and the trailing-12 chart.',
      link: '/app/invoices',
      linkLabel: 'Create invoice',
      // No invoice count in the summary; cheap proxy: a non-zero FY revenue
      // string. Brand-new firms get "₹0" - once the first invoice posts it
      // updates and the step ticks.
      completed: !/^\s*₹0\b/.test(data.stats.revenueFY),
    },
    {
      label: 'Configure firm branding',
      hint: 'Display name, logo, accent - used in client portal and document exports.',
      link: '/app/settings',
      linkLabel: 'Open settings',
      completed: false,
      disabledHint: isFirmAdmin ? undefined : 'Firm admin configures branding',
    },
  ];

  return (
    <div className="col stagger fm-view fm-firm">
      {/* Page header */}
      <div className="fm-firm-head">
        <div>
          <div className="fm-eyebrow">Firm overview · {data.firm.period}</div>
          <h1 className="fm-firm-title">{data.firm.name}</h1>
          <div className="fm-firm-meta">
            <span className="fm-seats">
              <span className="fm-bar" aria-hidden><span style={{ width: `${Math.min(100, seatPct)}%` }} /></span>
              <span className="tabular">
                {data.firm.seatsUsed} of {data.firm.seats} seats used ({seatPct}%)
              </span>
            </span>
          </div>
        </div>
        <div className="fm-firm-actions">
          <button
            className="btn"
            type="button"
            onClick={() => {
              const s = data.stats;
              downloadCsv(
                `firm-report-${new Date().toISOString().slice(0, 10)}.csv`,
                ['Metric', 'Value'],
                [
                  ['Firm', data.firm.name],
                  ['Period', data.firm.period],
                  ['Seats used', `${data.firm.seatsUsed} / ${data.firm.seats}`],
                  ['Total matters', s.totalMatters],
                  ['Active matters', s.activeMatters],
                  ['Revenue (FY)', s.revenueFY],
                  ['Revenue YoY (%)', s.revenueDeltaPct],
                  ['Billable hours (month)', s.billableHoursMonth],
                  ['Realisation (%)', s.realizationPct],
                  ['Active advocates', s.advocatesActive],
                  ['Active clients', s.clientsActive],
                ],
              );
              showToast({ type: 'sage', text: 'Firm report exported' });
            }}
          >
            <Icon name="download" size={14} /> Export report
          </button>
          <CaptureLeadCta variant="secondary" />
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setInviteOpen(true)}
          >
            <Icon name="plus" size={14} /> Invite member
          </button>
        </div>
      </div>
      <InviteMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} />

      {isEmptyChambers && (
        <DashboardEmptyState
          plan="Firm"
          firmName={data.firm.name}
          steps={firmSteps}
        />
      )}

      {/* Headline KPI strip - each tile drills into the relevant view */}
      <div className="fm-kpis">
        <Stat
          label="Total matters"
          value={String(data.stats.totalMatters)}
          hint={<><strong>{data.stats.activeMatters}</strong> active</>}
          to="/app/cases"
          drillLabel={`Total matters: ${data.stats.totalMatters}. View all matters`}
        />
        <Stat
          label="Revenue · FY"
          value={data.stats.revenueFY}
          hint={<><strong>{`${data.stats.revenueDeltaPct > 0 ? '+' : ''}${data.stats.revenueDeltaPct}%`}</strong> vs prior year</>}
          to="/app/invoices"
          drillLabel={`Revenue this financial year: ${data.stats.revenueFY}. View invoices`}
        />
        <Stat
          label="Billable hours · month"
          value={data.stats.billableHoursMonth > 0 ? String(data.stats.billableHoursMonth) : '-'}
          hint={
            data.stats.realizationPct > 0
              ? <><strong>{data.stats.realizationPct}%</strong> realisation</>
              : 'Time tracking not configured'
          }
          to="/app/analytics"
          drillLabel="Billable hours this month. View analytics"
        />
        <Stat
          label="Active advocates"
          value={String(data.stats.advocatesActive)}
          hint={<><strong>{data.stats.clientsActive}</strong> active clients</>}
          to="/app/manage"
          drillLabel={`${data.stats.advocatesActive} active advocates. Manage the firm roster`}
        />
      </div>

      {/* Quick tools: month calendar + court fee calculator */}
      <div className="fm-shortcuts">
        <div className="fm-shortcut">
          <span className="fm-shortcut-icon" aria-hidden><Icon name="calendar" size={18} /></span>
          <div className="fm-shortcut-text">
            <div className="fm-eyebrow">Month at a glance</div>
            <div className="fm-shortcut-title">Full hearings calendar</div>
            <p className="fm-shortcut-desc">
              Every hearing across the firm for the month. Step through months and drill into any day's list.
            </p>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => setCalendarOpen(true)}
            aria-label="Open full month calendar"
          >
            Open calendar
          </button>
        </div>
        <div className="fm-shortcut">
          <span className="fm-shortcut-icon" aria-hidden><Icon name="calculator" size={18} /></span>
          <div className="fm-shortcut-text">
            <div className="fm-eyebrow">All-India · 36 states &amp; UTs</div>
            <div className="fm-shortcut-title">Court fee &amp; stamp duty calculator</div>
            <p className="fm-shortcut-desc">
              Estimate the court fee on a plaint or the stamp duty on an instrument before filing, plus a vakalatnama generator.
            </p>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => navigate('/app/calculators')}
            aria-label="Open court fee and stamp duty calculator"
          >
            Open
          </button>
        </div>
      </div>

      {/* Revenue + matters split */}
      <div className="fm-grid-2 is-stretch">
        <div className="fm-panel">
          <div className="fm-panel-head">
            <div>
              <div className="fm-eyebrow">Monthly revenue · ₹ lakh</div>
              <h2 className="fm-panel-title">Trailing twelve months</h2>
            </div>
            {data.stats.revenueDeltaPct !== 0 && (
              <span className={`fm-pill ${data.stats.revenueDeltaPct >= 0 ? 'is-solid' : 'is-strong'}`}>
                {data.stats.revenueDeltaPct > 0 ? '+' : ''}
                {data.stats.revenueDeltaPct}% YoY
              </span>
            )}
          </div>
          {data.monthlyRevenue.length > 0
            ? <RevenueChart series={data.monthlyRevenue} />
            : <div className="fm-quiet">No invoices posted yet. Revenue appears here month by month.</div>}
        </div>

        <div className="fm-panel">
          <div className="fm-panel-head">
            <div>
              <div className="fm-eyebrow">Matters by stage</div>
              <h2 className="fm-panel-title">Across the firm</h2>
            </div>
            <span className="fm-panel-aside">{data.stats.activeMatters} active</span>
          </div>
          {data.caseStages.length > 0
            ? <StageBars stages={data.caseStages} />
            : <div className="fm-quiet">No active matters with a stage yet.</div>}
        </div>
      </div>

      {/* Members + practice mix */}
      <div className="fm-grid-2">
        <div className="fm-panel is-flush">
          <div className="fm-panel-head">
            <div>
              <div className="fm-eyebrow">Chambers performance</div>
              <h2 className="fm-panel-title">Members</h2>
            </div>
            <span className="fm-panel-aside">{data.members.length} on roll</span>
          </div>
          <div className="fm-scroll">
            <table className="tbl fm-tbl">
              <thead>
                <tr>
                  <th>Advocate</th>
                  <th className="num">Matters</th>
                  <th className="num">Hrs · mo</th>
                  <th className="num">Win %</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.members.length === 0 ? (
                  <tr>
                    <td colSpan={5} data-span="all" className="body-sm muted" style={{ padding: '20px 24px' }}>
                      No advocates on roll yet. Invite teammates from Manage Members.
                    </td>
                  </tr>
                ) : (
                  data.members.map((m) => <MemberRow key={m.id} member={m} />)
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="fm-panel">
          <div className="fm-panel-head">
            <div>
              <div className="fm-eyebrow">Practice mix</div>
              <h2 className="fm-panel-title">Revenue by area</h2>
            </div>
          </div>
          <div className="fm-area-list">
            {data.practiceAreas.length === 0 ? (
              <div className="fm-quiet">
                No practice areas tracked yet. Tag matters with an area when you open them and they'll surface here.
              </div>
            ) : (
              data.practiceAreas.map((p, i) => <PracticeRow key={p.name} area={p} lead={i === 0} />)
            )}
          </div>
        </div>
      </div>

      {/* Top clients + today + alerts */}
      <div className="fm-grid-2">
        <div className="fm-panel is-flush">
          <div className="fm-panel-head">
            <div>
              <div className="fm-eyebrow">Book of business</div>
              <h2 className="fm-panel-title">Top clients</h2>
            </div>
            <span className="fm-panel-aside">FY to date</span>
          </div>
          <table className="tbl fm-tbl">
            <thead>
              <tr>
                <th>Client</th>
                <th className="num">Matters</th>
                <th className="num">Billed</th>
                <th className="num">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {data.topClients.length === 0 ? (
                <tr>
                  <td colSpan={4} data-span="all" className="body-sm muted" style={{ padding: '20px 24px' }}>
                    No client billing recorded this financial year yet.
                  </td>
                </tr>
              ) : (
                data.topClients.map((c) => <ClientRow key={c.name} client={c} />)
              )}
            </tbody>
          </table>
        </div>

        <div className="col" style={{ gap: 20 }}>
          <div className="fm-panel">
            <div className="fm-panel-head" style={{ marginBottom: 10 }}>
              <div>
                <div className="fm-eyebrow">Today</div>
                <h2 className="fm-panel-title">Hearings across the firm</h2>
              </div>
              <span className="fm-pill is-plain">{data.hearingsToday.length} listed</span>
            </div>
            <MonthCalendarModal open={calendarOpen} onClose={() => setCalendarOpen(false)} />
            <div className="col" style={{ gap: 0 }}>
              {data.hearingsToday.length === 0 && (
                <div className="fm-quiet">
                  No hearings listed for today.
                </div>
              )}
              {data.hearingsToday.map((h, i) => (
                <div
                  key={h.id ?? `${h.case}-${i}`}
                  className="fm-hearing"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(h.caseId ? `/app/cases/${h.caseId}` : '/app/causelist')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(h.caseId ? `/app/cases/${h.caseId}` : '/app/causelist');
                  }}
                >
                  <div className="fm-time">
                    <div className="fm-time-h">{h.time}</div>
                    <div className="fm-time-z">IST</div>
                  </div>
                  <div className="fm-hearing-text">
                    <div className="fm-hearing-case">{h.case}</div>
                    <div className="fm-hearing-sub">
                      {h.purpose} · {h.court}
                    </div>
                  </div>
                  <Icon name="chevron" size={16} className="muted" />
                </div>
              ))}
            </div>
          </div>

          <div className="fm-panel">
            <div className="fm-panel-head" style={{ marginBottom: 6 }}>
              <div>
                <div className="fm-eyebrow">Notices to the bench</div>
                <h2 className="fm-panel-title">Firm alerts</h2>
              </div>
              <span className="fm-panel-aside">{data.alerts.length} active</span>
            </div>
            <div className="fm-alerts">
              {data.alerts.length === 0 && (
                <div className="fm-quiet">
                  No active alerts.
                </div>
              )}
              {data.alerts.map((a, i) => (
                <div key={i} className="fm-alert">
                  <span
                    className={`fm-alert-mark${a.type === 'vermillion' ? ' is-urgent' : a.type === 'cobalt' || a.type === 'sage' ? ' is-soft' : ''}`}
                    aria-hidden
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="fm-alert-text">{a.text}</div>
                    <div className="fm-alert-detail">{a.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Helpers ----------------------------------------------------------------

function Loading() {
  return (
    <div className="col stagger fm-view fm-firm" aria-busy="true" aria-label="Loading firm dashboard">
      <div>
        <div className="fm-eyebrow" style={{ marginBottom: 12 }}>Firm overview</div>
        <Skeleton width="55%" height={40} />
      </div>
      <div className="fm-kpis">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="fm-kpi" style={{ gap: 12 }}>
            <Skeleton width="50%" height={11} />
            <Skeleton width="40%" height={34} />
            <Skeleton width="70%" height={11} />
          </div>
        ))}
      </div>
      <div className="fm-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Skeleton width="30%" height={16} />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Skeleton width={32} height={32} circle />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <Skeleton width="50%" height={13} />
              <Skeleton width="35%" height={11} />
            </div>
            <Skeleton width={70} height={20} radius="pill" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="col stagger fm-view fm-firm">
      <div>
        <div className="fm-eyebrow">Firm overview</div>
        <h1 className="fm-firm-title">Couldn't load the dashboard</h1>
      </div>
      <div className="fm-error" role="alert">
        <span className="fm-error-mark" aria-hidden>!</span>
        <span>{message}</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  to,
  drillLabel,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  /** When set, the tile becomes an interactive button that navigates here. */
  to?: string;
  /** Accessible action description, e.g. "View all matters". */
  drillLabel?: string;
}) {
  const navigate = useNavigate();

  const inner = (
    <>
      <span className="fm-kpi-label">{label}</span>
      <span className="fm-kpi-value">{value}</span>
      {hint && <span className="fm-kpi-hint">{hint}</span>}
      {to && (
        <span className="fm-kpi-chev" aria-hidden>
          <Icon name="chevron" size={16} />
        </span>
      )}
    </>
  );

  if (to) {
    return (
      <button
        type="button"
        className="fm-kpi"
        onClick={() => navigate(to)}
        aria-label={drillLabel ?? `${label}: ${value}. View details`}
      >
        {inner}
      </button>
    );
  }

  return <div className="fm-kpi">{inner}</div>;
}

function MemberRow({ member }: { member: FirmMember }) {
  const statusCls =
    member.status === 'Active' ? 'is-solid' : member.status === 'On leave' ? 'is-dashed' : 'is-muted';
  return (
    <tr>
      <td>
        <div className="fm-user">
          <div className="fm-avatar is-sm" aria-hidden>{member.initials}</div>
          <div style={{ minWidth: 0 }}>
            <div className="fm-cell-title">{member.name}</div>
            <div className="fm-cell-sub">{member.role}</div>
          </div>
        </div>
      </td>
      <td className="num">{member.activeMatters || '-'}</td>
      <td className="num">{member.billableHours || '-'}</td>
      <td className="num">{member.winRate ? `${member.winRate}%` : '-'}</td>
      <td>
        <span className={`fm-pill ${statusCls}`}>{member.status}</span>
      </td>
    </tr>
  );
}

function ClientRow({ client }: { client: TopClient }) {
  return (
    <tr>
      <td><span className="fm-cell-title">{client.name}</span></td>
      <td className="num">{client.matters}</td>
      <td className="num" style={{ fontFamily: 'var(--font-title)', fontSize: 15.5, fontWeight: 600 }}>{client.billed}</td>
      <td className="num"><span className="fm-date">{client.lastActivity}</span></td>
    </tr>
  );
}

function PracticeRow({ area, lead }: { area: PracticeAreaSlice; lead?: boolean }) {
  const pct = Math.round(area.share * 100);
  return (
    <div>
      <div className="fm-area-row">
        <span className="fm-area-name">{area.name}</span>
        <span className="fm-area-figs">
          {area.matters} matters · {pct}%<strong>{area.revenue}</strong>
        </span>
      </div>
      <div className={`fm-bar${lead ? '' : ' is-soft'}`} aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StageBars({ stages }: { stages: CaseStageSlice[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="fm-stage-list">
      {stages.map((s) => {
        const pct = (s.count / max) * 100;
        return (
          <div key={s.stage} className="fm-stage">
            <span className="fm-stage-label">{s.stage}</span>
            <div className={`fm-bar${s.count === max ? '' : ' is-soft'}`} aria-hidden>
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="fm-stage-count">{s.count}</span>
          </div>
        );
      })}
    </div>
  );
}

function RevenueChart({ series }: { series: MonthlyRevenuePoint[] }) {
  const W = 600;
  const H = 220;
  const P = { l: 34, r: 14, t: 24, b: 28 };
  const innerW = W - P.l - P.r;
  const innerH = H - P.t - P.b;

  const values = series.map((p) => p.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const x = (i: number) => P.l + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v: number) => P.t + (1 - (v - min) / range) * innerH;

  const path = useMemo(
    () => series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(p.value).toFixed(2)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series],
  );

  const areaPath = useMemo(() => {
    const top = series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(p.value).toFixed(2)}`).join(' ');
    return `${top} L ${x(series.length - 1).toFixed(2)} ${(P.t + innerH).toFixed(2)} L ${x(0).toFixed(2)} ${(P.t + innerH).toFixed(2)} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series]);

  const peakIndex = values.indexOf(Math.max(...values));
  const peak = series[peakIndex];
  const peakX = x(peakIndex);
  const anchor = peakX > W - 70 ? 'end' : peakX < 70 ? 'start' : 'middle';

  return (
    <svg className="fm-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly revenue">
      {/* Grid */}
      {[0, 0.5, 1].map((t) => {
        const yLine = P.t + t * innerH;
        return (
          <line key={t} x1={P.l} x2={W - P.r} y1={yLine} y2={yLine} stroke="var(--border-subtle)" strokeWidth={1} strokeDasharray={t === 1 ? undefined : '2 4'} />
        );
      })}
      {/* Area fill */}
      <path d={areaPath} fill="var(--bg-surface-2)" />
      {/* Line */}
      <path d={path} fill="none" stroke="var(--text-primary)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      {/* Peak marker + label */}
      {peak && (
        <>
          <line x1={peakX} x2={peakX} y1={y(peak.value)} y2={P.t + innerH} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="2 3" />
          <circle cx={peakX} cy={y(peak.value)} r={4.5} fill="var(--text-primary)" stroke="var(--bg-surface)" strokeWidth={2} />
          <text x={peakX} y={y(peak.value) - 10} textAnchor={anchor} fontSize={11} fontWeight={600} fill="var(--text-primary)">
            Peak ₹{peak.value.toFixed(2)}L
          </text>
        </>
      )}
      {/* X labels */}
      {series.map((p, i) => (
        <text
          key={p.month + i}
          x={x(i)}
          y={H - 6}
          textAnchor="middle"
          fontSize={10.5}
          fill={i === peakIndex ? 'var(--text-primary)' : 'var(--text-tertiary)'}
          fontWeight={i === peakIndex ? 600 : 400}
        >
          {p.month}
        </text>
      ))}
      {/* Y axis ticks */}
      {[min, (min + max) / 2, max].map((v, i) => (
        <text
          key={i}
          x={P.l - 8}
          y={y(v) + 3}
          textAnchor="end"
          fontSize={10}
          fill="var(--text-tertiary)"
        >
          {v.toFixed(1)}
        </text>
      ))}
    </svg>
  );
}
