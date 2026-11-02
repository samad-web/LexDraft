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
import { useEfilingFilings, useEfilingSessionStatus, useEndEfilingSession, useOpenPortalRow, usePortalCounts, usePortalList, type PortalList, type PortalRowView } from '@/hooks/useEfiling';
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
  const lost = Boolean(connection && (status.isError || status.data?.authenticated === false));
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
          {ended ? <p className="body-sm" role="status">Your eFiling session ended - the portal allows one login per account, so opening it in another browser signs DifAi out. Log in again to continue.</p> : null}
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
 * The portal's own Dashboard, read over the advocate's session and laid out
 * as filing.ecourts.gov.in lays it out, so nothing is in a new place: the six
 * tiles in their three panels (Draft / Completed Pleadings, Draft / Completed
 * IAs, Objections, My Cases), the Calendar, "Cases Listed Today". A tile opens
 * its list in a pop-up window with the portal's search and paging; a row's
 * View Documents / View Status opens a second window on top, tab by tab.
 */
function PortalDashboard({ sessionId, preparedCount, onNewCase, onPrepared }: {
  sessionId: string;
  preparedCount: number;
  onNewCase: () => void;
  onPrepared: () => void;
}) {
  const counts = usePortalCounts(sessionId);
  const [open, setOpen] = useState<PortalList['key'] | null>(null);
  const list = usePortalList(sessionId, open, !counts.isLoading);
  const isLoading = counts.isLoading;
  const isFetching = counts.isFetching || list.isFetching;
  const refetch = () => { void counts.refetch(); if (open) void list.refetch(); };
  // A row's button (View Documents / View Status), done on the portal.
  const openRow = useOpenPortalRow(sessionId);
  const [drill, setDrill] = useState<{ key: PortalList['key']; match: string[]; action: string } | null>(null);
  const onAction = (key: PortalList['key']) => (cells: string[], action: string) => {
    const v = { key, match: cells.slice(0, 2), action };
    setDrill(v);
    openRow.mutate(v);
  };
  const closeDrill = () => { setDrill(null); openRow.reset(); };
  const tile = (k: PortalList['key'], label: string, icon: React.ReactNode) => {
    const n = counts.data?.counts?.[k];
    return (
      <button key={k} type="button" onClick={() => setOpen(k)} aria-label={`${label}: ${n ?? 'not read yet'}`}
        style={{
          flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px 16px', cursor: 'pointer',
          background: 'var(--bg-inverse)', color: 'var(--text-inverse)', border: 'none', borderRadius: 2, textAlign: 'left',
        }}>
        <span style={{ alignSelf: 'center', textAlign: 'center', fontSize: 16, fontWeight: 600, flex: 1 }}>{label}</span>
        <span className="row" style={{ alignItems: 'center', gap: 18 }}>
          <span aria-hidden style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--text-inverse)', color: 'var(--bg-inverse)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{icon}</span>
          <span style={{ fontSize: 40, fontWeight: 500, lineHeight: 1 }}>{isLoading ? '…' : n ?? '–'}</span>
        </span>
      </button>
    );
  };
  const panel = (children: React.ReactNode) => (
    <div className="row" style={{ gap: 14, padding: 12, border: '1px solid var(--border-default)', borderRadius: 4, flex: '1 1 300px', alignItems: 'stretch' }}>{children}</div>
  );
  return (
    <div className="col" style={{ gap: 18 }} aria-label="Your eFiling dashboard">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="body-sm muted">From your account on filing.ecourts.gov.in</span>
        <span className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={refetch} disabled={isFetching}>{isFetching ? 'Reading…' : 'Refresh from portal'}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onNewCase}>+ New Case Filing</button>
        </span>
      </div>
      {counts.isError ? <p className="body-sm">{(counts.error as Error)?.message || 'Could not read the portal right now.'}</p> : null}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {panel(<>{tile('draft_pleadings', 'Draft Pleadings', <IconEdit />)}{tile('completed_pleadings', 'Completed Pleadings', <IconCheck />)}</>)}
        {panel(<>{tile('draft_ias', 'Draft IAs', <IconEdit />)}{tile('completed_ias', 'Completed IAs', <IconCheck />)}</>)}
        {panel(<>{tile('objections', 'Objections', <IconQuestion />)}{tile('my_cases', 'My Cases', <IconBriefcase />)}</>)}
      </div>
      <div className="row" style={{ gap: 30, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <PortalCalendar calendar={counts.data?.calendar} loading={isLoading} />
        <section className="col" style={{ gap: 14, flex: '1 1 420px', minWidth: 0 }} aria-label="Cases Listed Today">
          <h3 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{counts.data?.today?.title || `Cases Listed Today - ${todayDmy()}`}</h3>
          <div style={{ border: '1px solid var(--border-default)', padding: 12, minHeight: 110 }}>
            {isLoading ? <p className="body-sm muted" style={{ textAlign: 'center' }}>Reading from filing.ecourts.gov.in…</p>
              : counts.data?.today?.table && counts.data.today.table.rows.length
                ? <PortalTable rows={counts.data.today.table.rows} headers={counts.data.today.table.headers} />
                : (
                  <div className="col" style={{ alignItems: 'center', gap: 6 }}>
                    <span aria-hidden style={{ width: 68, height: 68, borderRadius: '50%', background: 'var(--bg-surface-2)', display: 'grid', placeItems: 'center' }}><IconFolder /></span>
                    <span className="body-sm">{counts.data?.today?.text || 'No Cases'}</span>
                  </div>
                )}
          </div>
        </section>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="body-sm muted">Case Filing on the portal:</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen('draft_cases')}>Draft Cases</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen('filed_cases')}>eFiled Cases</button>
        <span className="body-sm muted">·</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onPrepared}>Prepared in DifAi, not yet on the portal ({preparedCount})</button>
      </div>

      {open ? (
        <PortalModal title={LIST_LABEL[open]} onClose={() => { closeDrill(); setOpen(null); }}>
          {list.isLoading || list.isFetching ? <p className="body-sm muted">Opening {LIST_LABEL[open]} on filing.ecourts.gov.in…</p> : null}
          {list.isError ? <p className="body-sm">{(list.error as Error)?.message || 'Could not open this list on the portal.'}</p> : null}
          {list.data && !list.isFetching ? (
            list.data.error && !list.data.rows.length
              ? <p className="body-sm">{list.data.error}</p>
              : <PortalListView key={open} label={list.data.label} headers={list.data.headers} rows={list.data.rows} pageSize={25} onAction={onAction(open)} busy={openRow.isPending} />
          ) : null}
        </PortalModal>
      ) : null}
      {drill ? (
        <PortalModal level={2} title="" onClose={closeDrill}>
          <PortalRowWindow
            action={drill.action}
            view={openRow.data}
            loading={openRow.isPending}
            error={openRow.isError ? ((openRow.error as Error)?.message || 'The portal did not answer.') : null}
            onRetry={() => openRow.mutate(drill)}
          />
        </PortalModal>
      ) : null}
    </div>
  );
}

