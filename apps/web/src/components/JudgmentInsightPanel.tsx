import { useEffect, useRef } from 'react';
import { Icon } from '@lexdraft/ui';
import { Modal } from './Modal';
import { useAnalyzeJudgment } from '@/hooks/useDiaryAssistant';
import { useUIStore } from '@/store/ui';

interface Props {
  open: boolean;
  onClose: () => void;
  entryId: string;
  fileName: string;
}

export function JudgmentInsightPanel({ open, onClose, entryId, fileName }: Props) {
  const analyze = useAnalyzeJudgment();
  const showToast = useUIStore((s) => s.showToast);
  // Fire the analysis once per open. Reset on close so re-opening re-runs (the
  // backend caches by content hash, so a repeat open is a fast cache hit).
  const ranFor = useRef<string | null>(null);

  useEffect(() => {
    if (open && entryId && ranFor.current !== entryId) {
      ranFor.current = entryId;
      analyze.mutate({ entryId });
    }
    if (!open) {
      // Reset on close so a stale result from a previous entry can't flash under
      // the next entry's filename before its analysis lands.
      ranFor.current = null;
      analyze.reset();
    }
    // analyze is intentionally excluded — we want this to fire once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entryId]);

  const data = analyze.data;
  const errMsg =
    (analyze.error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error ??
    (analyze.error as Error | null)?.message ??
    null;

  const copyAll = async () => {
    if (!data) return;
    const lines = [
      `Summary:\n${data.summary}`,
      data.holding ? `\nHolding:\n${data.holding}` : '',
      data.followUps.length ? `\nFollow-ups:\n${data.followUps.map((f) => `• ${f.title} — ${f.rationale}`).join('\n')}` : '',
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      showToast({ type: 'sage', text: 'Copied to clipboard' });
    } catch {
      showToast({ type: 'vermillion', text: 'Could not copy' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Judgment intelligence"
      title="Judgment analysis"
      description={fileName}
      width={680}
      footer={
        <>
          {data && (
            <button type="button" className="btn" onClick={copyAll}>
              <Icon name="documents" size={13} /> Copy
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="col" style={{ gap: 16, minHeight: 80 }}>
        {analyze.isPending && (
          <p className="body-md muted">Reading the judgment<span className="blink" /></p>
        )}

        {!analyze.isPending && errMsg && (
          <div className="col" style={{ gap: 10 }}>
            <p className="body-sm" style={{ color: 'var(--danger)' }}>{errMsg}</p>
            <button type="button" className="btn btn-sm" onClick={() => { if (entryId) analyze.mutate({ entryId }); }}>
              <Icon name="arrow" size={13} /> Retry
            </button>
          </div>
        )}

        {!analyze.isPending && data && (
          <>
            <section className="col" style={{ gap: 6 }}>
              <div className="eyebrow">Summary</div>
              <p className="body-md" style={{ whiteSpace: 'pre-wrap', margin: 0, color: 'var(--text-primary)' }}>
                {data.summary || '—'}
              </p>
            </section>

            {data.holding && (
              <section className="col" style={{ gap: 6 }}>
                <div className="eyebrow">Holding · ratio</div>
                <p className="body-md" style={{ whiteSpace: 'pre-wrap', margin: 0, color: 'var(--text-primary)' }}>
                  {data.holding}
                </p>
              </section>
            )}

            {data.followUps.length > 0 && (
              <section className="col" style={{ gap: 8 }}>
                <div className="eyebrow">Suggested follow-ups</div>
                {data.followUps.map((f, i) => (
                  <div
                    key={i}
                    className="row"
                    style={{ gap: 10, alignItems: 'flex-start', padding: '8px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}
                  >
                    <span style={{ color: 'var(--text-secondary)', paddingTop: 2 }}><Icon name="flag" size={13} /></span>
                    <div className="col" style={{ gap: 2 }}>
                      <span className="body-sm" style={{ fontWeight: 600 }}>{f.title}</span>
                      {f.rationale && <span className="body-sm muted">{f.rationale}</span>}
                    </div>
                  </div>
                ))}
              </section>
            )}

            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              {data.cached && <span className="badge badge-sage">cached</span>}
              <span className="body-xs muted mono">{data.modelUsed}</span>
              <span className="spacer" style={{ flex: 1 }} />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { if (entryId) analyze.mutate({ entryId, force: true }); }}
                disabled={analyze.isPending}
                title="Run the analysis again, ignoring the cached result"
              >
                <Icon name="arrow" size={12} /> Re-analyze
              </button>
            </div>
            <p className="body-xs muted">AI-generated from the attached PDF. Verify against the certified copy before relying on it.</p>
          </>
        )}
      </div>
    </Modal>
  );
}
