import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@lexdraft/ui';
import type { AttentionGroup, DashboardToday, DayHearing, UserPlan } from '@lexdraft/types';
import { useFirmDashboard } from '@/hooks/useFirmDashboard';
import { useCan } from '@/hooks/useFirmAdmin';
import { Modal } from '@/components/Modal';

// =============================================================================
// Dashboard KPI cards - plan-aware and editable.
//
// Every KPI the dashboard can show lives in CATALOG. Each plan gets the six
// that matter most for how that practice works (PLAN_DEFAULTS); the user can
// pick their own set and order with "Customise" (saved per user, per view, in
// this browser). A KPI whose data the user can't see (no billing access, or a
// team KPI outside the team view) is never offered.
// =============================================================================

export type KpiScope = 'mine' | 'firm';

type KpiId =
  | 'hearingsToday' | 'next7' | 'limitation' | 'objections' | 'noNextDate'
  | 'overdueTasks' | 'feesOverdue' | 'revenueFY' | 'openLeads' | 'reviews'
  | 'clientMessages' | 'esign' | 'activeMatters' | 'unassigned' | 'teamLoad';

interface Ctx {
  practice: DashboardToday['practice'];
  today: DayHearing[];
  week: DayHearing[];
  group: (k: AttentionGroup['key']) => AttentionGroup | undefined;
  scope: KpiScope;
  org: 'chambers' | 'firm';
  firm: ReturnType<typeof useFirmDashboard>;
  canAnalytics: boolean;
  canLimitation: boolean;
}

interface KpiCard {
  icon: IconName; label: string; value: string; unit?: string; clue: ReactNode;
  cta: string; to: string; tone?: 'rose' | 'amber'; alert?: string;
}

interface KpiDef {
  id: KpiId;
  /** Name in the Customise list. */
  name: string;
  /** One line on why it matters, shown in Customise. */
  why: string;
  available: (c: Ctx) => boolean;
  build: (c: Ctx) => KpiCard;
}

const shortDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** "<strong>label</strong> · detail" for the first row of an attention group. */
function firstRow(g: AttentionGroup | undefined, empty: string, prefix = ''): ReactNode {
  const it = g?.items[0];
  if (!it) return empty;
  return <>{prefix}<strong>{it.label}</strong>{it.detail ? ` · ${it.detail}` : ''}</>;
}

const always = () => true;
const teamOnly = (c: Ctx) => c.scope === 'firm';

