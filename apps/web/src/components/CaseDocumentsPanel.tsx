import { useMemo, useState } from 'react';
import { Icon, EmptyState } from '@lexdraft/ui';
import type { DocumentRecord } from '@lexdraft/types';
import { useDocuments, useDeleteDocument } from '@/hooks/useDocuments';
import { useUIStore } from '@/store/ui';
import { DocumentViewerModal } from './DocumentViewerModal';
import { NewDocumentModal } from './NewDocumentModal';
import { Gate } from './Gate';

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
  const showToast = useUIStore((s) => s.showToast);
  const [filter, setFilter] = useState<Bucket>('all');
  const [viewing, setViewing] = useState<DocumentRecord | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = (doc: DocumentRecord) => {
    if (!doc.id) return;
    const ok = window.confirm(
      `Delete "${doc.name}"? This removes the document and its file. This can't be undone.`,
    );
    if (!ok) return;
    setDeletingId(doc.id);
    deleteDocument.mutate(doc.id, {
      onSuccess: () => {
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

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="heading-md">Documents on file</div>
        <span className="body-sm muted">{forMatter.length} on record</span>
        <span className="spacer" style={{ flex: 1 }} />
        <Gate feature="shared.documents">
          <button type="button" className="btn btn-sm" onClick={() => setUploadOpen(true)}>
            <Icon name="upload" size={13} /> Upload
          </button>
        </Gate>
      </div>

      {/* Type filters */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
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

      {/* List */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading && (
          <div className="body-sm muted" style={{ padding: 20, textAlign: 'center' }}>Loading documents…</div>
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
          <div
            key={doc.id ?? `${doc.name}-${i}`}
            className="row-clickable"
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', background: 'transparent',
              borderBottom: i < visible.length - 1 ? '1px solid var(--border-subtle)' : 'none',
            }}
          >
            <button
              type="button"
              onClick={() => setViewing(doc)}
              style={{
                flex: 1, minWidth: 0, textAlign: 'left', display: 'flex', alignItems: 'center',
                gap: 12, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                color: 'inherit', font: 'inherit',
              }}
            >
              <Icon name={doc.kind === 'draft' ? 'draft' : 'documents'} size={16} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.name}
                </div>
                <div className="body-xs muted">
                  {doc.type || (doc.kind === 'draft' ? 'Draft' : 'Document')}
                  {doc.fileName ? ` · ${doc.fileName}` : ''}
                </div>
              </div>
            </button>
            {doc.hasFile && <span className="badge" style={{ fontSize: 9 }}>FILE</span>}
            {fileMissing && (
              <span
                className="badge"
                title="This document's file content isn't stored. Re-upload it so it can be read."
                style={{ fontSize: 9, color: 'var(--warning)', borderColor: 'var(--warning)' }}
              >
                FILE MISSING
              </span>
            )}
            <span className="mono tabular body-xs muted" style={{ minWidth: 64, textAlign: 'right' }}>{doc.updated}</span>
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
      <NewDocumentModal open={uploadOpen} onClose={() => setUploadOpen(false)} defaultCase={matterTitle} />
    </div>
  );
}
