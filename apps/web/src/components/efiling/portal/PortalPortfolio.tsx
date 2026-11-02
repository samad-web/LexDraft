import { useState } from 'react';
import { PortalModal } from '../PortalKit';
import { LiveScreenPanel } from './PortalVakalat';
import { portalError } from '@/hooks/efiling/vakalat';
import {
  useExportMyCases, useImportMyCases, usePortfolioScreen, usePortfolioStep,
  type CourtType, type ImportResult, type PortfolioScreenView,
} from '@/hooks/efiling/portfolio';

// =============================================================================
// The portal's Portfolio menu except My Cases (EfilingView's MyCasesWindow):
//   Search Cases, Planner - live screens of the advocate's portal page
//     (js/portfolio/search_cases.js, calendar.js run there);
//   Export Cases, Import Cases - the portal's own modals (#exportCasesConfirm,
//     #importCasesModal) and their requests (mycases_common_functions.js).
// Monochrome; no red.
// =============================================================================

/**
 * The Portfolio menu, in the portal's order: Search Cases, Planner, Export
 * Cases, My Cases, Import Cases. My Cases is the existing My Cases window
 * (not drawn here); it sits between Export Cases and Import Cases.
 */
export const PORTFOLIO_ITEMS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'search_cases', label: 'Search Cases' },
  { id: 'planner', label: 'Planner' },
  { id: 'export_cases', label: 'Export Cases' },
  { id: 'my_cases', label: 'My Cases' },
  { id: 'import_cases', label: 'Import Cases' },
];

export function PortalPortfolio({ sessionId, view }: { sessionId: string; view: string }) {
  if (view === 'search_cases' || view === 'planner') return <PortfolioScreen sessionId={sessionId} view={view} />;
  if (view === 'export_cases') return <ExportCases sessionId={sessionId} />;
  if (view === 'import_cases') return <ImportCases sessionId={sessionId} />;
  return <p className="body-sm muted">My Cases opens in its own window.</p>;
}

function PortfolioScreen({ sessionId, view }: { sessionId: string; view: PortfolioScreenView }) {
  const screen = usePortfolioScreen(sessionId, view);
  const step = usePortfolioStep(sessionId, view);
  return (
    <LiveScreenPanel
      label={view === 'planner' ? 'Planner' : 'Search Cases'}
      screen={screen.data}
      loading={screen.isLoading}
      error={screen.error ? portalError(screen.error) : null}
      onReload={() => void screen.refetch()}
      onStep={(s) => step.mutateAsync(s)}
      busy={step.isPending || screen.isFetching}
    />
  );
}

// ---- the portal's Export / Import modals ------------------------------------------------------

const FILE: Record<CourtType, string> = { D: 'myCases.txt', H: 'hcMyCases.txt' };

/** DISTRICT COURT / HIGH COURT pills (radOpt-export / radOpt-import). */
function CourtPills({ value, onChange, name }: { value: CourtType; onChange: (c: CourtType) => void; name: string }) {
  return (
    <div className="row" role="radiogroup" aria-label="Court type" style={{ gap: 8 }}>
      {(['D', 'H'] as const).map((c) => (
        <label key={c} style={{
          padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--text-primary)',
          background: value === c ? 'var(--bg-inverse)' : 'var(--bg-surface)', color: value === c ? 'var(--text-inverse)' : 'var(--text-primary)',
        }}>
          <input type="radio" name={name} checked={value === c} onChange={() => onChange(c)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
          {c === 'D' ? 'DISTRICT COURT' : 'HIGH COURT'}
        </label>
      ))}
    </div>
  );
}

const card: React.CSSProperties = { maxWidth: 460, border: '1px solid var(--border-default)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-surface)' };
const head = (title: string, sub: string) => (
  <div style={{ borderBottom: '1px solid var(--border-default)', padding: '18px 20px 14px' }}>
    <h5 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h5>
    <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>{sub}</p>
  </div>
);
const primary: React.CSSProperties = { flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontSize: 13, fontWeight: 600, cursor: 'pointer' };

