import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FilingsList } from '@/components/efiling/FilingsList';
import { FilingDetail } from '@/components/efiling/FilingDetail';
import { PortalLoginPanel } from '@/components/efiling/PortalLoginPanel';
import { ProfilePanel } from '@/components/efiling/ProfilePanel';
import {
  ApplicationsModule,
  EfilingDashboard,
  NewCaseFiling,
  OathModule,
  ObjectionsModule,
  PaymentsModule,
  PleadingsModule,
  VakalatModule,
  type PortalModule,
} from '@/components/efiling/PortalModules';
import { AnchoredMenu } from '@/components/ecourts/app/AppUi';
import { useEfilingFilings, useEfilingSessionStatus, useEndEfilingSession, usePortalCounts, usePortalList, type PortalList } from '@/hooks/useEfiling';
import { useEfilingPortalStore, type PortalConnection } from '@/store/efilingPortal';
import { PageHeader } from '@/components/PageHeader';

// =============================================================================
// EfilingView - laid out like the eFiling 3.0 portal itself (official user
// manual), so an advocate finds things where the portal keeps them: one top
// menu bar, no sidebar.
//
//   Dashboard · My Partners ▾ · Case Filing ▾ · Vakalat ▾ · Pleadings ▾ ·
//   ePayments ▾ · Applications ▾ · Portfolio ▾         Advocate profile · Portal session
//
// URL: ?m=<module>, ?filing=<id> (opens that filing; used by notifications),
// ?case=<id> (start a new case filing for that matter, from the case page).
// Old links with ?tab=portal / ?tab=profile still work.
// =============================================================================

type Menu = PortalModule | 'filings' | 'profile' | 'portal';

type Item =
  | { kind: 'module'; id: Menu; label: string }
  | { kind: 'link'; to: string; label: string };

const MENUS: ReadonlyArray<{ id: string; label: string; items: ReadonlyArray<Item> }> = [
  { id: 'partners', label: 'My Partners', items: [{ kind: 'link', to: '/app/members', label: 'My Partners' }] },
  {
    id: 'case_filing',
    label: 'Case Filing',
    items: [
      { kind: 'module', id: 'new_case', label: 'New Case Filing' },
      { kind: 'link', to: '/app/clients', label: 'Manage Favourite Clients' },
      { kind: 'module', id: 'filings', label: 'All filings' },
    ],
  },
  {
    id: 'vakalat',
    label: 'Vakalat',
    items: [
      { kind: 'module', id: 'vakalat', label: 'Assign Partners to Case' },
      { kind: 'module', id: 'accept_offer', label: 'Accept Offer' },
      { kind: 'module', id: 'print_vakalat', label: 'Print Vakalat' },
    ],
  },
  {
    id: 'pleadings',
    label: 'Pleadings',
    items: [
      { kind: 'link', to: '/app/draft', label: 'Use Template' },
      { kind: 'module', id: 'pleadings', label: 'Pleadings' },
      { kind: 'module', id: 'oath', label: 'Video Recording' },
    ],
  },
  {
    id: 'epayments',
    label: 'ePayments',
    items: [
      { kind: 'module', id: 'payments', label: 'Payment' },
      { kind: 'module', id: 'wallet', label: 'Court Fee Wallet' },
    ],
  },
  {
    id: 'applications',
    label: 'Applications',
    items: [
      { kind: 'module', id: 'applications', label: 'Interlocutory Application Filing' },
      { kind: 'module', id: 'submitted_ias', label: 'Submitted Applications' },
    ],
  },
];

/** The portal's Portfolio menu is a tile grid, not a list. */
const PORTFOLIO: ReadonlyArray<{ label: string; to: string; icon: string }> = [
  { label: 'Search Cases', to: '/app/ecourts', icon: '⌕' },
  { label: 'My Cases', to: '/app/cases', icon: '▣' },
  { label: 'Planner', to: '/app/calendar', icon: '▦' },
  { label: 'Import Cases', to: '/app/ecourts', icon: '⤓' },
  { label: 'Export Cases', to: '/app/ecourts', icon: '⤒' },
  { label: 'Delete Cases', to: '/app/cases', icon: '✕' },
];

