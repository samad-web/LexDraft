import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import type {
  MatterBrief,
  MatterChatMessage,
  MatterChatThread,
  MatterCitation,
  MatterDocument,
  MatterDocumentSummary,
} from '@lexdraft/types';
import { Icon } from '@lexdraft/ui';
import { Modal } from '@/components/Modal';
import { useConfirm } from '@/components/ConfirmDialog';
import { useDocuments } from '@/hooks/useDocuments';
import { useUIStore } from '@/store/ui';
import {
  useMatterBrief,
  useMatterDocument,
  useMatterDocuments,
  usePullMatterDocument,
  useRegenerateMatterBrief,
  useRemoveMatterDocument,
  useSummariseMatterDocument,
  useUploadMatterDocuments,
} from '@/hooks/useMatterIntel';
import {
  useCreateMatterChatThread,
  useMatterChatMessages,
  useMatterChatThreads,
  usePostMatterChatMessage,
} from '@/hooks/useMatterChat';

// =============================================================================
// Matter Intelligence — three-pane layout (documents · brief+detail · chat).
//
// Used both as a stand-alone view (/app/matter-intel/:caseId) and as the
// "Intelligence" tab inside CaseDetailView. Same component tree in both
// places; the only contextual difference is the surrounding shell.
//
// State:
//   * selectedDocId  — which ingested document the centre pane shows
//   * centreTab      — 'brief' | 'document' (auto-flips to 'document' when
//                       a row is clicked; user can switch back to 'brief')
//   * threadId       — active chat thread; null means "create on first send"
//   * draft          — composer text (lifted so Cmd/Ctrl+Enter works)
//   * streaming      — { assistantText } during a live stream
//   * citationDrawer — currently-open source-document preview, if any
// =============================================================================

const ACCEPTED_TYPES = '.pdf,.docx,.txt,.md';
const MAX_BYTES = 25 * 1024 * 1024;

interface MatterIntelPanelProps {
  caseId: string;
  matterTitle?: string;
}

