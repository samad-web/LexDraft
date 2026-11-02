import { useRef, useState } from 'react';
import { AnchoredMenu } from '@/components/ecourts/app/AppUi';
import { useEfilingPortalStates } from '@/hooks/useEfiling';
import { PortalModal } from '@/components/efiling/PortalKit';

// =============================================================================
// The eFiling portal's own header, as filing.ecourts.gov.in draws it: the
// A- A A+ / contrast bar, the navy menu bar (teal "eFiling Services", a round
// icon over each menu), "Select State or High Court", the advocate's name and
// the logout button, then the grey strip with Help. DifAi's own items (profile,
// session, what DifAi has prepared) sit in the advocate's name menu, outside
// the portal's own screens.
// =============================================================================

export interface ChromeMenu { id: string; label: string; items: ReadonlyArray<{ label: string; onPick: () => void }> }

const icon = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const MENU_ICON: Record<string, React.ReactNode> = {
  partners: <svg {...icon}><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 19c0-3 3-5 6-5s6 2 6 5" /><path d="M15 14c3 0 6 1.5 6 4.5" /></svg>,
  case_filing: <svg {...icon}><path d="M4 20l4-1 11-11-3-3L5 16z" /></svg>,
  vakalat: <svg {...icon}><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h6M9 16h6" /></svg>,
  pleadings: <svg {...icon}><path d="M7 11V5a2 2 0 0 1 4 0v5" /><path d="M11 10V4a2 2 0 0 1 4 0v7" /><path d="M15 10a2 2 0 0 1 4 0v4a7 7 0 0 1-12 5l-3-4a2 2 0 0 1 3-2l1 1" /></svg>,
  epayments: <svg {...icon}><path d="M7 5h10M7 9h10M9 5c4 0 5 4 0 4H7l7 10" /></svg>,
  applications: <svg {...icon}><path d="M6 3h9l4 4v14H6z" /><path d="M9 10h7M9 14h7M9 18h4" /></svg>,
  portfolio: <svg {...icon}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></svg>,
};

function TopMenu({ menu, active }: { menu: ChromeMenu; active: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={ref} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '5px 7px 3px', border: 'none',
          borderRight: '1px solid rgba(255,255,255,0.12)', background: active ? 'rgba(255,255,255,0.12)' : 'transparent', color: '#ffffff', cursor: 'pointer', font: 'inherit',
        }}>
        <span aria-hidden style={{ width: 26, height: 26, borderRadius: '50%', background: '#ffffff', color: '#111111', display: 'grid', placeItems: 'center' }}>{MENU_ICON[menu.id] ?? null}</span>
        <span style={{ fontSize: 13.5, whiteSpace: 'nowrap', color: '#ffffff', fontWeight: active ? 700 : 400, textDecoration: active ? 'underline' : 'none', textUnderlineOffset: 4 }}>{menu.label} <span aria-hidden style={{ fontSize: 10 }}>▼</span></span>
      </button>
      <AnchoredMenu anchor={ref.current} open={open} onClose={() => setOpen(false)}>
        <div style={{ margin: -4, padding: 4 }}>
          {menu.items.map((i) => (
            <button key={i.label} type="button" role="menuitem" onClick={() => { setOpen(false); i.onPick(); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 14, cursor: 'pointer' }}>
              {i.label}
            </button>
          ))}
        </div>
      </AnchoredMenu>
    </>
  );
}

