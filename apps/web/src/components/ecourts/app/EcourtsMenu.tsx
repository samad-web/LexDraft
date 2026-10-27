import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEcourtsCourtLocation } from '@/hooks/useEcourts';
import { useEcourtsCourtStore } from '@/store/ecourtsCourt';
import { L, useEcourtsT } from '@/hooks/useEcourtsLabels';
import { AnchoredMenu } from './AppUi';

// The eCourts app's side menu (☰): Import, Export, Court Complex Locator,
// ePay, NJDG, e-Filing, India Code, Virtual Courts. Items that DifAI has
// itself stay in the app (My Cases import/export, eFiling); the national
// portals open in a new tab, as the app opens them in the browser.

const PORTALS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'ePay', href: 'https://pay.ecourts.gov.in/' },
  { label: 'NJDG', href: 'https://njdg.ecourts.gov.in/' },
  { label: 'India Code', href: 'https://www.indiacode.nic.in/' },
  { label: 'Virtual Courts', href: 'https://vcourts.gov.in/' },
];

export function EcourtsMenu({ onMyCases }: { onMyCases: () => void }) {
  const { t } = useEcourtsT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const scope = useEcourtsCourtStore((s) => s.scope);
  const location = useEcourtsCourtLocation(
    scope.stateCode === '' ? null : scope.stateCode,
    scope.distCode === '' ? null : scope.distCode,
    scope.complexCode || null,
    scope.court,
  );
  const loc = location.data;

  const item = { width: '100%', justifyContent: 'flex-start' } as const;
  return (
    <>
      <button ref={setAnchor} type="button" className="btn" aria-haspopup="menu" aria-expanded={open} aria-label="eCourts menu" onClick={() => setOpen((o) => !o)}>
        ☰
      </button>
      <AnchoredMenu anchor={anchor} open={open} onClose={close} minWidth={240}>
        <div className="eyebrow" style={{ padding: '6px 10px' }}>eCourts Services</div>
        <button type="button" role="menuitem" className="btn btn-ghost" style={item} onClick={() => { close(); onMyCases(); }}>
          {t(L.importCases, 'Import')} / {t(L.exportCases, 'Export')}
        </button>
        {loc ? (
          <a role="menuitem" className="btn btn-ghost" style={item} href={`https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`} target="_blank" rel="noreferrer" onClick={close}>
            Court Complex Locator ↗
          </a>
        ) : (
          <span className="btn btn-ghost" style={{ ...item, opacity: 0.55, cursor: 'default' }} title="Pick a court complex under Case Status first">
            Court Complex Locator
          </span>
        )}
        <button type="button" role="menuitem" className="btn btn-ghost" style={item} onClick={() => { close(); navigate('/app/efiling'); }}>
          e-Filing
        </button>
        {PORTALS.map((p) => (
          <a key={p.href} role="menuitem" className="btn btn-ghost" style={item} href={p.href} target="_blank" rel="noreferrer" onClick={close}>
            {p.label} ↗
          </a>
        ))}
      </AnchoredMenu>
    </>
  );
}
