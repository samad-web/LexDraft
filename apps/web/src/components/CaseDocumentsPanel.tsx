import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, EmptyState } from '@lexdraft/ui';
import type { DocumentRecord } from '@lexdraft/types';
import { useDocuments, useDeleteDocument } from '@/hooks/useDocuments';
import { useDeleteDraft } from '@/hooks/useDrafts';
import { canEditInDifai } from '@/lib/imported-docs';
import { blankReview, canReview, reviewErrorText, reviewFromDocument, reviewFromDocuments } from '@/lib/review-copy';
import { useUIStore } from '@/store/ui';
import { DocumentViewerModal } from './DocumentViewerModal';
import { NewDocumentModal } from './NewDocumentModal';
import { Gate } from './Gate';
import { MultiShareDialog } from './MultiShareDialog';
import { MAX_SHARE_FILES, type ShareItem } from '@/lib/multi-share';

interface Props {
  /** The matter whose documents to show — linked by case label (title). */
  matterTitle: string;
}

// Coarse buckets an advocate scans a file by. Free-text `type` values are
// mapped to one of these; anything unrecognised falls under "Other".
type Bucket = 'all' | 'pleading' | 'order' | 'evidence' | 'correspondence' | 'draft' | 'other';

const BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'all',            label: 'All' },
  { id: 'pleading',       label: 'Pleadings' },
  { id: 'order',          label: 'Orders' },
  { id: 'evidence',       label: 'Evidence' },
  { id: 'correspondence', label: 'Correspondence' },
  { id: 'draft',          label: 'Drafts' },
  { id: 'other',          label: 'Other' },
];

function bucketOf(doc: DocumentRecord): Bucket {
  if (doc.kind === 'draft') return 'draft';
  const t = (doc.type || '').toLowerCase();
  if (/plaint|petition|application|written statement|reply|rejoinder|affidavit|vakalat|pleading/.test(t)) return 'pleading';
  if (/order|judgment|decree|award/.test(t)) return 'order';
  if (/evidence|exhibit|deposition|witness/.test(t)) return 'evidence';
  if (/notice|letter|email|correspondence|memo/.test(t)) return 'correspondence';
  if (/draft/.test(t)) return 'draft';
  return 'other';
}

/**
 * The matter's document file: every uploaded document and generated draft filed
 * against this case, filterable by type, each openable in the viewer. This is
 * the advocate's "case file" — what's on record for the matter, retrievable.
 */