const ALL = new Set<string>([
  'dashboard', 'objections', 'profile', 'portal',
  ...MENUS.flatMap((m) => m.items.flatMap((i) => (i.kind === 'module' ? [i.id] : []))),
]);

/** Which top menu a module belongs to (for the active highlight). */
const MENU_OF: Record<string, string> = Object.fromEntries(
  MENUS.flatMap((m) => m.items.flatMap((i) => (i.kind === 'module' ? [[i.id, m.id] as const] : []))),
);

const barBtn = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 12px', border: 'none', borderRadius: 6,
  font: 'inherit', fontSize: 14, fontWeight: active ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap',
  background: active ? 'var(--bg-inverse)' : 'transparent', color: active ? 'var(--text-inverse)' : 'inherit',
});

function MenuDropdown({ menu, active, onPick }: {
  menu: (typeof MENUS)[number];
  active: boolean;
  onPick: (item: Item) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={ref} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={barBtn(active)}>
        {menu.label} <span aria-hidden style={{ fontSize: 10 }}>▾</span>
      </button>
      <AnchoredMenu anchor={ref.current} open={open} onClose={() => setOpen(false)}>
        {menu.items.map((i) => (
          <button
            key={i.label}
            type="button"
            role="menuitem"
            className="btn btn-ghost btn-sm"
            style={{ justifyContent: 'flex-start', textAlign: 'left', borderLeft: '3px solid var(--text-primary)', borderRadius: 4 }}
            onClick={() => { setOpen(false); onPick(i); }}
          >
            {i.label}{i.kind === 'link' ? ' ↗' : ''}
          </button>
        ))}
      </AnchoredMenu>
    </>
  );
}

function PortfolioDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={ref} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={barBtn(false)}>
        Portfolio <span aria-hidden style={{ fontSize: 10 }}>▾</span>
      </button>
      <AnchoredMenu anchor={ref.current} open={open} onClose={() => setOpen(false)} minWidth={300}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {PORTFOLIO.map((t) => (
            <Link
              key={t.label}
              to={t.to}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="col"
              style={{ alignItems: 'center', gap: 4, padding: '14px 8px', borderRadius: 8, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', textDecoration: 'none', fontWeight: 600, fontSize: 13 }}
            >
              <span aria-hidden style={{ fontSize: 18 }}>{t.icon}</span>
              {t.label}
            </Link>
          ))}
        </div>
      </AnchoredMenu>
    </>
  );
}

