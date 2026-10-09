import { useMemo, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Icon, Skeleton, ErrorState } from '@lexdraft/ui';
import type { Lead, LeadStage, ConflictStatus } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { useLeads, useMoveLead, useUpdateLead, useRetainLead } from '@/hooks/useLeads';
import { NewLeadModal } from '@/components/NewLeadModal';
import { downloadCsv } from '@/lib/export-doc';
import { Gate } from '@/components/Gate';
import { FAB } from '@/components/FAB';
import { useDeleteWithUndo } from '@/hooks/useDeleteWithUndo';
import { useAlert, useConfirm, useConfirmWithInput } from '@/components/ConfirmDialog';
import { api } from '@/lib/api';

// The board columns, in legal-intake order. The `qualified` enum value is
// legacy (pre-redesign rows) — it is folded into the Consultation column below
// rather than shown as its own stage.
interface Stage {
  id: LeadStage;
  label: string;
  sub: string;
}

const STAGES: ReadonlyArray<Stage> = [
  { id: 'new',          label: 'New enquiry',     sub: 'Untriaged enquiries' },
  { id: 'conflict',     label: 'Conflict check',  sub: 'Clear adversity' },
  { id: 'consultation', label: 'Consultation',    sub: 'Matter scoped' },
  { id: 'proposal',     label: 'Engagement sent', sub: 'Awaiting signature' },
  { id: 'won',          label: 'Retained',        sub: 'Client opened' },
  { id: 'lost',         label: 'Declined',        sub: 'Not engaged' },
];

const STAGE_BADGE: Record<Stage['id'], string> = {
  new:          'badge-cobalt',
  conflict:     'badge-amber',
  consultation: 'badge-cream',
  qualified:    'badge-cream',
  proposal:     'badge-cobalt',
  won:          'badge-sage',
  lost:         'badge-vermillion',
};

/** Map any stored stage (incl. legacy 'qualified') to a board column id. */
function columnOf(stage: LeadStage): Stage['id'] {
  return stage === 'qualified' ? 'consultation' : stage;
}

