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
  const [editing, setEditing] = useState<DocumentRecord | null>(null);
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

      <div className="docs-grid split-rail" style={{ gap: 24 }}>
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
              <table className="tbl tbl-fit docs-tbl">
                <colgroup>
                  <col style={{ width: 'auto' }} />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 92 }} />
                  <col style={{ width: 88 }} />
                </colgroup>
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
                          <div
                            className="row docs-name-cell"
                            style={{ gap: 10, minWidth: 0 }}
                            title={d.name}
                          >
                            <Icon name="documents" size={14} />
                            <span
                              style={{
                                fontWeight: 500,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                minWidth: 0,
                                flex: 1,
                              }}
                            >
                              {d.name}
                            </span>
                          </div>
                        </td>
                        <td
                          className="muted"
                          style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={d.case}
                        >
                          {d.case}
                        </td>
                        <td
                          className="muted"
                          style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={d.type}
                        >
                          {d.type}
                        </td>
                        <td>
                          <span className={`badge ${status.cls}`}>{status.label}</span>
                        </td>
                        <td className="mono muted">{d.updated}</td>
                        <td onClick={(e) => e.stopPropagation()}>
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
                        <td onClick={(e) => e.stopPropagation()}>
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
                          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              onClick={() => handleEdit(d)}
                              disabled={!docId}
                              title={d.kind === 'draft' ? 'Edit draft' : 'Edit metadata'}
                              aria-label={`Edit ${d.name}`}
                            >
                              <Icon name="edit" size={12} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              onClick={() => handleDelete(d)}
                              disabled={!docId || deleteDocument.isPending || deleteDraft.isPending}
                              title="Delete"
                              aria-label={`Delete ${d.name}`}
                              style={{ color: 'var(--danger)' }}
                            >
                              <Icon name="trash" size={12} />
                            </button>
                          </div>
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

        /* Defeat the global \`min-width: max-content\` rule on table cards
           (globals.css §.tbl) for the documents table — that rule forces a
           horizontal scrollbar on wide schemas, which we don't want here.
           Instead, use a fixed table layout with explicit column widths and
           ellipsis-truncate the long cells. */
        .docs-grid .card:has(> .tbl) { overflow: hidden; }
        .docs-grid .card > .docs-tbl { min-width: 0; }
        .docs-tbl { table-layout: fixed; width: 100%; }
        /* The Document cell uses a flex row inside the <td>; let the span
           inside truncate by giving the flex parent min-width: 0. Without
           this, flex's default min-width: auto would keep the span at its
           intrinsic width and push the table wide. */
        .docs-tbl .docs-name-cell { min-width: 0; }

        /* Trim padding at narrower widths so the action buttons + status
           badge still fit inside the explicit column widths. */
        @media (max-width: 1200px) {
          .docs-tbl th, .docs-tbl td { padding-left: 12px; padding-right: 12px; }
        }

        /* Whole row is now the click target for opening the document; give
           it an affordance so users know it. Keyboard focus uses the same
           treatment plus a visible outline. */
        .docs-tbl .docs-row { cursor: pointer; }
        .docs-tbl .docs-row:focus-visible {
          outline: 2px solid var(--text-primary);
          outline-offset: -2px;
        }
      `}</style>

      <NewDocumentModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <FAB ariaLabel="Upload document" onClick={() => setModalOpen(true)}>
        <Icon name="upload" size={22} />
      </FAB>
      <DocumentViewerModal doc={viewing} onClose={() => setViewing(null)} />
      <EditDocumentModal doc={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