export function EfilingView() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const filingId = params.get('filing');
  const caseParam = params.get('case');
  // Old links used ?tab=portal / ?tab=profile.
  const legacyTab = params.get('tab');
  const raw = params.get('m') ?? (legacyTab === 'portal' || legacyTab === 'profile' ? legacyTab : caseParam ? 'new_case' : 'dashboard');
  const m: Menu = ALL.has(raw) ? (raw as Menu) : 'dashboard';
  const { data: filings } = useEfilingFilings();
  const objectionCount = (filings ?? []).filter((f) => f.status === 'objected').length;

  // eFiling starts with the advocate's own portal login, as on the portal.
  const connection = useEfilingPortalStore((s) => s.connection);
  const offline = useEfilingPortalStore((s) => s.offline);
  const setOffline = useEfilingPortalStore((s) => s.setOffline);
  const disconnect = useEfilingPortalStore((s) => s.disconnect);
  const endSession = useEndEfilingSession();
  const status = useEfilingSessionStatus(connection?.sessionId ?? null);
  const [ended, setEnded] = useState(false);
  // The keep-alive found no session (DifAi restarted, idle timeout, portal
  // logged it out): back to the login.
  const lost = Boolean(connection && status.isError);
  useEffect(() => {
    if (!lost) return;
    disconnect();
    setEnded(true);
  }, [lost, disconnect]);
  const logOut = () => {
    if (connection) endSession.mutate(connection.sessionId);
    disconnect();
  };

  const go = (next: Menu, extra: Record<string, string | null> = {}) => {
    const p = new URLSearchParams();
    if (next !== 'dashboard') p.set('m', next);
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    setParams(p);
  };
  const open = (id: string) => go(m, { filing: id });
  const pick = (i: Item) => (i.kind === 'link' ? navigate(i.to) : go(i.id));

  // A filing opened from a list, a notification or a link: show it in full.
  const showDetail = Boolean(filingId) && !['new_case', 'pleadings', 'oath', 'payments', 'wallet', 'applications', 'submitted_ias'].includes(m);

  if (!connection && !offline) {
    return (
      <div className="col" style={{ gap: 16, maxWidth: 1240 }}>
        <PageHeader title="eFiling" description="Log in with your own eFiling account to start, as on filing.ecourts.gov.in." />
        <section className="card col" style={{ gap: 14, maxWidth: 640 }} aria-label="eFiling login">
          <h2 className="heading-md">eFiling Services · Sign In</h2>
          {ended ? <p className="body-sm" role="status">Your eFiling session ended. Log in again to continue.</p> : null}
          {/* Logged in: the screen that was asked for (?m=, ?filing=) opens, else the Dashboard. */}
          <PortalLoginPanel onConnected={() => setEnded(false)} />
          <div className="row" style={{ gap: 8, alignItems: 'center', borderTop: '1px solid var(--border-default)', paddingTop: 12 }}>
            <span className="body-sm muted" style={{ flex: 1 }}>No eFiling login handy? You can still prepare filings and log in later.</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOffline(true)}>Prepare without logging in</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 16, maxWidth: 1240 }}>
      <PageHeader
        title="eFiling"
        description="Laid out like the eFiling 3.0 portal: prepare filings here, file on the portal, and track them until registered."
      />

      <ConnectionBar connection={connection} onLogOut={logOut} onLogIn={() => setOffline(false)} pending={endSession.isPending} />

      <nav
        aria-label="eFiling menu"
        className="card row"
        style={{ gap: 2, padding: 6, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div className="row" style={{ gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" aria-current={m === 'dashboard' ? 'page' : undefined} onClick={() => go('dashboard')} style={barBtn(m === 'dashboard')}>
            Dashboard
          </button>
          {MENUS.map((menu) => <MenuDropdown key={menu.id} menu={menu} active={MENU_OF[m] === menu.id} onPick={pick} />)}
          <PortfolioDropdown />
          <button type="button" aria-current={m === 'objections' ? 'page' : undefined} onClick={() => go('objections')} style={barBtn(m === 'objections')}>
            Objections
            {objectionCount > 0 ? <span className="badge badge-amber" style={{ fontSize: 10 }}>{objectionCount}</span> : null}
          </button>
        </div>
        <div className="row" style={{ gap: 2, flexWrap: 'wrap' }}>
          <button type="button" aria-current={m === 'profile' ? 'page' : undefined} onClick={() => go('profile')} style={barBtn(m === 'profile')}>Advocate profile</button>
          <button type="button" aria-current={m === 'portal' ? 'page' : undefined} onClick={() => go('portal')} style={barBtn(m === 'portal')}>Portal session</button>
        </div>
      </nav>

      <section aria-label="eFiling" style={{ minWidth: 0 }}>
        {showDetail ? (
          <FilingDetail filingId={filingId!} onClose={() => go(m)} />
        ) : (
          <>
            {/* Logged in: the dashboard IS the portal's - its tiles, its numbers, its lists. */}
            {m === 'dashboard' && connection ? (
              <PortalDashboard sessionId={connection.sessionId} preparedCount={(filings ?? []).filter((f) => ['draft', 'ready'].includes(f.status)).length}
                onNewCase={() => go('new_case')} onPrepared={() => go('filings')} />
            ) : null}
            {m === 'dashboard' && !connection ? <EfilingDashboard onOpen={open} onNav={(x) => go(x)} /> : null}
            {m === 'new_case' ? (
              <NewCaseFiling
                key={caseParam ?? 'new'}
                filingId={filingId}
                initialCaseId={caseParam}
                // Keep ?case= while the filing gets its id: dropping it changes
                // the key above, remounting the wizard and losing its state.
                onFiling={(id) => go('new_case', { filing: id, case: id ? caseParam : null })}
                onOpen={(id) => go('filings', { filing: id })}
              />
            ) : null}
            {m === 'filings' ? <FilingsList onOpen={open} /> : null}
            {m === 'vakalat' ? <VakalatModule view="assign" onOpen={(id) => go('filings', { filing: id })} /> : null}
            {m === 'accept_offer' ? <VakalatModule view="accept" onOpen={(id) => go('filings', { filing: id })} /> : null}
            {m === 'print_vakalat' ? <VakalatModule view="print" onOpen={(id) => go('filings', { filing: id })} /> : null}
            {m === 'pleadings' ? <PleadingsModule initialFiling={filingId} /> : null}
            {m === 'oath' ? <OathModule initialFiling={filingId} /> : null}
            {m === 'payments' ? <PaymentsModule key="payment" initialFiling={filingId} view="payment" /> : null}
            {m === 'wallet' ? <PaymentsModule key="wallet" initialFiling={filingId} view="wallet" /> : null}
            {m === 'applications' ? <ApplicationsModule key="filing" initialFiling={filingId} view="filing" onOpen={(id) => go('filings', { filing: id })} /> : null}
            {m === 'submitted_ias' ? <ApplicationsModule key="submitted" initialFiling={filingId} view="submitted" onOpen={(id) => go('filings', { filing: id })} /> : null}
            {m === 'objections' ? <ObjectionsModule onOpen={(id) => go('filings', { filing: id })} /> : null}
            {m === 'profile' ? <ProfilePanel /> : null}
            {m === 'portal' ? <PortalLoginPanel /> : null}
          </>
        )}
      </section>
    </div>
  );
}

/** Who is connected to the portal - or that DifAi is preparing offline. */
function ConnectionBar({ connection, onLogOut, onLogIn, pending }: {
  connection: PortalConnection | null;
  onLogOut: () => void;
  onLogIn: () => void;
  pending: boolean;
}) {
  return (
    <div className="card row" role="status" aria-label="eFiling connection" style={{ gap: 10, padding: '10px 14px', alignItems: 'center', flexWrap: 'wrap' }}>
      <span className={`dot ${connection ? 'dot-sage' : ''}`} aria-hidden />
      <span className="body-sm" style={{ flex: 1 }}>
        {connection
          ? <>Connected to filing.ecourts.gov.in as <strong>{connection.username}</strong>{connection.stateName ? ` · ${connection.stateName}` : ''}</>
          : <>Not connected to the eFiling portal. You can prepare filings; log in to file them.</>}
      </span>
      {connection
        ? <button type="button" className="btn btn-ghost btn-sm" onClick={onLogOut} disabled={pending}>Log out of eFiling</button>
        : <button type="button" className="btn btn-primary btn-sm" onClick={onLogIn}>Log in to eFiling</button>}
    </div>
  );
}

/**
 * The portal's own Dashboard, read over the advocate's session: the same six
 * tiles in the same order and grouping (Draft / Completed Pleadings, Draft /
 * Completed IAs, Objections, My Cases) with the portal's numbers; a tile opens
 * the portal's own table. Case Filing drafts and eFiled cases from the portal
 * follow, then what DifAi has prepared that isn't on the portal yet.
 */
function PortalDashboard({ sessionId, preparedCount, onNewCase, onPrepared }: {
  sessionId: string;
  preparedCount: number;
  onNewCase: () => void;
  onPrepared: () => void;
}) {
  // Tile numbers first (one quick read of the portal's dashboard), then the
  // list of whichever tile is open - like clicking a tile on the portal.
  const counts = usePortalCounts(sessionId);
  const [open, setOpen] = useState<PortalList['key']>('draft_pleadings');
  const list = usePortalList(sessionId, open, !counts.isLoading);
  const isLoading = counts.isLoading;
  const isFetching = counts.isFetching || list.isFetching;
  const isError = counts.isError;
  const error = counts.error;
  const refetch = () => { void counts.refetch(); void list.refetch(); };
  const shown = list.data ?? null;
  const countOf = (k: PortalList['key']) => counts.data?.counts?.[k];
  const tile = (k: PortalList['key'], label: string) => {
    const n = countOf(k);
    const on = open === k;
    return (
      <button
        key={k}
        type="button"
        className="card"
        aria-pressed={on}
        onClick={() => setOpen(k)}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 150, flex: 1, cursor: 'pointer',
          background: on ? 'var(--bg-inverse)' : undefined, color: on ? 'var(--text-inverse)' : undefined,
        }}
      >
        <span className="body-sm" style={{ fontWeight: 700, color: 'inherit' }}>{label}</span>
        <span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{isLoading ? '…' : n ?? '–'}</span>
      </button>
    );
  };
  const panel = (children: React.ReactNode) => (
    <div className="row" style={{ gap: 10, padding: 10, borderRadius: 10, border: '1px solid var(--border-default)', background: 'var(--bg-surface-2, var(--bg-subtle))', flex: '2 1 320px' }}>{children}</div>
  );
  return (
    <div className="col" style={{ gap: 16 }} aria-label="Your eFiling dashboard">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="body-sm muted">From your account on filing.ecourts.gov.in</span>
        <span className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void refetch(); }} disabled={isFetching}>{isFetching ? 'Reading…' : 'Refresh from portal'}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onNewCase}>+ New Case Filing</button>
        </span>
      </div>
      {isError ? <p className="body-sm">{(error as Error)?.message || 'Could not read the portal right now.'}</p> : null}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {panel(<>{tile('draft_pleadings', 'Draft Pleadings')}{tile('completed_pleadings', 'Completed Pleadings')}</>)}
        {panel(<>{tile('draft_ias', 'Draft IAs')}{tile('completed_ias', 'Completed IAs')}</>)}
        <div className="row" style={{ gap: 10, flex: '2 1 320px' }}>{tile('objections', 'Objections')}{tile('my_cases', 'My Cases')}</div>
      </div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <PortalCalendar calendar={counts.data?.calendar} loading={isLoading} />
        <section className="card col" style={{ gap: 10, flex: '2 1 360px' }} aria-label="Cases Listed Today">
          <h3 className="heading-sm">{counts.data?.today?.title || `Cases Listed Today - ${todayDmy()}`}</h3>
          {isLoading ? <p className="body-sm muted">Reading from filing.ecourts.gov.in…</p>
            : counts.data?.today?.table && counts.data.today.table.rows.length
              ? <PortalListTable list={{ key: 'my_cases', label: 'Cases Listed Today', total: null, error: null, ...counts.data.today.table }} />
              : <p className="body-sm muted">{counts.data?.today?.text || 'No Cases'}</p>}
        </section>
      </div>
      <section className="card col" style={{ gap: 10 }} aria-label={shown?.label ?? 'List'}>
        <h3 className="heading-sm">{shown?.label ?? LIST_LABEL[open]}</h3>
        {list.isLoading ? <p className="body-sm muted">Opening {LIST_LABEL[open]} on filing.ecourts.gov.in…</p> : null}
        {list.isError ? <p className="body-sm">{(list.error as Error)?.message || 'Could not open this list on the portal.'}</p> : null}
        {shown ? <PortalListTable list={shown} /> : null}
      </section>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        {(['draft_cases', 'filed_cases'] as const).map((k) => {
          const l = open === k ? list.data : undefined;
          return (
            <button key={k} type="button" className="card row" onClick={() => setOpen(k)} aria-pressed={open === k}
              style={{ flex: '1 1 240px', gap: 10, alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
              <span className="body-sm" style={{ fontWeight: 600 }}>Case Filing · {k === 'draft_cases' ? 'Draft Cases on the portal' : 'eFiled Cases'}</span>
              <strong>{open === k && list.isLoading ? '…' : l?.total ?? 'Open'}</strong>
            </button>
          );
        })}
        <button type="button" className="card row" onClick={onPrepared} style={{ flex: '1 1 240px', gap: 10, alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
          <span className="body-sm" style={{ fontWeight: 600 }}>Prepared in DifAi, not yet on the portal</span>
          <strong>{preparedCount}</strong>
        </button>
      </div>
    </div>
  );
}

function todayDmy() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The portal's dashboard Calendar: the month it shows, with its case-count badge on each day. */
function PortalCalendar({ calendar, loading }: { calendar?: { month: number | null; year: number | null; days: Record<string, number> }; loading: boolean }) {
  const now = new Date();
  const month = (calendar?.month ?? now.getMonth() + 1) - 1;
  const year = calendar?.year ?? now.getFullYear();
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const isThisMonth = month === now.getMonth() && year === now.getFullYear();
  const cells: Array<number | null> = [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return (
    <section className="card col" style={{ gap: 8, flex: '1 1 280px' }} aria-label="Calendar">
      <h3 className="heading-sm">Calendar</h3>
      <div className="body-sm" style={{ fontWeight: 700, textAlign: 'center' }}>{MONTHS[month]} {year}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, textAlign: 'center' }}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <span key={d} className="body-sm muted" style={{ fontWeight: 600 }}>{d}</span>)}
        {cells.map((d, i) => {
          const n = d ? calendar?.days?.[String(d)] : undefined;
          const today = isThisMonth && d === now.getDate();
          return (
            <span key={i} className="body-sm" title={n ? `${n} case${n === 1 ? '' : 's'} listed` : undefined}
              style={{ position: 'relative', padding: '6px 0', borderRadius: 6, border: today ? '1px solid var(--text-primary)' : '1px solid transparent', fontWeight: n ? 700 : 400 }}>
              {d ?? ''}
              {n ? (
                <span aria-label={`${n} cases`} style={{ position: 'absolute', top: -2, right: 0, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, fontSize: 10, lineHeight: '16px', background: 'var(--bg-inverse)', color: 'var(--text-inverse)' }}>{n}</span>
              ) : null}
            </span>
          );
        })}
      </div>
      {loading ? <span className="body-sm muted">Reading the portal calendar…</span> : null}
    </section>
  );
}

const LIST_LABEL: Record<PortalList['key'], string> = {
  draft_pleadings: 'Draft Pleadings', completed_pleadings: 'Completed Pleadings', draft_ias: 'Draft IAs', completed_ias: 'Completed IAs',
  objections: 'Objections', my_cases: 'My Cases', draft_cases: 'Draft Cases', filed_cases: 'eFiled Cases',
};

function PortalListTable({ list }: { list: PortalList }) {
  if (list.error) return <p className="body-sm">{list.label}: {list.error}</p>;
  if (list.rows.length === 0) return <p className="body-sm muted">No {list.label.toLowerCase()} on your portal account.</p>;
  const cols = Math.max(list.headers.length, ...list.rows.map((r) => ('cells' in r ? r.cells.length : 0)));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tbl" aria-label={list.label}>
        {list.headers.length ? <thead><tr>{list.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead> : null}
        <tbody>
          {list.rows.map((r, i) => ('group' in r ? (
            <tr key={i}><td colSpan={cols} style={{ fontWeight: 700, textAlign: 'center' }}>{r.group}</td></tr>
          ) : (
            <tr key={i}>{r.cells.map((c, j) => <td key={j}>{c}</td>)}</tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}
