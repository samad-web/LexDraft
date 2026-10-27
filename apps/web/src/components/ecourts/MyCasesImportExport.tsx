import { useRef, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { Modal } from '@/components/Modal';
import { triggerBlobDownload } from '@/lib/blob-download';
import {
  useEcourtsImportPreview,
  useImportEcourtsCases,
  type CaseListItem,
  type EcourtsImportItem,
  type EcourtsImportResult,
} from '@/hooks/useCases';
import { L, useEcourtsT } from '@/hooks/useEcourtsLabels';
import { extractCnrs } from '@/lib/cnr-extract';
import { localToday } from './MyCasesPanel';

// The eCourts app's Import / Export on My Cases.
//
// Export: the matters as a CSV (opens in Excel) or a plain CNR list - the
// list re-imports here or anywhere that takes CNRs.
// Import: any file holding CNRs - the eCourts app's own backup
// (myCases_backup.txt, hcMyCases_backup.txt), a CSV, or a typed list. The
// file is read in the browser and only the CNRs are sent. A preview shows
// what is new before anything is created; CNRs already in matters are
// skipped.

const MAX_IMPORT = 200;

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function realCnr(c: CaseListItem): boolean {
  return /^[A-Z]{4}[A-Z0-9]{12}$/i.test((c.cnr ?? '').trim());
}

export function MyCasesImportExport({ cases }: { cases: CaseListItem[] }) {
  const { t } = useEcourtsT();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<EcourtsImportItem[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [pasted, setPasted] = useState('');
  const [court, setCourt] = useState<'DC' | 'HC'>('DC');
  const [readError, setReadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<EcourtsImportResult | null>(null);
  const preview = useEcourtsImportPreview();
  const importer = useImportEcourtsCases();

  const exportCsv = () => {
    const head = ['Case', 'CNR Number', 'Court', 'Next Hearing Date', 'Case Stage', 'Status', 'eCourts'];
    const lines = cases.map((c) => [c.title, c.cnr, c.court, c.next, c.stage, c.status, c.ecourtsLinkStatus ?? ''].map(csvCell).join(','));
    // BOM so Excel reads names in Indian scripts correctly.
    triggerBlobDownload(new Blob(['﻿' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' }), `my-cases-${localToday()}.csv`);
  };

  const exportCnrs = () => {
    const cnrs = cases.filter(realCnr).map((c) => c.cnr.trim().toUpperCase());
    triggerBlobDownload(new Blob([cnrs.join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8' }), `my-cases-cnr-${localToday()}.txt`);
  };

  const startPreview = (cnrs: string[], tier: 'DC' | 'HC', name: string) => {
    setReadError(null);
    setDone(null);
    if (cnrs.length === 0) {
      setItems(null);
      setReadError(`No CNR numbers found in ${name}.`);
      return;
    }
    const list = cnrs.slice(0, MAX_IMPORT).map((cnr) => ({ cnr, court: tier }));
    setItems(list);
    setFileName(name);
    setCourt(tier);
    preview.mutate(list);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setOpen(true);
    if (file.size > 5 * 1024 * 1024) {
      setItems(null);
      setReadError('That file is larger than 5 MB - export a smaller list.');
      return;
    }
    const text = await file.text();
    // The app keeps High Court cases in hcMyCases_backup.txt.
    startPreview(extractCnrs(text), /^hc/i.test(file.name) ? 'HC' : 'DC', file.name);
  };

  const existing = new Set(preview.data?.existing ?? []);
  const fresh = (items ?? []).filter((i) => !existing.has(i.cnr));
  const total = items ? items.length : 0;

  const runImport = () => {
    if (fresh.length === 0) return;
    importer.mutate(fresh.map((i) => ({ ...i, court })), { onSuccess: setDone });
  };

  const close = () => {
    setOpen(false);
    setItems(null);
    setDone(null);
    setReadError(null);
    setPasted('');
    preview.reset();
    importer.reset();
  };

  const apiError = (err: unknown) =>
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not reach DifAI. Try again.';

  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm" onClick={() => { setOpen(true); }}>
          <Icon name="upload" size={14} /> {t(L.importCases, 'Import')}
        </button>
        <button type="button" className="btn btn-sm" disabled={cases.length === 0} onClick={exportCsv}>
          <Icon name="download" size={14} /> {t(L.exportCases, 'Export')} CSV
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={!cases.some(realCnr)} onClick={exportCnrs}>
          CNR list
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.csv,.json,.tsv,text/plain,text/csv,application/json"
          style={{ display: 'none' }}
          onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>

      <Modal
        open={open}
        onClose={close}
        title={`${t(L.importCases, 'Import')} ${t(L.myCases, 'My Cases')}`}
        description="Upload the eCourts app's backup (myCases_backup.txt or hcMyCases_backup.txt), a CSV or a list of CNR numbers. Each new CNR becomes a matter that eCourts fills in."
        width={560}
        footer={
          done ? (
            <button type="button" className="btn btn-primary" onClick={close}>Done</button>
          ) : (
            <>
              <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!items || preview.isPending || !preview.isSuccess || fresh.length === 0 || importer.isPending}
                onClick={runImport}
              >
                {importer.isPending ? 'Importing…' : `Import ${fresh.length} case${fresh.length === 1 ? '' : 's'}`}
              </button>
            </>
          )
        }
      >
        <div className="col" style={{ gap: 14 }}>
          {!done ? (
            <>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={14} /> Choose file
                </button>
                {fileName && items ? <span className="body-sm muted">{fileName}</span> : null}
              </div>
              <label className="col" style={{ gap: 4 }}>
                <span className="body-sm muted">Or paste CNR numbers</span>
                <textarea
                  className="input mono"
                  rows={3}
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="KLER010001682023, TNCG0B0011172024 …"
                />
              </label>
              <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="body-sm muted">These are</span>
                {(['DC', 'HC'] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`btn btn-sm${court === c ? ' btn-primary' : ' btn-ghost'}`}
                    onClick={() => setCourt(c)}
                  >
                    {c === 'DC' ? t(L.districtCourt, 'District Court') : t(L.highCourt, 'High Court')}
                  </button>
                ))}
                {pasted.trim() ? (
                  <button type="button" className="btn btn-sm" onClick={() => startPreview(extractCnrs(pasted), court, 'the pasted text')}>
                    Check CNRs
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          {readError ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{readError}</p> : null}

          {items && !done ? (
            <div className="card col" style={{ gap: 6, padding: 12 }}>
              {preview.isPending ? <span className="body-sm muted">Checking against your matters…</span> : null}
              {preview.isError ? <span className="body-sm" style={{ color: 'var(--danger)' }}>{apiError(preview.error)}</span> : null}
              {preview.isSuccess ? (
                <>
                  <span className="body-md">
                    <strong>{fresh.length}</strong> new · {existing.size} already in your matters
                    {total >= MAX_IMPORT ? ` · first ${MAX_IMPORT} only` : ''}
                  </span>
                  <div className="mono body-sm muted" style={{ maxHeight: 140, overflowY: 'auto', lineHeight: 1.6 }}>
                    {items.map((i) => (
                      <div key={i.cnr}>{i.cnr}{existing.has(i.cnr) ? '  (already added)' : ''}</div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {importer.isError ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{apiError(importer.error)}</p> : null}

          {done ? (
            <div className="col" style={{ gap: 6 }}>
              <p className="body-md">
                {done.created.length > 0
                  ? `${t(L.importCases, 'Import')}: ${done.created.length} case${done.created.length === 1 ? '' : 's'} added.`
                  : 'Nothing new to add.'}
                {done.existing.length > 0 ? ` ${done.existing.length} were already in your matters.` : ''}
              </p>
              <p className="body-sm muted">
                DifAI is fetching their details from eCourts now. If eCourts is down, they are filled in at the next 9 AM / 7 PM update.
              </p>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
