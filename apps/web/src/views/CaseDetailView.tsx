import { Fragment, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import {
  useCase,
  useCaseTimeline,
  useTransitionCase,
  useAddFirmCaseStage,
  type CaseWithPipeline,
} from '@/hooks/useCases';
import type { MatterTimelineEvent } from '@lexdraft/types';
import { NewHearingModal } from '@/components/NewHearingModal';
import { NewTaskModal } from '@/components/NewTaskModal';
import { NewDocumentModal } from '@/components/NewDocumentModal';
import { CaseNotesPanel } from '@/components/CaseNotesPanel';
import { MatterIntelPanel } from '@/components/matter-intel/MatterIntelPanel';
import { CopyButton } from '@/components/CopyButton';
import { Modal } from '@/components/Modal';
import { useUpdateMatterVisibility } from '@/hooks/usePortalAdmin';
import { useGenerateEngagementLetter } from '@/hooks/useEngagement';
import { useUIStore } from '@/store/ui';

interface PartyEntry {
  side: 'Plaintiff' | 'Defendant';
  name: string;
  role: string;
  addr: string;
  counsel: string;
}

const PARTIES: ReadonlyArray<PartyEntry> = [];

interface TaskEntry {
  title: string;
  due: string;
  assignee: string;
  done?: boolean;
}

const TASKS: ReadonlyArray<TaskEntry> = [];

export function CaseDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useCase(id);
  const timeline = useCaseTimeline(id);
  const transition = useTransitionCase();
  const addStage = useAddFirmCaseStage();
  const [docOpen, setDocOpen] = useState(false);
  const [hearingOpen, setHearingOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [engagementLetter, setEngagementLetter] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'intelligence'>('overview');
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [transitionNote, setTransitionNote] = useState('');
  const [shareWithClient, setShareWithClient] = useState(true);
  // Inline "Add stage" composer at the end of the stepper. Lets the firm
  // extend the canonical catalog with custom checkpoints (IA, Mediation,
  // etc.) without leaving the matter page.
  const [addingStage, setAddingStage] = useState(false);
  const [newStageName, setNewStageName] = useState('');
  const updateVisibility = useUpdateMatterVisibility();
  const generateLetter = useGenerateEngagementLetter();
  const showToast = useUIStore((s) => s.showToast);

  if (isLoading) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <BackButton onBack={() => navigate('/app/cases')} />
        <div className="card"><span className="muted">Loading matter…</span></div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <BackButton onBack={() => navigate('/app/cases')} />
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <div className="heading-sm" style={{ marginBottom: 6 }}>Couldn’t load matter</div>
          <p className="body-sm muted">
            {error instanceof Error ? error.message : 'The case could not be found.'}
          </p>
        </div>
      </div>
    );
  }

  const c: CaseWithPipeline = data;
  const STAGES: ReadonlyArray<string> = c.pipeline?.stages ?? [];
  const currentIdx = c.pipeline?.currentIndex ?? -1;

  const commitTransition = async (): Promise<void> => {
    if (!pendingStage || !c.id) return;
    try {
      await transition.mutateAsync({
        id: c.id,
        toStage: pendingStage,
        ...(transitionNote.trim() ? { note: transitionNote.trim() } : {}),
        visibleToPortal: shareWithClient,
      });
      showToast({ type: 'sage', text: `Stage updated to ${pendingStage}` });
      setPendingStage(null);
      setTransitionNote('');
      setShareWithClient(true);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not update stage';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  const commitNewStage = async (): Promise<void> => {
    const trimmed = newStageName.trim();
    if (!trimmed) {
      setAddingStage(false);
      return;
    }
    try {
      await addStage.mutateAsync({
        kind: (c.pipeline?.kind ?? 'default') as Parameters<typeof addStage.mutateAsync>[0]['kind'],
        stageName: trimmed,
      });
      showToast({ type: 'sage', text: `Stage "${trimmed}" added` });
      setNewStageName('');
      setAddingStage(false);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not add stage';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  const handleGenerateEngagement = async (): Promise<void> => {
    try {
      const result = await generateLetter.mutateAsync({ caseId: c.id });
      setEngagementLetter(result.text);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not generate engagement letter';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <BackButton onBack={() => navigate('/app/cases')} />

      {/* HEADER */}
      <div className="card">
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <span className="badge badge-sage">{c.status.toUpperCase()}</span>
              <span className="badge badge-cobalt">{String(c.type).toUpperCase()}</span>
            </div>
            <h1 className="heading-xl" style={{ marginBottom: 8 }}>
              <em className="case-name">{c.title}</em>
            </h1>
            <div className="row" style={{ gap: 14, flexWrap: 'wrap', color: 'var(--text-secondary)', fontSize: 13 }}>
              <span>{c.court}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
              <span>CNR <CopyButton value={c.cnr} /></span>
              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
              <span>For: {c.client}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <label
              className="row"
              style={{ gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}
              title="When enabled, this matter is visible in the client portal."
            >
              <input
                type="checkbox"
                checked={!!c.visibleToClient}
                disabled={!c.id || updateVisibility.isPending}
                onChange={(e) => updateVisibility.mutate({
                  id: c.id, visibleToClient: e.target.checked,
                })}
              />
              Visible to client
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => setDocOpen(true)}
            >
              <Icon name="upload" size={14} /> Upload
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => { void handleGenerateEngagement(); }}
              disabled={generateLetter.isPending}
              title="Generate the engagement letter from the firm's default template for this matter type"
            >
              <Icon name="documents" size={14} />{' '}
              {generateLetter.isPending ? 'Generating…' : 'Generate engagement letter'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setHearingOpen(true)}
            >
              <Icon name="plus" size={14} /> Hearing
            </button>
          </div>
        </div>

        {/* STAGE STEPPER — click a stage to move the matter there. */}
        <div style={{ marginTop: 24, overflowX: 'auto', paddingBottom: 4 }}>
          <div className="row" style={{ gap: 0, minWidth: 'min-content' }}>
            {STAGES.map((s, i) => {
              const done   = i < currentIdx;
              const active = i === currentIdx;
              const isCurrent = active;
              return (
                <Fragment key={s}>
                  <button
                    type="button"
                    onClick={() => !isCurrent && setPendingStage(s)}
                    disabled={isCurrent || transition.isPending}
                    aria-label={`Move stage to ${s}`}
                    className="col"
                    style={{
                      alignItems: 'center',
                      gap: 6,
                      minWidth: 80,
                      flex: '0 0 auto',
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: isCurrent ? 'default' : 'pointer',
                    }}
                  >
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 'var(--radius-full)',
                        border: `2px solid ${active ? 'var(--text-primary)' : done ? 'var(--text-secondary)' : 'var(--border-default)'}`,
                        background: done ? 'var(--text-secondary)' : active ? 'var(--text-primary)' : 'var(--bg-surface)',
                        color: done ? 'var(--bg-base)' : active ? 'var(--bg-base)' : 'var(--text-tertiary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                      }}
                    >
                      {done ? '✓' : i + 1}
                    </div>
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.16em',
                        color: active ? 'var(--text-primary)' : done ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                        fontWeight: active ? 600 : 400,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.toUpperCase()}
                    </span>
                  </button>
                  {i < STAGES.length - 1 && (
                    <div
                      style={{
                        flex: 1,
                        minWidth: 24,
                        height: 1,
                        background: i < currentIdx ? 'var(--text-secondary)' : 'var(--border-default)',
                        marginTop: 12,
                      }}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
          {currentIdx === -1 && c.stage && (
            <div className="body-sm muted" style={{ marginTop: 10 }}>
              Current stage <strong>{c.stage}</strong> isn't on the canonical {c.pipeline?.kind ?? 'default'} path. Click a step above to align.
            </div>
          )}
          {/* Inline custom-stage composer. The new stage is added to the
              firm's catalog (firm_custom_case_stages) for this pipeline
              kind, so it shows up on every matter of the same type. */}
          <div
            className="row"
            style={{
              gap: 8,
              alignItems: 'center',
              marginTop: 12,
              flexWrap: 'wrap',
            }}
          >
            {addingStage ? (
              <>
                <input
                  className="input"
                  autoFocus
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  placeholder="e.g. IA, Mediation, Pre-filing review"
                  maxLength={60}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void commitNewStage(); }
                    if (e.key === 'Escape') { setAddingStage(false); setNewStageName(''); }
                  }}
                  style={{ flex: '0 1 280px', minWidth: 200 }}
                  disabled={addStage.isPending}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => { void commitNewStage(); }}
                  disabled={addStage.isPending || !newStageName.trim()}
                >
                  {addStage.isPending ? 'Adding…' : 'Add'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setAddingStage(false); setNewStageName(''); }}
                  disabled={addStage.isPending}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setAddingStage(true)}
                title="Add a custom stage to this firm's pipeline"
              >
                <Icon name="plus" size={12} /> Add stage
              </button>
            )}
            <span
              className="mono body-xs muted"
              style={{ letterSpacing: '0.14em' }}
            >
              CUSTOM STAGES APPLY TO ALL {String(c.pipeline?.kind ?? 'default').toUpperCase()} MATTERS
            </span>
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div className="matter-intel-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          className={`matter-intel-tab${activeTab === 'overview' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'intelligence'}
          className={`matter-intel-tab${activeTab === 'intelligence' ? ' is-active' : ''}`}
          onClick={() => setActiveTab('intelligence')}
        >
          Intelligence
        </button>
      </div>

      {activeTab === 'intelligence' && (
        <MatterIntelPanel caseId={c.id} matterTitle={c.title} />
      )}

      {activeTab === 'overview' && (
      <>
      {/* BODY - two columns */}
      <div className="case-body split-2-wide" style={{ gap: 24 }}>
        {/* LEFT */}
        <div className="col" style={{ gap: 24 }}>
          {/* Case meta */}
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Matter</div>
            <h2 className="heading-md" style={{ marginBottom: 12 }}>Overview</h2>
            <div className="grid-2" style={{ gap: 16 }}>
              <MetaItem label="CNR"        value={c.cnr}         mono copyable />
              <MetaItem label="Court"      value={c.court} />
              <MetaItem label="Stage"      value={String(c.stage)} />
              <MetaItem label="Status"     value={c.status} />
              <MetaItem label="Client"     value={c.client} />
              <MetaItem label="Next date"  value={c.next}        mono />
            </div>
          </div>

          {/* Timeline — stage transitions, hearings, documents, notes,
              merged newest-first from /api/cases/:id/timeline. */}
          <div>
            <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
              <h2 className="heading-lg">Timeline</h2>
              <span className="spacer" />
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
                {timeline.data?.length ?? 0} EVENTS
              </span>
            </div>
            {timeline.isLoading ? (
              <p className="body-md muted">Loading timeline…</p>
            ) : timeline.isError ? (
              <p className="body-sm" style={{ color: 'var(--danger)' }}>
                Could not load timeline. {(timeline.error as Error)?.message ?? ''}
              </p>
            ) : (timeline.data?.length ?? 0) === 0 ? (
              <p className="body-md muted">
                No events recorded yet. Stage changes, hearings, documents and notes will appear here.
              </p>
            ) : (
              <div className="col" style={{ gap: 10 }}>
                {timeline.data!.map((e) => (
                  <TimelineRow key={e.id} event={e} />
                ))}
              </div>
            )}
          </div>

          {/* Parties */}
          <div>
            <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
              <h2 className="heading-lg">Parties</h2>
            </div>
            {PARTIES.length === 0 ? (
              <p className="body-md muted">No parties on record. Add them when the case file is opened.</p>
            ) : (
              <div className="grid-2">
                {PARTIES.map((p) => (
                  <div key={p.name} className="card" style={{ padding: 20 }}>
                    <div className="eyebrow" style={{ marginBottom: 6 }}>{p.side}</div>
                    <div className="heading-md" style={{ marginBottom: 4 }}>{p.name}</div>
                    <div className="body-sm muted" style={{ marginBottom: 12 }}>{p.role}</div>
                    <div className="body-sm" style={{ marginBottom: 8 }}>{p.addr}</div>
                    <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)' }}>
                      COUNSEL: {p.counsel}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes - typed memos or uploaded files; AI drafting can pull these
              in as context when generating documents for this matter. */}
          <CaseNotesPanel caseId={c.id} matterTitle={c.title} />
        </div>

        {/* RIGHT */}
        <div className="col" style={{ gap: 24 }}>
          {/* Next hearing */}
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Next hearing</div>
            {c.next ? (
              <div className="mono tabular" style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
                {c.next}
              </div>
            ) : (
              <p className="body-md muted" style={{ marginBottom: 16 }}>No date scheduled.</p>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() =>
                  navigate('/app/draft', {
                    state: {
                      caseContext: {
                        id: c.id,
                        title: c.title,
                        cnr: c.cnr,
                        court: c.court,
                        client: c.client,
                        type: c.type,
                        stage: c.stage,
                      },
                    },
                  })
                }
              >
                Prepare brief
              </button>
            </div>
          </div>

          {/* Tasks */}
          <div className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <div className="heading-md">Tasks</div>
              <span className="spacer" />
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
                {TASKS.filter((t) => !t.done).length} OPEN
              </span>
            </div>
            {TASKS.length === 0 ? (
              <p className="body-sm muted">No tasks. Add the first below.</p>
            ) : (
              <div className="col" style={{ gap: 0 }}>
                {TASKS.map((t, i) => (
                  <div
                    key={t.title}
                    className="row"
                    style={{
                      padding: '12px 0',
                      borderBottom: i < TASKS.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      gap: 12,
                      alignItems: 'flex-start',
                    }}
                  >
                    <div
                      aria-hidden="true"
                      style={{
                        width: 16, height: 16,
                        borderRadius: 'var(--radius-sm)',
                        border: `1px solid ${t.done ? 'var(--success)' : 'var(--border-default)'}`,
                        background: t.done ? 'var(--success-bg)' : 'transparent',
                        color: 'var(--success)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {t.done && <Icon name="check" size={12} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: t.done ? 'var(--text-tertiary)' : 'var(--text-primary)',
                          textDecoration: t.done ? 'line-through' : 'none',
                        }}
                      >
                        {t.title}
                      </div>
                      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginTop: 2 }}>
                        DUE {t.due.toUpperCase()} · {t.assignee}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn btn-sm"
              style={{ marginTop: 12 }}
              onClick={() => setTaskOpen(true)}
            >
              <Icon name="plus" size={12} /> Add task
            </button>
          </div>

          {/* Recent documents have moved to the unified Timeline (left
              column) which streams document uploads alongside hearings and
              stage moves. A dedicated card here would duplicate that. */}
        </div>
      </div>
      </>
      )}

      <EngagementLetterPreview
        text={engagementLetter}
        caseTitle={c.title}
        onClose={() => setEngagementLetter(null)}
      />

      <NewDocumentModal open={docOpen} onClose={() => setDocOpen(false)} defaultCase={c.title} />
      <NewHearingModal
        open={hearingOpen}
        onClose={() => setHearingOpen(false)}
        defaultCase={c.title}
        defaultCourt={c.court}
        defaultDate={c.next || undefined}
      />
      <NewTaskModal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        defaultCase={c.title}
      />

      <Modal
        open={pendingStage !== null}
        onClose={() => {
          if (transition.isPending) return;
          setPendingStage(null);
          setTransitionNote('');
        }}
        title={`Move to ${pendingStage ?? ''}`}
        eyebrow={c.title}
        description={
          c.stage
            ? `Currently at "${c.stage}". This will be logged on the matter timeline.`
            : 'This will be logged on the matter timeline.'
        }
        width={520}
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPendingStage(null);
                setTransitionNote('');
              }}
              disabled={transition.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { void commitTransition(); }}
              disabled={transition.isPending}
            >
              {transition.isPending ? 'Updating…' : 'Move stage'}
            </button>
          </>
        }
      >
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 6 }}>
            <span className="eyebrow">Note (optional)</span>
            <textarea
              className="input"
              rows={3}
              maxLength={400}
              placeholder="Brief context — e.g. 'WS filed today, sent to client for review'"
              value={transitionNote}
              onChange={(e) => setTransitionNote(e.target.value)}
              disabled={transition.isPending}
            />
          </label>
          <label className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={shareWithClient}
              onChange={(e) => setShareWithClient(e.target.checked)}
              disabled={transition.isPending}
            />
            <span className="body-sm">Visible on client portal</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}

/* ---------- Inline helpers ---------- */

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={onBack}
      style={{ alignSelf: 'flex-start' }}
    >
      <Icon name="chevron" size={14} style={{ transform: 'scaleX(-1)' }} /> Cases
    </button>
  );
}

function MetaItem({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  /** When true, render the value as a CopyButton so advocates can grab
   *  long identifiers (CNR, file numbers) without a select-all gesture. */
  copyable?: boolean;
}) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div className={mono && !copyable ? 'mono tabular' : ''} style={{ fontSize: 14, color: 'var(--text-primary)' }}>
        {copyable ? <CopyButton value={value} mono={mono} /> : value}
      </div>
    </div>
  );
}

