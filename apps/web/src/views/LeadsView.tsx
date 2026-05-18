import { useMemo, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, Skeleton } from '@lexdraft/ui';
import type { Lead, LeadStage } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { useLeads, useMoveLead } from '@/hooks/useLeads';
import { NewLeadModal } from '@/components/NewLeadModal';
import { downloadCsv } from '@/lib/export-doc';
import { Gate } from '@/components/Gate';
import { FAB } from '@/components/FAB';
import { useDeleteWithUndo } from '@/hooks/useDeleteWithUndo';
import { api } from '@/lib/api';

type StageId = LeadStage;

interface Stage {
  id: StageId;
  label: string;
  sub: string;
}

const STAGES: ReadonlyArray<Stage> = [
  { id: 'new',       label: 'New',           sub: 'Untriaged enquiries'   },
  { id: 'qualified', label: 'Qualified',     sub: 'Discovery complete'    },
  { id: 'proposal',  label: 'Proposal sent', sub: 'Awaiting reply'        },
  { id: 'won',       label: 'Won',           sub: 'Engagement signed'     },
  { id: 'lost',      label: 'Lost',          sub: 'Closed without engagement' },
];

const STAGE_BADGE: Record<StageId, string> = {
  new:       'badge-cobalt',
  qualified: 'badge-amber',
  proposal:  'badge-cream',
  won:       'badge-sage',
  lost:      'badge-vermillion',
};

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

