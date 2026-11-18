import { useEffect, useMemo, useState } from 'react';
import { Icon, ErrorState, Skeleton } from '@lexdraft/ui';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';
import { saveDocx, useFormatLibrary, type BlankForm, type LaweForm } from '@/hooks/useFormatLibrary';
import { useUIStore } from '@/store/ui';

// Formats (owner, 2026-11-18): the LAWE forms library as its own page. Every
// form can be viewed inside DifAi and downloaded blank as PDF or Word. The
// files are DifAi's own rendering (engine /v1/blank), never LAWE's originals.

type As = 'view' | 'pdf' | 'word';

const fileBase = (title: string) => `${title} (blank)`;

async function blankFor(f: LaweForm): Promise<BlankForm> {
  return api.post<BlankForm>('/drafting/engine/blank', {
    docLabel: f.docLabel,
    ...(Object.keys(f.preset ?? {}).length ? { preset: f.preset } : {}),
  });
}

const pdfOf = (form: BlankForm, title: string) =>
  api.postBlob('/drafting/engine/docx-to-pdf', { docxBase64: form.docxBase64, fileName: fileBase(title) });

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w.() -]+/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function FormatsView() {
  const library = useFormatLibrary();
  const showToast = useUIStore((s) => s.showToast);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ form: LaweForm; blank: BlankForm; url: string; pdf: Blob } | null>(null);

  // Release the viewer's PDF when it closes or changes.
  useEffect(() => () => { if (viewing) URL.revokeObjectURL(viewing.url); }, [viewing]);

  const forms = library.data?.lawe ?? [];
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const m = new Map<string, LaweForm[]>();
    for (const f of forms) {
      if (q && !`${f.title} ${f.group} ${f.docLabel}`.toLowerCase().includes(q)) continue;
      m.set(f.group, [...(m.get(f.group) ?? []), f]);
    }
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, rows]) => ({ group, rows: rows.sort((a, b) => a.title.localeCompare(b.title)) }));
  }, [forms, q]);
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);

  async function act(f: LaweForm, as: As) {
    setBusy(`${f.id}:${as}`);
    try {
      const blank = await blankFor(f);
      if (as === 'word') {
        saveDocx(blank.docxBase64, fileBase(f.title));
        showToast({ type: 'sage', text: `${f.title}: Word downloaded` });
        return;
      }
      const pdf = await pdfOf(blank, f.title);
      if (as === 'pdf') {
        download(pdf, fileBase(f.title));
        showToast({ type: 'sage', text: `${f.title}: PDF downloaded` });
      } else {
        setViewing({ form: f, blank, pdf, url: URL.createObjectURL(pdf) });
      }
    } catch {
      showToast({ type: 'amber', text: `Could not prepare ${f.title}. Try again in a moment.` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <PageHeader
        title="Formats"
        description="Court forms from the LAWE library, in DifAi's court layout. View any form here, or download it blank as PDF or Word."
        meta={library.isSuccess ? (q ? `${shown} of ${forms.length} formats` : `${forms.length} formats`) : undefined}
      />

      <div className="row" style={{ gap: 8, margin: '0 0 16px', alignItems: 'center' }}>
        <Icon name="search" size={14} aria-hidden />
        <input
          className="input"
          style={{ flex: 1, maxWidth: 520 }}
          placeholder="Search formats (e.g. vakalat, warrant, copy application)"
          aria-label="Search formats"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {library.isLoading && <Skeleton height={240} />}
      {library.isError && <ErrorState icon="documents" title="Could not load the formats" onRetry={() => { void library.refetch(); }} />}
      {library.isSuccess && forms.length === 0 && <p className="body-sm muted">The formats are not available right now. Try again later.</p>}
      {library.isSuccess && forms.length > 0 && shown === 0 && <p className="body-sm muted">No format matches “{query}”.</p>}

      <div className="col" style={{ gap: 20 }}>
        {groups.map((g) => (
          <section key={g.group} aria-label={g.group}>
            <h2 className="body-sm" style={{ fontWeight: 600, margin: '0 0 8px' }}>{g.group}</h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))', gap: 8 }}>
              {g.rows.map((f) => (
                <li key={f.id} className="row" style={{ alignItems: 'center', gap: 4, minHeight: 48, padding: '4px 6px 4px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <button type="button" onClick={() => { void act(f, 'view'); }} disabled={busy !== null} title={`View ${f.title}`}
                    style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 0, padding: '4px 0', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
                    <span className="body-sm" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</span>
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} aria-label={`View ${f.title}`} onClick={() => { void act(f, 'view'); }}>
                    {busy === `${f.id}:view` ? '…' : 'View'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} aria-label={`Download ${f.title} as PDF`} onClick={() => { void act(f, 'pdf'); }}>
                    {busy === `${f.id}:pdf` ? '…' : 'PDF'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} aria-label={`Download ${f.title} as Word`} onClick={() => { void act(f, 'word'); }}>
                    {busy === `${f.id}:word` ? '…' : 'Word'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        width={1000}
        eyebrow={viewing?.form.group}
        title={viewing?.form.title ?? ''}
        footer={viewing && (
          <>
            <button type="button" className="btn" onClick={() => download(viewing.pdf, fileBase(viewing.form.title))}>Download PDF</button>
            <button type="button" className="btn" onClick={() => saveDocx(viewing.blank.docxBase64, fileBase(viewing.form.title))}>Download Word</button>
            <button type="button" className="btn btn-primary" onClick={() => setViewing(null)}>Close</button>
          </>
        )}
      >
        {viewing && (
          <iframe title={`${viewing.form.title} (blank form)`} src={viewing.url} style={{ width: '100%', height: '70vh', border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }} />
        )}
        <p className="body-xs muted" style={{ margin: '8px 0 0' }}>If the form does not show on this device, use Download PDF.</p>
      </Modal>
    </div>
  );
}
