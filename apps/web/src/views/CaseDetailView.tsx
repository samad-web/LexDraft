import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import {
  useCase,
  useCaseTimeline,
  useSyncCaseFromEcourts,
  useCaseActs,
  useCaseParties,
  type CaseWithPipeline,
  type EcourtsSyncResult,
} from '@/hooks/useCases';
import type { MatterTimelineEvent } from '@lexdraft/types';
import { PipelineBuilder } from '@/components/pipeline/PipelineBuilder';
import { ApplicationsPanel } from '@/components/ApplicationsPanel';
import { NewHearingModal } from '@/components/NewHearingModal';
import { NewTaskModal } from '@/components/NewTaskModal';
import { NewDocumentModal } from '@/components/NewDocumentModal';
import { CaseNotesPanel } from '@/components/CaseNotesPanel';
import { CaseLeadHandover } from '@/components/CaseLeadHandover';
import { MatterIntelPanel } from '@/components/matter-intel/MatterIntelPanel';
import { CopyButton } from '@/components/CopyButton';
import { Modal } from '@/components/Modal';
import { useUpdateMatterVisibility } from '@/hooks/usePortalAdmin';
import { useGenerateEngagementLetter } from '@/hooks/useEngagement';
import { useUIStore } from '@/store/ui';

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
  const parties = useCaseParties(id);
  const acts = useCaseActs(id);
  const [docOpen, setDocOpen] = useState(false);
  const [hearingOpen, setHearingOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [engagementLetter, setEngagementLetter] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'intelligence'>('overview');
  const updateVisibility = useUpdateMatterVisibility();
  const generateLetter = useGenerateEngagementLetter();
  const showToast = useUIStore((s) => s.showToast);
  const syncFromEcourts = useSyncCaseFromEcourts();
  // The sync mutation returns a rich diff payload we want to show *after* the
  // case row finishes updating — stash it in local state so the modal stays
  // mounted independent of the mutation lifecycle.
  const [ecourtsSyncResult, setEcourtsSyncResult] = useState<EcourtsSyncResult | null>(null);

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
            {error instanceof Error ? error.message : 'The matter could not be found.'}
          </p>
        </div>
      </div>
    );
  }

  const c: CaseWithPipeline = data;

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

  const handleSyncFromEcourts = async (): Promise<void> => {
    try {
      const result = await syncFromEcourts.mutateAsync({ id: c.id });
      setEcourtsSyncResult(result);
      const n = Object.keys(result.sync.changes).length;
      const h = result.sync.hearingsReplaced;
      const a = result.sync.actsReplaced;
      const p = result.sync.partiesReplaced;
      showToast({
        type: 'sage',
        text: n > 0 || h > 0 || a > 0 || p > 0
          ? `Synced from eCourts: ${n} field${n === 1 ? '' : 's'}, ${h} hearing${h === 1 ? '' : 's'}, ${p} part${p === 1 ? 'y' : 'ies'}, ${a} act${a === 1 ? '' : 's'}`
          : 'Already up to date with eCourts',
      });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not sync from eCourts';
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
              className="btn"
              onClick={() => { void handleSyncFromEcourts(); }}
              disabled={syncFromEcourts.isPending || !c.cnr}
              title={c.cnr
                ? 'Pull latest case status, hearings, and orders from the eCourts gateway'
                : 'Set a CNR on this matter before syncing'}
            >
              <Icon name="ecourts" size={14} />{' '}
              {syncFromEcourts.isPending ? 'Syncing…' : 'Sync from eCourts'}
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

        {/* PIPELINE BUILDER — this matter's own branching pipeline graph.
            Stages, branches and conditions are per-case (migration 0054). */}
        <div style={{ marginTop: 24 }}>
          <PipelineBuilder caseId={c.id} />
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
            <h2 className="heading-md" style={{ marginBottom: 12 }}>Particulars</h2>
            <div className="grid-2" style={{ gap: 16 }}>
              <MetaItem label="CNR"        value={c.cnr}         mono copyable />
              <MetaItem label="Court"      value={c.court} />
              <MetaItem label="Stage"      value={String(c.stage)} />
              <MetaItem label="Status"     value={c.status} />
              <MetaItem label="Client"     value={c.client} />
              <MetaItem label="Next date"  value={c.next}        mono />
              {c.judge && <MetaItem label="Bench" value={c.judge} />}
              {c.filingNo && <MetaItem label="Filing No." value={c.filingNo} mono copyable />}
              {c.firNo && (
                <MetaItem
                  label="FIR"
                  value={`${c.firNo}/${c.firYear ?? ''}${c.firDetails ? ` · ${c.firDetails.split('^').filter(Boolean).join(' · ')}` : ''}`}
                />
              )}
              {c.ecourtsSyncedAt && (
                <MetaItem
                  label="Last eCourts sync"
                  value={new Date(c.ecourtsSyncedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                />
              )}
            </div>
          </div>

          {/* Lead advocate + handover (case_assignments). */}
          <CaseLeadHandover caseId={c.id} />

          {/* Acts & sections — populated by the eCourts sync (case_acts table). */}
          {(acts.data?.length ?? 0) > 0 && (
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Statute</div>
              <h2 className="heading-md" style={{ marginBottom: 12 }}>Acts & sections</h2>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {acts.data!.map((a) => (
                  <span key={a.id} className="badge" style={{ fontFamily: 'var(--font-mono)' }}>
                    {a.actName} §{a.section}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Timeline — stage transitions, hearings, documents, notes,
              merged newest-first from /api/cases/:id/timeline. */}
          <div>
            <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
              <h2 className="heading-lg">Matter diary</h2>
              <span className="spacer" />
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
                {timeline.data?.length ?? 0} ENTRIES
              </span>
            </div>
            {timeline.isLoading ? (
              <p className="body-md muted">Loading diary…</p>
            ) : timeline.isError ? (
              <p className="body-sm" style={{ color: 'var(--danger)' }}>
                Could not load diary. {(timeline.error as Error)?.message ?? ''}
              </p>
            ) : (timeline.data?.length ?? 0) === 0 ? (
              <p className="body-md muted">
                No diary entries yet. Stage moves, next dates, filings and notes will appear here.
              </p>
            ) : (
              <div className="col" style={{ gap: 10 }}>
                {timeline.data!.map((e) => (
                  <TimelineRow key={e.id} event={e} />
                ))}
              </div>
            )}
          </div>

          {/* Parties — populated by the eCourts sync (case_parties table).
              Falls back to a hint when the matter has never been synced. */}
          <div>
            <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
              <h2 className="heading-lg">Parties</h2>
              <span className="spacer" />
              {(parties.data?.length ?? 0) > 0 && (
                <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
                  {parties.data!.length} ON RECORD
                </span>
              )}
            </div>
            {parties.isLoading ? (
              <p className="body-md muted">Loading parties…</p>
            ) : (parties.data?.length ?? 0) === 0 ? (
              <p className="body-md muted">
                No parties on record. Click <strong>Sync from eCourts</strong> in the header to import them, or add manually when the matter file is opened.
              </p>
            ) : (
              <div className="grid-2">
                {parties.data!.map((p) => (
                  <div key={p.id} className="card" style={{ padding: 20 }}>
                    <div className="eyebrow" style={{ marginBottom: 6, textTransform: 'uppercase' }}>{p.side}</div>
                    <div className="heading-md" style={{ marginBottom: 4 }}>{p.partyName}</div>
                    {p.roleLabel && (
                      <div className="body-sm muted" style={{ marginBottom: 12 }}>{p.roleLabel}</div>
                    )}
                    {p.advocateName && (
                      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)' }}>
                        COUNSEL: {p.advocateName}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Applications — interim applications, appeals, execution, review,
              bail. Many per matter, each with its own status lifecycle. */}
          <ApplicationsPanel caseId={c.id} />

          {/* Notes - typed memos or uploaded files; AI drafting can pull these
              in as context when generating documents for this matter. */}
          <CaseNotesPanel caseId={c.id} matterTitle={c.title} />
        </div>

        {/* RIGHT */}
        <div className="col" style={{ gap: 24 }}>
          {/* Next date — when the matter is next posted on the cause-list. */}
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Next date</div>
            {c.next ? (
              <div className="mono tabular" style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
                {c.next}
              </div>
            ) : (
              <p className="body-md muted" style={{ marginBottom: 16 }}>Not posted to a date yet.</p>
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

          {/* Pendings — the advocate's word for to-dos / open work-items on the matter. */}
          <div className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <div className="heading-md">Pendings</div>
              <span className="spacer" />
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
                {TASKS.filter((t) => !t.done).length} PENDING
              </span>
            </div>
            {TASKS.length === 0 ? (
              <p className="body-sm muted">No pendings. Add the first below.</p>
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
              <Icon name="plus" size={12} /> Add pending
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

      <EcourtsSyncResultModal
        result={ecourtsSyncResult}
        onClose={() => setEcourtsSyncResult(null)}
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
      <Icon name="chevron" size={14} style={{ transform: 'scaleX(-1)' }} /> Matters
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

function EcourtsSyncResultModal({
  result,
  onClose,
}: {
  result: EcourtsSyncResult | null;
  onClose: () => void;
}) {
  if (!result) return null;
  const { sync } = result;
  const changeEntries = Object.entries(sync.changes);
  return (
    <Modal
      open
      onClose={onClose}
      title="eCourts sync complete"
      eyebrow={result.title}
      description={
        sync.sideDetected
          ? `Detected your firm represents the ${sync.sideDetected}.`
          : 'Could not auto-detect which side your firm represents — disposition mapping skipped. Set the client name to match the petitioner or respondent and try again.'
      }
      width={720}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
      }
    >
      <div className="col stagger" style={{ gap: 20 }}>
        <SummaryRow
          label="FIELDS UPDATED"
          value={String(changeEntries.length)}
          detail={changeEntries.length === 0 ? 'Already up to date' : undefined}
        />
        <SummaryRow
          label="HEARINGS REPLACED"
          value={String(sync.hearingsReplaced)}
          detail="The full hearing history was re-imported from eCourts."
        />
        <SummaryRow
          label="ACTS / SECTIONS"
          value={String(sync.actsReplaced)}
          detail={sync.actsReplaced > 0 ? 'Refreshed from the court record.' : undefined}
        />
        <SummaryRow
          label="PARTIES"
          value={String(sync.partiesReplaced)}
          detail={sync.partiesReplaced > 0 ? 'Petitioner / respondent + extras imported.' : undefined}
        />

        {changeEntries.length > 0 && (
          <div className="col" style={{ gap: 8 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
              CHANGES
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Field</th>
                  <th>Was</th>
                  <th>Now</th>
                </tr>
              </thead>
              <tbody>
                {changeEntries.map(([field, { from, to }]) => (
                  <tr key={field}>
                    <td className="mono" style={{ fontSize: 12 }}>{field}</td>
                    <td className="body-sm muted">{fmtValue(from)}</td>
                    <td className="body-sm">{fmtValue(to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(sync.surfaceOnly.transfers.length > 0
          || sync.surfaceOnly.finalOrders + sync.surfaceOnly.interimOrders > 0) && (
          <div className="col" style={{ gap: 8 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
              ADDITIONAL DATA (NOT YET STORED)
            </div>
            <p className="body-sm muted">
              eCourts returned these too; LexDraft doesn't have columns for them yet. They'll appear in the eCourts gateway view in full.
            </p>
            <ul className="col" style={{ gap: 6, paddingLeft: 18, fontSize: 13 }}>
              {sync.surfaceOnly.transfers.length > 0
                && <li>{sync.surfaceOnly.transfers.length} court transfer{sync.surfaceOnly.transfers.length === 1 ? '' : 's'} recorded</li>}
              {sync.surfaceOnly.finalOrders + sync.surfaceOnly.interimOrders > 0
                && <li>{sync.surfaceOnly.finalOrders} final + {sync.surfaceOnly.interimOrders} interim order PDFs available in the eCourts view</li>}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SummaryRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="row" style={{ alignItems: 'baseline', gap: 16 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)', minWidth: 160 }}>{label}</span>
      <span className="heading-md tabular">{value}</span>
      {detail && <span className="body-sm muted">{detail}</span>}
    </div>
  );
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function kindToColor(kind: MatterTimelineEvent['kind']): string {
  switch (kind) {
    case 'stage':       return 'var(--success, #2f7d32)';
    case 'hearing':     return 'var(--info, #2563eb)';
    case 'document':    return 'var(--warning, #b45309)';
    case 'application': return 'var(--accent, #7c3aed)';
    case 'note':        return 'var(--border-default)';
    default:            return 'var(--border-default)';
  }
}

function kindLabel(kind: MatterTimelineEvent['kind']): string {
  switch (kind) {
    case 'stage':       return 'STAGE';
    case 'hearing':     return 'HEARING';
    case 'document':    return 'DOCUMENT';
    case 'application': return 'APPLICATION';
    case 'note':        return 'NOTE';
    default:            return 'ENTRY';
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
