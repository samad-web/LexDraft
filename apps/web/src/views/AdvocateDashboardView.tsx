import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorState, Icon, Skeleton, type IconName } from '@lexdraft/ui';
import type { AttentionGroup, DayHearing } from '@lexdraft/types';
import { useDashboardToday } from '@/hooks/useDashboardToday';
import { useFirmDashboard } from '@/hooks/useFirmDashboard';
import { useCan } from '@/hooks/useFirmAdmin';
import { useAuthStore } from '@/store/auth';
import { MoreMenu, type MoreMenuItem } from '@/components/MoreMenu';
import { NewCaseModal } from '@/components/NewCaseModal';
import { NewHearingModal } from '@/components/NewHearingModal';
import { NewLeadModal } from '@/components/NewLeadModal';
import { DashboardEmptyState } from '@/components/DashboardEmptyState';
import { DashboardKpis } from '@/components/dashboard/DashboardKpis';
import { startProductTour } from '@/components/tour/ProductTour';

/**
 * Dashboard ("Overview") - built to dashboard-design.md, translated for
 * advocates. See .claude/skills/lexdraft-dashboard/SKILL.md for the rules.
 *
 *   Greeting   date · "Good evening, {name}" · firm · matters · this week · actions
 *   KPI cards  2 × 3 tinted: active matters, listed today, needs attention,
 *              your plan, AI drafts (bar), eCourts coverage (bar)
 *   Split      PRIORITY Needs attention  |  SCHEDULE Upcoming hearings
 *   Footer     © year firm · Powered by Sirah Digital
 */

type Scope = 'mine' | 'firm';
type Tint = 'blue' | 'rose' | 'violet' | 'green' | 'amber' | 'teal' | 'slate' | 'gold';

const GROUP: Record<AttentionGroup['key'], { source: string; pill: string; icon: IconName }> = {
  // Mandatory (danger) groups: the pill is a red button naming the issue.
  limitations:    { source: 'Limitation',  pill: 'Limitation due', icon: 'limitation' },
  objections:     { source: 'eFiling',     pill: 'Cure objection', icon: 'efiling' },
  overdueTasks:   { source: 'Pending',     pill: 'Overdue',   icon: 'tasks' },
  noNextDate:     { source: 'No next date', pill: 'Post date', icon: 'calendar' },
  reviews:        { source: 'Contract review', pill: 'Review', icon: 'review' },
  clientMessages: { source: 'Client portal', pill: 'Reply',    icon: 'inbox' },
  esign:          { source: 'e-Sign',      pill: 'Pending',   icon: 'edit' },
};
const TONE_TINT: Record<AttentionGroup['tone'], Tint> = { danger: 'rose', warning: 'amber', info: 'blue' };
const TONE_RANK: Record<AttentionGroup['tone'], number> = { danger: 0, warning: 1, info: 2 };
const AVATAR_TINTS: Tint[] = ['blue', 'violet', 'teal', 'amber', 'rose', 'green'];
const tintFor = (s: string): Tint => AVATAR_TINTS[[...s].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_TINTS.length]!;
const initialOf = (s: string) => (s.trim()[0] ?? '·').toUpperCase();

/** "chambers" on the Practice plan, "firm" on the Firm plan - the word the
 *  leader view uses for the whole organisation. */
function useOrgWord(): 'chambers' | 'firm' {
  return useAuthStore((s) => s.user?.plan) === 'Practice' ? 'chambers' : 'firm';
}

function greeting(): string {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}

interface AttnRow {
  id: string;
  label: string;
  status: string;
  to: string;
  tint: Tint;
  pill: string;
  icon?: IconName;
}