function todayDmy() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The portal's dashboard Calendar: month and year boxes, arrows, the day grid and its case-count badges. */
function PortalCalendar({ calendar, loading }: { calendar?: { month: number | null; year: number | null; days: Record<string, number> }; loading: boolean }) {
  const now = new Date();
  const [view, setView] = useState({ m: now.getMonth(), y: now.getFullYear() });
  useEffect(() => {
    if (calendar?.month && calendar.year) setView({ m: calendar.month - 1, y: calendar.year });
  }, [calendar?.month, calendar?.year]);
  const { m, y } = view;
  const shift = (by: number) => setView(({ m: mm, y: yy }) => ({ m: (mm + by + 12) % 12, y: yy + Math.floor((mm + by) / 12) }));
  const badges = calendar && calendar.month === m + 1 && calendar.year === y ? calendar.days : {};
  const first = new Date(y, m, 1).getDay();
  const total = new Date(y, m + 1, 0).getDate();
  const prevTotal = new Date(y, m, 0).getDate();
  const cells: Array<{ d: number; other: boolean }> = [
    ...Array.from({ length: first }, (_, i) => ({ d: prevTotal - first + i + 1, other: true })),
    ...Array.from({ length: total }, (_, i) => ({ d: i + 1, other: false })),
  ];
  for (let d = 1; cells.length % 7; d++) cells.push({ d, other: true });
  const cell: React.CSSProperties = { border: '1px solid var(--border-default)', padding: '6px 6px', textAlign: 'right', position: 'relative', fontSize: 15 };
  return (
    <section className="col" style={{ gap: 14, flex: '0 1 450px', minWidth: 280 }} aria-label="Calendar">
      <h3 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Calendar</h3>
      <div style={{ border: '1px solid var(--border-default)', padding: 4 }}>
        <div className="row" style={{ alignItems: 'center', gap: 6, padding: 6, background: 'var(--bg-surface-2)' }}>
          <button type="button" aria-label="Previous month" onClick={() => shift(-1)} style={calArrow}>◀</button>
          <select aria-label="Month" value={m} onChange={(e) => setView({ m: Number(e.target.value), y })} style={{ flex: 1 }}>
            {MONTHS.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
          <select aria-label="Year" value={y} onChange={(e) => setView({ m, y: Number(e.target.value) })} style={{ flex: 1 }}>
            {Array.from({ length: 7 }, (_, i) => now.getFullYear() - 3 + i).map((yy) => <option key={yy} value={yy}>{yy}</option>)}
          </select>
          <button type="button" aria-label="Next month" onClick={() => shift(1)} style={calArrow}>▶</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 2, tableLayout: 'fixed' }}>
          <thead><tr>{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <th key={d} style={{ padding: '8px 0', fontSize: 15 }}>{d}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: cells.length / 7 }, (_, w) => (
              <tr key={w}>
                {cells.slice(w * 7, w * 7 + 7).map((c, i) => {
                  const today = !c.other && c.d === now.getDate() && m === now.getMonth() && y === now.getFullYear();
                  const n = c.other ? undefined : badges[String(c.d)];
                  return (
                    <td key={i} title={n ? `${n} case${n === 1 ? '' : 's'} listed` : undefined}
                      style={{ ...cell, background: today ? 'var(--bg-surface-2)' : undefined, fontWeight: today || n ? 700 : 400, opacity: c.other ? 0.45 : 1, outline: today ? '2px solid var(--text-primary)' : undefined }}>
                      {n ? <span aria-label={`${n} cases`} style={{ position: 'absolute', top: 2, left: 3, minWidth: 16, height: 16, borderRadius: 8, fontSize: 10, lineHeight: '16px', textAlign: 'center', background: 'var(--bg-inverse)', color: 'var(--text-inverse)' }}>{n}</span> : null}
                      {c.d}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading ? <span className="body-sm muted">Reading the portal calendar…</span> : null}
    </section>
  );
}

const calArrow: React.CSSProperties = { width: 26, height: 26, borderRadius: '50%', border: 'none', background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontSize: 10, cursor: 'pointer' };

const LIST_LABEL: Record<PortalList['key'], string> = {
  draft_pleadings: 'Draft Pleadings', completed_pleadings: 'Completed Pleadings', draft_ias: 'Draft IAs', completed_ias: 'Completed IAs',
  objections: 'Objections', my_cases: 'My Cases', draft_cases: 'Draft Cases', filed_cases: 'eFiled Cases',
};

// The portal's row buttons DifAi can open and read (not file downloads).
const ROW_ACTION = /^view\b/i;

// Open windows, newest last: Escape closes only the top one, as on the portal.
const modalStack: number[] = [];

/** A pop-up window like the portal's: title, close (×), content scrolling inside. */
function PortalModal({ title, onClose, level = 1, children }: { title: string; onClose: () => void; level?: number; children: React.ReactNode }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const id = Math.random();
    modalStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(id), 1);
    };
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-label={title || 'Portal window'} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000 + level * 10, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: level > 1 ? '40px 16px' : '24px 16px', overflowY: 'auto' }}>
      <div style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', width: level > 1 ? 'min(1240px, 100%)' : 'min(1720px, 100%)', boxShadow: '0 10px 40px rgba(0,0,0,0.35)' }}>
        <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderBottom: title ? '1px solid var(--border-default)' : 'none' }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 500 }}>{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose}
            style={{ width: 42, height: 42, border: '2px solid var(--text-primary)', borderRadius: 8, background: 'transparent', color: 'inherit', fontSize: 24, lineHeight: 1, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '14px 20px 20px' }}>{children}</div>
      </div>
    </div>
  );
}

