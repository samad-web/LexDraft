import { useState } from 'react';
import { KvTable } from '@/components/ecourts/app/AppUi';
import { useCases } from '@/hooks/useCases';
import { useTitleReports } from '@/hooks/useTitleReports';
import { fetchLandPdf, useSaveLandResult, type LandResult, type LandService } from '@/hooks/useLandRecords';
import { triggerBlobDownload } from '@/lib/blob-download';
import { Spinner, errorText } from './LandUi';

// The result of a Land Records search, read off the site's result page as
// plain text, plus the PDF of that page (or the sketch the site opened).
// Filing puts the PDF in the matter's documents and/or a title report's
// search trail (revenue search, with the document attached).

export function LandResultPanel({ sessionId, service, result, applicationId, onFollow, onSearchAgain }: {
  sessionId: string;
  service: LandService;
  result: LandResult;
  applicationId?: string;
  onFollow?: (applicationId: string) => void;
  onSearchAgain: () => void;
}) {
  const cases = useCases();
  const reports = useTitleReports({ pageSize: 100 });
  const save = useSaveLandResult();
  const [caseId, setCaseId] = useState('');
  const [reportId, setReportId] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const download = async (): Promise<void> => {
    setDownloading(true);
    try {
      const { blob, filename } = await fetchLandPdf(sessionId);
      triggerBlobDownload(blob, filename);
    } catch (err) {
      setNote(errorText(err, 'The PDF is no longer available - search again.'));
    } finally {
      setDownloading(false);
    }
  };

  const file = (): void => {
    if (!caseId && !reportId) return;
    setNote(null);
    save.mutate(
      { sessionId, caseId: caseId || undefined, titleReportId: reportId || undefined },
      {
        onSuccess: (r) => setNote(`Filed "${r.name}"${caseId ? ' in the matter\'s documents' : ''}${reportId ? `${caseId ? ' and' : ''} in the title report's searches` : ''}.`),
        onError: (err) => setNote(errorText(err, 'Could not file the record.')),
      },
    );
  };

  const empty = result.fields.length === 0 && result.sections.length === 0;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card col" style={{ gap: 14, padding: 18 }}>
        <h2 className="heading-md" style={{ textAlign: 'center', margin: 0 }}>{result.title}</h2>
        {result.fields.length > 0 ? <KvTable rows={result.fields.map((f) => [f.label, f.value] as const)} /> : null}
        {result.sections.map((s, i) => (
          <div key={i} className="col" style={{ gap: 6 }}>
            {s.heading ? (
              <div style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700, fontSize: 14 }}>{s.heading}</div>
            ) : null}
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                {s.headers.some(Boolean) ? (
                  <thead><tr>{s.headers.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
                ) : null}
                <tbody>
                  {s.rows.map((r, j) => (
                    <tr key={j}>{r.map((c, k) => <td key={k} style={{ whiteSpace: 'normal' }}>{c}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {empty ? <p className="body-md" style={{ margin: 0 }}>{result.text || 'Land Records returned no details.'}</p> : null}
      </div>

      <div className="card col" style={{ gap: 12, padding: 18 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {result.hasPdf ? (
            <button type="button" className="btn" onClick={() => void download()} disabled={downloading}>
              {downloading ? 'Preparing…' : 'Download PDF'}
            </button>
          ) : null}
          {applicationId && onFollow && (service === 'app-status' || service === 'fline' || service === 'order-copy') ? (
            <button type="button" className="btn" onClick={() => onFollow(applicationId)}>Follow this application</button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={onSearchAgain}>New search</button>
        </div>

        {result.hasPdf ? (
          <div className="col" style={{ gap: 10 }}>
            <span className="body-sm" style={{ fontWeight: 600 }}>File this record</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 10 }}>
              <select className="input" value={caseId} onChange={(e) => setCaseId(e.target.value)} aria-label="Matter">
                <option value="">Matter (documents)…</option>
                {(cases.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
              <select className="input" value={reportId} onChange={(e) => setReportId(e.target.value)} aria-label="Title report">
                <option value="">Title report (revenue search)…</option>
                {(reports.data?.items ?? []).map((r) => (
                  <option key={r.id} value={r.id}>{r.reportNumber} · {r.applicantName}</option>
                ))}
              </select>
            </div>
            <div>
              <button type="button" className="btn btn-primary" disabled={(!caseId && !reportId) || save.isPending} onClick={file}>
                {save.isPending ? <><Spinner size={12} /> Filing…</> : 'File'}
              </button>
            </div>
          </div>
        ) : null}
        {note ? <p className="body-sm" role="status" style={{ margin: 0, fontWeight: 600 }}>{note}</p> : null}
      </div>
    </div>
  );
}
