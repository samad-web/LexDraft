import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, EmptyState, ErrorState } from '@lexdraft/ui';
import { FAB } from '@/components/FAB';
import { useDocuments } from '@/hooks/useDocuments';
import type { DocumentRecord } from '@lexdraft/types';
import { NewDocumentModal } from '@/components/NewDocumentModal';
import { DocumentViewerModal } from '@/components/DocumentViewerModal';
import { useUpdateDocumentPortalFlags } from '@/hooks/usePortalAdmin';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

interface FolderDef {
  id: string;
  label: string;
  match: ((doc: DocumentRecord) => boolean) | null;
}

const FOLDERS: FolderDef[] = [
  { id: 'all', label: 'All', match: null },
  {
    id: 'pleadings',
    label: 'Pleadings',
    match: (d) => /plaint|petition|written statement|ws\b/i.test(d.type),
  },
  { id: 'notices', label: 'Notices', match: (d) => /notice/i.test(d.type) },
  { id: 'affidavits', label: 'Affidavits', match: (d) => /affidavit/i.test(d.type) },
  { id: 'contracts', label: 'Contracts', match: (d) => /contract|agreement|deed/i.test(d.type) },
  { id: 'receipts', label: 'Receipts', match: (d) => /receipt|invoice|bill/i.test(d.type) },
];

interface ChipDef {
  id: string;
  label: string;
  test: ((doc: DocumentRecord) => boolean) | null;
}

const CHIPS: ChipDef[] = [
  { id: 'all', label: 'All', test: null },
  { id: 'plaint', label: 'Plaint', test: (d) => /plaint/i.test(d.type) },
  { id: 'ws', label: 'WS', test: (d) => /\bws\b|written statement/i.test(d.type) },
  { id: 'affidavit', label: 'Affidavit', test: (d) => /affidavit/i.test(d.type) },
  { id: 'bail', label: 'Bail', test: (d) => /bail/i.test(d.type) },
  { id: 'notice', label: 'Notice', test: (d) => /notice/i.test(d.type) },
];

function statusFor(doc: DocumentRecord): { label: string; cls: string } {
  const t = doc.type.toLowerCase();
  if (/final|signed|filed/i.test(t)) return { label: 'Filed', cls: 'badge-sage' };
  if (/draft/i.test(t)) return { label: 'Draft', cls: 'badge-amber' };
  if (/notice/i.test(t)) return { label: 'Sent', cls: 'badge-cobalt' };
  return { label: doc.type.toUpperCase(), cls: 'badge' };
}