export function LeadsView() {
  const showToast = useUIStore((s) => s.showToast);
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<StageId | null>(null);
  const { data: leads = [], isLoading, isError } = useLeads();
  const moveLead = useMoveLead();
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
        // Re-insert in original position if known; otherwise append.
        const all = leads;
        const idx = all.findIndex((l) => l.id === lead.id);
        const restored = [...cur.items];
        if (idx >= 0 && idx <= restored.length) restored.splice(idx, 0, lead);
        else restored.push(lead);
        qc.setQueryData<{ items: Lead[] }>(['leads'], { items: restored });
      },
      commit: () => api.delete<void>(`/leads/${lead.id}`),
    });
  };

  const handleDragStart = (e: DragEvent<HTMLElement>, lead: Lead) => {
    e.dataTransfer.setData('text/plain', lead.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(lead.id);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverStage(null);
  };

  const handleDragOver = (e: DragEvent<HTMLElement>, stage: StageId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverStage !== stage) setDragOverStage(stage);
  };

  const handleDragLeave = (e: DragEvent<HTMLElement>) => {
    // Only clear when leaving the column container itself, not its children.
    if (e.currentTarget === e.target) setDragOverStage(null);
  };

  const handleDrop = (e: DragEvent<HTMLElement>, stage: StageId) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    setDraggingId(null);
    setDragOverStage(null);
    if (!id) return;
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;
    moveLead.mutate(
      { id, stage },
      {
        onError: () => showToast({ type: 'vermillion', text: 'Couldn’t move lead' }),
      },
    );
  };

  const PIPELINE: Record<StageId, Lead[]> = useMemo(() => {
    const groups: Record<StageId, Lead[]> = { new: [], qualified: [], proposal: [], won: [], lost: [] };
    for (const l of leads) groups[l.stage].push(l);
    return groups;
  }, [leads]);

  const totals = useMemo<Record<StageId, number>>(() => ({
    new:       PIPELINE.new.reduce((s, l) => s + l.valueInr, 0),
    qualified: PIPELINE.qualified.reduce((s, l) => s + l.valueInr, 0),
    proposal:  PIPELINE.proposal.reduce((s, l) => s + l.valueInr, 0),
    won:       PIPELINE.won.reduce((s, l) => s + l.valueInr, 0),
    lost:      PIPELINE.lost.reduce((s, l) => s + l.valueInr, 0),
  }), [PIPELINE]);

  const totalPipe = totals.new + totals.qualified + totals.proposal + totals.won;

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Intake pipeline</div>
        <h1 className="heading-xl">Leads</h1>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div className="col" style={{ gap: 4 }}>
          <span className="eyebrow" style={{ color: 'var(--text-tertiary)' }}>Open pipeline value</span>
          <span className="heading-lg mono tabular">₹{formatINR(totalPipe)}</span>
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
              ['Name', 'Stage', 'Value (INR)', 'Referrer', 'Captured at'],
              leads.map((l) => [l.name, l.stage, l.valueInr, l.referrer, l.capturedAt]),
            );
            showToast({ type: 'sage', text: `Exported ${leads.length} leads` });
          }}
        >
          <Icon name="download" size={14} /> Export
        </button>
        <Gate feature="leads.create">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModalOpen(true)}
          >
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

      <div
        className="kanban"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${STAGES.length}, minmax(220px, 1fr))`,
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
              <div className="row" style={{ marginBottom: 4 }}>
                <span className={`badge ${STAGE_BADGE[stage.id]}`}>{stage.label.toUpperCase()}</span>
                <span className="spacer" />
                <span className="mono tabular" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {list.length}
                </span>
              </div>
              <div className="eyebrow" style={{ marginTop: 6, marginBottom: 14 }}>
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
                      padding: 14,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <Skeleton height={14} width="70%" />
                    <Skeleton height={11} width="50%" />
                    <Skeleton height={11} width="35%" />
                  </article>
                ))}
                {!isLoading && list.length === 0 && (
                  <p
                    className="body-xs muted"
                    style={{
                      padding: '8px 4px',
                      color: isError ? 'var(--danger)' : 'var(--text-tertiary)',
                    }}
                  >
                    {isError ? "Couldn't load leads" : 'Drop a card here.'}
                  </p>
                )}
                {list.map((lead) => (
                  <article
                    key={lead.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, lead)}
                    onDragEnd={handleDragEnd}
                    className="row-clickable"
                    style={{
                      position: 'relative',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      padding: 14,
                      cursor: 'grab',
                      opacity: draggingId === lead.id ? 0.5 : 1,
                    }}
                  >
                    <button
                      type="button"
                      aria-label={`Delete ${lead.name}`}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); handleDelete(lead); }}
                      className="lead-delete-btn"
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        width: 22,
                        height: 22,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid transparent',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--text-tertiary)',
                        background: 'transparent',
                        cursor: 'pointer',
                        transition: 'background 120ms, border-color 120ms, color 120ms',
                      }}
                    >
                      <Icon name="close" size={12} />
                    </button>
                    <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 8, paddingRight: 24 }}>{lead.name}</div>
                    <div className="row" style={{ marginBottom: 10 }}>
                      <span className="mono tabular" style={{ fontWeight: 500 }}>
                        ₹{formatINR(lead.valueInr)}
                      </span>
                      <span className="spacer" />
                      <span className="mono tabular" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {formatAge(lead.capturedAt)}
                      </span>
                    </div>
                    {lead.referrer && (
                      <div
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: 'var(--text-tertiary)',
                          letterSpacing: '0.04em',
                          borderTop: '1px solid var(--border-subtle)',
                          paddingTop: 8,
                        }}
                      >
                        {lead.referrer.toUpperCase()}
                      </div>
                    )}
                    {lead.stage === 'lost' && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          moveLead.mutate(
                            { id: lead.id, stage: 'won' },
                            {
                              onError: () => showToast({ type: 'vermillion', text: 'Couldn’t reopen lead' }),
                              onSuccess: () => showToast({ type: 'sage', text: `"${lead.name}" moved to Won` }),
                            },
                          );
                        }}
                        style={{
                          marginTop: 10,
                          width: '100%',
                          borderColor: 'var(--success)',
                          color: 'var(--success)',
                        }}
                      >
                        <Icon name="check" size={12} /> Reopen as won
                      </button>
                    )}
                    {/* Touch fallback: native select for stage move (HTML5
                        drag doesn't fire on touch). Hidden via CSS on
                        viewports where drag works (>=1024px). */}
                    <select
                      aria-label={`Move ${lead.name} to a different stage`}
                      className="input lead-move-select"
                      value={lead.stage}
                      onChange={(e) => {
                        const next = e.target.value as LeadStage;
                        if (next === lead.stage) return;
                        moveLead.mutate(
                          { id: lead.id, stage: next },
                          {
                            onError: () =>
                              showToast({ type: 'vermillion', text: "Couldn't move lead" }),
                          },
                        );
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        marginTop: 10,
                        height: 36,
                        fontSize: 13,
                        padding: '0 12px',
                      }}
                    >
                      {STAGES.map((s) => (
                        <option key={s.id} value={s.id}>
                          Move to {s.label}
                        </option>
                      ))}
                    </select>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