export function AdvocateDashboardView() {
  const { data, isLoading, isError, error, refetch } = useDashboardToday();
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const canDraft = useCan('drafting.ai');
  const canLead = useCan('leads.create');
  const canCreateMatter = useCan('matter.create');
  const canLimitation = useCan('limitation.use');
  // The view follows plan + role - no switch. Leaders (firm.dashboard.view:
  // Firm-plan partners / firm admins, Practice-plan group lead) see the whole
  // firm or chambers, with their own items marked "You". Solo advocates and
  // associates see their own day.
  const canFirm = useCan('firm.dashboard.view') || !!data?.canSeeFirm;
  const scope: Scope = canFirm ? 'firm' : 'mine';
  const org = useOrgWord();
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [newHearingOpen, setNewHearingOpen] = useState(false);
  const [newLeadOpen, setNewLeadOpen] = useState(false);

  const firstName = ((data?.user.name || user?.name) ?? '').split(' ')[0] ?? '';
  const firm = user?.firm || 'Your chambers';
  const dateLine = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  // Members without the firm view see their own hearings plus unassigned
  // ones, so nothing listed slips through the cracks.
  const { today, week } = useMemo(() => {
    const inScope = (h: DayHearing) => scope === 'firm' || h.mine || h.unassigned;
    return {
      today: (data?.hearingsToday ?? []).filter(inScope),
      week: (data?.hearingsWeek ?? []).filter(inScope),
    };
  }, [data, scope]);

  const groups = useMemo(
    () => [...(data?.attention ?? [])].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]),
    [data],
  );
  const urgent = groups.filter((g) => g.tone === 'danger').reduce((s, g) => s + g.count, 0);

  const moreItems: MoreMenuItem[] = [
    { label: 'Add hearing', icon: 'calendar', onSelect: () => setNewHearingOpen(true) },
    ...(canDraft ? [{ label: 'New draft', icon: 'draft' as const, onSelect: () => navigate('/app/draft') }] : []),
    ...(canLead ? [{ label: 'Capture lead', icon: 'leads' as const, onSelect: () => setNewLeadOpen(true) }] : []),
    { label: 'Open cause list', icon: 'causelist', onSelect: () => navigate('/app/causelist') },
    { label: 'Take the tour', icon: 'sparkle', onSelect: () => startProductTour() },
  ];

  const isFresh = data && data.practice.totalMatters === 0 && data.hearingsToday.length === 0 && data.hearingsWeek.length === 0;

  return (
    <div className="adv">
      {/* ---- Greeting block ---------------------------------------------------- */}
      <header className="adv-head">
        <div className="adv-head-text">
          <div className="adv-date">{dateLine}</div>
          <h1 className="adv-greet">{greeting()}, <span className="adv-name">{firstName || 'Counsel'}</span></h1>
          <p className="adv-sub">
            {firm}
            {data && <>
              {' · '}{data.practice.activeMatters} active {data.practice.activeMatters === 1 ? 'matter' : 'matters'}
              {' · '}{today.length} today, {week.length} more this week{scope === 'firm' ? ` across the ${org}` : ''}
              {urgent > 0 && <> · <strong className="adv-sub-urgent">{urgent} urgent</strong></>}
            </>}
          </p>
        </div>
        <div className="adv-head-actions">
          <Link to="/app/cases" className="btn">All matters</Link>
          <MoreMenu items={moreItems} />
          {canCreateMatter && (
            <button type="button" className="btn btn-primary" data-tour="new-matter" onClick={() => setNewCaseOpen(true)}>
              <Icon name="plus" size={14} /> New matter
            </button>
          )}
        </div>
      </header>

      <NewCaseModal open={newCaseOpen} onClose={() => setNewCaseOpen(false)} />
      <NewHearingModal open={newHearingOpen} onClose={() => setNewHearingOpen(false)} />
      <NewLeadModal open={newLeadOpen} onClose={() => setNewLeadOpen(false)} />

      {isFresh && (
        <DashboardEmptyState
          plan={user?.plan ?? 'Solo'}
          firstName={firstName}
          steps={[
            { label: 'Add your first client', hint: 'Matters and invoices hang off the client.', link: '/app/clients', linkLabel: 'Add client', completed: false },
            { label: 'Open your first matter', hint: 'Hearings, documents and deadlines belong to a matter.', link: '/app/cases', linkLabel: 'Open matter', completed: false },
            { label: 'Connect it to eCourts', hint: 'Add the CNR and next dates update automatically.', link: '/app/ecourts', linkLabel: 'Open eCourts', completed: false },
            ...(canLimitation
              ? [{ label: 'Set a limitation deadline', hint: 'Track filing deadlines from day one.', link: '/app/limitation', linkLabel: 'Add deadline', completed: false }]
              : []),
          ]}
        />
      )}

      {isLoading && <DashboardSkeleton />}
      {isError && (
        <ErrorState
          title="Couldn't load your dashboard"
          description={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <>
          {/* ---- KPI cards: 2 rows × 3, each = "what to act on" ------------- */}
          <DashboardKpis
            data={data}
            today={today}
            week={week}
            groups={groups}
            scope={scope}
            org={org}
            plan={user?.plan ?? 'Solo'}
            userId={user?.id ?? 'me'}
          />
          {/* Plan / AI quota / eCourts coverage are deliberately NOT here: the
              trial banner, sidebar meter and eCourts page already carry them. */}

          {/* ---- Priority | Schedule ----------------------------------------- */}
          <div className="adv-split">
            <NeedsAttention groups={groups} />
            <UpcomingHearings
              today={today}
              week={week}
              scope={scope}
              onAddHearing={() => setNewHearingOpen(true)}
            />
          </div>

          {scope === 'firm' && <TeamWorkload today={today} week={week} />}
        </>
      )}

      {/* ---- Footer ------------------------------------------------------------ */}
      <footer className="adv-foot">
        <span>© {new Date().getFullYear()} {firm}. All rights reserved.</span>
        <span>Powered by <strong>Sirah Digital</strong></span>
      </footer>
    </div>
  );
}