const CATALOG: KpiDef[] = [
  {
    id: 'hearingsToday', name: 'Hearings today', why: 'Where you (or the team) must appear today.',
    available: always,
    build: ({ today, scope, org }) => {
      const courts = new Set(today.map((h) => h.court)).size;
      const appearing = new Set(today.filter((h) => !h.unassigned).map((h) => h.advocate ?? h.id)).size;
      const first = today[0];
      return {
        icon: 'causelist', label: 'Hearings today', value: String(today.length),
        unit: scope === 'firm' ? ` ${org}-wide` : undefined, to: '/app/causelist', cta: 'Open cause list',
        clue: scope === 'firm'
          ? today.length
            ? <><strong>{courts}</strong> {plural(courts, 'court')} · <strong>{appearing}</strong> {plural(appearing, 'advocate')} appearing</>
            : `No hearings listed for the ${org} today.`
          : first ? <>First: <strong>{first.time || 'time n/a'}</strong> · {first.court}</> : 'No hearings today. A good day for drafting.',
      };
    },
  },
  {
    id: 'next7', name: 'Next 7 days', why: 'The week ahead, and its busiest day.',
    available: always,
    build: ({ week }) => {
      const m = new Map<string, number>();
      for (const h of week) m.set(h.date, (m.get(h.date) ?? 0) + 1);
      let best: [string, number] | null = null;
      for (const e of m) if (!best || e[1] > best[1]) best = e;
      return {
        icon: 'calendar', label: 'Next 7 days', value: String(week.length), to: '/app/calendar', cta: 'Open calendar',
        clue: best ? <>Busiest: <strong>{shortDate(best[0])}</strong> · {best[1]} {plural(best[1], 'hearing')}</> : 'Nothing listed yet this week.',
      };
    },
  },
  {
    id: 'limitation', name: 'Limitation due', why: 'Periods running out in 7 days - mandatory.',
    available: (c) => c.canLimitation,
    build: ({ group }) => {
      const g = group('limitations');
      const n = g?.count ?? 0;
      return {
        icon: 'limitation', label: 'Limitation due', value: String(n), unit: ' in 7 days', to: '/app/limitation', cta: 'Limitation tracker',
        tone: n ? 'rose' : undefined, alert: n ? `${n} ${plural(n, 'limitation')} due` : undefined,
        clue: firstRow(g, 'No limitation period runs out this week.', 'Earliest: '),
      };
    },
  },
  {
    id: 'objections', name: 'Objections to cure', why: 'eFiling defects the registry raised - mandatory.',
    available: always,
    build: ({ group }) => {
      const g = group('objections');
      const n = g?.count ?? 0;
      return {
        icon: 'efiling', label: 'Objections to cure', value: String(n), to: '/app/efiling?m=objections', cta: 'Cure in eFiling',
        tone: n ? 'rose' : undefined, alert: n ? `Cure ${n} ${plural(n, 'objection')}` : undefined,
        clue: firstRow(g, 'No eFiling objections pending.'),
      };
    },
  },
  {
    id: 'unassigned', name: 'Unassigned hearings', why: 'Hearings this week with no advocate on them.',
    available: teamOnly,
    build: ({ today, week }) => {
      const t = today.filter((h) => h.unassigned);
      const w = week.filter((h) => h.unassigned);
      const first = t[0] ?? w[0];
      const n = t.length + w.length;
      return {
        icon: 'members', label: 'Unassigned', value: String(n), unit: ` ${plural(n, 'hearing')}`, to: '/app/causelist', cta: 'Assign advocates',
        tone: t.length ? 'rose' : w.length ? 'amber' : undefined, alert: t.length ? `Assign advocate · ${t.length} today` : undefined,
        clue: first ? <>First: <strong>{first.case}</strong> · {t.length ? `today ${first.time}` : shortDate(first.date)}</> : 'Every hearing this week has an advocate.',
      };
    },
  },
  {
    id: 'reviews', name: 'Drafts to review', why: 'Juniors\' drafts waiting for your sign-off.',
    available: always,
    build: ({ group }) => {
      const g = group('reviews');
      const n = g?.count ?? 0;
      return {
        icon: 'review', label: 'Drafts to review', value: String(n), to: '/app/review-queue', cta: 'Open review queue',
        tone: n ? 'amber' : undefined, clue: firstRow(g, 'Nothing is waiting for your review.'),
      };
    },
  },
  {
    id: 'noNextDate', name: 'No next date', why: 'Active matters with no hearing date posted.',
    available: always,
    build: ({ group, practice }) => {
      const g = group('noNextDate');
      const n = g?.count ?? 0;
      return {
        icon: 'cases', label: 'No next date', value: String(n), unit: ` of ${practice.activeMatters} active`, to: '/app/cases', cta: 'Post next dates',
        tone: n ? 'amber' : undefined, clue: firstRow(g, 'Every active matter has a next date.'),
      };
    },
  },
  {
    id: 'overdueTasks', name: 'Overdue pendings', why: 'Tasks past their due date.',
    available: always,
    build: ({ group }) => {
      const g = group('overdueTasks');
      const n = g?.count ?? 0;
      return {
        icon: 'tasks', label: 'Overdue pendings', value: String(n), to: '/app/tasks', cta: 'Open tasks',
        tone: n ? 'amber' : undefined, clue: firstRow(g, 'No pending work is overdue.'),
      };
    },
  },
  {
    id: 'feesOverdue', name: 'Fees overdue', why: 'Invoices past due - money owed to you.',
    available: (c) => c.practice.overdueInvoices !== null,
    build: ({ practice }) => {
      const od = practice.overdueInvoices!;
      return {
        icon: 'invoices', label: 'Fees overdue', value: od.count ? od.amount : '₹0', to: '/app/invoices', cta: 'Follow up invoices',
        tone: od.count ? 'amber' : undefined,
        clue: od.count ? <><strong>{od.count}</strong> {plural(od.count, 'invoice')} past due</> : 'Every invoice is current.',
      };
    },
  },
  {
    id: 'revenueFY', name: 'Revenue this FY', why: 'Fees collected since 1 April.',
    available: (c) => c.practice.revenueFY !== null || (c.scope === 'firm' && !!c.firm.data?.stats),
    build: ({ practice, firm, scope, canAnalytics }) => {
      const stats = scope === 'firm' ? firm.data?.stats : undefined;
      const delta = stats?.revenueDeltaPct ?? 0;
      const od = practice.overdueInvoices;
      return {
        icon: 'analytics', label: 'Revenue this FY', value: stats?.revenueFY ?? practice.revenueFY ?? '—',
        unit: delta ? ` ${delta > 0 ? '+' : ''}${delta}%` : undefined,
        to: canAnalytics ? '/app/analytics' : '/app/invoices', cta: canAnalytics ? 'Firm analytics' : 'Invoices',
        clue: od?.count ? <><strong>{od.amount}</strong> overdue · {od.count} {plural(od.count, 'invoice')}</> : 'Every invoice is current.',
      };
    },
  },
  {
    id: 'openLeads', name: 'New enquiries', why: 'Prospective clients still to follow up.',
    available: (c) => c.practice.openLeads !== null,
    build: ({ practice }) => {
      const n = practice.openLeads ?? 0;
      return {
        icon: 'leads', label: 'New enquiries', value: String(n), unit: ` open ${plural(n, 'lead')}`, to: '/app/leads', cta: 'Open leads',
        clue: n ? 'Call back while the enquiry is warm.' : 'No open enquiries right now.',
      };
    },
  },
  {
    id: 'clientMessages', name: 'Client messages', why: 'Unanswered messages from clients.',
    available: always,
    build: ({ group }) => {
      const n = group('clientMessages')?.count ?? 0;
      return {
        icon: 'chat', label: 'Client messages', value: String(n), unit: ' unanswered', to: '/app/messages', cta: 'Reply to clients',
        tone: n ? 'amber' : undefined, clue: n ? 'Clients are waiting for a reply.' : 'Every client has a reply.',
      };
    },
  },
  {
    id: 'esign', name: 'Awaiting e-sign', why: 'Documents sent out for signature.',
    available: always,
    build: ({ group }) => {
      const n = group('esign')?.count ?? 0;
      return {
        icon: 'documents', label: 'Awaiting e-sign', value: String(n), to: '/app/documents', cta: 'Open documents',
        clue: n ? `${n} ${plural(n, 'document')} out for signature.` : 'Nothing is out for signature.',
      };
    },
  },
  {
    id: 'activeMatters', name: 'Active matters', why: 'Your live caseload.',
    available: always,
    build: ({ practice }) => ({
      icon: 'cases', label: 'Active matters', value: String(practice.activeMatters), unit: ` of ${practice.totalMatters ?? practice.activeMatters}`,
      to: '/app/cases', cta: 'All matters',
      clue: `${practice.totalMatters ?? practice.activeMatters} matters on the books in total.`,
    }),
  },
  {
    id: 'teamLoad', name: 'Team load', why: 'Who carries the most matters vs the average.',
    available: teamOnly,
    build: ({ firm }) => {
      const members = firm.data?.members ?? [];
      const busiest = [...members].sort((a, b) => b.activeMatters - a.activeMatters)[0];
      const avg = members.length ? Math.round(members.reduce((s, m) => s + m.activeMatters, 0) / members.length) : 0;
      return {
        icon: 'members', label: 'Team load', value: String(firm.data?.stats?.advocatesActive ?? members.length), unit: ' advocates',
        to: '/app/firm', cta: 'People & workload',
        tone: busiest && avg > 0 && busiest.activeMatters >= avg * 1.75 ? 'amber' : undefined,
        clue: busiest ? <>Busiest: <strong>{busiest.name}</strong> · {busiest.activeMatters} matters (avg {avg})</> : firm.isLoading ? 'Loading the team…' : 'No members yet.',
      };
    },
  },
];