type PortalRows = PortalList['rows'];

/**
 * A portal list as the portal shows it: "Search By (eFiling Number/CNR
 * Number/Party Name)" with Search / Clear and First · Prev · pages · Next ·
 * Last, "Show N entries", the table, "Showing a to b of n entries".
 */
function PortalListView({ label, headers, rows, pageSize: initialSize, onAction, busy }: {
  label: string; headers: string[]; rows: PortalRows; pageSize: number;
  onAction?: (cells: string[], action: string) => void; busy?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [size, setSize] = useState(initialSize);
  const [page, setPage] = useState(0);
  // Each data row with the group heading it sits under.
  const items: Array<{ group: string | null; row: { cells: string[]; actions?: string[] } }> = [];
  let group: string | null = null;
  for (const r of rows) {
    if ('group' in r) group = r.group;
    else items.push({ group, row: r });
  }
  const q = query.trim().toLowerCase();
  const found = q ? items.filter((it) => `${it.group ?? ''} ${it.row.cells.join(' ')}`.toLowerCase().includes(q)) : items;
  const pages = Math.max(1, Math.ceil(found.length / size));
  const p = Math.min(page, pages - 1);
  const shown = found.slice(p * size, p * size + size);
  const pageRows: PortalRows = [];
  let last: string | null | undefined;
  for (const it of shown) {
    if (it.group && it.group !== last) pageRows.push({ group: it.group });
    last = it.group;
    pageRows.push(it.row);
  }
  const search = () => { setQuery(draft); setPage(0); };
  const pager = (
    <span className="row" style={{ border: '1px solid var(--border-default)', borderRadius: 4, overflow: 'hidden' }}>
      {[['First', 0], ['Prev', p - 1]].map(([t, to]) => <button key={t} type="button" style={pagerBtn(false)} disabled={p === 0} onClick={() => setPage(to as number)}>{t}</button>)}
      {Array.from({ length: pages }, (_, i) => i).filter((i) => Math.abs(i - p) < 3).map((i) => (
        <button key={i} type="button" style={pagerBtn(i === p)} aria-current={i === p ? 'page' : undefined} onClick={() => setPage(i)}>{i + 1}</button>
      ))}
      {[['Next', p + 1], ['Last', pages - 1]].map(([t, to]) => <button key={t} type="button" style={pagerBtn(false)} disabled={p >= pages - 1} onClick={() => setPage(to as number)}>{t}</button>)}
    </span>
  );
  const bar = (
    <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <label className="body-sm" style={{ fontWeight: 700 }} htmlFor={`q-${label}`}>Search By (eFiling Number/CNR Number/Party Name)</label>
      <input id={`q-${label}`} className="input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }} style={{ width: 210 }} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={search}>Search</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(''); setQuery(''); setPage(0); }}>Clear</button>
      {pager}
    </div>
  );
  return (
    <div className="col" style={{ gap: 14 }}>
      {bar}
      <label className="body-sm" style={{ fontWeight: 700 }}>
        Show{' '}
        <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>{' '}entries
      </label>
      {found.length ? <PortalTable headers={headers} rows={pageRows} onAction={onAction} busy={busy} />
        : <p className="body-sm muted">{q ? 'No matching entries.' : `No ${label.toLowerCase()} on your portal account.`}</p>}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="body-sm">{found.length ? `Showing ${p * size + 1} to ${p * size + shown.length} of ${found.length} entries` : 'Showing 0 entries'}</span>
      </div>
      {found.length > size ? bar : null}
    </div>
  );
}

const pagerBtn = (on: boolean): React.CSSProperties => ({
  padding: '6px 14px', border: 'none', borderLeft: '1px solid var(--border-default)', cursor: 'pointer', fontWeight: 600,
  background: on ? 'var(--bg-inverse)' : 'var(--bg-surface-2)', color: on ? 'var(--text-inverse)' : 'inherit',
});

/** The portal's table look: dark header row, bordered cells, each cell's lines kept, its View buttons where the portal has them. */
function PortalTable({ headers, rows, onAction, busy }: { headers: string[]; rows: PortalRows; onAction?: (cells: string[], action: string) => void; busy?: boolean }) {
  const cols = Math.max(headers.length, ...rows.map((r) => ('cells' in r ? r.cells.length : 0)));
  const td: React.CSSProperties = { padding: '10px 8px', borderRight: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)', verticalAlign: 'top', textAlign: 'center', whiteSpace: 'pre-line', fontSize: 14 };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {headers.length ? (
          <thead>
            <tr>{headers.map((h, i) => <th key={i} style={{ ...td, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700, fontSize: 15, verticalAlign: 'middle' }}>{h}</th>)}</tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((r, i) => ('group' in r ? (
            <tr key={i}><td colSpan={cols} style={{ ...td, textAlign: 'left', fontWeight: 700, background: 'var(--bg-surface-2)' }}>{r.group}</td></tr>
          ) : (
            <tr key={i} style={{ background: i % 2 ? undefined : 'var(--bg-surface-2)' }}>
              {r.cells.map((c, j) => {
                const act = onAction && r.actions?.find((a) => ROW_ACTION.test(a) && a === c.trim());
                return (
                  <td key={j} style={td}>
                    {act ? (
                      <button type="button" disabled={busy} onClick={() => onAction!(r.cells, act)}
                        style={{ background: 'var(--bg-inverse)', color: 'var(--text-inverse)', border: 'none', borderRadius: 4, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{act}</button>
                    ) : c}
                  </td>
                );
              })}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

/** What a row's button opened on the portal: its heading lines and its tabs (Document, Application, Court Fee, Oath). */
function PortalRowWindow({ action, view, loading, error, onRetry }: {
  action: string; view?: PortalRowView; loading: boolean; error: string | null; onRetry: () => void;
}) {
  const [tab, setTab] = useState(0);
  useEffect(() => { setTab(0); }, [view]);
  const section = view?.sections[tab];
  if (loading) return <p className="body-sm muted">Opening {action} on filing.ecourts.gov.in… (the portal loads each part in turn)</p>;
  if (error) return <p className="body-sm">{error} <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>Try again</button></p>;
  if (!view) return null;
  return (
    <div className="col" style={{ gap: 14 }}>
      {view.title.length ? (
        <div className="col" style={{ gap: 4, textAlign: 'center' }}>
          {view.title.map((t, i) => <span key={i} style={{ fontWeight: 700, fontSize: 17 }}>{t}</span>)}
        </div>
      ) : null}
      {view.sections.length > 1 ? (
        <div className="row" role="tablist" style={{ gap: 4, flexWrap: 'wrap', padding: 4, background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)' }}>
          {view.sections.map((s, i) => (
            <button key={s.name} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)}
              style={{ padding: '8px 18px', fontSize: 16, cursor: 'pointer', border: '1px solid var(--border-default)', borderRadius: 3,
                background: tab === i ? 'var(--bg-inverse)' : 'var(--bg-surface)', color: tab === i ? 'var(--text-inverse)' : 'inherit' }}>{s.name}</button>
          ))}
        </div>
      ) : null}
      {section ? (
        section.table && section.table.rows.length
          ? <PortalListView key={`${tab}-${section.name}`} label={section.name} headers={section.table.headers} rows={section.table.rows} pageSize={10} />
          : <p className="body-sm muted">{section.text || `Nothing under ${section.name} on the portal.`}</p>
      ) : null}
    </div>
  );
}

const svgProps = { width: 30, height: 30, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const IconEdit = () => <svg {...svgProps}><path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>;
const IconCheck = () => <svg {...svgProps} strokeWidth={3.2}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const IconQuestion = () => <svg {...svgProps}><path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4.5" /><path d="M12 18.5h.01" /></svg>;
const IconBriefcase = () => <svg {...svgProps}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></svg>;
const IconFolder = () => <svg {...svgProps}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