/**
 * Preview modal for a freshly generated engagement letter.
 *
 * The shared `DocumentViewerModal` is wired to fetch its body from the
 * documents / drafts API by id; a generated-on-the-fly letter has no id, so
 * we render it through the generic `Modal` chrome instead. Same affordances -
 * scrollable preview, close, copy to clipboard - without coupling the
 * generated text to the persistence layer.
 */
function EngagementLetterPreview({
  text,
  caseTitle,
  onClose,
}: {
  text: string | null;
  caseTitle: string;
  onClose: () => void;
}) {
  const showToast = useUIStore((s) => s.showToast);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    if (!text) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      showToast({ type: 'sage', text: 'Engagement letter copied' });
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      showToast({ type: 'vermillion', text: 'Could not copy letter' });
    }
  };

  return (
    <Modal
      open={text !== null}
      onClose={onClose}
      title="Engagement letter"
      eyebrow={caseTitle}
      description="Generated from the firm's default template for this matter type. Review carefully before sending."
      width={920}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={() => { void handleCopy(); }}>
            <Icon name={copied ? 'check' : 'documents'} size={12} />{' '}
            {copied ? 'Copied' : 'Copy to clipboard'}
          </button>
        </>
      }
    >
      <pre
        style={{
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: 20,
          margin: 0,
          minHeight: 320,
          maxHeight: '60vh',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'var(--font-serif, Georgia, serif)',
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--text-primary)',
        }}
      >
        {text ?? ''}
      </pre>
    </Modal>
  );
}