const BY_ID = new Map(CATALOG.map((d) => [d.id, d]));

/**
 * The six KPIs each kind of practice needs first:
 *  - Solo: court today/this week, the two mandatory deadlines, fees owed, new clients.
 *  - Practice (chambers lead): court for the chambers, unassigned hearings,
 *    mandatory deadlines, juniors' drafts to review, fees owed.
 *  - Firm (partner / admin): court firm-wide, coverage, mandatory deadlines,
 *    team load, revenue.
 *  - A member's own view on a Practice / Firm plan: their day, deadlines, follow-ups.
 */
const PLAN_DEFAULTS: Record<'Solo' | 'PracticeLead' | 'FirmLead' | 'Member', KpiId[]> = {
  Solo: ['hearingsToday', 'next7', 'limitation', 'objections', 'feesOverdue', 'openLeads'],
  PracticeLead: ['hearingsToday', 'unassigned', 'limitation', 'objections', 'reviews', 'feesOverdue'],
  FirmLead: ['hearingsToday', 'unassigned', 'limitation', 'objections', 'teamLoad', 'revenueFY'],
  Member: ['hearingsToday', 'next7', 'limitation', 'objections', 'noNextDate', 'overdueTasks'],
};

/** Shown when a default KPI isn't available (e.g. no billing access). */
const FALLBACKS: KpiId[] = ['noNextDate', 'overdueTasks', 'next7', 'activeMatters', 'reviews', 'clientMessages'];

