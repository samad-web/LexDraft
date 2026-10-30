import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, EmptyState, ErrorState } from '@lexdraft/ui';
import { FAB } from '@/components/FAB';
import { useDeleteDocument, useDocuments } from '@/hooks/useDocuments';
import { useDeleteDraft } from '@/hooks/useDrafts';
import type { DocumentRecord } from '@lexdraft/types';
import { NewDocumentModal } from '@/components/NewDocumentModal';
import { DocumentViewerModal } from '@/components/DocumentViewerModal';
import { EditDocumentModal } from '@/components/EditDocumentModal';
import { SendForSignatureModal } from '@/components/SendForSignatureModal';
import { Gate } from '@/components/Gate';
import { PageHeader } from '@/components/PageHeader';
import { useUpdateDocumentPortalFlags } from '@/hooks/usePortalAdmin';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import { useConfirm } from '@/components/ConfirmDialog';
import { useUIStore } from '@/store/ui';

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
  if (/final|signed|filed/i.test(t)) return { label: 'Filed', cls: 'is-solid' };
  if (/draft/i.test(t)) return { label: 'Draft', cls: 'is-dashed' };
  if (/notice/i.test(t)) return { label: 'Sent', cls: 'is-strong' };
  return { label: doc.type.toUpperCase(), cls: 'is-muted' };
}

