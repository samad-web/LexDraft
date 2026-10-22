import { useRef, useState } from 'react';
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
import { useEfilingFilings } from '@/hooks/useEfiling';
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

  return (
    <div className="col" style={{ gap: 16, maxWidth: 1240 }}>
      <PageHeader
        title="eFiling"
        description="Laid out like the eFiling 3.0 portal: prepare filings here, file on the portal, and track them until registered."
      />

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
            {m === 'dashboard' ? <EfilingDashboard onOpen={open} onNav={(x) => go(x)} /> : null}
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
