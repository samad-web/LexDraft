import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { useFirmDashboard } from '@/hooks/useFirmDashboard';
import { useCan, useFirmPracticeGroups } from '@/hooks/useFirmAdmin';
import { useUIStore } from '@/store/ui';
import { InviteMemberModal } from '@/components/InviteMemberModal';
import { MonthCalendarModal } from '@/components/MonthCalendarModal';
import { DashboardEmptyState, type DashboardEmptyStateStep } from '@/components/DashboardEmptyState';
import { downloadCsv } from '@/lib/export-doc';
import type {
  CaseStageSlice,
  FirmMember,
  MonthlyRevenuePoint,
  PracticeAreaSlice,
  TopClient,
} from '@lexdraft/types';

export function FirmDashboardView() {
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
    <div className="col stagger" style={{ gap: 28 }}>
      {/* Page header */}
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Firm overview</div>
          <h1 className="heading-xl">{data.firm.name}</h1>
          <div className="body-sm muted" style={{ marginTop: 4 }}>
            <span className="mono tabular">{data.firm.period.toUpperCase()}</span>
            <span style={{ margin: '0 10px', color: 'var(--text-tertiary)' }}>·</span>
            <span className="tabular">
              {data.firm.seatsUsed} of {data.firm.seats} seats used ({seatPct}%)
            </span>
          </div>
        </div>
        <span className="spacer" />
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
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => setInviteOpen(true)}
        >
          <Icon name="plus" size={14} /> Invite member
        </button>
      </div>
      <InviteMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} />

      {/* Calendar CTA - dedicated card row. */}
      <div
        className="card"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          padding: '18px 22px',
          background: 'var(--bg-surface-2)',
          borderColor: 'var(--border-default)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Month at a glance</div>
          <div className="heading-md" style={{ marginBottom: 2 }}>Full hearings calendar</div>
          <p className="body-sm muted" style={{ margin: 0 }}>
            Every hearing across the firm for the month. Step through months and drill into any day's list.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={() => setCalendarOpen(true)}
          aria-label="Open full month calendar"
        >
          <Icon name="calendar" size={16} /> Open calendar
        </button>
      </div>

      {isEmptyChambers && (
        <DashboardEmptyState
          plan="Firm"
          firmName={data.firm.name}
          steps={firmSteps}
        />
      )}

      {/* Headline KPI strip */}
      <div className="stat-row">
        <Stat label="Total matters" value={String(data.stats.totalMatters)} hint={`${data.stats.activeMatters} active`} />
        <Stat
          label="Revenue · FY"
          value={data.stats.revenueFY}
          hint={`${data.stats.revenueDeltaPct > 0 ? '+' : ''}${data.stats.revenueDeltaPct}% vs prior year`}
          tone={data.stats.revenueDeltaPct >= 0 ? 'success' : 'danger'}
        />
        <Stat
          label="Billable hours · month"
          value={data.stats.billableHoursMonth > 0 ? String(data.stats.billableHoursMonth) : '-'}
          hint={
            data.stats.realizationPct > 0
              ? `${data.stats.realizationPct}% realisation`
              : 'Time tracking not configured'
          }
        />
        <Stat label="Active advocates" value={String(data.stats.advocatesActive)} hint={`${data.stats.clientsActive} active clients`} />
      </div>

      {/* Revenue + matters split */}
      <div className="grid-2" style={{ alignItems: 'stretch' }}>
        <div className="card">
          <div className="row" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Monthly revenue · ₹L</div>
              <div className="heading-md">Trailing twelve months</div>
            </div>
            <span className="spacer" />
            {data.stats.revenueDeltaPct !== 0 && (
              <span
                className={`badge ${data.stats.revenueDeltaPct >= 0 ? 'badge-sage' : 'badge-vermillion'}`}
              >
                {data.stats.revenueDeltaPct > 0 ? '+' : ''}
                {data.stats.revenueDeltaPct}% YoY
              </span>
            )}
          </div>
          <RevenueChart series={data.monthlyRevenue} />
        </div>

        <div className="card">
          <div className="row" style={{ marginBottom: 16 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Matters by stage</div>
              <div className="heading-md">Across the firm</div>
            </div>
          </div>
          <StageBars stages={data.caseStages} />
        </div>
      </div>

      {/* Members + practice mix */}
      <div className="grid-2" style={{ alignItems: 'flex-start' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="row" style={{ padding: 24, alignItems: 'flex-end', borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Chambers performance</div>
              <div className="heading-md">Members</div>
            </div>
            <span className="spacer" />
            <span className="body-sm muted tabular">{data.members.length} on roll</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Advocate</th>
                <th style={{ textAlign: 'right' }}>Matters</th>
                <th style={{ textAlign: 'right' }}>Hrs · mo</th>
                <th style={{ textAlign: 'right' }}>Win %</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 6 }}>Practice mix</div>
          <div className="heading-md" style={{ marginBottom: 18 }}>Revenue by area</div>
          <div className="col" style={{ gap: 14 }}>
            {data.practiceAreas.map((p) => (
              <PracticeRow key={p.name} area={p} />
            ))}
          </div>
        </div>
      </div>

      {/* Top clients + today + alerts */}
      <div className="grid-2" style={{ alignItems: 'flex-start' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="row" style={{ padding: 24, alignItems: 'flex-end', borderBottom: '1px solid var(--border-subtle)' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Book of business</div>
              <div className="heading-md">Top clients</div>
            </div>
            <span className="spacer" />
            <span className="body-sm muted">FY to date</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Client</th>
                <th style={{ textAlign: 'right' }}>Matters</th>
                <th style={{ textAlign: 'right' }}>Billed</th>
                <th style={{ textAlign: 'right' }}>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {data.topClients.map((c) => (
                <ClientRow key={c.name} client={c} />
              ))}
            </tbody>
          </table>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="row" style={{ marginBottom: 14, alignItems: 'flex-end' }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Today</div>
                <div className="heading-md">Hearings across the firm</div>
              </div>
              <span className="spacer" />
              <span className="badge badge-cobalt">{data.hearingsToday.length} listed</span>
            </div>
            <MonthCalendarModal open={calendarOpen} onClose={() => setCalendarOpen(false)} />
            <div className="col" style={{ gap: 0 }}>
              {data.hearingsToday.length === 0 && (
                <div className="body-sm muted" style={{ padding: '12px 0' }}>
                  No hearings listed for today.
                </div>
              )}
              {data.hearingsToday.map((h, i, arr) => (
                <div
                  key={`${h.case}-${i}`}
                  className="row"
                  style={{
                    padding: '14px 0',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    gap: 16,
                  }}
                >
                  <div style={{ width: 56 }}>
                    <div className="mono tabular heading-sm">{h.time}</div>
                    <div className="body-xs muted">IST</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="body-md" style={{ fontWeight: 500 }}>
                      <em className="case-name">{h.case}</em>
                    </div>
                    <div className="body-sm muted">
                      {h.purpose} · <span className="mono">{h.court}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ marginBottom: 14, alignItems: 'flex-end' }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Notices to the bench</div>
                <div className="heading-md">Firm alerts</div>
              </div>
              <span className="spacer" />
              <span className="body-sm muted">{data.alerts.length} active</span>
            </div>
            <div className="col" style={{ gap: 12 }}>
              {data.alerts.map((a, i) => (
                <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <span className={`dot dot-${a.type}`} style={{ marginTop: 8 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="body-md" style={{ fontWeight: 500 }}>{a.text}</div>
                    <div className="body-sm muted">{a.detail}</div>
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
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Firm overview</div>
        <div className="heading-xl muted">Loading<span className="blink" /></div>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Firm overview</div>
        <h1 className="heading-xl">Couldn't load the dashboard</h1>
      </div>
      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="badge badge-vermillion">Error</span>
          <span className="body-sm">{message}</span>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div className="display-md tabular" style={{ fontSize: 36, lineHeight: 1.1 }}>{value}</div>
      {hint && (
        <div
          className="body-sm"
          style={{
            marginTop: 6,
            color: tone === 'success' ? 'var(--success)' : tone === 'danger' ? 'var(--danger)' : 'var(--text-secondary)',
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function MemberRow({ member }: { member: FirmMember }) {
  const statusBadge =
    member.status === 'Active' ? 'badge-sage' : member.status === 'On leave' ? 'badge-amber' : 'badge-vermillion';
  return (
    <tr>
      <td>
        <div className="row" style={{ gap: 12 }}>
          <div className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>{member.initials}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{member.name}</div>
            <div className="body-xs muted">{member.role}</div>
          </div>
        </div>
      </td>
      <td className="tabular" style={{ textAlign: 'right' }}>{member.activeMatters || '-'}</td>
      <td className="tabular" style={{ textAlign: 'right' }}>{member.billableHours || '-'}</td>
      <td className="tabular" style={{ textAlign: 'right' }}>{member.winRate ? `${member.winRate}%` : '-'}</td>
      <td>
        <span className={`badge ${statusBadge}`}>{member.status}</span>
      </td>
    </tr>
  );
}

function ClientRow({ client }: { client: TopClient }) {
  return (
    <tr>
      <td style={{ fontWeight: 500 }}>{client.name}</td>
      <td className="tabular" style={{ textAlign: 'right' }}>{client.matters}</td>
      <td className="tabular" style={{ textAlign: 'right' }}>{client.billed}</td>
      <td className="mono body-sm muted" style={{ textAlign: 'right' }}>{client.lastActivity}</td>
    </tr>
  );
}

function PracticeRow({ area }: { area: PracticeAreaSlice }) {
  const pct = Math.round(area.share * 100);
  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="body-md" style={{ fontWeight: 500 }}>{area.name}</span>
        <span className="spacer" />
        <span className="body-sm muted tabular">
          {area.matters} matters · {area.revenue}
        </span>
      </div>
      <div
        style={{
          height: 6,
          background: 'var(--bg-surface-2)',
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'var(--text-primary)',
            borderRadius: 'var(--radius-full)',
          }}
        />
      </div>
    </div>
  );
}

function StageBars({ stages }: { stages: CaseStageSlice[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="col" style={{ gap: 10 }}>
      {stages.map((s) => {
        const pct = (s.count / max) * 100;
        return (
          <div key={s.stage} className="row" style={{ gap: 12 }}>
            <span className="body-sm" style={{ width: 96, color: 'var(--text-secondary)' }}>{s.stage}</span>
            <div
              style={{
                flex: 1,
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
                  background: 'var(--text-primary)',
                  borderRadius: 'var(--radius-full)',
                }}
              />
            </div>
            <span className="mono tabular body-sm" style={{ width: 28, textAlign: 'right' }}>{s.count}</span>
          </div>
        );
      })}
    </div>
  );
}

function RevenueChart({ series }: { series: MonthlyRevenuePoint[] }) {
  const W = 600;
  const H = 200;
  const P = { l: 36, r: 12, t: 12, b: 28 };
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

  const peakIndex = values.indexOf(max);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly revenue" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* Grid */}
      {[0, 0.5, 1].map((t) => {
        const yLine = P.t + t * innerH;
        return (
          <line key={t} x1={P.l} x2={W - P.r} y1={yLine} y2={yLine} stroke="var(--border-subtle)" strokeWidth={1} />
        );
      })}
      {/* Area fill */}
      <path d={areaPath} fill="var(--bg-surface-2)" />
      {/* Line */}
      <path d={path} fill="none" stroke="var(--text-primary)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {/* Peak marker */}
      <circle cx={x(peakIndex)} cy={y(values[peakIndex] ?? 0)} r={4} fill="var(--info)" stroke="var(--bg-surface)" strokeWidth={2} />
      {/* X labels */}
      {series.map((p, i) => (
        <text
          key={p.month + i}
          x={x(i)}
          y={H - 8}
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize={10}
          fill="var(--text-tertiary)"
          style={{ letterSpacing: '0.06em' }}
        >
          {p.month.toUpperCase()}
        </text>
      ))}
      {/* Y axis ticks */}
      {[min, (min + max) / 2, max].map((v, i) => (
        <text
          key={i}
          x={P.l - 8}
          y={y(v) + 3}
          textAnchor="end"
          fontFamily="var(--font-mono)"
          fontSize={9}
          fill="var(--text-tertiary)"
          style={{ letterSpacing: '0.04em' }}
        >
          {v.toFixed(1)}
        </text>
      ))}
    </svg>
  );
}
