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
import {
  useEfilingFilings, useEfilingSessionStatus, useEndEfilingSession, useOpenMyCaseHistory, useOpenPortalFile, useOpenPortalRow, usePortalCounts, usePortalList, usePortalMyCases,
  type MyCase, type MyCasesFilter, type MyCasesGroup, type PortalBlock, type PortalFileRequest, type PortalList, type PortalMyCases, type PortalRowView,
} from '@/hooks/useEfiling';
import { useEfilingPortalStore, type PortalConnection } from '@/store/efilingPortal';
import { PageHeader } from '@/components/PageHeader';
import { PortalHeader, type ChromeMenu } from '@/components/efiling/PortalChrome';
import { PortalTabs } from '@/components/efiling/PortalForm';
import '@/styles/efiling-portal.css';
import { PortalEpay } from '@/components/efiling/portal/PortalEpay';
import { PortalApplications } from '@/components/efiling/portal/PortalApplications';
import { PortalPleadings } from '@/components/efiling/portal/PortalPleadings';
import { PortalVakalat } from '@/components/efiling/portal/PortalVakalat';
import { PortalPortfolio } from '@/components/efiling/portal/PortalPortfolio';
import { PortalCaseFiling } from '@/components/efiling/portal/PortalCaseFiling';
import { CellWithLinks, PortalListView, PortalModal, PortalTable, ROW_ACTION, type PortalRows } from '@/components/efiling/PortalKit';
import { PortalSyncWindow } from '@/components/efiling/PortalSync';
import { syncMenuLabel, usePortalSync } from '@/hooks/efiling/sync';

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

/** Screens that exist only on the portal: they open live once logged in. */
type PortalOnly =
  | 'add_partner' | 'accept_partnership' | 'revoke_partnership' | 'accept_revocation' | 'partners_report'
  | 'fav_clients' | 'draft_cases' | 'filed_cases' | 'templates'
  | 'search_cases' | 'planner' | 'export_cases' | 'my_cases' | 'import_cases';

type Menu = PortalModule | PortalOnly | 'filings' | 'profile' | 'portal';

type Item =
  | { kind: 'module'; id: Menu; label: string }
  | { kind: 'link'; to: string; label: string };