/** Export my cases: "Choose a court type and download" -> myCases.txt / hcMyCases.txt. */
function ExportCases({ sessionId }: { sessionId: string }) {
  const [court, setCourt] = useState<CourtType>('D');
  const [note, setNote] = useState<string | null>(null);
  const exp = useExportMyCases(sessionId);
  const download = async () => {
    setNote(null);
    try {
      const r = await exp.mutateAsync(court);
      if (r.message) { setNote(r.message); return; }
      const url = URL.createObjectURL(new Blob([r.content], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = r.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setNote(`${r.fileName} downloaded (${r.count} case${r.count === 1 ? '' : 's'}).`);
    } catch (err) {
      setNote(portalError(err));
    }
  };
  return (
    <div style={card} aria-label="Export my cases">
      {head('Export my cases', 'Choose a court type and download')}
      <div className="col" style={{ gap: 16, padding: '16px 20px' }}>
        <CourtPills name="radOpt-export" value={court} onChange={setCourt} />
        <div className="row" style={{ gap: 8 }}>
          <button type="button" style={primary} disabled={exp.isPending} onClick={() => void download()}>{exp.isPending ? 'Preparing…' : 'Download'}</button>
        </div>
        {note ? <p role="status" className="body-sm" style={{ margin: 0, fontWeight: 600 }}>{note}</p> : null}
      </div>
    </div>
  );
}

/** Import cases: "Upload a file and select court type" (myCases.txt / hcMyCases.txt). */
function ImportCases({ sessionId }: { sessionId: string }) {
  const [court, setCourt] = useState<CourtType>('D');
  const [picked, setPicked] = useState<{ name: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<ImportResult | null>(null);
  const imp = useImportMyCases(sessionId);

  // checkImportFile(): the court's own file name, and JSON.
  const choose = async (f: File | undefined) => {
    setError(null);
    setDone(null);
    setPicked(null);
    if (!f) return;
    if (f.name !== FILE[court]) { setError(`Please select file ${FILE[court]}`); return; }
    const content = await f.text();
    try { JSON.parse(content); } catch { setError('Incorrect file format'); return; }
    setPicked({ name: f.name, content });
  };
  const run = async () => {
    setConfirm(false);
    if (!picked) return;
    try {
      setDone(await imp.mutateAsync({ court, fileName: picked.name, content: picked.content }));
    } catch (err) {
      setError(portalError(err));
    }
  };
  return (
    <div style={card} aria-label="Import cases">
      {head('Import cases', 'Upload a file and select court type')}
      <div className="col" style={{ gap: 14, padding: '16px 20px' }}>
        <CourtPills name="radOpt-import" value={court} onChange={(c) => { setCourt(c); setPicked(null); setError(null); }} />
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void choose(e.dataTransfer.files[0]); }}
          style={{ display: 'block', border: '1.5px dashed var(--border-default)', borderRadius: 8, padding: 16, textAlign: 'center', cursor: 'pointer', background: 'var(--bg-surface-2)' }}>
          <span className="muted" style={{ fontSize: 12 }}>Drag &amp; drop or <strong style={{ color: 'var(--text-primary)' }}>browse</strong></span>
          {picked ? <p style={{ margin: '4px 0 0', fontSize: 12, fontWeight: 600 }}>{picked.name}</p> : null}
          <input type="file" accept=".txt" style={{ display: 'none' }} onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" style={{ ...primary, opacity: picked && !imp.isPending ? 1 : 0.45 }} disabled={!picked || imp.isPending} onClick={() => setConfirm(true)}>
            {imp.isPending ? 'Importing…' : 'Import'}
          </button>
        </div>
        {error ? <p role="alert" className="body-sm" style={{ margin: 0, fontWeight: 700 }}>{error}</p> : null}
        {done ? (
          <p role="status" className="body-sm" style={{ margin: 0, fontWeight: 600 }}>
            {done.added} of {done.inFile} case{done.inFile === 1 ? '' : 's'} added to My Cases.{done.messages.length ? ` ${done.messages.join(' ')}` : ''}
          </p>
        ) : null}
      </div>
      <div className="body-sm" style={{ borderTop: '1px solid var(--border-default)', padding: '8px 16px', background: 'var(--bg-surface-2)' }}>
        Your cases may take some time to refresh after being imported.
      </div>
      {confirm && picked ? (
        <PortalModal title="Import cases" level={2} onClose={() => setConfirm(false)}>
          <div className="col" style={{ gap: 14 }}>
            <p className="body" style={{ margin: 0 }}>Add the cases in {picked.name} to My Cases on your eFiling portal account?</p>
            <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void run()}>Import</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Cancel</button>
            </div>
          </div>
        </PortalModal>
      ) : null}
    </div>
  );
}