// ---- Section card -------------------------------------------------------------------

function Section({ id, eyebrow, title, icon, tint, aside, children }: {
  id?: string; eyebrow: string; title: string; icon: IconName; tint: Tint; aside?: ReactNode; children: ReactNode;
}) {
  return (
    <section id={id} className="adv-card">
      <header className="adv-card-head">
        <span className={`adv-card-icon tint-${tint}`}><Icon name={icon} size={18} /></span>
        <div className="adv-card-titles">
          <div className="adv-eyebrow">{eyebrow}</div>
          <h2 className="adv-card-title">{title}</h2>
        </div>
        <span className="spacer" />
        {aside}
      </header>
      {children}
    </section>
  );
}

// ---- PRIORITY · Needs attention -------------------------------------------------------

function NeedsAttention({ groups }: { groups: AttentionGroup[] }) {
  const [all, setAll] = useState(false);
  const rows: AttnRow[] = useMemo(() => groups.flatMap((g): AttnRow[] => {
    const meta = GROUP[g.key];
    const tint = TONE_TINT[g.tone];
    if (g.items.length === 0) {
      return [{ id: g.key, label: `${g.count} ${meta.source.toLowerCase()} ${g.count === 1 ? 'item' : 'items'}`, status: 'Open to review', to: g.to, tint, pill: meta.pill, icon: meta.icon }];
    }
    const items: AttnRow[] = g.items.map((it) => ({
      id: `${g.key}.${it.id}`, label: it.label, status: `${meta.source}${it.detail ? ` · ${it.detail}` : ''}`, to: it.to, tint, pill: meta.pill,
    }));
    if (g.count > g.items.length) {
      items.push({ id: `${g.key}.more`, label: `+${g.count - g.items.length} more`, status: meta.source, to: g.to, tint, pill: meta.pill, icon: meta.icon });
    }
    return items;
  }), [groups]);
  const shown = all ? rows : rows.slice(0, 5);

  return (
    <Section
      id="attention" eyebrow="Priority" title="Needs attention" icon="flag" tint="rose"
      aside={rows.length > 5 && (
        <button type="button" className="adv-link" onClick={() => setAll((v) => !v)}>
          {all ? 'Show less' : `Review all (${rows.length})`}
        </button>
      )}
    >
      {rows.length === 0 ? (
        <div className="adv-empty">
          <span className="adv-empty-icon tint-green"><Icon name="check" size={22} /></span>
          <div className="adv-empty-title">All clear</div>
          <div className="adv-muted">No deadlines, objections or overdue work.</div>
        </div>
      ) : (
        <ul className="adv-list">
          {shown.map((r) => (
            <li key={r.id}>
              <Link to={r.to} className="adv-row">
                <span className={`adv-avatar tint-${r.icon ? r.tint : tintFor(r.label)}`}>
                  {r.icon ? <Icon name={r.icon} size={17} /> : initialOf(r.label)}
                </span>
                <span className="adv-row-main">
                  <span className="adv-row-title">{r.label}</span>
                  <span className="adv-row-sub">{r.status}</span>
                </span>
                {r.tint === 'rose'
                  ? <span className="adv-alert-btn">{r.pill}</span>
                  : <span className="adv-pill">{r.pill}</span>}
                <Icon name="chevron" size={15} className="adv-chev" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---- SCHEDULE · Upcoming hearings --------------------------------------------------------

function UpcomingHearings({ today, week, scope, onAddHearing }: {
  today: DayHearing[]; week: DayHearing[]; scope: Scope; onAddHearing: () => void;
}) {
  const navigate = useNavigate();
  const org = useOrgWord();
  const rows = [...today.map((h) => ({ h, isToday: true })), ...week.map((h) => ({ h, isToday: false }))].slice(0, 7);
  const more = today.length + week.length - rows.length;

  return (
    <Section
      eyebrow={scope === 'firm' ? `Schedule · whole ${org}` : 'Schedule'} title="Upcoming hearings" icon="calendar" tint="blue"
      aside={<Link to="/app/calendar" className="adv-link">Calendar</Link>}
    >
      {rows.length === 0 ? (
        <div className="adv-empty">
          <span className="adv-empty-icon tint-blue"><Icon name="calendar" size={22} /></span>
          <div className="adv-empty-title">No upcoming hearings</div>
          <div className="adv-muted">Nothing listed for the next 7 days.</div>
          <button type="button" className="btn btn-sm" onClick={onAddHearing}><Icon name="plus" size={12} /> Add hearing</button>
        </div>
      ) : (
        <>
          <ul className="adv-list">
            {rows.map(({ h, isToday }) => {
              const d = new Date(h.date + 'T00:00:00');
              return (
                <li key={h.id}>
                  <button type="button" className="adv-row" onClick={() => navigate(`/app/cases/${h.caseId}`)}>
                    <span className={`adv-dateblock${isToday ? ' is-today' : ''}`}>
                      <span className="adv-dateblock-m">{isToday ? 'Today' : d.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                      <span className="adv-dateblock-d">{d.getDate()}</span>
                    </span>
                    <span className="adv-row-main">
                      <span className="adv-row-title">{h.case}</span>
                      <span className="adv-row-sub">
                        {/* Firm view: who is appearing is the key fact for a partner. */}
                        {scope === 'firm' && <><strong>{h.unassigned ? 'No advocate' : (h.mine ? 'You' : h.advocate ?? 'Colleague')}</strong> · </>}
                        {h.purpose} · {h.court}
                      </span>
                    </span>
                    {/* Today with no advocate is mandatory -> red button; later this week, neutral. */}
                    {scope === 'firm' && h.unassigned && (isToday
                      ? <span className="adv-alert-btn">Assign advocate</span>
                      : <span className="adv-pill">Unassigned</span>)}
                    <span className="adv-pill adv-pill-time">{h.time || '—'}</span>
                    <Icon name="chevron" size={15} className="adv-chev" />
                  </button>
                </li>
              );
            })}
          </ul>
          {more > 0 && <Link to="/app/calendar" className="adv-more">+{more} more this week</Link>}
        </>
      )}
    </Section>
  );
}

// ---- FIRM view: team workload (partners / firm admins / PG leads) -------------------

/** Who carries the firm's work: active matters per advocate, plus who is in
 *  court today/this week, so a partner can rebalance at a glance. */
function TeamWorkload({ today, week }: { today: DayHearing[]; week: DayHearing[] }) {
  const { data, isLoading } = useFirmDashboard();
  const org = useOrgWord();
  if (isLoading) return <Skeleton height={220} />;
  const members = [...(data?.members ?? [])].sort((a, b) => b.activeMatters - a.activeMatters);
  if (members.length === 0) return null;
  const max = Math.max(1, ...members.map((m) => m.activeMatters));
  const inCourt = (name: string, list: DayHearing[]) => list.filter((h) => h.advocate === name).length;

  return (
    <Section eyebrow="Team" title="Workload by advocate" icon="members" tint="green"
      aside={<Link to="/app/firm" className="adv-link">{org === 'chambers' ? 'Chambers overview' : 'Firm overview'}</Link>}>
      <ul className="adv-team">
        {members.slice(0, 8).map((m) => {
          const t = inCourt(m.name, today);
          const w = inCourt(m.name, week);
          return (
            <li key={m.id} className="adv-team-row">
              <span className="adv-avatar adv-avatar-sm">{m.initials}</span>
              <span className="adv-row-main">
                <span className="adv-row-title">{m.name} <span className="adv-team-role">{m.role}</span></span>
                <span className="adv-bar"><span style={{ width: `${(m.activeMatters / max) * 100}%` }} /></span>
              </span>
              <span className="adv-team-nums">
                <span><strong>{m.activeMatters}</strong> matters</span>
                <span>{t ? <><strong>{t}</strong> today</> : 'not in court today'}{w ? ` · ${w} this week` : ''}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="col" style={{ gap: 18 }} aria-busy="true" aria-label="Loading dashboard">
      <div className="adv-kpis">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height={132} />)}</div>
      <div className="adv-split"><Skeleton height={320} /><Skeleton height={320} /></div>
    </div>
  );
}