const MAX_KPIS = 9;
const MIN_KPIS = 3;

function defaultKey(plan: UserPlan, scope: KpiScope): keyof typeof PLAN_DEFAULTS {
  if (plan === 'Solo') return 'Solo';
  if (scope === 'mine') return 'Member';
  return plan === 'Practice' ? 'PracticeLead' : 'FirmLead';
}

const PLAN_LABEL: Record<keyof typeof PLAN_DEFAULTS, string> = {
  Solo: 'Solo', PracticeLead: 'Practice (chambers)', FirmLead: 'Firm', Member: 'Team member',
};

function storageKey(userId: string, scope: KpiScope) {
  return `lexdraft-kpis:${userId}:${scope}`;
}

function readSaved(key: string): KpiId[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const ids = (JSON.parse(raw) as unknown[]).filter((x): x is KpiId => typeof x === 'string' && BY_ID.has(x as KpiId));
    return ids.length ? ids : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, ids: KpiId[] | null) {
  try {
    if (ids) localStorage.setItem(key, JSON.stringify(ids));
    else localStorage.removeItem(key);
  } catch { /* storage blocked - the choice lasts for this visit only */ }
}

export function DashboardKpis({ data, today, week, groups, scope, org, plan, userId }: {
  data: DashboardToday;
  today: DayHearing[];
  week: DayHearing[];
  groups: AttentionGroup[];
  scope: KpiScope;
  org: 'chambers' | 'firm';
  plan: UserPlan;
  userId: string;
}) {
  const firm = useFirmDashboard();
  const canAnalytics = useCan('analytics.firm');
  const canLimitation = useCan('limitation.use');
  const ctx: Ctx = {
    practice: data.practice, today, week, scope, org, firm, canAnalytics, canLimitation,
    group: (k) => groups.find((g) => g.key === k),
  };

  const key = storageKey(userId, scope);
  const planKey = defaultKey(plan, scope);
  const [saved, setSaved] = useState<KpiId[] | null>(() => readSaved(key));
  const [editing, setEditing] = useState(false);

  const offered = CATALOG.filter((d) => d.available(ctx)).map((d) => d.id);
  const defaults = useMemo(() => {
    const ok = PLAN_DEFAULTS[planKey].filter((id) => offered.includes(id));
    for (const id of FALLBACKS) if (ok.length < 6 && !ok.includes(id) && offered.includes(id)) ok.push(id);
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- offered is derived from ctx each render
  }, [planKey, offered.join()]);
  const shown = (saved ?? defaults).filter((id) => offered.includes(id));

  const save = (ids: KpiId[] | null) => { setSaved(ids); writeSaved(key, ids); };

  return (
    <section className="adv-kpi-wrap" data-tour="kpis" aria-label="Key figures">
      <div className="adv-kpi-bar">
        <span className="adv-kpi-bar-label">
          {saved ? 'Your KPIs' : `${PLAN_LABEL[planKey]} KPIs`}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
          <Icon name="edit" size={13} /> Customise
        </button>
      </div>
      <div className="adv-kpis">
        {shown.map((id) => <Kpi key={id} {...BY_ID.get(id)!.build(ctx)} />)}
      </div>
      <KpiEditor
        open={editing}
        onClose={() => setEditing(false)}
        offered={offered}
        current={shown}
        planLabel={PLAN_LABEL[planKey]}
        defaults={defaults}
        onSave={(ids) => { save(ids.join() === defaults.join() ? null : ids); setEditing(false); }}
      />
    </section>
  );
}

