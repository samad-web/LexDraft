import { useMemo, useState } from 'react';
import { Icon, EmptyState } from '@lexdraft/ui';
import type { DocumentRecord } from '@lexdraft/types';
import { useDocuments } from '@/hooks/useDocuments';
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
  const [filter, setFilter] = useState<Bucket>('all');
  const [viewing, setViewing] = useState<DocumentRecord | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

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
        {!isLoading && visible.map((doc, i) => (
          <button
            key={doc.id ?? `${doc.name}-${i}`}
            type="button"
            onClick={() => setViewing(doc)}
            className="row-clickable"
            style={{
              width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', background: 'transparent', cursor: 'pointer',
              borderBottom: i < visible.length - 1 ? '1px solid var(--border-subtle)' : 'none',
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
            {doc.hasFile && <span className="badge" style={{ fontSize: 9 }}>FILE</span>}
            <span className="mono tabular body-xs muted" style={{ minWidth: 64, textAlign: 'right' }}>{doc.updated}</span>
            <Icon name="chevron" size={12} />
          </button>
        ))}
      </div>

      <DocumentViewerModal doc={viewing} onClose={() => setViewing(null)} />
      <NewDocumentModal open={uploadOpen} onClose={() => setUploadOpen(false)} defaultCase={matterTitle} />
    </div>
  );
}