export function PortalHeader({ menus, activeMenu, onDashboard, username, stateName, zoom, setZoom, contrast, setContrast, onLogOut, onSwitchState, userItems }: {
  menus: ReadonlyArray<ChromeMenu>;
  activeMenu: string | null;
  onDashboard: () => void;
  username: string;
  stateName: string;
  zoom: number;
  setZoom: (z: number) => void;
  contrast: boolean;
  setContrast: (c: boolean) => void;
  onLogOut: () => void;
  /** The portal keeps one state per login: switching means logging in again for it. */
  onSwitchState: (state: { code: number; name: string }) => void;
  userItems: ReadonlyArray<{ label: string; onPick: () => void }>;
}) {
  const { data: states } = useEfilingPortalStates();
  const [userOpen, setUserOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [askState, setAskState] = useState<{ code: number; name: string } | null>(null);
  const userRef = useRef<HTMLButtonElement | null>(null);
  const small = (on: boolean, dark = false): React.CSSProperties => ({
    border: 'none', borderRight: '1px solid var(--border-default)', padding: '2px 8px', fontSize: 12, cursor: 'pointer',
    background: dark ? 'var(--bg-inverse)' : on ? 'var(--bg-surface-2)' : 'var(--bg-surface)', color: dark ? 'var(--text-inverse)' : 'var(--text-primary)',
  });
  return (
    <header aria-label="eFiling Services">
      <div className="row" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)' }} aria-label="Text size and contrast">
        <button type="button" aria-label="Smaller text" onClick={() => setZoom(Math.max(0.8, Math.round((zoom - 0.1) * 10) / 10))} style={small(false)}>A-</button>
        <button type="button" aria-label="Normal text" onClick={() => setZoom(1)} style={small(zoom === 1)}>A</button>
        <button type="button" aria-label="Larger text" onClick={() => setZoom(Math.min(1.3, Math.round((zoom + 0.1) * 10) / 10))} style={small(false)}>A+</button>
        <button type="button" aria-label="Normal contrast" onClick={() => setContrast(false)} style={small(!contrast)}>A</button>
        <button type="button" aria-label="High contrast" onClick={() => setContrast(true)} style={small(contrast, true)}>A</button>
      </div>
      <nav aria-label="eFiling menu" className="row" style={{ background: 'var(--efp-nav)', alignItems: 'stretch', flexWrap: 'wrap', minHeight: 62 }}>
        <button type="button" onClick={onDashboard}
          style={{ background: 'var(--efp-brand)', color: 'var(--efp-brand-text)', border: 'none', padding: '0 10px', cursor: 'pointer', font: 'inherit', fontWeight: 400, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 20 }}>eFiling Services</span>
        </button>
        {menus.map((mn) => <TopMenu key={mn.id} menu={mn} active={activeMenu === mn.id} />)}
        <span style={{ flex: 1 }} />
        <label className="row" style={{ alignItems: 'center', gap: 8, color: '#ffffff', fontWeight: 700, fontSize: 13, padding: '0 8px' }}>
          <span style={{ lineHeight: 1.3 }}>Select State or High<br />Court:</span>
          <select aria-label="Select State or High Court" value={stateName}
            onChange={(e) => { const s = (states ?? []).find((x) => x.name === e.target.value); if (s && s.name !== stateName) setAskState(s); }}
            style={{ width: 170, height: 40, borderRadius: 4, border: '1px solid #ced4da', padding: '0 8px', fontSize: 14, background: '#ffffff', color: '#212529' }}>
            {!(states ?? []).some((s) => s.name === stateName) ? <option value={stateName}>{stateName}</option> : null}
            {(states ?? []).map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        <button ref={userRef} type="button" aria-haspopup="menu" aria-expanded={userOpen} onClick={() => setUserOpen((o) => !o)}
          className="row" style={{ alignItems: 'center', gap: 8, border: 'none', background: 'transparent', color: '#ffffff', cursor: 'pointer', padding: '0 10px', font: 'inherit', fontSize: 14 }}>
          <span aria-hidden style={{ width: 34, height: 34, borderRadius: '50%', background: '#9aa0a6', border: '3px solid #ffffff' }} />
          <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{username}</span>
        </button>
        <AnchoredMenu anchor={userRef.current} open={userOpen} onClose={() => setUserOpen(false)}>
          <div style={{ margin: -4, padding: 4 }}>
            {userItems.map((i) => (
              <button key={i.label} type="button" role="menuitem" onClick={() => { setUserOpen(false); i.onPick(); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 14, cursor: 'pointer' }}>
                {i.label}
              </button>
            ))}
          </div>
        </AnchoredMenu>
        <span className="row" style={{ alignItems: 'center', padding: '0 10px' }}>
          <button type="button" aria-label="Log out of eFiling" title="Logout" onClick={onLogOut}
            style={{ width: 38, height: 32, borderRadius: 4, border: 'none', background: 'var(--efp-btn)', color: 'var(--efp-btn-text)', cursor: 'pointer', fontSize: 15 }}>⏻</button>
        </span>
      </nav>
      <div className="row" style={{ background: 'var(--efp-strip)', justifyContent: 'flex-end', padding: '6px 10px', borderBottom: '1px solid var(--border-default)' }}>
        <button type="button" aria-label="Help" onClick={() => setHelp(true)}
          style={{ width: 40, height: 30, borderRadius: 15, border: 'none', background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700, cursor: 'pointer' }}>?</button>
      </div>
      {help ? (
        <PortalModal title="Help" onClose={() => setHelp(false)}>
          <div className="col" style={{ gap: 8 }}>
            <p className="body-sm">These are the screens of your eFiling account on filing.ecourts.gov.in, opened inside DifAi.</p>
            <a href="https://ecommitteesci.gov.in/service/e-filing/" target="_blank" rel="noreferrer">eFiling manuals and video tutorials (eCommittee, Supreme Court of India) ↗</a>
            <a href="https://filing.ecourts.gov.in/pdedev/" target="_blank" rel="noreferrer">Open filing.ecourts.gov.in ↗</a>
          </div>
        </PortalModal>
      ) : null}
      {askState ? (
        <PortalModal title="Select State or High Court" onClose={() => setAskState(null)}>
          <div className="col" style={{ gap: 12 }}>
            <p className="body-sm">The portal keeps one state per login. To work in {askState.name}, log out of eFiling and log in again for {askState.name}.</p>
            <span className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { const s = askState; setAskState(null); onSwitchState(s); }}>Log out and log in for {askState.name}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAskState(null)}>Stay in {stateName}</button>
            </span>
          </div>
        </PortalModal>
      ) : null}
    </header>
  );
}