/** Action KPI card: big number, one specific clue, and the place you act on
 *  it. Black & white; the ONE colour is a red button naming a mandatory issue. */
function Kpi({ icon, label, value, unit, clue, cta, to, tone, alert }: KpiCard) {
  const mandatory = tone === 'rose';
  return (
    <Link to={to} className="adv-kpi">
      <span className="adv-kpi-label">
        <span className="adv-kpi-icon"><Icon name={icon} size={16} /></span>
        <span className="adv-kpi-text">{label}</span>
      </span>
      <span className="adv-kpi-value">{value}{unit && <small>{unit}</small>}</span>
      <span className="adv-kpi-note">{clue}</span>
      {mandatory
        ? <span className="adv-kpi-cta"><span className="adv-alert-btn">{alert ?? cta} <Icon name="arrow" size={13} /></span></span>
        : <span className="adv-kpi-cta">{cta} <Icon name="arrow" size={13} /></span>}
    </Link>
  );
}

function KpiEditor({ open, onClose, offered, current, defaults, planLabel, onSave }: {
  open: boolean;
  onClose: () => void;
  offered: KpiId[];
  current: KpiId[];
  defaults: KpiId[];
  planLabel: string;
  onSave: (ids: KpiId[]) => void;
}) {
  const [picked, setPicked] = useState<KpiId[]>(current);
  // Re-sync each time the editor opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPicked(current);
  }

  const toggle = (id: KpiId) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_KPIS ? p : [...p, id]));
  const move = (id: KpiId, by: -1 | 1) =>
    setPicked((p) => {
      const i = p.indexOf(id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const unpicked = offered.filter((id) => !picked.includes(id));
  const tooFew = picked.length < MIN_KPIS;

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Dashboard"
      title="Customise your KPIs"
      description={`Pick ${MIN_KPIS} to ${MAX_KPIS} cards and their order. The ${planLabel} set is the starting point.`}
      width={560}
      footer={
        <div className="row" style={{ gap: 8, justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={() => setPicked(defaults)}>
            Reset to {planLabel} set
          </button>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={tooFew} onClick={() => onSave(picked)}>Save</button>
          </div>
        </div>
      }
    >
      <div className="kpi-ed">
        <div className="kpi-ed-head">
          <span className="eyebrow">On your dashboard</span>
          <span className="kpi-ed-count">{picked.length} / {MAX_KPIS}</span>
        </div>
        <ol className="kpi-ed-list">
          {picked.map((id, i) => {
            const d = BY_ID.get(id)!;
            return (
              <li key={id} className="kpi-ed-row is-on">
                <span className="kpi-ed-num">{i + 1}</span>
                <span className="kpi-ed-main">
                  <span className="kpi-ed-name">{d.name}</span>
                  <span className="kpi-ed-why">{d.why}</span>
                </span>
                <button type="button" className="kpi-ed-btn" aria-label={`Move ${d.name} up`} disabled={i === 0} onClick={() => move(id, -1)}>
                  <Icon name="chevron" size={14} style={{ transform: 'rotate(-90deg)' }} />
                </button>
                <button type="button" className="kpi-ed-btn" aria-label={`Move ${d.name} down`} disabled={i === picked.length - 1} onClick={() => move(id, 1)}>
                  <Icon name="chevron" size={14} style={{ transform: 'rotate(90deg)' }} />
                </button>
                <button type="button" className="kpi-ed-btn" aria-label={`Remove ${d.name}`} onClick={() => toggle(id)}>
                  <Icon name="close" size={13} />
                </button>
              </li>
            );
          })}
        </ol>
        {tooFew && <p className="body-xs" role="alert" style={{ margin: 0, fontWeight: 600 }}>Keep at least {MIN_KPIS} cards.</p>}

        {unpicked.length > 0 && (
          <>
            <div className="kpi-ed-head"><span className="eyebrow">Add a KPI</span></div>
            <ul className="kpi-ed-list">
              {unpicked.map((id) => {
                const d = BY_ID.get(id)!;
                return (
                  <li key={id} className="kpi-ed-row">
                    <span className="kpi-ed-main">
                      <span className="kpi-ed-name">{d.name}</span>
                      <span className="kpi-ed-why">{d.why}</span>
                    </span>
                    <button type="button" className="btn btn-sm" disabled={picked.length >= MAX_KPIS} onClick={() => toggle(id)}>
                      <Icon name="plus" size={12} /> Add
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
