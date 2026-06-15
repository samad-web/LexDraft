import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { CasePipelineGraph, PipelineNode, PipelineNodeStatus } from '@lexdraft/types';
import {
  useCasePipeline,
  useAddPipelineNode,
  useUpdatePipelineNode,
  useDeletePipelineNode,
  useSetNodeStatus,
  useAddPipelineEdge,
  useUpdatePipelineEdge,
  useDeletePipelineEdge,
} from '@/hooks/usePipelineGraph';
import { useCaseApplications } from '@/hooks/useCaseApplications';
import { useUIStore } from '@/store/ui';
import {
  COL_GAP, NODE_STATUSES, orderedNodes, statusDotColor, statusLabel,
} from './pipelineLayout';

const EMPTY: CasePipelineGraph = { nodes: [], edges: [] };

/**
 * Touch-friendly, vertical rendering of a case pipeline — the mobile/narrow
 * counterpart to the drag-and-drop PipelineBuilder canvas. Same data + hooks,
 * so edits made here and on the canvas are fully interchangeable. Supports the
 * complete editing surface without any dragging: add, rename, set status, link
 * an application, connect stages (via a picker), label/clear branch conditions,
 * and delete. Branches read as indented "→ if …" rows under each stage.
 */
export function PipelineList({ caseId }: { caseId: string }) {
  const pipeline = useCasePipeline(caseId);
  const apps = useCaseApplications(caseId);
  const showToast = useUIStore((s) => s.showToast);

  const addNode = useAddPipelineNode(caseId);
  const updateNode = useUpdatePipelineNode(caseId);
  const deleteNode = useDeletePipelineNode(caseId);
  const setStatus = useSetNodeStatus(caseId);
  const addEdge = useAddPipelineEdge(caseId);
  const updateEdge = useUpdatePipelineEdge(caseId);
  const deleteEdge = useDeletePipelineEdge(caseId);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [addingStage, setAddingStage] = useState(false);
  const [newStage, setNewStage] = useState('');

  const graph = pipeline.data ?? EMPTY;
  const ordered = orderedNodes(graph);

  function err(e: unknown, fallback: string) {
    const msg = (e as { response?: { data?: { error?: string } }; message?: string })
      ?.response?.data?.error ?? (e as Error).message ?? fallback;
    showToast({ type: 'vermillion', text: msg });
  }

  function commitAddStage() {
    const label = newStage.trim();
    if (!label) { setAddingStage(false); return; }
    // Place the new stage to the right of the rest so it sorts to the end of
    // the list (and the canvas), matching the builder's placement.
    const x = graph.nodes.length ? Math.max(...graph.nodes.map((n) => n.x)) + COL_GAP : 0;
    addNode.mutate(
      { label, x, y: 0 },
      {
        onSuccess: () => { setNewStage(''); setAddingStage(false); },
        onError: (e) => err(e, 'Could not add stage'),
      },
    );
  }

  function commitRename(node: PipelineNode) {
    const v = renameVal.trim();
    if (v && v !== node.label) {
      updateNode.mutate({ nodeId: node.id, patch: { label: v } }, { onError: (e) => err(e, 'Could not rename stage') });
    }
    setRenamingId(null);
  }

  const labelOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? '—';

  if (pipeline.isLoading) {
    return <p className="body-sm muted">Loading pipeline…</p>;
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      {/* Toolbar */}
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {addingStage ? (
          <>
            <input
              className="input"
              autoFocus
              value={newStage}
              onChange={(e) => setNewStage(e.target.value)}
              placeholder="Stage name — e.g. Mediation, Remand"
              maxLength={80}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitAddStage(); }
                if (e.key === 'Escape') { setAddingStage(false); setNewStage(''); }
              }}
              style={{ flex: 1, minWidth: 0 }}
              disabled={addNode.isPending}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={commitAddStage} disabled={addNode.isPending || !newStage.trim()}>
              {addNode.isPending ? 'Adding…' : 'Add'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAddingStage(false); setNewStage(''); }} disabled={addNode.isPending}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingStage(true)}>
              <Icon name="plus" size={12} /> Add stage
            </button>
            <span className="spacer" style={{ flex: 1 }} />
            <span className="mono body-xs muted" style={{ letterSpacing: '0.12em' }}>TAP A STAGE TO EDIT</span>
          </>
        )}
      </div>

      {ordered.length === 0 ? (
        <div className="card" style={{ padding: 24 }}>
          <p className="body-md muted">No pipeline yet. Add the first stage above to start building this matter's path.</p>
        </div>
      ) : (
        <div className="col" style={{ gap: 0 }}>
          {ordered.map((n, i) => {
            const expanded = expandedId === n.id;
            const renaming = renamingId === n.id;
            const outgoing = graph.edges.filter((e) => e.fromNodeId === n.id);
            const targetIds = new Set(outgoing.map((e) => e.toNodeId));
            const connectable = ordered.filter((m) => m.id !== n.id && !targetIds.has(m.id));
            const dot = statusDotColor(n.status);
            const skipped = n.status === 'skipped';

            return (
              <div key={n.id} className="col" style={{ gap: 0 }}>
                {/* Connector from the previous row. */}
                {i > 0 && (
                  <div aria-hidden style={{ height: 12, marginLeft: 21, borderLeft: '2px solid var(--border-subtle)' }} />
                )}

                <div
                  className="card"
                  style={{ padding: 0, overflow: 'hidden', borderColor: expanded ? 'var(--text-primary)' : undefined }}
                >
                  {/* Header row — tap to expand. */}
                  <button
                    type="button"
                    className="row"
                    onClick={() => { setExpandedId(expanded ? null : n.id); setRenamingId(null); }}
                    style={{
                      width: '100%', gap: 12, alignItems: 'center', padding: '12px 14px',
                      background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                    }}
                    aria-expanded={expanded}
                  >
                    <span
                      aria-hidden
                      style={{
                        flex: '0 0 auto', width: 14, height: 14, borderRadius: '50%',
                        background: n.status === 'pending' || skipped ? 'transparent' : dot,
                        border: `2px solid ${dot}`,
                        ...(skipped ? { borderStyle: 'dashed' } : null),
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        className="body-md"
                        style={{
                          display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          textDecoration: skipped ? 'line-through' : undefined,
                          color: skipped ? 'var(--text-tertiary)' : undefined,
                        }}
                      >
                        {n.label}
                      </span>
                      <span className="mono body-xs" style={{ color: dot, letterSpacing: '0.12em' }}>
                        {statusLabel(n.status).toUpperCase()}
                      </span>
                    </span>
                    <Icon name={expanded ? 'chevronD' : 'chevron'} size={16} />
                  </button>

                  {/* Branch summary (collapsed view) — shows where this stage leads. */}
                  {!expanded && outgoing.length > 0 && (
                    <div className="col" style={{ gap: 2, padding: '0 14px 12px 40px' }}>
                      {outgoing.map((e) => (
                        <span key={e.id} className="body-xs muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          → {e.conditionLabel ? <span className="mono" style={{ color: 'var(--text-tertiary)' }}>{e.conditionLabel} </span> : null}
                          {labelOf(e.toNodeId)}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Expanded editor. */}
                  {expanded && (
                    <div className="col" style={{ gap: 14, padding: '4px 14px 16px', borderTop: '1px solid var(--border-subtle)' }}>
                      {/* Rename */}
                      <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 12 }}>
                        {renaming ? (
                          <input
                            className="input"
                            autoFocus
                            value={renameVal}
                            maxLength={80}
                            onChange={(e) => setRenameVal(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitRename(n); }
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            onBlur={() => commitRename(n)}
                            style={{ flex: 1, minWidth: 0 }}
                          />
                        ) : (
                          <>
                            <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {n.label}
                            </strong>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRenameVal(n.label); setRenamingId(n.id); }}>
                              Rename
                            </button>
                          </>
                        )}
                      </div>

                      {/* Status */}
                      <div className="col" style={{ gap: 6 }}>
                        <div className="mono body-xs muted" style={{ letterSpacing: '0.12em' }}>STATUS</div>
                        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                          {NODE_STATUSES.map((st) => (
                            <button
                              key={st}
                              type="button"
                              className={`btn btn-sm${st === n.status ? ' btn-primary' : ''}`}
                              disabled={setStatus.isPending || st === n.status}
                              onClick={() => setStatus.mutate(
                                { nodeId: n.id, status: st as PipelineNodeStatus },
                                { onError: (e) => err(e, 'Could not set status') },
                              )}
                            >
                              {statusLabel(st)}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Linked application */}
                      <div className="col" style={{ gap: 6 }}>
                        <div className="mono body-xs muted" style={{ letterSpacing: '0.12em' }}>LINKED APPLICATION</div>
                        <select
                          className="input"
                          value={n.applicationId ?? ''}
                          onChange={(e) => updateNode.mutate(
                            { nodeId: n.id, patch: { applicationId: e.target.value || null } },
                            { onError: (er) => err(er, 'Could not link application') },
                          )}
                          style={{ width: '100%' }}
                        >
                          <option value="">— none —</option>
                          {(apps.data ?? []).map((a) => (
                            <option key={a.id} value={a.id}>
                              {(a.label || a.kind.toUpperCase())}{a.appType ? ` · ${a.appType}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Branches / connections */}
                      <div className="col" style={{ gap: 6 }}>
                        <div className="mono body-xs muted" style={{ letterSpacing: '0.12em' }}>BRANCHES TO</div>
                        {outgoing.length === 0 && (
                          <span className="body-xs muted">No outgoing branches yet.</span>
                        )}
                        {outgoing.map((e) => (
                          <div key={e.id} className="row" style={{ gap: 6, alignItems: 'center' }}>
                            <Icon name="arrow" size={12} />
                            <span className="body-sm" style={{ flex: '0 0 auto', maxWidth: '38%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {labelOf(e.toNodeId)}
                            </span>
                            <input
                              className="input mono"
                              key={`${e.id}:${e.conditionLabel ?? ''}`}
                              defaultValue={e.conditionLabel ?? ''}
                              placeholder="if allowed…"
                              maxLength={60}
                              onKeyDown={(ev) => {
                                if (ev.key === 'Enter') { ev.preventDefault(); (ev.target as HTMLInputElement).blur(); }
                              }}
                              onBlur={(ev) => {
                                const v = ev.target.value.trim();
                                if ((e.conditionLabel ?? '') !== v) {
                                  updateEdge.mutate({ edgeId: e.id, conditionLabel: v || null }, { onError: (er) => err(er, 'Could not save condition') });
                                }
                              }}
                              style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '6px 8px' }}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              title="Remove branch"
                              disabled={deleteEdge.isPending}
                              onClick={() => deleteEdge.mutate(e.id, { onError: (er) => err(er, 'Could not remove branch') })}
                            >
                              <Icon name="close" size={12} />
                            </button>
                          </div>
                        ))}
                        {connectable.length > 0 && (
                          <select
                            className="input"
                            value=""
                            onChange={(ev) => {
                              const toNodeId = ev.target.value;
                              if (!toNodeId) return;
                              addEdge.mutate({ fromNodeId: n.id, toNodeId }, { onError: (er) => err(er, 'Could not link stages') });
                            }}
                            style={{ width: '100%' }}
                          >
                            <option value="">+ Connect to a stage…</option>
                            {connectable.map((m) => (
                              <option key={m.id} value={m.id}>{m.label}</option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* Delete */}
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--danger)' }}
                          disabled={deleteNode.isPending}
                          onClick={() => {
                            deleteNode.mutate(n.id, { onError: (e) => err(e, 'Could not delete stage') });
                            setExpandedId(null);
                          }}
                        >
                          Delete stage
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