export function MatterIntelPanel({ caseId, matterTitle }: MatterIntelPanelProps) {
  const documentsQ = useMatterDocuments(caseId);
  const briefQ     = useMatterBrief(caseId);

  const [selectedDocId, setSelectedDocId]   = useState<string | null>(null);
  const [centreTab, setCentreTab]           = useState<'brief' | 'document'>('brief');
  const [citationDoc, setCitationDoc]       = useState<{ id: string; page: number } | null>(null);

  const handleSelectDoc = (id: string) => {
    setSelectedDocId(id);
    setCentreTab('document');
  };

  return (
    <div className="matter-intel-shell">
      {/* LEFT — Documents */}
      <div className="matter-intel-pane matter-intel-pane-left">
        <DocumentsPane
          caseId={caseId}
          documents={documentsQ.data ?? []}
          isLoading={documentsQ.isLoading}
          selectedDocId={selectedDocId}
          onSelect={handleSelectDoc}
        />
      </div>

      {/* CENTRE — Brief + Document Detail */}
      <div className="matter-intel-pane matter-intel-pane-centre">
        <CentreTabs
          tab={centreTab}
          onChange={setCentreTab}
          documentSelected={Boolean(selectedDocId)}
        />
        {centreTab === 'brief' && (
          <BriefPanel
            caseId={caseId}
            brief={briefQ.data ?? null}
            isLoading={briefQ.isLoading}
            matterTitle={matterTitle}
            documentCount={documentsQ.data?.length ?? 0}
          />
        )}
        {centreTab === 'document' && (
          <DocumentDetailPanel
            caseId={caseId}
            matterDocumentId={selectedDocId}
            onCitationClick={(c) => setCitationDoc({ id: c.matterDocumentId, page: c.page })}
          />
        )}
      </div>

      {/* RIGHT — Chat */}
      <div className="matter-intel-pane matter-intel-pane-right">
        <ChatPanel
          caseId={caseId}
          documentCount={documentsQ.data?.length ?? 0}
          onCitationClick={(c) => setCitationDoc({ id: c.matterDocumentId, page: c.page })}
        />
      </div>

      {/* Citation preview drawer */}
      {citationDoc && (
        <CitationDrawer
          matterDocumentId={citationDoc.id}
          page={citationDoc.page}
          onClose={() => setCitationDoc(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents pane
// ---------------------------------------------------------------------------

interface DocumentsPaneProps {
  caseId: string;
  documents: Array<MatterDocument & { summary?: MatterDocumentSummary }>;
  isLoading: boolean;
  selectedDocId: string | null;
  onSelect: (id: string) => void;
}

function DocumentsPane({ caseId, documents, isLoading, selectedDocId, onSelect }: DocumentsPaneProps) {
  const upload = useUploadMatterDocuments(caseId);
  const remove = useRemoveMatterDocument(caseId);
  const showToast = useUIStore((s) => s.showToast);
  const confirm = useConfirm();
  const [pullOpen, setPullOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const oversized = list.filter((f) => f.size > MAX_BYTES);
    if (oversized.length > 0) {
      showToast({ type: 'vermillion', text: `${oversized.length} file(s) exceed the 25 MB cap` });
      return;
    }
    try {
      const result = await upload.mutateAsync(list);
      if (result.failures.length === 0) {
        showToast({ type: 'sage', text: `Ingested ${result.ingested.length} document${result.ingested.length === 1 ? '' : 's'}` });
      } else {
        showToast({
          type: 'amber',
          text: `${result.ingested.length} ingested · ${result.failures.length} failed (${result.failures[0]!.fileName})`,
        });
      }
    } catch (err) {
      showToast({ type: 'vermillion', text: err instanceof Error ? err.message : 'Upload failed' });
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <>
      <div className="pane-head">
        <div className="eyebrow">Documents</div>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setPullOpen(true)}
        >
          Pull from matter
        </button>
      </div>

      <div
        className={`matter-intel-dropzone${dragOver ? ' is-over' : ''}${upload.isPending ? ' is-busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <Icon name="upload" size={18} />
        <div>
          <div className="body-sm" style={{ fontWeight: 500 }}>
            {upload.isPending ? 'Uploading…' : 'Drop PDFs, DOCX, TXT, or MD here'}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            ≤ 25 MB each · multiple files supported
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES}
          style={{ display: 'none' }}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <div className="matter-intel-list" aria-busy={isLoading}>
        {isLoading && <DocSkeletonList count={3} />}
        {!isLoading && documents.length === 0 && (
          <div className="muted body-sm" style={{ padding: '20px 4px' }}>
            No documents ingested yet. Upload files or pull from the matter to begin.
          </div>
        )}
        {documents.map((d) => (
          <DocRow
            key={d.id}
            doc={d}
            selected={d.id === selectedDocId}
            onClick={() => onSelect(d.id)}
            onRemove={async () => {
              const ok = await confirm({
                title: 'Remove document?',
                message: `"${d.fileName}" will be removed from matter intelligence. Source files on the matter page are not affected.`,
                confirmLabel: 'Remove',
                danger: true,
              });
              if (!ok) return;
              await remove.mutateAsync(d.id);
              showToast({ type: 'sage', text: 'Document removed' });
            }}
          />
        ))}
      </div>

      <PullFromMatterModal
        open={pullOpen}
        onClose={() => setPullOpen(false)}
        caseId={caseId}
        ingestedDocumentIds={new Set(documents.map((d) => d.sourceDocumentId).filter(Boolean) as string[])}
      />
    </>
  );
}

function DocRow({
  doc,
  selected,
  onClick,
  onRemove,
}: {
  doc: MatterDocument & { summary?: MatterDocumentSummary };
  selected: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`matter-intel-row${selected ? ' is-selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="matter-intel-row-name" title={doc.fileName}>
          {doc.fileName}
        </div>
        <div className="cluster" style={{ gap: 6 }}>
          {doc.summary?.documentType && (
            <span className="chip chip-sm">{titleCase(doc.summary.documentType)}</span>
          )}
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            {new Date(doc.ingestedAt).toLocaleString()}
          </span>
        </div>
      </div>
      <StatusChip status={doc.status} />
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        aria-label="Remove document"
        title="Remove"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

function StatusChip({ status }: { status: MatterDocument['status'] }) {
  if (status === 'ready')     return <span className="badge badge-sage">Ready</span>;
  if (status === 'failed')    return <span className="badge badge-vermillion">Failed</span>;
  // The pipeline no longer embeds — the matter_doc_status enum still has
  // the 'embedding' value for backwards-compat with rows persisted before
  // the embed removal. Relabel to "Indexing…" so the user-visible language
  // reflects what's actually happening (text-only chunk persistence).
  if (status === 'embedding') return <span className="badge badge-cobalt">Indexing…</span>;
  if (status === 'extracting')return <span className="badge badge-cobalt">Extracting…</span>;
  return <span className="badge badge-cream">Queued</span>;
}

function DocSkeletonList({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="matter-intel-row" aria-busy="true">
          <div style={{ flex: 1 }}>
            <div className="skeleton skeleton-text" style={{ width: '60%', height: 14 }} />
            <div className="skeleton skeleton-text" style={{ width: '35%', height: 10, marginTop: 6 }} />
          </div>
          <div className="skeleton" style={{ width: 56, height: 18, borderRadius: 9999 }} />
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pull-from-matter modal
// ---------------------------------------------------------------------------

interface PullFromMatterModalProps {
  open: boolean;
  onClose: () => void;
  caseId: string;
  ingestedDocumentIds: Set<string>;
}

function PullFromMatterModal({ open, onClose, caseId, ingestedDocumentIds }: PullFromMatterModalProps) {
  const docsQ = useDocuments();
  const pull  = usePullMatterDocument(caseId);
  const showToast = useUIStore((s) => s.showToast);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) setPicked(new Set());
  }, [open]);

  // Best-effort filter: the documents endpoint doesn't yet expose caseId on
  // the list payload (legacy DocumentRecord shape), so we offer ALL the
  // firm's documents and rely on the user to pick. The server-side pull
  // route also rejects cross-matter sources via the case/firm join.
  // We narrow to rows with `id` so downstream picker logic gets a string.
  const candidates = (docsQ.data ?? []).filter(
    (d): d is typeof d & { id: string } => Boolean(d.hasFile && d.id),
  );

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirm = async () => {
    const ids = Array.from(picked);
    const results = await Promise.allSettled(ids.map((id) => pull.mutateAsync(id)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - ok;
    if (failed === 0) showToast({ type: 'sage', text: `Pulled ${ok} document${ok === 1 ? '' : 's'}` });
    else showToast({ type: 'amber', text: `${ok} pulled · ${failed} failed` });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Pull from matter"
      width={560}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={picked.size === 0 || pull.isPending}
            onClick={confirm}
          >
            {pull.isPending ? 'Pulling…' : `Pull ${picked.size || ''}`.trim()}
          </button>
        </>
      }
    >
      {docsQ.isLoading && <div className="muted body-sm">Loading matter documents…</div>}
      {!docsQ.isLoading && candidates.length === 0 && (
        <div className="muted body-sm">
          No uploaded documents on this firm yet. Upload to the Documents tab first, then come back.
        </div>
      )}
      <div className="matter-intel-list">
        {candidates.map((d) => {
          const already = ingestedDocumentIds.has(d.id);
          const checked = picked.has(d.id);
          return (
            <label
              key={d.id}
              className="matter-intel-pull-row"
              style={{ opacity: already ? 0.55 : 1 }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={already}
                onChange={() => toggle(d.id)}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{d.name}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                  {d.case} · {d.type} · {d.updated}
                </div>
              </div>
              {already && <span className="badge badge-cream">Already ingested</span>}
            </label>
          );
        })}
      </div>
      <div suppressHydrationWarning>{caseId /* referenced so lint doesn't strip the prop */}</div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Centre tab strip
// ---------------------------------------------------------------------------

function CentreTabs({
  tab,
  onChange,
  documentSelected,
}: {
  tab: 'brief' | 'document';
  onChange: (t: 'brief' | 'document') => void;
  documentSelected: boolean;
}) {
  return (
    <div className="matter-intel-tabs">
      <button
        type="button"
        className={`matter-intel-tab${tab === 'brief' ? ' is-active' : ''}`}
        onClick={() => onChange('brief')}
      >
        Brief
      </button>
      <button
        type="button"
        className={`matter-intel-tab${tab === 'document' ? ' is-active' : ''}`}
        onClick={() => onChange('document')}
        disabled={!documentSelected}
      >
        Document
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brief panel
// ---------------------------------------------------------------------------

function BriefPanel({
  caseId,
  brief,
  isLoading,
  matterTitle,
  documentCount,
}: {
  caseId: string;
  brief: MatterBrief | null;
  isLoading: boolean;
  matterTitle?: string;
  documentCount: number;
}) {
  const regenerate = useRegenerateMatterBrief(caseId);
  const showToast = useUIStore((s) => s.showToast);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const onConfirm = async () => {
    setConfirmOpen(false);
    try {
      await regenerate.mutateAsync();
      showToast({ type: 'sage', text: 'Matter brief generated' });
    } catch (err) {
      showToast({ type: 'vermillion', text: err instanceof Error ? err.message : 'Generation failed' });
    }
  };

  if (isLoading) return <div className="muted body-sm" style={{ padding: 24 }}>Loading brief…</div>;

  // Synthesising the brief from many documents can take 10–30s. Without a
  // visual cue the screen looks frozen, so we render a spinner + progress
  // strip in place of the empty-state OR overlaid on top of the existing
  // brief during regeneration.
  if (regenerate.isPending) {
    return (
      <div className="matter-intel-empty" aria-busy="true" aria-live="polite">
        <span
          className="lex-spinner lex-spinner-lg"
          style={{ marginBottom: 'var(--space-3)' }}
          aria-hidden
        />
        <div className="heading-md" style={{ marginBottom: 8 }}>Synthesising matter brief…</div>
        <p className="body-sm muted" style={{ maxWidth: 460 }}>
          Reading {documentCount} document{documentCount === 1 ? '' : 's'} and composing the brief.
          This typically takes 10–30 seconds.
        </p>
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="matter-intel-empty">
        <div className="heading-md" style={{ marginBottom: 8 }}>No brief yet</div>
        <p className="body-sm muted" style={{ marginBottom: 20, maxWidth: 460 }}>
          Generate a synthesised brief across the {documentCount > 0 ? `${documentCount} ingested ` : ''}
          document{documentCount === 1 ? '' : 's'} in this matter — posture, key facts, disputed issues,
          chronology, and open questions.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={documentCount === 0 || regenerate.isPending}
          onClick={() => void onConfirm()}
        >
          {regenerate.isPending ? (
            <><span className="lex-spinner" aria-hidden /> Synthesising…</>
          ) : 'Generate brief'}
        </button>
        {documentCount === 0 && (
          <p className="body-xs muted" style={{ marginTop: 8 }}>
            Ingest at least one document to enable brief generation.
          </p>
        )}
      </div>
    );
  }

  const degraded = brief.modelUsed.startsWith('fallback:');

  return (
    <div className="matter-intel-brief">
      <div className="row" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div className="eyebrow">Matter brief{matterTitle ? ` · ${matterTitle}` : ''}</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
            Generated {new Date(brief.generatedAt).toLocaleString()} · {brief.modelUsed}
          </div>
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setConfirmOpen(true)}
          disabled={regenerate.isPending}
        >
          {regenerate.isPending ? (
            <><span className="lex-spinner" aria-hidden /> Synthesising…</>
          ) : 'Regenerate'}
        </button>
      </div>

      {degraded && <DegradedModeBanner />}

      <BriefSection title="Current posture">
        <p className="body-md">{brief.posture || <em className="muted">Unknown</em>}</p>
      </BriefSection>

      <BriefSection title="Key facts">
        <BulletList items={brief.keyFacts} />
      </BriefSection>

      <BriefSection title="Disputed issues">
        <BulletList items={brief.disputedIssues} />
      </BriefSection>

      <BriefSection title="Timeline">
        {brief.timeline.length === 0 ? (
          <p className="muted body-sm">No timeline events extracted.</p>
        ) : (
          <ol className="matter-intel-timeline">
            {brief.timeline.map((t, i) => (
              <li key={`${t.date ?? ''}-${i}`}>
                <span className="mono tabular" style={{ minWidth: 96 }}>{t.date || '—'}</span>
                <span>{t.event || ''}</span>
              </li>
            ))}
          </ol>
        )}
      </BriefSection>

      <BriefSection title="Open questions">
        <BulletList items={brief.openQuestions} />
      </BriefSection>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Regenerate brief?"
        width={420}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => void onConfirm()}>
              Regenerate
            </button>
          </>
        }
      >
        <p className="body-sm">
          The current brief will be archived and a new one synthesised from
          the current document summaries. This may take 10–30 seconds.
        </p>
      </Modal>
    </div>
  );
}

function BriefSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="matter-intel-brief-section">
      <div className="eyebrow" style={{ marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items || items.length === 0) return <p className="muted body-sm">None recorded.</p>;
  return (
    <ul className="matter-intel-bullets">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Document detail panel
// ---------------------------------------------------------------------------

function DocumentDetailPanel({
  caseId,
  matterDocumentId,
  onCitationClick,
}: {
  caseId: string;
  matterDocumentId: string | null;
  onCitationClick: (c: MatterCitation) => void;
}) {
  const docQ = useMatterDocument(matterDocumentId);
  const resummarise = useSummariseMatterDocument(caseId);
  const showToast = useUIStore((s) => s.showToast);

  if (!matterDocumentId) {
    return (
      <div className="matter-intel-empty">
        <div className="muted body-sm">Select a document on the left to see its structured summary.</div>
      </div>
    );
  }

  if (docQ.isLoading) return <div className="muted body-sm" style={{ padding: 24 }}>Loading…</div>;

  if (!docQ.data) {
    return (
      <div className="matter-intel-empty">
        <div className="heading-md" style={{ marginBottom: 8 }}>Document not found</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => docQ.refetch()}>Retry</button>
      </div>
    );
  }

  const doc = docQ.data;
  const summary = doc.summary;
  const degraded = summary?.modelUsed.startsWith('fallback:') ?? false;

  return (
    <div className="matter-intel-doc-detail">
      <div className="row" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">Document</div>
          <h3 className="heading-md" style={{ marginTop: 4 }}>{doc.fileName}</h3>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
            {doc.pageCount ? `${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'} · ` : ''}
            Ingested {new Date(doc.ingestedAt).toLocaleString()}
          </div>
        </div>
        <span className="spacer" />
        <StatusChip status={doc.status} />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            try {
              await resummarise.mutateAsync(doc.id);
              showToast({ type: 'sage', text: 'Document re-summarised' });
            } catch (err) {
              showToast({ type: 'vermillion', text: err instanceof Error ? err.message : 'Summarise failed' });
            }
          }}
          disabled={resummarise.isPending || doc.status !== 'ready'}
        >
          {resummarise.isPending ? (
            <><span className="lex-spinner" aria-hidden /> Summarising…</>
          ) : 'Re-summarise'}
        </button>
      </div>

      {/* Full-card busy overlay while the document is being re-summarised.
          Keeps the existing summary visible underneath but signals clearly
          that the AI call is in flight (can take 10–20s on large PDFs). */}
      {resummarise.isPending && (
        <div className="lex-loading-overlay" role="status" aria-live="polite">
          <span className="lex-spinner lex-spinner-lg" aria-hidden />
          <div className="heading-sm">Summarising document…</div>
          <p className="body-sm muted" style={{ maxWidth: 360, margin: 0 }}>
            Reading {doc.pageCount ? `${doc.pageCount} pages` : 'the document'} and rebuilding the structured summary.
          </p>
        </div>
      )}

      {degraded && <DegradedModeBanner />}

      {doc.status === 'failed' && doc.statusError && (
        <div className="card" style={{ borderColor: 'var(--danger)', padding: 12, marginBottom: 16 }}>
          <div className="body-sm" style={{ color: 'var(--danger)' }}>{doc.statusError}</div>
        </div>
      )}

      {!summary && (
        <div className="muted body-sm" style={{ padding: 16 }}>
          {doc.status === 'ready'
            ? 'No structured summary yet — click "Re-summarise" to generate one.'
            : 'Summary will appear once extraction and indexing finish.'}
        </div>
      )}

      {summary && (
        <>
          {summary.executiveSummary && (
            <BriefSection title="Executive summary">
              <p className="body-md" style={{ lineHeight: 1.55 }}>{summary.executiveSummary}</p>
            </BriefSection>
          )}

          {summary.parties.length > 0 && (
            <BriefSection title="Parties">
              <ul className="matter-intel-bullets">
                {summary.parties.map((p, i) => (
                  <li key={i}>
                    <strong>{p.name || '—'}</strong>
                    {p.role ? <span className="muted"> · {p.role}</span> : null}
                  </li>
                ))}
              </ul>
            </BriefSection>
          )}

          {summary.keyDates.length > 0 && (
            <BriefSection title="Key dates">
              <ol className="matter-intel-timeline">
                {summary.keyDates.map((d, i) => (
                  <li key={i}>
                    <span className="mono tabular" style={{ minWidth: 96 }}>{d.date || '—'}</span>
                    <span>{d.event || ''}</span>
                  </li>
                ))}
              </ol>
            </BriefSection>
          )}

          {summary.operativeContent && (
            <BriefSection title="Operative content">
              <p className="body-md" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                {summary.operativeContent}
              </p>
            </BriefSection>
          )}

          {summary.citations.length > 0 && (
            <BriefSection title="Citations referenced">
              <ul className="matter-intel-bullets">
                {summary.citations.map((c, i) => (
                  <li key={i}>
                    <strong>{c.statute_or_case || '—'}</strong>
                    {c.reference ? <span className="muted"> · {c.reference}</span> : null}
                  </li>
                ))}
              </ul>
            </BriefSection>
          )}

          {/* Single citation pill exemplifies the source-preview drawer. */}
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <button
              type="button"
              className="chip chip-sm"
              onClick={() => onCitationClick({
                matterDocumentId: doc.id,
                page: 1,
                snippet: '',
              })}
            >
              <Icon name="file" size={12} /> Open source
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat panel
// ---------------------------------------------------------------------------

function ChatPanel({
  caseId,
  documentCount,
  onCitationClick,
}: {
  caseId: string;
  documentCount: number;
  onCitationClick: (c: MatterCitation) => void;
}) {
  const threadsQ = useMatterChatThreads(caseId);
  const createThread = useCreateMatterChatThread(caseId);
  const [threadId, setThreadId] = useState<string | null>(null);

  // Default the active thread to the most-recent one, but don't force the
  // selection — the user may have explicitly switched.
  useEffect(() => {
    if (threadId) return;
    const first = threadsQ.data?.[0];
    if (first) setThreadId(first.id);
  }, [threadsQ.data, threadId]);

  return (
    <>
      <div className="pane-head">
        <div className="eyebrow">Chat</div>
        <span className="spacer" />
        {documentCount > 0 && (
          <span className="chip chip-sm" title="Chat is constrained to the matter's documents">
            <Icon name="shield" size={12} /> Grounded in {documentCount} doc{documentCount === 1 ? '' : 's'}
          </span>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            const t = await createThread.mutateAsync({});
            setThreadId(t.id);
          }}
        >
          + New thread
        </button>
      </div>

      <ThreadSwitcher
        threads={threadsQ.data ?? []}
        activeId={threadId}
        onChange={setThreadId}
      />

      <ChatStream
        threadId={threadId}
        caseId={caseId}
        documentCount={documentCount}
        onCitationClick={onCitationClick}
        onAutoCreateThread={async () => {
          const t = await createThread.mutateAsync({});
          setThreadId(t.id);
          return t.id;
        }}
      />
    </>
  );
}

function ThreadSwitcher({
  threads,
  activeId,
  onChange,
}: {
  threads: MatterChatThread[];
  activeId: string | null;
  onChange: (id: string) => void;
}) {
  if (threads.length === 0) return null;
  return (
    <div className="matter-intel-threads">
      {threads.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`matter-intel-thread${t.id === activeId ? ' is-active' : ''}`}
          onClick={() => onChange(t.id)}
          title={t.title ?? new Date(t.createdAt).toLocaleString()}
        >
          {t.title || `Thread · ${new Date(t.createdAt).toLocaleDateString()}`}
        </button>
      ))}
    </div>
  );
}

interface OptimisticAssistant {
  text: string;
  done: boolean;
}

function ChatStream({
  threadId,
  caseId,
  documentCount,
  onCitationClick,
  onAutoCreateThread,
}: {
  threadId: string | null;
  caseId: string;
  documentCount: number;
  onCitationClick: (c: MatterCitation) => void;
  onAutoCreateThread: () => Promise<string>;
}) {
  const messagesQ = useMatterChatMessages(threadId);
  const poster = usePostMatterChatMessage(threadId ?? '', caseId);

  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState<OptimisticAssistant | null>(null);
  const [optimisticUser, setOptimisticUser] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the scroll glued to the bottom as new messages / deltas arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messagesQ.data, streaming?.text, optimisticUser]);

  // If the user navigates away mid-stream, abort.
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    if (streaming) return;

    // Auto-create the thread on first send if none exists.
    let activeId = threadId;
    if (!activeId) {
      try {
        activeId = await onAutoCreateThread();
      } catch (err) {
        setStreamError(err instanceof Error ? err.message : 'Could not create thread');
        return;
      }
    }

    setDraft('');
    setOptimisticUser(content);
    setStreamError(null);
    setReconnecting(null);
    setStreaming({ text: '', done: false });

    const controller = new AbortController();
    abortRef.current = controller;

    await poster.post(
      content,
      {
        onUserMessage: () => {
          // The persisted row replaces the optimistic one once the
          // messages query refetches. Clear immediately so the canonical
          // row drives layout.
          setOptimisticUser(null);
        },
        onDelta: (text) => {
          setStreaming((prev) => prev ? { ...prev, text: prev.text + text } : { text, done: false });
        },
        onAssistantMessage: () => {
          setStreaming(null);
        },
        onError: (msg) => {
          setStreamError(msg);
          setStreaming(null);
        },
        onReconnecting: (attempt, delayMs) => {
          setReconnecting(`Reconnecting (attempt ${attempt}, ${Math.round(delayMs / 1000)}s)…`);
        },
      },
      controller.signal,
    );
    setReconnecting(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void send();
    }
  };

  const messages = messagesQ.data ?? [];

  return (
    <>
      <div ref={scrollRef} className="matter-intel-chat-scroll">
        {messages.length === 0 && !optimisticUser && !streaming && (
          <div className="muted body-sm" style={{ padding: 16 }}>
            {documentCount === 0
              ? 'Ingest at least one document to enable grounded chat.'
              : 'Ask a question about this matter. Answers cite the source documents.'}
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} message={m} onCitationClick={onCitationClick} />
        ))}
        {optimisticUser && (
          <Bubble
            message={{
              id: '_optimistic_user',
              threadId: threadId ?? '_',
              role: 'user',
              content: optimisticUser,
              citations: [],
              modelUsed: null,
              createdAt: new Date().toISOString(),
            }}
            onCitationClick={onCitationClick}
            optimistic
          />
        )}
        {streaming && (
          <Bubble
            message={{
              id: '_optimistic_assistant',
              threadId: threadId ?? '_',
              role: 'assistant',
              content: streaming.text || '…',
              citations: [],
              modelUsed: null,
              createdAt: new Date().toISOString(),
            }}
            onCitationClick={onCitationClick}
            streaming
          />
        )}
        {streamError && (
          <div className="card" style={{ borderColor: 'var(--danger)', padding: 10, marginTop: 8 }}>
            <div className="body-sm" style={{ color: 'var(--danger)' }}>{streamError}</div>
          </div>
        )}
        {reconnecting && (
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)', padding: 6 }}>
            {reconnecting}
          </div>
        )}
      </div>

      <div className="matter-intel-composer">
        <textarea
          className="input"
          rows={2}
          placeholder="Ask about this matter…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={Boolean(streaming)}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            ⌘/Ctrl+Enter to send
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-primary"
            disabled={!draft.trim() || Boolean(streaming)}
            onClick={() => void send()}
          >
            {streaming ? 'Streaming…' : 'Send'}
          </button>
        </div>
      </div>
    </>
  );
}

function Bubble({
  message,
  onCitationClick,
  optimistic,
  streaming,
}: {
  message: MatterChatMessage;
  onCitationClick: (c: MatterCitation) => void;
  optimistic?: boolean;
  streaming?: boolean;
}) {
  const isUser = message.role === 'user';
  const segments = useMemo(() => renderWithCitations(message.content, message.citations), [message.content, message.citations]);
  const degraded = !isUser && message.modelUsed?.startsWith('fallback:');
  const ungrounded = !isUser && !streaming && message.citations.length === 0;

  return (
    <div className={`matter-intel-bubble matter-intel-bubble-${isUser ? 'user' : 'assistant'}${optimistic ? ' is-optimistic' : ''}`}>
      <div className="matter-intel-bubble-body">
        {segments.map((seg, i) =>
          seg.type === 'text' ? (
            <span key={i}>{seg.text}</span>
          ) : (
            <button
              key={i}
              type="button"
              className="matter-intel-citation"
              onClick={() => onCitationClick(seg.citation)}
              title={seg.citation.snippet || 'Open source document'}
            >
              <Icon name="file" size={10} /> p.{seg.citation.page}
            </button>
          ),
        )}
        {streaming && <span className="blink" aria-hidden />}
      </div>
      {!isUser && (degraded || ungrounded) && (
        <div className="matter-intel-bubble-warn">
          {degraded
            ? 'AI is disabled — this is a fallback response.'
            : 'No citations — verify before relying on this answer.'}
        </div>
      )}
    </div>
  );
}

interface Segment {
  type: 'text';
  text: string;
}
interface CitationSegment {
  type: 'citation';
  citation: MatterCitation;
}

const CITATION_RE = /\[doc:([0-9a-f-]{36})\s+p:(\d+)\]/gi;

function renderWithCitations(content: string, citations: MatterCitation[]): Array<Segment | CitationSegment> {
  const out: Array<Segment | CitationSegment> = [];
  const byKey = new Map<string, MatterCitation>();
  for (const c of citations) byKey.set(`${c.matterDocumentId}|${c.page}`, c);
  let last = 0;
  for (const m of content.matchAll(CITATION_RE)) {
    const start = m.index ?? 0;
    const docId = m[1]!;
    const page = Number.parseInt(m[2]!, 10);
    if (start > last) out.push({ type: 'text', text: content.slice(last, start) });
    const c = byKey.get(`${docId}|${page}`) ?? { matterDocumentId: docId, page, snippet: '' };
    out.push({ type: 'citation', citation: c });
    last = start + m[0].length;
  }
  if (last < content.length) out.push({ type: 'text', text: content.slice(last) });
  return out;
}

// ---------------------------------------------------------------------------
// Citation drawer (source preview)
// ---------------------------------------------------------------------------

function CitationDrawer({
  matterDocumentId,
  page,
  onClose,
}: {
  matterDocumentId: string;
  page: number;
  onClose: () => void;
}) {
  const docQ = useMatterDocument(matterDocumentId);

  return (
    <>
      <div className="side-panel-scrim" onClick={onClose} />
      <aside className="side-panel is-open" role="dialog" aria-label="Source document">
        <div className="pane-head" style={{ padding: 16, borderBottom: '1px solid var(--border-default)' }}>
          <div>
            <div className="eyebrow">Source</div>
            <div className="heading-sm" style={{ marginTop: 4 }} title={docQ.data?.fileName}>
              {docQ.data?.fileName ?? 'Loading…'}
            </div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
              Page {page}
            </div>
          </div>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {docQ.isLoading && <div className="muted body-sm">Loading…</div>}
          {docQ.data && (
            <p className="body-sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
              {/*
                v1: render the surrounding extracted text (the API returns it
                on the per-document GET). A future iteration can render the
                PDF / DOCX inline via pdfjs-dist and scroll to the cited page.
              */}
              {docQ.data.summary?.executiveSummary
                || docQ.data.statusError
                || 'Source preview not available — switch to the Documents tab to open this file.'}
            </p>
          )}
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Degraded-mode banner (no LLM provider configured)
// ---------------------------------------------------------------------------

function DegradedModeBanner() {
  return (
    <div className="card" style={{ padding: 10, marginBottom: 12, borderColor: 'var(--border-default)' }}>
      <div className="body-xs" style={{ color: 'var(--text-secondary)' }}>
        <strong>Degraded mode:</strong> no LLM provider configured. AI features return deterministic
        placeholders so the UI is usable in dev. Configure <span className="mono">ANTHROPIC_API_KEY</span>{' '}
        or <span className="mono">XAI_API_KEY</span> for real summaries and chat.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleCase(s: string): string {
  return s.replace(/[_\s]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