export function DocumentsView() {
  const docs = useDocuments();
  const navigate = useNavigate();
  const [folder, setFolder] = useState<string>('all');
  const [chip, setChip] = useState<string>('all');
  const [query, setQuery] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [viewing, setViewing] = useState<DocumentRecord | null>(null);
  const [editing, setEditing] = useState<DocumentRecord | null>(null);
  const [signing, setSigning] = useState<DocumentRecord | null>(null);
  const updateFlags = useUpdateDocumentPortalFlags();
  const deleteDocument = useDeleteDocument();
  const deleteDraft = useDeleteDraft();
  const confirm = useConfirm();
  const showToast = useUIStore((s) => s.showToast);

  const handleEdit = (d: DocumentRecord) => {
    if (d.kind === 'draft') {
      // Drafts edit by loading them into the drafting workspace, not in a
      // metadata-only dialog.
      navigate('/app/draft', { state: { draftId: d.id } });
      return;
    }
    setEditing(d);
  };

  const handleDelete = async (d: DocumentRecord) => {
    if (!d.id) return;
    const isDraft = d.kind === 'draft';
    const ok = await confirm({
      title: `Delete ${isDraft ? 'draft' : 'document'}?`,
      message: isDraft
        ? `"${d.name}" will be permanently removed from your saved drafts. The AI quota credit isn't refunded.`
        : `"${d.name}" will be permanently removed, including any attached file. This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      if (isDraft) {
        await deleteDraft.mutateAsync(d.id);
      } else {
        await deleteDocument.mutateAsync(d.id);
      }
      showToast({ type: 'sage', text: `Deleted "${d.name}"` });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Could not delete';
      showToast({ type: 'vermillion', text: msg });
    }
  };

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
    <div className="col stagger fm-view fm-docs">
      <PageHeader
        title="Document Vault"
        description="Every pleading, notice, contract and receipt across your matters."
        meta={docs.data ? `${all.length} documents` : undefined}
        actions={<>
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
        </>}
      />

      <div className="fm-docs-grid">
        {/* Folder rail (a tab strip below 1200px) */}
        <nav className="fm-folders" aria-label="Folders">
          <div className="fm-eyebrow">Folders</div>
          {FOLDERS.map((f) => {
            const active = folder === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFolder(f.id)}
                className={`fm-folder${active ? ' is-active' : ''}`}
                aria-pressed={active}
              >
                <Icon name="documents" size={14} />
                <span className="fm-folder-label">{f.label}</span>
                <span className="fm-folder-count">{counts[f.id] ?? 0}</span>
              </button>
            );
          })}
        </nav>

        {/* Right side: search + chips + table */}
        <div className="fm-docs-main">
          <div className="fm-toolbar">
            <div className="fm-search">
              <input
                className="input"
                type="search"
                placeholder="Search by filename or matter…"
                aria-label="Search documents"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="fm-search-icon"><Icon name="search" size={14} /></span>
            </div>
          </div>

          <div className="fm-chips" role="group" aria-label="Document type">
            {CHIPS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`chip${chip === c.id ? ' active' : ''}`}
                aria-pressed={chip === c.id}
                onClick={() => setChip(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="card fm-docs-card">
            {docs.isLoading && (
              <p className="fm-loading">
                Loading documents<span className="blink" />
              </p>
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
              <div className="fm-scroll">
                <table className="tbl tbl-fit docs-tbl fm-tbl">
                  <colgroup>
                    <col style={{ width: 'auto' }} />
                    <col style={{ width: 160 }} />
                    <col style={{ width: 112 }} />
                    <col style={{ width: 136 }} />
                    <col style={{ width: 104 }} />
                    <col style={{ width: 76 }} />
                    <col style={{ width: 84 }} />
                    <col style={{ width: 112 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Matter</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th className="is-center" title="Share with the client portal">Shared</th>
                      <th className="is-center" title="Client must acknowledge">Ack req'd</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pager.slice.map((d) => {
                      const status = statusFor(d);
                      const key = d.id ?? `${d.name}-${d.updated}`;
                      const docId = d.id ?? '';
                      const isDraft = d.kind === 'draft';
                      return (
                        <tr
                          key={key}
                          className="docs-row"
                          role="button"
                          tabIndex={0}
                          aria-label={`Open ${d.name}`}
                          onClick={() => setViewing(d)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setViewing(d);
                            }
                          }}
                        >
                          <td>
                            <div className="fm-doc-name" title={d.name}>
                              <span className={`fm-doc-icon${isDraft ? ' is-draft' : ''}`} aria-hidden>
                                <Icon name={isDraft ? 'draft' : 'file'} size={15} />
                              </span>
                              <span className="fm-doc-text">
                                <span className="fm-doc-title" style={{ display: 'block' }}>{d.name}</span>
                                <span className="fm-doc-type" style={{ display: 'block' }}>
                                  {isDraft ? 'Saved draft' : d.hasFile ? 'File attached' : 'Record only'}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td title={d.case}>
                            <div className="fm-ellip">{d.case}</div>
                          </td>
                          <td title={d.type}>
                            <div className="fm-ellip">{d.type}</div>
                          </td>
                          <td>
                            <span className={`fm-pill ${status.cls}`}>{status.label}</span>
                          </td>
                          <td><span className="fm-date">{d.updated}</span></td>
                          <td className="is-center" onClick={(e) => e.stopPropagation()}>
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
                          <td className="is-center" onClick={(e) => e.stopPropagation()}>
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
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="fm-doc-actions">
                              {d.hasFile && docId && (
                                <Gate feature="esign.send">
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-ghost"
                                    onClick={() => setSigning(d)}
                                    title="Send for electronic signature"
                                    aria-label={`Send ${d.name} for signature`}
                                  >
                                    <Icon name="check" size={13} />
                                  </button>
                                </Gate>
                              )}
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                onClick={() => handleEdit(d)}
                                disabled={!docId}
                                title={d.kind === 'draft' ? 'Edit draft' : 'Edit metadata'}
                                aria-label={`Edit ${d.name}`}
                              >
                                <Icon name="edit" size={13} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                onClick={() => handleDelete(d)}
                                disabled={!docId || deleteDocument.isPending || deleteDraft.isPending}
                                title="Delete"
                                aria-label={`Delete ${d.name}`}
                              >
                                <Icon name="trash" size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={8} data-span="all">
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
              </div>
            )}
            {docs.data && (
              <div className="fm-tbl-foot">
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

      <NewDocumentModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <FAB ariaLabel="Upload document" onClick={() => setModalOpen(true)}>
        <Icon name="upload" size={22} />
      </FAB>
      <DocumentViewerModal doc={viewing} onClose={() => setViewing(null)} />
      <EditDocumentModal doc={editing} onClose={() => setEditing(null)} />
      {signing?.id && (
        <SendForSignatureModal
          open={!!signing}
          onClose={() => setSigning(null)}
          documentId={signing.id}
          documentName={signing.name}
        />
      )}
    </div>
  );
}