function formatINR(value: number): string {
  return value.toLocaleString('en-IN');
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'now';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'now';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

const CONFLICT_LABEL: Record<ConflictStatus, string> = {
  '': 'Conflict: not checked',
  clear: 'Conflict: clear',
  conflict: 'Conflict: ADVERSE',
};

export function LeadsView() {
  const showToast = useUIStore((s) => s.showToast);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const alertDialog = useAlert();
  const confirmDialog = useConfirm();
  const confirmWithInput = useConfirmWithInput();
  const [modalOpen, setModalOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<Stage['id'] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data: leads = [], isLoading, isError } = useLeads();
  const moveLead = useMoveLead();
  const updateLead = useUpdateLead();
  const retainLead = useRetainLead();
  const deleteWithUndo = useDeleteWithUndo();

  const handleDelete = (lead: Lead) => {
    deleteWithUndo({
      toastText: `Deleted "${lead.name}"`,
      errorText: "Couldn't delete lead",
      optimisticRemove: () => {
        const prev = qc.getQueryData<{ items: Lead[] }>(['leads']);
        if (prev) {
          qc.setQueryData<{ items: Lead[] }>(['leads'], {
            items: prev.items.filter((l) => l.id !== lead.id),
          });
        }
      },
      restore: () => {
        const cur = qc.getQueryData<{ items: Lead[] }>(['leads']);
        if (!cur) return;
        const idx = leads.findIndex((l) => l.id === lead.id);
        const restored = [...cur.items];
        if (idx >= 0 && idx <= restored.length) restored.splice(idx, 0, lead);
        else restored.push(lead);
        qc.setQueryData<{ items: Lead[] }>(['leads'], { items: restored });
      },
      commit: () => api.delete<void>(`/leads/${lead.id}`),
    });
  };

  // --- stage move, honouring the conflict gate (server returns 409) ----------
  const moveTo = (lead: Lead, stage: Stage['id']) => {
    if (columnOf(lead.stage) === stage) return;
    if (stage === 'won') { void onRetain(lead); return; }
    if (stage === 'lost') { void onDecline(lead); return; }
    moveLead.mutate(
      { id: lead.id, stage },
      {
        onError: (err) => {
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error
            ?? "Couldn't move lead";
          showToast({ type: 'vermillion', text: msg });
        },
      },
    );
  };

  // --- conflict check -------------------------------------------------------
  const setConflict = async (lead: Lead, conflictStatus: ConflictStatus) => {
    setBusyId(lead.id);
    try {
      await updateLead.mutateAsync({ id: lead.id, patch: { conflictStatus } });
      if (conflictStatus === 'clear') {
        showToast({ type: 'sage', text: `Conflict cleared for "${lead.name}"` });
      } else if (conflictStatus === 'conflict') {
        showToast({ type: 'vermillion', text: `Marked ADVERSE: this lead cannot be retained` });
      }
    } catch {
      showToast({ type: 'vermillion', text: "Couldn't update conflict status" });
    } finally {
      setBusyId(null);
    }
  };

  // --- retain (win) → create client + open pre-filled matter -----------------
  const onRetain = async (lead: Lead) => {
    if (lead.conflictStatus !== 'clear') {
      await alertDialog({
        title: 'Run the conflict check first',
        message:
          `Before "${lead.name}" can be retained, the conflict-of-interest check must be marked clear. `
          + `Open the card, run the check, then retain.`,
        tone: 'danger',
      });
      return;
    }
    const ok = await confirmDialog({
      title: `Retain ${lead.name}?`,
      message:
        `This creates a client record for "${lead.name}" and opens a new matter pre-filled from this lead. `
        + `You'll confirm the court and matter details on the next screen.`,
      confirmLabel: 'Retain & open matter',
    });
    if (!ok) return;
    setBusyId(lead.id);
    try {
      const { matterPrefill } = await retainLead.mutateAsync(lead.id);
      showToast({ type: 'sage', text: `"${lead.name}" retained, client created` });
      // Hand off to the New-matter flow, pre-filled. The Cases view reads these
      // params to seed its "New case" modal.
      const params = new URLSearchParams({
        newMatter: '1',
        client: matterPrefill.client,
        title: matterPrefill.title,
        type: matterPrefill.type,
      });
      navigate(`/app/cases?${params.toString()}`);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? "Couldn't retain lead";
      await alertDialog({ title: 'Could not retain', message: msg, tone: 'danger' });
    } finally {
      setBusyId(null);
    }
  };

  // --- decline (lost) with a reason -----------------------------------------
  const onDecline = async (lead: Lead) => {
    const { confirmed, value: reason } = await confirmWithInput({
      title: `Decline "${lead.name}"?`,
      inputLabel: 'Reason (e.g. conflict, fee, went elsewhere, not our practice area)',
      inputDefaultValue: lead.declineReason || '',
      confirmLabel: 'Decline',
      danger: true,
    });
    if (!confirmed) return;
    setBusyId(lead.id);
    try {
      await updateLead.mutateAsync({ id: lead.id, patch: { stage: 'lost', declineReason: reason.trim() } });
      showToast({ type: 'amber', text: `"${lead.name}" declined` });
    } catch {
      showToast({ type: 'vermillion', text: "Couldn't decline lead" });
    } finally {
      setBusyId(null);
    }
  };

  // --- drag & drop ----------------------------------------------------------
  const handleDragStart = (e: DragEvent<HTMLElement>, lead: Lead) => {
    e.dataTransfer.setData('text/plain', lead.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(lead.id);
  };
  const handleDragEnd = () => { setDraggingId(null); setDragOverStage(null); };
  const handleDragOver = (e: DragEvent<HTMLElement>, stage: Stage['id']) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverStage !== stage) setDragOverStage(stage);
  };
  const handleDragLeave = (e: DragEvent<HTMLElement>) => {
    if (e.currentTarget === e.target) setDragOverStage(null);
  };
  const handleDrop = (e: DragEvent<HTMLElement>, stage: Stage['id']) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    setDraggingId(null);
    setDragOverStage(null);
    if (!id) return;
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;
    moveTo(lead, stage);
  };

  // Group leads into columns (legacy 'qualified' folds into consultation).
  const PIPELINE = useMemo<Record<Stage['id'], Lead[]>>(() => {
    const groups: Record<Stage['id'], Lead[]> = {
      new: [], conflict: [], consultation: [], qualified: [], proposal: [], won: [], lost: [],
    };
    for (const l of leads) groups[columnOf(l.stage)].push(l);
    return groups;
  }, [leads]);

  // Weighted pipeline value = Σ(fee × probability) over LIVE (non-terminal)
  // leads. This is the number a partner chases — retained fees are realised,
  // declined are dead, so both are excluded.
  const weightedPipeline = useMemo(() => {
    return leads
      .filter((l) => l.stage !== 'won' && l.stage !== 'lost')
      .reduce((sum, l) => sum + Math.round((l.valueInr * l.probability) / 100), 0);
  }, [leads]);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Intake pipeline</div>
        <h1 className="heading-xl">Leads</h1>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div className="col" style={{ gap: 4 }}>
          <span className="eyebrow" style={{ color: 'var(--text-tertiary)' }}>
            Weighted pipeline value
          </span>
          <span className="heading-lg mono tabular">₹{formatINR(weightedPipeline)}</span>
          <span className="body-xs muted">Σ estimated fee × likelihood, live leads only</span>
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (leads.length === 0) {
              showToast({ type: 'amber', text: 'No leads to export' });
              return;
            }
            downloadCsv(
              `leads-${new Date().toISOString().slice(0, 10)}.csv`,
              ['Name', 'Contact', 'Practice area', 'Matter', 'Stage', 'Conflict', 'Fee (INR)', 'Likelihood %', 'Source', 'Captured'],
              leads.map((l) => [
                l.name, l.contact, l.practiceArea, l.matterSummary, l.stage,
                l.conflictStatus || 'unchecked', l.valueInr, l.probability, l.referrer, l.capturedAt,
              ]),
            );
            showToast({ type: 'sage', text: `Exported ${leads.length} leads` });
          }}
        >
          <Icon name="download" size={14} /> Export
        </button>
        <Gate feature="leads.create">
          <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <Icon name="plus" size={14} /> Capture lead
          </button>
        </Gate>
      </div>
      <NewLeadModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <Gate feature="leads.create">
        <FAB ariaLabel="Capture lead" onClick={() => setModalOpen(true)}>
          <Icon name="plus" size={22} />
        </FAB>
      </Gate>

      {isError && (
        <ErrorState
          variant="inline"
          title="Couldn't load leads"
          description="The pipeline below may be stale. Reload to retry."
        />
      )}

      <div
        className="kanban"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${STAGES.length}, minmax(236px, 1fr))`,
          gap: 16,
          alignItems: 'flex-start',
          overflowX: 'auto',
        }}
      >
        {STAGES.map((stage) => {
          const list = PIPELINE[stage.id];
          const isDropTarget = dragOverStage === stage.id;
          return (
            <section
              key={stage.id}
              aria-label={`${stage.label} column`}
              onDragOver={(e) => handleDragOver(e, stage.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage.id)}
              style={{
                background: isDropTarget ? 'var(--bg-elevated)' : 'var(--bg-surface-2)',
                border: '1px solid',
                borderColor: isDropTarget ? 'var(--text-primary)' : 'var(--border-default)',
                borderRadius: 'var(--radius-lg)',
                padding: 16,
                minHeight: 360,
                transition: 'background 120ms, border-color 120ms',
              }}
            >
              <div className="row" style={{ marginBottom: 6, alignItems: 'center', gap: 8 }}>
                <span
                  className={`badge ${STAGE_BADGE[stage.id]}`}
                  style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {stage.label.toUpperCase()}
                </span>
                <span className="spacer" />
                <span className="mono tabular" style={{ fontSize: 12, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                  {list.length}
                </span>
              </div>
              <div
                className="eyebrow"
                style={{
                  marginBottom: 14,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {stage.sub}
              </div>

              <div className="col" style={{ gap: 10 }}>
                {isLoading && list.length === 0 && Array.from({ length: 2 }, (_, i) => (
                  <article
                    key={`sk-${stage.id}-${i}`}
                    aria-busy="true"
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
                    }}
                  >
                    <Skeleton height={14} width="70%" />
                    <Skeleton height={11} width="50%" />
                    <Skeleton height={11} width="35%" />
                  </article>
                ))}
                {!isLoading && !isError && list.length === 0 && (
                  <p className="body-xs muted" style={{ padding: '8px 4px', color: 'var(--text-tertiary)' }}>
                    Drop a card here.
                  </p>
                )}
                {list.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    stageId={stage.id}
                    busy={busyId === lead.id}
                    dragging={draggingId === lead.id}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDelete={handleDelete}
                    onMoveTo={moveTo}
                    onSetConflict={setConflict}
                    onRetain={onRetain}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LeadCard — one prospect. Shows the money (fee × likelihood), the conflict
// gate, and stage-appropriate actions.
// ---------------------------------------------------------------------------
function LeadCard(props: {
  lead: Lead;
  stageId: Stage['id'];
  busy: boolean;
  dragging: boolean;
  onDragStart: (e: DragEvent<HTMLElement>, lead: Lead) => void;
  onDragEnd: () => void;
  onDelete: (lead: Lead) => void;
  onMoveTo: (lead: Lead, stage: Stage['id']) => void;
  onSetConflict: (lead: Lead, status: ConflictStatus) => void;
  onRetain: (lead: Lead) => void;
}) {
  const { lead, stageId } = props;
  const weighted = Math.round((lead.valueInr * lead.probability) / 100);
  const conflictColor =
    lead.conflictStatus === 'clear' ? 'var(--success)'
    : lead.conflictStatus === 'conflict' ? 'var(--danger)'
    : 'var(--text-tertiary)';

  return (
    <article
      draggable
      onDragStart={(e) => props.onDragStart(e, lead)}
      onDragEnd={props.onDragEnd}
      className="row-clickable"
      style={{
        position: 'relative',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: 14,
        cursor: 'grab',
        opacity: props.dragging ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        aria-label={`Delete ${lead.name}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); props.onDelete(lead); }}
        className="lead-delete-btn"
        style={{
          position: 'absolute', top: 8, right: 8, width: 22, height: 22,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid transparent', borderRadius: 'var(--radius-sm)',
          color: 'var(--text-tertiary)', background: 'transparent', cursor: 'pointer',
          transition: 'background 120ms, border-color 120ms, color 120ms',
        }}
      >
        <Icon name="close" size={12} />
      </button>

      <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 2, paddingRight: 24 }}>{lead.name}</div>
      {lead.matterSummary && (
        <div className="body-xs muted" style={{ marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lead.matterSummary}
        </div>
      )}

      <div className="row" style={{ marginBottom: 8, alignItems: 'baseline', gap: 6 }}>
        <span className="mono tabular" style={{ fontWeight: 500 }}>₹{formatINR(lead.valueInr)}</span>
        <span className="body-xs muted">× {lead.probability}% =</span>
        <span className="mono tabular body-sm" style={{ color: 'var(--text-secondary)' }}>₹{formatINR(weighted)}</span>
        <span className="spacer" />
        <span className="mono tabular" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{formatAge(lead.capturedAt)}</span>
      </div>

      {/* Conflict-check line — the legal gate. */}
      <div
        className="mono"
        style={{
          fontSize: 11, letterSpacing: '0.02em', color: conflictColor,
          borderTop: '1px solid var(--border-subtle)', paddingTop: 8, marginBottom: 8,
        }}
      >
        {CONFLICT_LABEL[lead.conflictStatus]}
      </div>

      {/* Conflict controls appear until the check is resolved clear. */}
      {lead.conflictStatus !== 'clear' && (
        <div className="row" style={{ gap: 6, marginBottom: 8 }}>
          <button
            type="button"
            className="btn btn-sm"
            disabled={props.busy}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); props.onSetConflict(lead, 'clear'); }}
            style={{ flex: 1, borderColor: 'var(--success)', color: 'var(--success)' }}
          >
            <Icon name="check" size={12} /> Clear
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={props.busy}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); props.onSetConflict(lead, 'conflict'); }}
            style={{ flex: 1, borderColor: 'var(--danger)', color: 'var(--danger)' }}
          >
            Adverse
          </button>
        </div>
      )}

      {/* Retain shortcut on consultation / engagement columns. */}
      {(stageId === 'consultation' || stageId === 'proposal') && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={props.busy || lead.conflictStatus !== 'clear'}
          title={lead.conflictStatus !== 'clear' ? 'Clear the conflict check first' : 'Retain & open matter'}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); props.onRetain(lead); }}
          style={{ width: '100%', borderColor: 'var(--success)', color: 'var(--success)', marginBottom: 8 }}
        >
          <Icon name="check" size={12} /> Retain & open matter
        </button>
      )}

      {stageId === 'lost' && lead.declineReason && (
        <div className="body-xs muted" style={{ marginBottom: 8, fontStyle: 'italic' }}>
          Reason: {lead.declineReason}
        </div>
      )}
      {stageId === 'won' && lead.convertedClient && (
        <div className="body-xs" style={{ marginBottom: 8, color: 'var(--success)' }}>
          Client: {lead.convertedClient}
        </div>
      )}
      {lead.referrer && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.04em' }}>
          {lead.referrer.toUpperCase()}
        </div>
      )}

      {/* Touch fallback: native select for stage move (drag doesn't fire on
          touch). Hidden via CSS on viewports where drag works (>=1024px). */}
      <select
        aria-label={`Move ${lead.name} to a different stage`}
        className="input lead-move-select"
        value={stageId}
        onChange={(e) => {
          const next = e.target.value as Stage['id'];
          if (next === stageId) return;
          props.onMoveTo(lead, next);
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ marginTop: 10, height: 36, fontSize: 13, padding: '0 12px' }}
      >
        {STAGES.map((s) => (
          <option key={s.id} value={s.id}>Move to {s.label}</option>
        ))}
      </select>
    </article>
  );
}