export function DocumentsView() {
  const docs = useDocuments();
  const navigate = useNavigate();
  const [folder, setFolder] = useState<string>('all');
  const [chip, setChip] = useState<string>('all');
  const [query, setQuery] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [viewing, setViewing] = useState<DocumentRecord | null>(null);
  const updateFlags = useUpdateDocumentPortalFlags();

  const all = docs.data ?? [];

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const f of FOLDERS) {
      map[f.id] = f.match ? all.filter(f.match).length : all.length;
    }
    return map;
  }, [all]);

  const filtered = useMemo(() => {
    const folderDef = FOLDERS.find((f) => f.id === folder);
    const chipDef = CHIPS.find((c) => c.id === chip);
    const q = query.trim().toLowerCase();
    return all.filter((d) => {
      if (folderDef?.match && !folderDef.match(d)) return false;
      if (chipDef?.test && !chipDef.test(d)) return false;
      if (q && !d.name.toLowerCase().includes(q) && !d.case.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, folder, chip, query]);

  const pager = usePagination(filtered);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Document registry</div>
          <h1 className="heading-xl">Documents</h1>
        </div>
        <span className="spacer" />
        <button
          className="btn"
          type="button"
          onClick={() => setModalOpen(true)}
        >
          <Icon name="upload" size={14} /> Upload
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => navigate('/app/draft')}
        >
          <Icon name="plus" size={14} /> New draft
        </button>
      </div>

      <div
        className="docs-grid"
        style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24 }}
      >
        {/* Folder rail */}
        <aside
          className="col"
          style={{
            gap: 4,
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-4)',
            alignSelf: 'flex-start',
          }}
        >
          <div className="eyebrow" style={{ padding: '8px 12px' }}>Folders</div>
          {FOLDERS.map((f) => {
            const active = folder === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFolder(f.id)}
                className="row"
                style={{
                  padding: '10px 12px',
                  textAlign: 'left',
                  border: '1px solid transparent',
                  background: active ? 'var(--bg-surface)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: active ? 500 : 400,
                  fontSize: 14,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-md)',
                  gap: 10,
                  width: '100%',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <Icon name="documents" size={14} />
                <span>{f.label}</span>
                <span className="spacer" />
                <span className="mono body-xs muted">{counts[f.id] ?? 0}</span>
              </button>
            );
          })}
        </aside>

        {/* Right side: search + chips + table */}
        <div className="col" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 280px', minWidth: 240 }}>
              <input
                className="input"
                style={{ paddingLeft: 36, width: '100%' }}
                placeholder="Search by filename or matter…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-tertiary)',
                  display: 'flex',
                }}
              >
                <Icon name="search" size={14} />
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip${chip === c.id ? ' active' : ''}`}
                onClick={() => setChip(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="card" style={{ padding: 0 }}>
            {docs.isLoading && (
              <div style={{ padding: 'var(--space-6)' }}>
                <p className="body-md muted">
                  Loading documents<span className="blink" />
                </p>
              </div>
            )}
            {docs.isError && (
              <div style={{ padding: 'var(--space-6)' }}>
                <ErrorState
                  variant="inline"
                  title="Couldn't load documents"
                  description="Check your connection and try again."
                />
              </div>
            )}
            {docs.data && (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Matter</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th title="Share with the client portal">Shared</th>
                    <th title="Client must acknowledge">Ack req'd</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map((d) => {
                    const status = statusFor(d);
                    const key = d.id ?? `${d.name}-${d.updated}`;
                    const docId = d.id ?? '';
                    return (
                      <tr key={key}>
                        <td>
                          <div className="row" style={{ gap: 10 }}>
                            <Icon name="documents" size={14} />
                            <span style={{ fontWeight: 500 }}>{d.name}</span>
                          </div>
                        </td>
                        <td className="muted">{d.case}</td>
                        <td className="muted">{d.type}</td>
                        <td>
                          <span className={`badge ${status.cls}`}>{status.label}</span>
                        </td>
                        <td className="mono muted">{d.updated}</td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label="Share with client"
                            checked={!!d.sharedWithClient}
                            disabled={!docId || updateFlags.isPending}
                            onChange={(e) => updateFlags.mutate({
                              id: docId, sharedWithClient: e.target.checked,
                            })}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label="Requires acknowledgement"
                            checked={!!d.requiresAcknowledgement}
                            disabled={!docId || !d.sharedWithClient || updateFlags.isPending}
                            onChange={(e) => updateFlags.mutate({
                              id: docId, requiresAcknowledgement: e.target.checked,
                            })}
                            title={!d.sharedWithClient ? 'Share with client first' : ''}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setViewing(d)}
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8}>
                        <EmptyState
                          variant="inline"
                          title={docs.data && docs.data.length === 0 ? 'No documents yet' : 'No documents match'}
                          description={
                            docs.data && docs.data.length === 0
                              ? 'Upload a pleading, notice, or contract to start the matter record.'
                              : 'Try a different folder or clear the search.'
                          }
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {docs.data && (
              <div style={{ padding: '0 var(--space-4)' }}>
                <Pagination
                  page={pager.page}
                  totalPages={pager.totalPages}
                  total={pager.total}
                  pageSize={pager.pageSize}
                  onChange={pager.setPage}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) { .docs-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      <NewDocumentModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <FAB ariaLabel="Upload document" onClick={() => setModalOpen(true)}>
        <Icon name="upload" size={22} />
      </FAB>
      <DocumentViewerModal doc={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