// The portal's own menus and items, in its order (taken from the live portal).
const MENUS: ReadonlyArray<{ id: string; label: string; items: ReadonlyArray<Item> }> = [
  {
    id: 'partners',
    label: 'My Partners',
    items: [
      { kind: 'module', id: 'add_partner', label: 'Add Partners' },
      { kind: 'module', id: 'accept_partnership', label: 'Accept Partnership' },
      { kind: 'module', id: 'revoke_partnership', label: 'Revoke Partnership' },
      { kind: 'module', id: 'accept_revocation', label: 'Accept Revocation' },
      { kind: 'module', id: 'partners_report', label: 'My Partners Report' },
    ],
  },
  {
    id: 'case_filing',
    label: 'Case Filing',
    items: [
      { kind: 'module', id: 'new_case', label: 'New Case Filing' },
      { kind: 'module', id: 'fav_clients', label: 'Manage Favourite Clients' },
      { kind: 'module', id: 'draft_cases', label: 'Draft Cases' },
      { kind: 'module', id: 'filed_cases', label: 'eFiled Cases' },
      { kind: 'module', id: 'filings', label: 'Prepared in DifAi' },
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
      { kind: 'module', id: 'templates', label: 'Use Template' },
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
  {
    id: 'portfolio',
    label: 'Portfolio',
    items: [
      { kind: 'module', id: 'search_cases', label: 'Search Cases' },
      { kind: 'module', id: 'planner', label: 'Planner' },
      { kind: 'module', id: 'export_cases', label: 'Export Cases' },
      { kind: 'module', id: 'my_cases', label: 'My Cases' },
      { kind: 'module', id: 'import_cases', label: 'Import Cases' },
    ],
  },
];

const PORTAL_ONLY_LABEL: Record<PortalOnly, string> = Object.fromEntries(
  MENUS.flatMap((m) => m.items.flatMap((i) => (i.kind === 'module' ? [[i.id, i.label] as const] : []))),
) as Record<PortalOnly, string>;
const PORTAL_ONLY = new Set<string>([
  'add_partner', 'accept_partnership', 'revoke_partnership', 'accept_revocation', 'partners_report',
  'fav_clients', 'draft_cases', 'filed_cases', 'templates', 'search_cases', 'planner', 'export_cases', 'my_cases', 'import_cases',
]);

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
  const showDetail = Boolean(filingId) && !['new_case', 'pleadings', 'oath', 'payments', 'wallet', 'applications', 'submitted_ias'].includes(m) && !PORTAL_ONLY.has(m);

  // Text size and contrast, as the portal's A- A A+ bar sets them (this tab).
  const [zoom, setZoom] = useState(1);
  const [contrast, setContrast] = useState(false);
  // Portal -> DifAi sync: its status sits in the advocate's name menu, its window is DifAi's own.
  const sync = usePortalSync(connection?.sessionId ?? null);
  const [syncOpen, setSyncOpen] = useState(false);

  const screens = (
    <>
            {/* Logged in: the dashboard IS the portal's - its tiles, its numbers, its lists. */}
            {m === 'dashboard' && connection ? (
              <PortalDashboard key="dash" sessionId={connection.sessionId} preparedCount={(filings ?? []).filter((f) => ['draft', 'ready'].includes(f.status)).length}
                onNewCase={() => go('new_case')} onPrepared={() => go('filings')} />
            ) : null}
            {m === 'my_cases' && connection ? (
              <PortalDashboard key="dash-my-cases" sessionId={connection.sessionId} initialOpen="my_cases" preparedCount={(filings ?? []).filter((f) => ['draft', 'ready'].includes(f.status)).length}
                onNewCase={() => go('new_case')} onPrepared={() => go('filings')} />
            ) : null}
            {/* Portal-only screens, live on the advocate's own portal session. */}
            {connection && ['add_partner', 'accept_partnership', 'revoke_partnership', 'accept_revocation', 'partners_report'].includes(m) ? (
              <PortalVakalat key={`p-${m}`} sessionId={connection.sessionId} view={m as 'add_partner'} />
            ) : null}
            {connection && (m === 'draft_cases' || m === 'filed_cases') ? <PortalCaseFiling key={`p-${m}`} sessionId={connection.sessionId} view={m} /> : null}
            {connection && m === 'fav_clients' ? <PortalCaseFiling key="p-clients" sessionId={connection.sessionId} view="clients" /> : null}
            {connection && m === 'templates' ? <PortalPleadings key="p-templates" sessionId={connection.sessionId} view="templates" /> : null}
            {connection && ['search_cases', 'planner', 'export_cases', 'import_cases'].includes(m) ? (
              <PortalPortfolio key={`p-${m}`} sessionId={connection.sessionId} view={m} />
            ) : null}
            {!connection && PORTAL_ONLY.has(m) ? (
              <section className="card col" style={{ gap: 10, maxWidth: 640 }}>
                <h2 className="heading-md">{PORTAL_ONLY_LABEL[m as PortalOnly]}</h2>
                <p className="body-sm">This screen is on the eFiling portal itself. Log in with your eFiling account to open it here.</p>
                <span><button type="button" className="btn btn-primary btn-sm" onClick={() => setOffline(false)}>Log in to eFiling</button></span>
              </section>
            ) : null}
            {m === 'dashboard' && !connection ? <EfilingDashboard onOpen={open} onNav={(x) => go(x)} /> : null}
            {m === 'new_case' && connection && !caseParam && !filingId ? (
              <PortalCaseFiling key="p-new-case" sessionId={connection.sessionId} view="new_case" />
            ) : null}
            {m === 'new_case' && !(connection && !caseParam && !filingId) ? (
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
            {m === 'vakalat' ? (connection ? <PortalVakalat key="p-vakalat" sessionId={connection.sessionId} view="vakalat" /> : <VakalatModule view="assign" onOpen={(id) => go('filings', { filing: id })} />) : null}
            {m === 'accept_offer' ? (connection ? <PortalVakalat key="p-accept" sessionId={connection.sessionId} view="accept_offer" /> : <VakalatModule view="accept" onOpen={(id) => go('filings', { filing: id })} />) : null}
            {m === 'print_vakalat' ? (connection ? <PortalVakalat key="p-print" sessionId={connection.sessionId} view="print_vakalat" /> : <VakalatModule view="print" onOpen={(id) => go('filings', { filing: id })} />) : null}
            {m === 'pleadings' ? (connection ? <PortalPleadings key="p-pleadings" sessionId={connection.sessionId} view="pleadings" /> : <PleadingsModule initialFiling={filingId} />) : null}
            {m === 'oath' ? (connection ? <PortalPleadings key="p-oath" sessionId={connection.sessionId} view="oath" /> : <OathModule initialFiling={filingId} />) : null}
            {/* Logged in: the portal's own screens; otherwise DifAi's preparation screens. */}
            {m === 'payments' ? (connection ? <PortalEpay key="p-payments" sessionId={connection.sessionId} view="payments" /> : <PaymentsModule key="payment" initialFiling={filingId} view="payment" />) : null}
            {m === 'wallet' ? (connection ? <PortalEpay key="p-wallet" sessionId={connection.sessionId} view="wallet" /> : <PaymentsModule key="wallet" initialFiling={filingId} view="wallet" />) : null}
            {m === 'applications' ? (connection ? <PortalApplications key="p-apps" sessionId={connection.sessionId} view="applications" /> : <ApplicationsModule key="filing" initialFiling={filingId} view="filing" onOpen={(id) => go('filings', { filing: id })} />) : null}
            {m === 'submitted_ias' ? (connection ? <PortalApplications key="p-submitted" sessionId={connection.sessionId} view="submitted_ias" /> : <ApplicationsModule key="submitted" initialFiling={filingId} view="submitted" onOpen={(id) => go('filings', { filing: id })} />) : null}
            {m === 'objections' ? <ObjectionsModule onOpen={(id) => go('filings', { filing: id })} /> : null}
            {m === 'profile' ? <ProfilePanel /> : null}
            {m === 'portal' ? <PortalLoginPanel /> : null}
    </>
  );

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

  if (connection) {
    // The portal's own menus (DifAi's "Prepared in DifAi" lives in the advocate's name menu).
    const chromeMenus: ChromeMenu[] = MENUS.map((mn) => ({
      id: mn.id,
      label: mn.label,
      items: mn.items.filter((i) => !(i.kind === 'module' && i.id === 'filings')).map((i) => ({ label: i.label, onPick: () => pick(i) })),
    }));
    const switchState = (st: { code: number; name: string }) => {
      try {
        const raw = localStorage.getItem('difai.efiling.lastLogin');
        const last = raw ? JSON.parse(raw) : {};
        localStorage.setItem('difai.efiling.lastLogin', JSON.stringify({ ...last, stateCode: String(st.code) }));
      } catch { /* the login form just asks for the state */ }
      logOut();
    };
    return (
      <div className={`efp${contrast ? ' efp-hc' : ''}`} style={{ zoom }}>
        <PortalHeader
          menus={chromeMenus}
          activeMenu={m === 'dashboard' ? null : (MENU_OF[m] ?? null)}
          onDashboard={() => go('dashboard')}
          username={connection.username}
          stateName={connection.stateName}
          zoom={zoom}
          setZoom={setZoom}
          contrast={contrast}
          setContrast={setContrast}
          onLogOut={logOut}
          onSwitchState={switchState}
          userItems={[
            { label: 'My Profile', onPick: () => go('profile') },
            { label: syncMenuLabel(sync.data), onPick: () => setSyncOpen(true) },
            { label: `Prepared in DifAi (${(filings ?? []).filter((f) => ['draft', 'ready'].includes(f.status)).length})`, onPick: () => go('filings') },
            { label: `DifAi objection tracker${objectionCount ? ` (${objectionCount})` : ''}`, onPick: () => go('objections') },
            { label: 'Portal session', onPick: () => go('portal') },
            { label: 'Logout', onPick: logOut },
          ]}
        />
        <section aria-label="eFiling" style={{ minWidth: 0, padding: '18px 6px 24px' }}>
          {showDetail ? <FilingDetail filingId={filingId!} onClose={() => go(m)} /> : screens}
        </section>
        {syncOpen ? <PortalSyncWindow sessionId={connection.sessionId} onClose={() => setSyncOpen(false)} /> : null}
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
        {showDetail ? <FilingDetail filingId={filingId!} onClose={() => go(m)} /> : screens}
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
function PortalDashboard({ sessionId, preparedCount, onNewCase, onPrepared, initialOpen }: {
  sessionId: string;
  initialOpen?: PortalList['key'];
  preparedCount: number;
  onNewCase: () => void;
  onPrepared: () => void;
}) {
  const counts = usePortalCounts(sessionId);
  const [open, setOpen] = useState<PortalList['key'] | null>(initialOpen ?? null);
  // My Cases is the portal's portfolio widget, not a list: read on its own.
  const list = usePortalList(sessionId, open === 'my_cases' ? null : open, !counts.isLoading);
  const myCases = usePortalMyCases(sessionId, open === 'my_cases' && !counts.isLoading);
  const isLoading = counts.isLoading;
  const isFetching = counts.isFetching || list.isFetching || myCases.isFetching;
  const refetch = () => { void counts.refetch(); if (open === 'my_cases') void myCases.refetch(); else if (open) void list.refetch(); };
  // A case number in My Cases -> its case history; a hearing date in it -> Daily Status.
  const history = useOpenMyCaseHistory(sessionId);
  const daily = useOpenMyCaseHistory(sessionId);
  const [historyOf, setHistoryOf] = useState<MyCase | null>(null);
  const [dailyOf, setDailyOf] = useState<{ text: string; nth: number } | null>(null);
  const openHistory = (c: MyCase) => { setHistoryOf(c); history.mutate({ cino: c.cino, court: c.court }); };
  const closeDaily = () => { setDailyOf(null); daily.reset(); };
  const closeHistory = () => { closeDaily(); setHistoryOf(null); history.reset(); };
  // A row's button (View Documents / View Status), done on the portal.
  const openRow = useOpenPortalRow(sessionId);
  const [drill, setDrill] = useState<{ key: PortalList['key']; match: string[]; action: string } | null>(null);
  const onAction = (key: PortalList['key']) => (cells: string[], action: string) => {
    const v = { key, match: cells.slice(0, 2), action };
    setDrill(v);
    openRow.mutate(v, {
      // Some "View" buttons open the case PDF (eFiled Cases > View): show it as a document.
      onSuccess: (r) => {
        if (!r.file) return;
        setDrill(null);
        openRow.reset();
        showFile({ key, match: v.match, link: action });
      },
    });
  };
  const closeDrill = () => { setDrill(null); openRow.reset(); };
  // A document link (Acknowledgement, COMPLAINT ...): the PDF the portal shows.
  const openFile = useOpenPortalFile(sessionId);
  const [file, setFile] = useState<PortalFileRequest | null>(null);
  const showFile = (v: PortalFileRequest) => { setFile(v); openFile.mutate(v); };
  const closeFile = () => {
    if (openFile.data) URL.revokeObjectURL(openFile.data.url);
    setFile(null);
    openFile.reset();
  };
  const tile = (k: PortalList['key'], label: string, icon: React.ReactNode) => {
    const n = counts.data?.counts?.[k];
    return (
      <button key={k} type="button" onClick={() => setOpen(k)} aria-label={`${label}: ${n ?? 'not read yet'}`}
        style={{
          flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px 16px', cursor: 'pointer',
          background: 'var(--bg-inverse)', color: 'var(--text-inverse)', border: 'none', borderRadius: 2, textAlign: 'left',
        }}>
        <span style={{ alignSelf: 'center', textAlign: 'center', fontSize: 16, fontWeight: 500, flex: 1 }}>{label}</span>
        <span className="row" style={{ alignItems: 'center', gap: 18 }}>
          <span aria-hidden style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--text-inverse)', color: 'var(--bg-inverse)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{icon}</span>
          <span style={{ fontSize: 40, fontWeight: 500, lineHeight: 1 }}>{isLoading ? '…' : n ?? '–'}</span>
        </span>
      </button>
    );
  };
  const panel = (children: React.ReactNode) => (
    <div className="row" style={{ gap: 30, padding: 12, border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)', borderRadius: 4, flex: '1 1 300px', alignItems: 'stretch' }}>{children}</div>
  );
  return (
    <div className="col" style={{ gap: 18 }} aria-label="Your eFiling dashboard">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={refetch} disabled={isFetching} title="Read the dashboard again from filing.ecourts.gov.in">{isFetching ? 'Reading…' : '↻ Refresh'}</button>
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
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{counts.data?.today?.title || `Cases Listed Today - ${todayDmy()}`}</h3>
          <div style={{ border: '1px solid var(--border-default)', padding: 12, minHeight: 110 }}>
            {isLoading ? <p className="body-sm muted" style={{ textAlign: 'center' }}>Reading from filing.ecourts.gov.in…</p>
              : counts.data?.today?.table && counts.data.today.table.rows.length
                ? <PortalTable rows={counts.data.today.table.rows} headers={counts.data.today.table.headers} />
                : (
                  <div className="col" style={{ alignItems: 'center', gap: 6 }}>
                    <span aria-hidden style={{ width: 68, height: 68, borderRadius: '50%', background: 'var(--bg-surface-2)', color: 'var(--text-primary)', display: 'grid', placeItems: 'center' }}><IconFolder /></span>
                    <span className="body-sm">{counts.data?.today?.text || 'No Cases'}</span>
                  </div>
                )}
          </div>
        </section>
      </div>

      {open ? (
        <PortalModal title={LIST_LABEL[open]} onClose={() => { closeDrill(); closeHistory(); setOpen(null); }}>
          {open === 'my_cases' ? (
            <MyCasesWindow
              data={myCases.data}
              loading={myCases.isLoading || myCases.isFetching}
              error={myCases.isError ? ((myCases.error as Error)?.message || 'Could not open My Cases on the portal.') : null}
              onCase={openHistory}
              busy={history.isPending}
            />
          ) : null}
          {open !== 'my_cases' && (list.isLoading || list.isFetching) ?<p className="body-sm muted">Opening {LIST_LABEL[open]} on filing.ecourts.gov.in…</p> : null}
          {list.isError ? <p className="body-sm">{(list.error as Error)?.message || 'Could not open this list on the portal.'}</p> : null}
          {open !== 'my_cases' && list.data && !list.isFetching ? (
            list.data.error && !list.data.rows.length
              ? <p className="body-sm">{list.data.error}</p>
              : <PortalListView key={open} label={list.data.label} headers={list.data.headers} rows={list.data.rows} pageSize={25} onAction={onAction(open)} busy={openRow.isPending || openFile.isPending}
                  onLink={(cells, link) => showFile({ key: open, match: cells.slice(0, 2), link })} />
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
            busy={openFile.isPending}
            onLink={(tab, cells, link) => showFile({ key: drill.key, match: drill.match, action: drill.action, tab, docRow: cells.slice(0, 2), link })}
          />
        </PortalModal>
      ) : null}
      {historyOf ? (
        <PortalModal level={2} title={`${historyOf.caseNo}${historyOf.filing ? ' (F)' : ''}`} onClose={closeHistory}>
          {history.isPending ? <p className="body-sm muted">Opening the case history on filing.ecourts.gov.in…</p> : null}
          {history.isError ? (
            <p className="body-sm">{(history.error as Error)?.message || 'The portal did not show this case history.'}{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openHistory(historyOf)}>Try again</button></p>
          ) : null}
          {history.data ? (
            <PortalBlocks blocks={history.data.blocks} busy={daily.isPending}
              onLink={(text, nth) => { setDailyOf({ text, nth }); daily.mutate({ cino: historyOf.cino, court: historyOf.court, link: { text, nth } }); }} />
          ) : null}
        </PortalModal>
      ) : null}
      {historyOf && dailyOf ? (
        <PortalModal level={3} title="Daily Status" onClose={closeDaily}>
          {daily.isPending ? <p className="body-sm muted">Opening {dailyOf.text} on filing.ecourts.gov.in…</p> : null}
          {daily.isError ? (
            <p className="body-sm">{(daily.error as Error)?.message || 'The portal did not show the Daily Status.'}{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => daily.mutate({ cino: historyOf.cino, court: historyOf.court, link: dailyOf })}>Try again</button></p>
          ) : null}
          {daily.data ? <PortalBlocks blocks={daily.data.blocks} /> : null}
        </PortalModal>
      ) : null}
      {file ? (
        <PortalModal level={3} title={file.link} onClose={closeFile}>
          {openFile.isPending ? <p className="body-sm muted">Opening {file.link} on filing.ecourts.gov.in…</p> : null}
          {openFile.isError ? (
            <p className="body-sm">{(openFile.error as Error)?.message || 'The portal did not open this document.'}{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => openFile.mutate(file)}>Try again</button></p>
          ) : null}
          {openFile.data ? (
            <div className="col" style={{ gap: 10 }}>
              <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <a className="btn btn-ghost btn-sm" href={openFile.data.url} target="_blank" rel="noreferrer">Open in new tab</a>
                <a className="btn btn-ghost btn-sm" href={openFile.data.url} download={openFile.data.name}>Download</a>
              </span>
              <iframe title={file.link} src={openFile.data.url} style={{ width: '100%', height: '78vh', border: '1px solid var(--border-default)' }} />
            </div>
          ) : null}
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
  const cell: React.CSSProperties = { border: '1px solid var(--border-default)', background: 'var(--bg-surface)', color: 'var(--text-primary)', padding: '4px 6px', textAlign: 'right', position: 'relative', fontSize: 14 };
  return (
    <section className="col" style={{ gap: 14, flex: '0 1 450px', minWidth: 280 }} aria-label="Calendar">
      <h3 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Calendar</h3>
      <div style={{ border: '1px solid var(--border-default)', padding: 4 }}>
        <div className="row" style={{ alignItems: 'center', gap: 6, padding: 6, background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)', borderRadius: 3 }}>
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
                      style={{ ...cell, background: today ? 'var(--bg-surface-2)' : cell.background, outline: today ? '2px solid var(--text-primary)' : undefined, fontWeight: today || n ? 700 : 400, opacity: c.other ? 0.45 : 1 }}>
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

const calArrow: React.CSSProperties = { width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontSize: 9, cursor: 'pointer' };

const LIST_LABEL: Record<PortalList['key'], string> = {
  draft_pleadings: 'Draft Pleadings', completed_pleadings: 'Completed Pleadings', draft_ias: 'Draft IAs', completed_ias: 'Completed IAs',
  objections: 'Objections', my_cases: 'My Cases', draft_cases: 'Draft Cases', filed_cases: 'eFiled Cases',
};

/** What a row's button opened on the portal: its heading lines and its tabs (Document, Application, Court Fee, Oath). */
function PortalRowWindow({ action, view, loading, error, onRetry, onLink, busy }: {
  action: string; view?: PortalRowView; loading: boolean; error: string | null; onRetry: () => void;
  onLink?: (tab: string | undefined, cells: string[], link: string) => void; busy?: boolean;
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
          ? <PortalListView key={`${tab}-${section.name}`} label={section.name} headers={section.table.headers} rows={section.table.rows} pageSize={10} busy={busy} variant="datatable"
              onLink={onLink ? (cells, link) => onLink(view.sections.length > 1 ? section.name : undefined, cells, link) : undefined} />
          : <p className="body-sm muted">{section.text || `Nothing under ${section.name} on the portal.`}</p>
      ) : null}
    </div>
  );
}

/** yyyy-mm-dd -> dd-mm-yyyy, as the portal writes dates. */
const dmy = (iso: string) => iso.split('-').reverse().join('-');

/**
 * The portal's My Cases widget (js/portfolio/my_cases.js): Date wise /
 * District wise with the case count and "[Last refreshed on ...]", Search
 * Keyword, the Pending / Disposed / Both tabs, then "District Court Cases" /
 * "High Court Cases" with a collapsible panel per district (or per date),
 * each holding a table per establishment. A case number opens its history.
 */
function MyCasesWindow({ data, loading, error, onCase, busy }: {
  data?: PortalMyCases; loading: boolean; error: string | null; onCase: (c: MyCase) => void; busy?: boolean;
}) {
  // The portal starts District wise (sessionStorage DATEWISE unset) on Both (getData clicks #bothBtn).
  const [datewise, setDatewise] = useState(false);
  const [filter, setFilter] = useState<MyCasesFilter>('Both');
  const [keyword, setKeyword] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  if (loading) return <p className="body-sm muted">Opening My Cases on filing.ecourts.gov.in…</p>;
  if (error) return <p className="body-sm">{error}</p>;
  if (!data) return null;
  if (!data.cases.length) return <p className="body-sm">{data.message || 'No cases in My Cases on your portal account.'}</p>;

  // Search Keyword: one case picked -> only that case, as getMyCasesFromCINO1 draws it.
  const pick = (groups: MyCasesGroup[]): MyCasesGroup[] => {
    if (!keyword) return groups;
    return groups.flatMap((g) => {
      const establishments = g.establishments.map((e) => ({ ...e, cases: e.cases.filter((i) => data.cases[i]!.cino === keyword) })).filter((e) => e.cases.length);
      return establishments.length ? [{ ...g, count: establishments.reduce((n, e) => n + e.cases.length, 0), establishments }] : [];
    });
  };
  const view = data.views[datewise ? 'date' : 'district'][filter];
  const toggle = (k: string) => setOpenGroups((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const seg = (on: boolean): React.CSSProperties => ({
    padding: '6px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--text-primary)',
    background: on ? 'var(--bg-inverse)' : 'var(--bg-surface)', color: on ? 'var(--text-inverse)' : 'inherit',
  });
  const options = [...data.cases].sort((a, b) => a.caseNo.localeCompare(b.caseNo));
  const courts: Array<{ k: 'd' | 'h'; label: string }> = [{ k: 'd', label: 'District Court Cases' }, { k: 'h', label: 'High Court Cases' }];
  return (
    <div className="col" style={{ gap: 12 }} aria-label="My Cases">
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="row" role="group" aria-label="Group cases">
            <button type="button" aria-pressed={datewise} onClick={() => setDatewise(true)} style={{ ...seg(datewise), borderRadius: '4px 0 0 4px' }}>Date wise</button>
            <button type="button" aria-pressed={!datewise} onClick={() => setDatewise(false)} style={{ ...seg(!datewise), borderRadius: '0 4px 4px 0', borderLeft: 'none' }}>District wise</button>
          </span>
          <span aria-label={`${data.count} cases`} style={{ minWidth: 22, padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 700, textAlign: 'center', background: 'var(--bg-inverse)', color: 'var(--text-inverse)' }}>{data.count}</span>
          {data.lastRefreshed ? <span className="body-sm">[Last refreshed on {data.lastRefreshed}]</span> : null}
        </div>
        <label className="row body-sm" style={{ gap: 8, alignItems: 'center', fontWeight: 700 }}>
          Search Keyword
          <select value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 300, maxWidth: '60vw', height: 32, fontWeight: 400 }}>
            <option value="">Select</option>
            {options.map((c) => <option key={`${c.court}${c.cino}`} value={c.cino}>{c.caseNo}{c.filing ? ' (F)' : ''} - {c.petName} Vs {c.resName}</option>)}
          </select>
        </label>
      </div>
      {/* The portal's Pending / Disposed / Both tab strip. */}
      <PortalTabs tabs={(['Pending', 'Disposed', 'Both'] as const).map((f) => ({ key: f, label: f }))} active={filter} onPick={setFilter} />
      {courts.map(({ k, label }) => {
        // The band shows whenever that court list has cases (showHideDivsIfCasesExist).
        if (!data.cases.some((c) => c.court === k)) return null;
        const groups = pick(view[k]);
        return (
          <section key={k} className="col" style={{ gap: 6 }} aria-label={label}>
            <h3 className="row" style={{ gap: 8, alignItems: 'center', margin: 0, padding: '8px 12px', fontSize: 17, fontWeight: 700, background: 'var(--bg-inverse)', color: 'var(--text-inverse)' }}>
              <IconBank /> {label}
            </h3>
            {!groups.length ? <p className="body-sm muted" style={{ margin: '4px 0' }}>No {filter === 'Both' ? '' : `${filter.toLowerCase()} `}cases.</p> : null}
            {groups.map((g) => {
              const id = `${datewise ? 'date' : 'district'}:${k}:${g.title}`;
              const expanded = openGroups.has(id) || !!keyword;
              return (
                <div key={id} className="col" style={{ gap: 0 }}>
                  {g.divider ? <div style={{ fontWeight: 700, fontSize: 15, padding: '8px 2px 4px', borderBottom: '2px solid var(--text-primary)' }}>{g.divider}</div> : null}
                  <button type="button" aria-expanded={expanded} onClick={() => toggle(id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '10px 12px', font: 'inherit', fontWeight: 700, fontSize: 15, cursor: 'pointer', border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)', color: 'inherit' }}>
                    <span aria-hidden style={{ fontSize: 11 }}>{expanded ? '▼' : '▶'}</span>
                    {g.title} ({g.count})
                  </button>
                  {expanded ? (
                    <div className="col" style={{ gap: 8, padding: 8, border: '1px solid var(--border-default)', borderTop: 'none' }}>
                      {g.establishments.map((e) => (
                        <div key={e.name} className="col" style={{ gap: 4 }}>
                          <div style={{ fontWeight: 700, padding: '6px 10px', border: '1px solid var(--border-default)' }}>
                            {e.name}({e.cases.length}){datewise && e.district ? `, ${e.district}` : ''}
                          </div>
                          <MyCasesTable cases={e.cases.map((i) => data.cases[i]!)} onCase={onCase} busy={busy} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/** One establishment's cases, with the portal's columns. */
function MyCasesTable({ cases, onCase, busy }: { cases: MyCase[]; onCase: (c: MyCase) => void; busy?: boolean }) {
  const td: React.CSSProperties = { padding: '8px', borderRight: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)', verticalAlign: 'top', fontSize: 14 };
  const tag: React.CSSProperties = { display: 'inline-block', marginTop: 4, padding: '1px 6px', borderRadius: 3, fontSize: 11, fontWeight: 700, border: '1px solid var(--text-primary)' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{['Sr No', 'Case Number', 'Next/Disposal Date', 'Status', 'Cause Title', 'Representing', 'Registration Date'].map((h) => (
            <th key={h} style={{ ...td, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', textAlign: 'left' }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {cases.map((c, i) => {
            const when = c.decisionDate ?? c.nextDate;
            return (
              <tr key={`${c.court}${c.cino}`}>
                <td style={td}>{i + 1}</td>
                <td style={td}>
                  <button type="button" disabled={busy} onClick={() => onCase(c)} title={`View case history of ${c.caseNo}`}
                    style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, textDecoration: 'underline', color: 'inherit', cursor: 'pointer' }}>{c.caseNo}</button>
                  {c.filing ? '  (F)' : ''}
                  {c.ciCri ? <> <span style={{ ...tag, textTransform: 'uppercase' }}>{c.ciCri}</span></> : null}
                  {c.purpose ? <div><span style={tag}>{c.purpose}</span></div> : null}
                  {c.courtNoDesg ? <div>{c.courtNoDesg}</div> : null}
                  {c.pdeNo ? <div style={{ fontWeight: 700 }}>({c.pdeNo})</div> : null}
                  {c.underObjection ? <div style={{ fontWeight: 700 }}>Case Under Objection</div> : null}
                  {c.notice ? <div style={{ fontWeight: 700 }}>⚠ {c.notice}</div> : null}
                </td>
                <td style={td}>{when ? dmy(when) : 'No Date'}</td>
                <td style={td}><span style={{ ...tag, marginTop: 0, background: c.decisionDate ? 'var(--bg-inverse)' : 'transparent', color: c.decisionDate ? 'var(--text-inverse)' : 'inherit' }}>{c.decisionDate ? 'Disposed' : 'Pending'}</span></td>
                <td style={td}>{c.petName}<div style={{ fontWeight: 700 }}>Vs</div>{c.resName}</td>
                <td style={td}>
                  {c.representing.names.length ? <div style={{ fontWeight: 700 }}>{c.representing.as}</div> : null}
                  {c.representing.names.map((n, j) => <div key={j}>{j + 1}. {n}</div>)}
                </td>
                <td style={td}>{c.registrationDate ? dmy(c.registrationDate) : ''}{c.age ? <div>{c.age}</div> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What the portal showed (case history, Daily Status) in its own order:
 * headings, text and tables. Its links (a hearing's Business on Date) are
 * clickable; `nth` says which of the links with that text it is.
 */
function PortalBlocks({ blocks, onLink, busy }: { blocks: PortalBlock[]; onLink?: (text: string, nth: number) => void; busy?: boolean }) {
  // Every link in document order, to tell repeated texts apart.
  const seen = new Map<string, number>();
  const nthOf = new Map<string, number>();
  blocks.forEach((b, bi) => {
    const links = b.kind === 'text' ? (b.links ?? []).map((l) => [l, `${bi}:${l}`] as const)
      : b.kind === 'table' ? (b.table?.rows ?? []).flatMap((r, ri) => ('cells' in r ? (r.actions ?? []).map((l) => [l, `${bi}:${ri}:${l}`] as const) : []))
        : [];
    for (const [l, key] of links) {
      const n = seen.get(l) ?? 0;
      nthOf.set(key, n);
      seen.set(l, n + 1);
    }
  });
  const linkBtn = (l: string, key: string) => (
    <button type="button" disabled={busy || !onLink} onClick={() => onLink?.(l, nthOf.get(key) ?? 0)}
      style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, textDecoration: 'underline', color: 'inherit', cursor: 'pointer' }}>{l}</button>
  );
  if (!blocks.length) return <p className="body-sm muted">The portal showed nothing here.</p>;
  return (
    <div className="col" style={{ gap: 10 }}>
      {blocks.map((b, bi) => {
        if (b.kind === 'heading') return <h3 key={bi} style={{ margin: '6px 0 0', fontSize: 18, fontWeight: 700 }}>{b.text}</h3>;
        if (b.kind === 'text') {
          return (
            <div key={bi} className="body-sm">
              {(b.lines ?? []).map((line, i) => {
                const l = onLink ? (b.links ?? []).find((x) => x === line) : undefined;
                return <div key={i}>{l ? linkBtn(l, `${bi}:${l}`) : line}</div>;
              })}
            </div>
          );
        }
        if (!b.table) return null;
        const rows = b.table.rows;
        return (
          <PortalTable key={bi} headers={b.table.headers} rows={rows} busy={busy}
            onLink={onLink ? (cells, link) => {
              const ri = rows.findIndex((r) => 'cells' in r && r.cells === cells);
              onLink(link, nthOf.get(`${bi}:${ri}:${link}`) ?? 0);
            } : undefined} />
        );
      })}
    </div>
  );
}

const svgProps = { width: 30, height: 30, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const IconEdit = () => <svg {...svgProps}><path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>;
const IconCheck = () => <svg {...svgProps} strokeWidth={3.2}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const IconQuestion = () => <svg {...svgProps}><path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4.5" /><path d="M12 18.5h.01" /></svg>;
const IconBriefcase = () => <svg {...svgProps}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></svg>;
const IconBank = () => <svg {...svgProps} width={20} height={20}><path d="M3 10h18L12 4z" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20h18" /></svg>;
const IconFolder = () => <svg {...svgProps}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