function kindToColor(kind: MatterTimelineEvent['kind']): string {
  switch (kind) {
    case 'stage':    return 'var(--success, #2f7d32)';
    case 'hearing':  return 'var(--info, #2563eb)';
    case 'document': return 'var(--warning, #b45309)';
    case 'note':     return 'var(--border-default)';
    default:         return 'var(--border-default)';
  }
}

function kindLabel(kind: MatterTimelineEvent['kind']): string {
  switch (kind) {
    case 'stage':    return 'STAGE';
    case 'hearing':  return 'HEARING';
    case 'document': return 'DOCUMENT';
    case 'note':     return 'NOTE';
    default:         return 'EVENT';
  }
}

function TimelineRow({ event }: { event: MatterTimelineEvent }) {
  const date = event.at ? event.at.slice(0, 10) : '';
  return (
    <div
      className="card"
      style={{ padding: 18, borderLeft: `3px solid ${kindToColor(event.kind)}` }}
    >
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div
          className="mono tabular"
          style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)', minWidth: 92, paddingTop: 2 }}
        >
          {date}
        </div>
        <div style={{ flex: 1 }}>
          <div className="row" style={{ gap: 8, marginBottom: 4, alignItems: 'baseline' }}>
            <span
              className="mono"
              style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}
            >
              {kindLabel(event.kind)}
            </span>
            {event.actorName && (
              <span className="body-sm muted">· {event.actorName}</span>
            )}
          </div>
          <div className="heading-sm" style={{ marginBottom: event.body ? 4 : 0 }}>{event.title}</div>
          {event.body && <div className="body-sm muted">{event.body}</div>}
        </div>
      </div>
    </div>
  );
}
