import { useState } from 'react';
import { Icon, Skeleton } from '@lexdraft/ui';
import { useDashboard } from '@/hooks/useDashboard';
import { useFirmDashboard } from '@/hooks/useFirmDashboard';
import { useMyUsage } from '@/hooks/useMyUsage';
import { useCan, useFirmPracticeGroups } from '@/hooks/useFirmAdmin';
import { useUIStore } from '@/store/ui';
import { InviteMemberModal } from '@/components/InviteMemberModal';
import { MonthCalendarModal } from '@/components/MonthCalendarModal';
import { DashboardEmptyState, type DashboardEmptyStateStep } from '@/components/DashboardEmptyState';
import { greetingFor } from '@/lib/greeting';
import type { Alert, FirmMember, Hearing } from '@lexdraft/types';

interface PracticeDashboardViewProps {
  onNav: (view: string) => void;
}

export function PracticeDashboardView({ onNav }: PracticeDashboardViewProps) {
  const personal = useDashboard();
  const firm = useFirmDashboard();
  const usage = useMyUsage();
  const isFirmAdmin = useCan('admin.users');
  // Practice-groups endpoint is admin-only; non-admin members will get 403 and
  // we surface a "Ask your admin" hint for that step instead. TanStack Query
  // caches the error and the .data stays undefined - that lines up with the
  // step staying un-completed on the non-admin's view, which is correct.
  const practiceGroups = useFirmPracticeGroups();
  const showToast = useUIStore((s) => s.showToast);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-GB', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });

  if (personal.isLoading || firm.isLoading) {
    return <Loading dateStr={dateStr} />;
  }
  if (personal.isError || !personal.data || firm.isError || !firm.data) {
    const message =
      (personal.error as Error | null)?.message ??
      (firm.error as Error | null)?.message ??
      'Failed to load chambers dashboard.';
    return <ErrorState message={message} dateStr={dateStr} />;
  }

  const firstName = (personal.data.user.name ?? '').split(' ')[0] ?? '';
  const greeting = greetingFor(firstName);

  const myHearingCount = personal.data.hearings.length;
  const myAlertCount = personal.data.alerts.length;
  const firmHearingCount = firm.data.hearingsToday.length;
  const seatsRemaining = Math.max(0, firm.data.firm.seats - firm.data.firm.seatsUsed);
  const seatsAtCap = firm.data.firm.seatsUsed >= firm.data.firm.seats;

  const lede = firmHearingCount === 0 && myAlertCount === 0
    ? `A clean day across the chambers. ${seatsRemaining > 0 ? `${seatsRemaining} ${seatsRemaining === 1 ? 'seat' : 'seats'} still available.` : 'All seats in use.'}`
    : `${firmHearingCount} ${firmHearingCount === 1 ? 'hearing' : 'hearings'} listed across ${firm.data.firm.name}` +
      (myAlertCount > 0 ? `; ${myAlertCount} ${myAlertCount === 1 ? 'notice' : 'notices'} to your attention.` : '.');

  const aiUsed = usage.data?.aiDocuments.used ?? 0;
  const aiLimit = usage.data?.aiDocuments.limit ?? null;

  // Empty-state: brand-new chambers with no firm-wide matters, hearings today,
  // documents in the personal feed, or active clients on the firm books.
  const isEmptyChambers =
    firm.data.stats.activeMatters === 0 &&
    firm.data.hearingsToday.length === 0 &&
    personal.data.recentDocs.length === 0 &&
    firm.data.stats.clientsActive === 0;

  // Step completion derived from current data only - never persisted.
  // Branding has no tenant-facing read endpoint yet, so we deliberately leave
  // step 4 un-auto-completable; the link still drives the user into Settings.
  const practiceSteps: DashboardEmptyStateStep[] = [
    {
      label: 'Add your team',
      hint: isFirmAdmin
        ? 'Invite co-advocates so the seat count and chambers roster come alive.'
        : 'Your firm admin invites members from the Manage screen.',
      link: '/app/manage',
      linkLabel: 'Invite members',
      completed: firm.data.members.length > 1,
      disabledHint: isFirmAdmin ? undefined : 'Ask your admin to invite the team',
    },
    {
      label: 'Create practice groups',
      hint: 'Group members by practice area so analytics can roll up correctly.',
      link: '/app/manage',
      linkLabel: 'Open Manage',
      completed: (practiceGroups.data?.length ?? 0) > 0,
      disabledHint: isFirmAdmin ? undefined : 'Ask your admin to set up practice groups',
    },
    {
      label: 'Add your first matter',
      hint: 'Open a case file - hearings, documents, and bills flow from here.',
      link: '/app/cases',
      linkLabel: 'Open matter',
      completed: firm.data.stats.activeMatters > 0,
    },
    {
      label: 'Customise your firm branding',
      hint: 'Set a display name and accent so client-facing artefacts feel yours.',
      link: '/app/settings',
      linkLabel: 'Open settings',
      // No tenant-facing branding read endpoint, so this never auto-completes;
      // the panel as a whole disappears once the dashboard has live data.
      completed: false,
      disabledHint: isFirmAdmin ? undefined : 'Firm admin sets up branding',
    },
    {
      label: 'Generate a draft document',
      hint: 'Pick a template, brief the AI, get a first cut in seconds.',
      link: '/app/draft',
      linkLabel: 'Begin draft',
      completed: personal.data.recentDocs.length > 0,
    },
  ];

  return (
    <div className="col stagger" style={{ gap: 0 }}>
      {/* MASTHEAD */}
      <div style={{ paddingBottom: 24, borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
            CHAMBERS DASHBOARD · PRACTICE
          </span>
          <span className="spacer" />
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
            {dateStr.toUpperCase()}
          </span>
        </div>
        <h1 className="display-lg" style={{ color: 'var(--text-primary)' }}>
          {greeting}
        </h1>
        <p className="lede" style={{ marginTop: 14, maxWidth: 760 }}>
          {lede}
        </p>
        <div className="row" style={{ marginTop: 18, gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="badge">{firm.data.firm.name}</span>
          <span className="badge badge-cobalt mono" style={{ letterSpacing: '0.1em' }}>
            {firm.data.firm.seatsUsed} / {firm.data.firm.seats} SEATS
          </span>
          <span className="badge mono" style={{ letterSpacing: '0.1em' }}>
            {firm.data.firm.period.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Calendar CTA - dedicated card row. */}
      <div style={{ paddingTop: 24 }}>
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
      </div>
      <MonthCalendarModal open={calendarOpen} onClose={() => setCalendarOpen(false)} />

      {isEmptyChambers && (
        <div style={{ paddingTop: 24 }}>
          <DashboardEmptyState
            plan="Practice"
            firmName={firm.data.firm.name}
            steps={practiceSteps}
          />
        </div>
      )}

      {/* §I - MY DAY */}
      <section style={{ padding: '40px 0', borderBottom: '1px solid var(--border-subtle)' }}>
        <div
          className="dash-primary"
          style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 48, alignItems: 'flex-start' }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 16 }}>§ I - My day</div>
            <h2 className="display-md" style={{ marginBottom: 16 }}>
              {myHearingCount > 0
                ? <>You have <span style={{ color: 'var(--text-primary)' }}>{myHearingCount}</span> {myHearingCount === 1 ? 'hearing' : 'hearings'} listed.</>
                : <>Your day is open. <span style={{ color: 'var(--text-secondary)' }}>Draft, review, or open a matter.</span></>}
            </h2>
            <p className="body-lg muted" style={{ maxWidth: 520, marginBottom: 28 }}>
              Personal hearings, alerts, and drafts in flight. Co-advocate work appears under <em>Today across the firm</em>.
            </p>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary btn-lg" onClick={() => onNav('draft')}>
                Draft a document <Icon name="arrow" size={14} />
              </button>
              <button type="button" className="btn btn-lg" onClick={() => onNav('review')}>
                Review a contract
              </button>
              <button
                type="button"
                className="btn btn-lg"
                onClick={() => {
                  if (seatsAtCap) {
                    showToast({ type: 'amber', text: 'All Practice seats in use. Upgrade to Firm to invite more.' });
                  } else {
                    setInviteOpen(true);
                  }
                }}
              >
                <Icon name="plus" size={14} /> Invite a co-advocate
              </button>
            </div>
          </div>

          <div>
            <div
              className="row"
              style={{
                marginBottom: 12,
                paddingBottom: 12,
                borderBottom: '1px solid var(--border-default)',
              }}
            >
              <span className="eyebrow">My personal queue</span>
              <span className="spacer" />
            </div>
            <PersonalHearings hearings={personal.data.hearings} onNav={onNav} />
            <PersonalAlerts alerts={personal.data.alerts} onNav={onNav} />
          </div>
        </div>
      </section>

      {/* §II - CHAMBERS PULSE */}
      <section style={{ padding: '40px 0', borderBottom: '1px solid var(--border-subtle)' }}>
        <SectionHeader number="§ II" title="Chambers pulse" trailing="THIS MONTH" />
        <div className="stat-row">
          <StatCell n={String(firm.data.stats.totalMatters)} label="Total matters" hint={`${firm.data.stats.activeMatters} active`} />
          <StatCell n={String(firmHearingCount)}            label="Hearings · today" hint={firmHearingCount > 0 ? 'Across the firm' : 'Calendar clear'} />
          <StatCell n={`${firm.data.firm.seatsUsed}/${firm.data.firm.seats}`} label="Seats in use" hint={seatsAtCap ? 'Capacity reached' : `${seatsRemaining} remaining`} tone={seatsAtCap ? 'danger' : undefined} />
          <StatCell
            n={aiLimit == null ? `${aiUsed}` : `${aiUsed}/${aiLimit}`}
            label="AI drafts"
            hint={aiLimit == null ? 'Unlimited · Firm' : `${Math.max(0, aiLimit - aiUsed)} remaining`}
          />
        </div>
      </section>

      {/* §III - TODAY ACROSS THE FIRM */}
      <section style={{ padding: '40px 0', borderBottom: '1px solid var(--border-subtle)' }}>
        <SectionHeader
          number="§ III"
          title="Today across the firm"
          trailing={`${firmHearingCount} ${firmHearingCount === 1 ? 'LISTED' : 'LISTED'}`}
        />
        {firmHearingCount === 0 ? (
          <p className="body-md muted">No firm-wide hearings scheduled for today.</p>
        ) : (
          <div className="col" style={{ gap: 0 }}>
            {firm.data.hearingsToday.map((h, i, arr) => (
              <FirmHearingRow key={`${h.case}-${i}`} hearing={h} isLast={i === arr.length - 1} onNav={onNav} />
            ))}
          </div>
        )}
      </section>

      {/* §IV - ACTIVE MEMBERS */}
      <section style={{ padding: '40px 0', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="row" style={{ alignItems: 'flex-end', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border-default)' }}>
          <div className="eyebrow">§ IV</div>
          <h2 className="heading-xl" style={{ marginLeft: 16 }}>Active members</h2>
          <span className="spacer" />
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
            {firm.data.members.length} ON ROLL
          </span>
          <button type="button" className="btn btn-sm" onClick={() => onNav('members')} style={{ marginLeft: 12 }}>
            Manage members
          </button>
        </div>
        {firm.data.members.length === 0 ? (
          <p className="body-md muted">
            No members yet. <a href="#" onClick={(e) => { e.preventDefault(); setInviteOpen(true); }}>Invite a co-advocate</a> to seed the chambers roster.
          </p>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Advocate</th>
                  <th style={{ textAlign: 'right' }}>Active matters</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {firm.data.members.map((m) => (
                  <PracticeMemberRow key={m.id} member={m} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* §V - DOCUMENT REGISTER */}
      <section style={{ padding: '40px 0', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="row" style={{ alignItems: 'flex-end', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border-default)' }}>
          <div className="eyebrow">§ V</div>
          <h2 className="heading-xl" style={{ marginLeft: 16 }}>Document register</h2>
          <span className="spacer" />
          <a href="/app/documents" onClick={(e) => { e.preventDefault(); onNav('documents'); }}>
            All entries
          </a>
        </div>
        {personal.data.recentDocs.length === 0 ? (
          <p className="body-md muted">No documents yet. Drafts and uploads will surface here.</p>
        ) : (
          <div className="card">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>№</th>
                  <th>Title</th>
                  <th>Form</th>
                  <th>Matter</th>
                  <th style={{ textAlign: 'right' }}>Modified</th>
                </tr>
              </thead>
              <tbody>
                {personal.data.recentDocs.map((d, i) => (
                  <tr key={d.id ?? i} onClick={() => onNav('documents')} style={{ cursor: 'pointer' }}>
                    <td className="mono tabular" style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {String(i + 1).padStart(3, '0')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Icon name="file" size={14} />
                        <span style={{ fontWeight: 500 }}>{d.name}</span>
                      </div>
                    </td>
                    <td><span className="badge">{d.type.toUpperCase()}</span></td>
                    <td className="muted"><em className="case-name">{d.case}</em></td>
                    <td className="mono tabular" style={{ textAlign: 'right', color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {d.updated}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* §VI - UPGRADE NUDGE WHEN AT CAP */}
      {seatsAtCap && (
        <section style={{ padding: '24px 0 40px' }}>
          <div
            className="card"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 24,
              alignItems: 'center',
              background: 'var(--bg-surface-2)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>You’re at the Practice cap</div>
              <div className="heading-md" style={{ marginBottom: 4 }}>Move to Firm to add a ninth seat</div>
              <p className="body-sm muted" style={{ maxWidth: 520 }}>
                Firm unlocks unlimited seats, dedicated success management, advanced analytics, SSO, and on-premise deployment options. Existing matters and templates carry over.
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => onNav('settings')}>
              Speak with us
            </button>
          </div>
        </section>
      )}

      <InviteMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} />

      <style>{`
        @media (max-width: 900px) {
          .dash-primary { grid-template-columns: 1fr !important; gap: 32px !important; }
          .dash-2col    { grid-template-columns: 1fr !important; gap: 32px !important; }
          .hearing-row  { grid-template-columns: 1fr !important; gap: 16px !important; }
        }
      `}</style>
    </div>
  );
}

// ---------- helpers ----------------------------------------------------------

function Loading({ dateStr }: { dateStr: string }) {
  return (
    <div className="col stagger" style={{ gap: 24 }} aria-busy="true" aria-label="Loading dashboard">
      <div>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
            CHAMBERS DASHBOARD · PRACTICE
          </span>
          <span className="spacer" />
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
            {dateStr.toUpperCase()}
          </span>
        </div>
        <Skeleton width="60%" height={36} style={{ marginBottom: 12 }} />
        <Skeleton width="40%" height={16} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Skeleton width="50%" height={11} />
            <Skeleton width="35%" height={28} />
            <Skeleton width="70%" height={11} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton width="40%" height={12} />
            {Array.from({ length: 4 }, (_, j) => (
              <div key={j} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Skeleton width="80%" height={13} />
                <Skeleton width="50%" height={11} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message, dateStr }: { message: string; dateStr: string }) {
  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Practice dashboard</div>
        <h1 className="heading-xl">Couldn't load the chambers dashboard</h1>
        <div className="body-sm muted" style={{ marginTop: 6 }}>{dateStr}</div>
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

function SectionHeader({ number, title, trailing }: { number: string; title: string; trailing?: string }) {
  return (
    <div className="row" style={{ alignItems: 'flex-end', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border-default)' }}>
      <div className="eyebrow">{number}</div>
      <h2 className="heading-xl" style={{ marginLeft: 16 }}>{title}</h2>
      <span className="spacer" />
      {trailing && (
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
          {trailing}
        </span>
      )}
    </div>
  );
}

function StatCell({ n, label, hint, tone }: { n: string; label: string; hint?: string; tone?: 'success' | 'danger' }) {
  return (
    <div>
      <div className="display-md tabular" style={{ marginBottom: 8, color: 'var(--text-primary)' }}>{n}</div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      {hint && (
        <div
          className="body-sm"
          style={{
            color:
              tone === 'success' ? 'var(--success)' :
              tone === 'danger'  ? 'var(--danger)'  : 'var(--text-secondary)',
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function PersonalHearings({ hearings, onNav }: { hearings: Hearing[]; onNav: (view: string) => void }) {
  if (hearings.length === 0) {
    return (
      <p className="body-md muted" style={{ padding: '12px 0' }}>
        No personal hearings today. <a href="#" onClick={(e) => { e.preventDefault(); onNav('calendar'); }}>Open calendar</a>.
      </p>
    );
  }
  return (
    <div className="col" style={{ gap: 0 }}>
      {hearings.slice(0, 3).map((h, i) => (
        <div
          key={h.id ?? `${h.time}-${i}`}
          className="row"
          style={{
            gap: 16,
            padding: '14px 0',
            borderBottom: i < Math.min(2, hearings.length - 1) ? '1px solid var(--border-subtle)' : 'none',
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
  );
}

function PersonalAlerts({ alerts, onNav }: { alerts: Alert[]; onNav: (view: string) => void }) {
  if (alerts.length === 0) return null;
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Awaiting attention</div>
      <div className="col" style={{ gap: 10 }}>
        {alerts.slice(0, 3).map((a, i) => (
          <div key={a.id ?? i} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
            <span className={`dot dot-${a.type}`} style={{ marginTop: 8 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="body-sm" style={{ fontWeight: 500 }}>{a.text}</div>
              <div className="body-xs muted">{a.detail}</div>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => onNav('cases')}>Open</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function FirmHearingRow({ hearing, isLast, onNav }: { hearing: Hearing; isLast: boolean; onNav: (view: string) => void }) {
  return (
    <div
      className="hearing-row"
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr auto',
        gap: 24,
        alignItems: 'center',
        padding: '20px 0',
        borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)',
      }}
    >
      <div style={{ borderRight: '1px solid var(--border-subtle)', paddingRight: 16 }}>
        <div className="display-sm tabular" style={{ color: 'var(--text-primary)' }}>{hearing.time}</div>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--text-tertiary)', marginTop: 2 }}>
          IST
        </div>
      </div>
      <div>
        <div className="heading-sm" style={{ marginBottom: 4 }}>
          <em className="case-name">{hearing.case}</em>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="body-sm">{hearing.purpose}</span>
          <span style={{ width: 3, height: 3, background: 'var(--text-tertiary)', borderRadius: '50%' }} />
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
            {hearing.court.toUpperCase()}
          </span>
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-sm" onClick={() => onNav('cases')}>Open matter</button>
      </div>
    </div>
  );
}

function PracticeMemberRow({ member }: { member: FirmMember }) {
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
      <td>
        <span className={`badge ${statusBadge}`}>{member.status}</span>
      </td>
    </tr>
  );
}