export function CaseDocumentsPanel({ matterTitle }: Props) {
  const { data: allDocs = [], isLoading } = useDocuments();
  const deleteDocument = useDeleteDocument();
  const deleteDraft = useDeleteDraft();
  const navigate = useNavigate();
  const showToast = useUIStore((s) => s.showToast);
  const [filter, setFilter] = useState<Bucket>('all');
  const [viewing, setViewing] = useState<DocumentRecord | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharing, setSharing] = useState(false);

  const handleDelete = (doc: DocumentRecord) => {
    if (!doc.id) return;
    const ok = window.confirm(
      `Delete "${doc.name}"? This removes the document and its file${doc.draftId ? ', and its editable draft' : ''}. This can't be undone.`,
    );
    if (!ok) return;
    setDeletingId(doc.id);
    deleteDocument.mutate(doc.id, {
      onSuccess: () => {
        // an imported document's edited copy: its draft goes with it
        if (doc.draftId) deleteDraft.mutate(doc.draftId);
        setDeletingId(null);
        if (viewing?.id === doc.id) setViewing(null);
        showToast({ type: 'sage', text: `Deleted "${doc.name}"` });
      },
      onError: (e) => {
        setDeletingId(null);
        const msg = e instanceof Error ? e.message : 'Could not delete the document';
        showToast({ type: 'vermillion', text: msg });
      },
    });
  };

  // Documents are linked to a case by its label (title) — the same free-text
  // link the rest of the app uses. Match case-insensitively to absorb casing.
  const forMatter = useMemo(
    () => allDocs.filter((d) => d.case?.trim().toLowerCase() === matterTitle.trim().toLowerCase()),
    [allDocs, matterTitle],
  );

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { all: forMatter.length, pleading: 0, order: 0, evidence: 0, correspondence: 0, draft: 0, other: 0 };
    for (const d of forMatter) c[bucketOf(d)] += 1;
    return c;
  }, [forMatter]);

  const visible = useMemo(
    () => (filter === 'all' ? forMatter : forMatter.filter((d) => bucketOf(d) === filter)),
    [forMatter, filter],
  );

  // Only stored files can be sent (a draft with no file has nothing to attach).
  const shareable = useMemo(() => visible.filter((d) => d.id && d.hasFile), [visible]);
  useEffect(() => setSelected(new Set()), [filter, matterTitle]);
  const allTicked = shareable.length > 0 && shareable.every((d) => selected.has(d.id!));
  const toggle = (docId: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(docId)) next.delete(docId); else next.add(docId);
    return next;
  });
  const shareItems: ShareItem[] = shareable
    .filter((d) => selected.has(d.id!))
    .map((d) => ({ id: d.id!, name: d.name, fileName: d.fileName || d.name, mime: d.fileMime }));

  return (
    <div className="cs-docs">
      <div className="cs-docs-head">
        <div className="cs-card-titles">
          <h2 className="cs-card-title">Documents on file</h2>
          <p className="cs-card-sub">Pleadings, orders, evidence and drafts filed against this matter.</p>
        </div>
        <span className="cs-count">{forMatter.length} on record</span>
        <Gate feature="shared.documents">
          <button type="button" className="btn btn-sm" onClick={() => setUploadOpen(true)}>
            <Icon name="upload" size={13} /> Upload
          </button>
        </Gate>
        <Gate feature="drafting.basic">
          <button
            type="button" className="btn btn-sm"
            title="A blank page to write on with the pen (Apple Pencil, finger or mouse), saved with this case"
            onClick={() => blankReview(matterTitle).then((id) => navigate(`/app/review/${id}`))
              .catch((e: Error) => showToast({ type: 'amber', text: reviewErrorText(e.message) }))}
          >
            <Icon name="edit" size={13} /> New handwritten page
          </button>
        </Gate>
      </div>

      {/* Type filters */}
      <div className="cs-docs-chips" role="group" aria-label="Document type">
        {BUCKETS.filter((b) => b.id === 'all' || counts[b.id] > 0).map((b) => (
          <button
            key={b.id}
            type="button"
            className={`chip ${filter === b.id ? 'active' : ''}`}
            aria-pressed={filter === b.id}
            onClick={() => setFilter(b.id)}
          >
            {b.label}{b.id !== 'all' ? ` · ${counts[b.id]}` : ''}
          </button>
        ))}
      </div>

      {/* Select files to share on WhatsApp (features/multi-share.md) */}
      {shareable.length > 0 && (
        <Gate feature="shared.documents">
          <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 10px' }}>
            <label className="body-sm" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={allTicked}
                onChange={() => setSelected(allTicked ? new Set() : new Set(shareable.slice(0, MAX_SHARE_FILES).map((d) => d.id!)))}
              />
              Select all{shareable.length > MAX_SHARE_FILES ? ` (first ${MAX_SHARE_FILES})` : ''}
            </label>
            {selected.size > 0 && (
              <>
                <span className="body-sm">{selected.size} selected</span>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setSharing(true)}
                  disabled={selected.size > MAX_SHARE_FILES}>
                  <Icon name="chat" size={13} /> Share {selected.size} on WhatsApp
                </button>
                {(() => {
                  const markable = forMatter.filter((d) => d.id && selected.has(d.id) && canReview(d));
                  return markable.length > 0 && (
                    <Gate feature="drafting.basic">
                      <button
                        type="button" className="btn btn-sm"
                        title="Open the selected files (PDFs, Word, photos of paper) as one set of pages to mark with the pen"
                        onClick={() => reviewFromDocuments(markable.map((d) => d.id!)).then((id) => navigate(`/app/review/${id}`))
                          .catch((e: Error) => showToast({ type: 'amber', text: reviewErrorText(e.message) }))}
                      >
                        <Icon name="edit" size={13} /> Mark up {markable.length > 1 ? `${markable.length} together` : '1'}
                      </button>
                    </Gate>
                  );
                })()}
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
                {selected.size > MAX_SHARE_FILES && <span className="body-sm" role="alert">Up to {MAX_SHARE_FILES} at a time.</span>}
              </>
            )}
          </div>
        </Gate>
      )}

      {/* List */}
      <div className="card cs-docs-list">
        {isLoading && (
          <p className="cs-muted" style={{ padding: 20, textAlign: 'center' }}>Loading documents…</p>
        )}
        {!isLoading && visible.length === 0 && (
          <EmptyState
            variant="inline"
            title={forMatter.length === 0 ? 'No documents on file yet' : 'None in this category'}
            description={
              forMatter.length === 0
                ? 'Upload the case papers, or generate a draft and save it to this matter.'
                : 'Try a different filter.'
            }
          />
        )}
        {!isLoading && visible.map((doc, i) => {
          // An uploaded document with no stored file is an empty shell — the row
          // exists but the engine/viewer have nothing to open. Flag it so the
          // advocate can tell at a glance which files need re-uploading.
          const fileMissing = doc.kind !== 'draft' && !doc.hasFile;
          return (
          <div key={doc.id ?? `${doc.name}-${i}`} className="cs-doc">
            {doc.id && doc.hasFile ? (
              <input
                type="checkbox"
                aria-label={`Select ${doc.name} to share`}
                checked={selected.has(doc.id)}
                onChange={() => toggle(doc.id!)}
                style={{ flex: 'none', width: 16, height: 16, accentColor: 'var(--text-primary)' }}
              />
            ) : (
              <span aria-hidden="true" style={{ width: 16, flex: 'none' }} />
            )}
            <button type="button" className="cs-doc-open" onClick={() => setViewing(doc)}>
              <span className="cs-line-icon" aria-hidden="true">
                <Icon name={doc.kind === 'draft' ? 'draft' : 'documents'} size={15} />
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="cs-doc-name" style={{ display: 'block' }}>{doc.name}</span>
                <span className="cs-doc-meta" style={{ display: 'block' }}>
                  {doc.type || (doc.kind === 'draft' ? 'Draft' : 'Document')}
                  {doc.fileName ? ` · ${doc.fileName}` : ''}
                </span>
              </span>
            </button>
            {doc.hasFile && <span className="cs-status is-quiet">File</span>}
            {fileMissing && (
              <span
                className="cs-status is-strong is-dashed"
                title="This document's file content isn't stored. Re-upload it so it can be read."
              >
                File missing
              </span>
            )}
            <span className="cs-doc-date">{doc.updated}</span>
            {doc.id && (doc.reviewId || canReview(doc)) && (
              <Gate feature="drafting.basic">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => (doc.reviewId
                    ? navigate(`/app/review/${doc.reviewId}`)
                    : reviewFromDocument(doc.id!).then((id) => navigate(`/app/review/${id}`))
                      .catch((e: Error) => showToast({ type: 'amber', text: reviewErrorText(e.message) })))}
                  title={doc.reviewId ? 'Open this review with its marks and notes' : 'Mark a copy of this file with a pen and margin notes (the file is not changed)'}
                  aria-label={`${doc.reviewId ? 'Open review' : 'Review'}: ${doc.name}`}
                >
                  {doc.reviewId ? 'Open review' : 'Review'}
                </button>
              </Gate>
            )}
            {doc.id && (doc.draftId || canEditInDifai(doc)) && (
              <Gate feature="drafting.basic">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => navigate('/app/draft', { state: doc.draftId ? { draftId: doc.draftId } : { openDocumentId: doc.id } })}
                  title={doc.draftId ? 'Edit this document' : 'Open this file in the DifAi editor (your file is kept as it is)'}
                  aria-label={`${doc.draftId ? 'Edit' : 'Edit in DifAi'}: ${doc.name}`}
                >
                  <Icon name="edit" size={14} /> {doc.draftId ? 'Edit' : 'Edit in DifAi'}
                </button>
              </Gate>
            )}
            {doc.id ? (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                title={deletingId === doc.id ? 'Deleting…' : `Delete ${doc.name}`}
                aria-label={`Delete ${doc.name}`}
                disabled={deletingId === doc.id}
                onClick={() => handleDelete(doc)}
                style={deletingId === doc.id ? { opacity: 0.5 } : undefined}
              >
                <Icon name="trash" size={14} />
              </button>
            ) : (
              <Icon name="chevron" size={12} />
            )}
          </div>
          );
        })}
      </div>

      <DocumentViewerModal doc={viewing} onClose={() => setViewing(null)} />
      <MultiShareDialog
        open={sharing}
        onClose={() => setSharing(false)}
        items={shareItems}
        forWhom={matterTitle}
        onSent={() => { setSharing(false); setSelected(new Set()); }}
      />
      <NewDocumentModal open={uploadOpen} onClose={() => setUploadOpen(false)} defaultCase={matterTitle} />
    </div>
  );
}
