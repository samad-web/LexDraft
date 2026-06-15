import { useId, useRef, useState } from 'react';
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
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUIStore } from '@/store/ui';
import { PipelineList } from './PipelineList';
import {
  NODE_W, NODE_H, PAD, COL_GAP,
  edgePath, edgeMid, statusStyle, statusLabel, canvasSize, nodeById, NODE_STATUSES,
} from './pipelineLayout';

const EMPTY: CasePipelineGraph = { nodes: [], edges: [] };

interface DragState { nodeId: string; dx: number; dy: number; x: number; y: number; moved: boolean }
interface DraftEdge { fromNodeId: string; x: number; y: number }

/**
 * Per-case branching pipeline builder. Adaptive: a drag-and-drop SVG canvas on
 * desktop, and a touch-friendly vertical list (PipelineList) on narrow screens
 * where freeform dragging and 6px ports don't work. Both edit the same graph
 * through the same hooks, so the two views are fully interchangeable.
 */
export function PipelineBuilder({ caseId }: { caseId: string }) {
  // 768px ≈ tablet-portrait and below → the canvas is too cramped to drag.
  const narrow = useMediaQuery('(max-width: 768px)');
  return narrow ? <PipelineList caseId={caseId} /> : <PipelineCanvasEditor caseId={caseId} />;
}

/**
 * Desktop drag-and-drop canvas. Hand-rolled SVG (no graph lib) so it matches the
 * app's design tokens and shares its renderer with the read-only PipelineCanvas
 * via pipelineLayout. Supports: drag to arrange, draw edges from a node's
 * right-hand port, set node status, link a node to an application, and
 * edit/clear edge condition labels.
 */
function PipelineCanvasEditor({ caseId }: { caseId: string }) {
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

  const markerId = useId().replace(/[:]/g, '');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<CasePipelineGraph>(EMPTY);
  const dragRef = useRef<DragState | null>(null);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [draftEdge, setDraftEdge] = useState<DraftEdge | null>(null);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [addingStage, setAddingStage] = useState(false);
  const [newStage, setNewStage] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');

  const graph = pipeline.data ?? EMPTY;
  graphRef.current = graph;
  const { width, height } = canvasSize(graph.nodes);

  function toContent(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const wrap = wrapRef.current;
    if (!wrap) return { x: 0, y: 0 };
    const r = wrap.getBoundingClientRect();
    return {
      x: e.clientX - r.left + wrap.scrollLeft - PAD,
      y: e.clientY - r.top + wrap.scrollTop - PAD,
    };
  }

  function err(e: unknown, fallback: string) {
    const msg = (e as { response?: { data?: { error?: string } }; message?: string })
      ?.response?.data?.error ?? (e as Error).message ?? fallback;
    showToast({ type: 'vermillion', text: msg });
  }

  // ---- node drag -----------------------------------------------------------
  function startNodeDrag(e: React.PointerEvent, node: PipelineNode) {
    e.stopPropagation();
    setSelNode(node.id);
    setSelEdge(null);
    setRenaming(false);
    const p = toContent(e);
    const base = { nodeId: node.id, dx: p.x - node.x, dy: p.y - node.y };
    dragRef.current = { ...base, x: node.x, y: node.y, moved: false };
    setDrag(dragRef.current);

    const onMove = (ev: PointerEvent) => {
      const q = toContent(ev);
      const x = Math.max(0, q.x - base.dx);
      const y = Math.max(0, q.y - base.dy);
      const moved = (dragRef.current?.moved ?? false) || Math.abs(x - node.x) > 2 || Math.abs(y - node.y) > 2;
      dragRef.current = { ...base, x, y, moved };
      setDrag(dragRef.current);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (d && d.moved) {
        updateNode.mutate({ nodeId: d.nodeId, patch: { x: Math.round(d.x), y: Math.round(d.y) } });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ---- edge draw -----------------------------------------------------------
  function startEdgeDraw(e: React.PointerEvent, node: PipelineNode) {
    e.stopPropagation();
    const p = toContent(e);
    setDraftEdge({ fromNodeId: node.id, x: p.x, y: p.y });

    const onMove = (ev: PointerEvent) => {
      const q = toContent(ev);
      setDraftEdge({ fromNodeId: node.id, x: q.x, y: q.y });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const q = toContent(ev);
      const target = graphRef.current.nodes.find(
        (n) => n.id !== node.id && q.x >= n.x && q.x <= n.x + NODE_W && q.y >= n.y && q.y <= n.y + NODE_H,
      );
      setDraftEdge(null);
      if (target) {
        addEdge.mutate(
          { fromNodeId: node.id, toNodeId: target.id },
          { onError: (er) => err(er, 'Could not link stages') },
        );
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function commitAddStage() {
    const label = newStage.trim();
    if (!label) { setAddingStage(false); return; }
    const x = graph.nodes.length ? Math.max(...graph.nodes.map((n) => n.x)) + COL_GAP : 0;
    addNode.mutate(
      { label, x, y: 0 },
      {
        onSuccess: () => { setNewStage(''); setAddingStage(false); },
        onError: (e) => err(e, 'Could not add stage'),
      },
    );
  }

  const selectedNode = selNode ? nodeById(graph, selNode) : undefined;
  const selectedEdge = selEdge ? graph.edges.find((e) => e.id === selEdge) : undefined;
  const selEdgeMid = (() => {
    if (!selectedEdge) return null;
    const f = nodeById(graph, selectedEdge.fromNodeId);
    const t = nodeById(graph, selectedEdge.toNodeId);
    return f && t ? edgeMid(f, t) : null;
  })();

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
              style={{ flex: '0 1 280px', minWidth: 200 }}
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingStage(true)}>
            <Icon name="plus" size={12} /> Add stage
          </button>
        )}
        <span className="spacer" />
        <span className="mono body-xs muted" style={{ letterSpacing: '0.12em' }}>
          DRAG TO ARRANGE · DRAG THE ▸ HANDLE TO LINK · CLICK A STAGE TO SET STATUS
        </span>
      </div>

      {graph.nodes.length === 0 ? (
        <div className="card" style={{ padding: 24 }}>
          <p className="body-md muted">No pipeline yet. Add the first stage above to start building this matter's path.</p>
        </div>
      ) : (
        <div
          ref={wrapRef}
          style={{
            position: 'relative',
            overflow: 'auto',
            maxHeight: 520,
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-surface-2, var(--bg-surface))',
          }}
        >
          <div style={{ position: 'relative', width, height }}>
            <svg width={width} height={height} style={{ display: 'block' }}>
              <defs>
                <marker id={`arrow-${markerId}`} viewBox="0 0 10 10" refX="9" refY="5"
                        markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--border-strong, #9a9a9a)" />
                </marker>
              </defs>

              {/* background — click clears selection */}
              <rect
                x={0} y={0} width={width} height={height} fill="transparent"
                onPointerDown={() => { setSelNode(null); setSelEdge(null); setRenaming(false); }}
              />

              <g transform={`translate(${PAD}, ${PAD})`}>
                {/* edges */}
                {graph.edges.map((e) => {
                  const from = nodeById(graph, e.fromNodeId);
                  const to = nodeById(graph, e.toNodeId);
                  if (!from || !to) return null;
                  const fp = drag && drag.nodeId === from.id ? { ...from, x: drag.x, y: drag.y } : from;
                  const tp = drag && drag.nodeId === to.id ? { ...to, x: drag.x, y: drag.y } : to;
                  const mid = edgeMid(fp, tp);
                  const selected = e.id === selEdge;
                  return (
                    <g key={e.id}>
                      <path d={edgePath(fp, tp)} fill="none"
                            stroke={selected ? 'var(--text-primary)' : 'var(--border-strong, #9a9a9a)'}
                            strokeWidth={selected ? 2 : 1.5}
                            markerEnd={`url(#arrow-${markerId})`} />
                      {/* fat invisible hit target */}
                      <path d={edgePath(fp, tp)} fill="none" stroke="transparent" strokeWidth={14}
                            style={{ cursor: 'pointer' }}
                            onPointerDown={(ev) => { ev.stopPropagation(); setSelEdge(e.id); setSelNode(null); setRenaming(false); }} />
                      {e.conditionLabel && (
                        <text x={mid.x} y={mid.y - 6} textAnchor="middle"
                              style={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}>
                          {e.conditionLabel}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* draft edge being drawn */}
                {draftEdge && (() => {
                  const from = nodeById(graph, draftEdge.fromNodeId);
                  if (!from) return null;
                  const a = { x: from.x + NODE_W, y: from.y + NODE_H / 2 };
                  return (
                    <path d={`M ${a.x} ${a.y} L ${draftEdge.x} ${draftEdge.y}`} fill="none"
                          stroke="var(--text-primary)" strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" />
                  );
                })()}

                {/* nodes */}
                {graph.nodes.map((n) => {
                  const pos = drag && drag.nodeId === n.id ? { x: drag.x, y: drag.y } : { x: n.x, y: n.y };
                  const s = statusStyle(n.status);
                  const selected = n.id === selNode;
                  return (
                    <g key={n.id} transform={`translate(${pos.x}, ${pos.y})`} style={{ cursor: 'grab' }}>
                      <rect
                        width={NODE_W} height={NODE_H} rx={10}
                        fill={s.bg}
                        stroke={selected ? 'var(--text-primary)' : s.border}
                        strokeWidth={selected ? 2.5 : 1.5}
                        strokeDasharray={s.dashed ? '4 3' : undefined}
                        onPointerDown={(ev) => startNodeDrag(ev, n)}
                      />
                      <text x={14} y={22} pointerEvents="none"
                            style={{ fontSize: 13, fontWeight: 600, fill: s.fg, textDecoration: s.strike ? 'line-through' : undefined }}>
                        {truncate(n.label, 17)}
                      </text>
                      <text x={14} y={40} pointerEvents="none"
                            style={{ fontSize: 9, letterSpacing: '0.14em', fill: s.fg, opacity: 0.75, fontFamily: 'var(--font-mono)' }}>
                        {statusLabel(n.status).toUpperCase()}
                      </text>
                      {/* right-hand port for drawing edges */}
                      <circle
                        cx={NODE_W} cy={NODE_H / 2} r={6}
                        fill="var(--bg-base)" stroke="var(--text-primary)" strokeWidth={1.5}
                        style={{ cursor: 'crosshair' }}
                        onPointerDown={(ev) => startEdgeDraw(ev, n)}
                      />
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* node menu overlay */}
            {selectedNode && !drag && (
              <div
                className="card"
                style={{
                  position: 'absolute',
                  left: selectedNode.x + PAD,
                  top: selectedNode.y + PAD + NODE_H + 10,
                  width: 250,
                  padding: 12,
                  zIndex: 5,
                  boxShadow: 'var(--shadow-md, 0 8px 24px rgba(0,0,0,0.12))',
                }}
              >
                {renaming ? (
                  <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                    <input className="input" autoFocus value={renameVal} maxLength={80}
                           onChange={(e) => setRenameVal(e.target.value)}
                           onKeyDown={(e) => {
                             if (e.key === 'Enter') {
                               e.preventDefault();
                               const v = renameVal.trim();
                               if (v) updateNode.mutate({ nodeId: selectedNode.id, patch: { label: v } });
                               setRenaming(false);
                             }
                             if (e.key === 'Escape') setRenaming(false);
                           }}
                           style={{ flex: 1 }} />
                  </div>
                ) : (
                  <div className="row" style={{ alignItems: 'baseline', marginBottom: 10, gap: 8 }}>
                    <strong style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedNode.label}
                    </strong>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }}
                            onClick={() => { setRenameVal(selectedNode.label); setRenaming(true); }}>
                      Rename
                    </button>
                  </div>
                )}

                <div className="mono body-xs muted" style={{ letterSpacing: '0.12em', marginBottom: 6 }}>STATUS</div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {NODE_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      className={`btn btn-sm${st === selectedNode.status ? ' btn-primary' : ''}`}
                      style={{ padding: '3px 8px' }}
                      disabled={setStatus.isPending || st === selectedNode.status}
                      onClick={() => setStatus.mutate(
                        { nodeId: selectedNode.id, status: st as PipelineNodeStatus },
                        { onError: (e) => err(e, 'Could not set status') },
                      )}
                    >
                      {statusLabel(st)}
                    </button>
                  ))}
                </div>

                <div className="mono body-xs muted" style={{ letterSpacing: '0.12em', marginBottom: 6 }}>LINKED APPLICATION</div>
                <select
                  className="input"
                  value={selectedNode.applicationId ?? ''}
                  onChange={(e) => updateNode.mutate({
                    nodeId: selectedNode.id,
                    patch: { applicationId: e.target.value || null },
                  })}
                  style={{ marginBottom: 12, width: '100%' }}
                >
                  <option value="">— none —</option>
                  {(apps.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {(a.label || a.kind.toUpperCase())}{a.appType ? ` · ${a.appType}` : ''}
                    </option>
                  ))}
                </select>

                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                          disabled={deleteNode.isPending}
                          onClick={() => {
                            deleteNode.mutate(selectedNode.id, { onError: (e) => err(e, 'Could not delete stage') });
                            setSelNode(null);
                          }}>
                    Delete stage
                  </button>
                </div>
              </div>
            )}

            {/* edge menu overlay */}
            {selectedEdge && selEdgeMid && (
              <div
                className="card"
                style={{
                  position: 'absolute',
                  left: selEdgeMid.x + PAD - 110,
                  top: selEdgeMid.y + PAD + 8,
                  width: 220,
                  padding: 12,
                  zIndex: 5,
                  boxShadow: 'var(--shadow-md, 0 8px 24px rgba(0,0,0,0.12))',
                }}
              >
                <div className="mono body-xs muted" style={{ letterSpacing: '0.12em', marginBottom: 6 }}>CONDITION</div>
                <input
                  className="input"
                  defaultValue={selectedEdge.conditionLabel ?? ''}
                  placeholder="e.g. if allowed"
                  maxLength={60}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const v = (e.target as HTMLInputElement).value.trim();
                      updateEdge.mutate({ edgeId: selectedEdge.id, conditionLabel: v || null });
                      setSelEdge(null);
                    }
                    if (e.key === 'Escape') setSelEdge(null);
                  }}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if ((selectedEdge.conditionLabel ?? '') !== v) {
                      updateEdge.mutate({ edgeId: selectedEdge.id, conditionLabel: v || null });
                    }
                  }}
                  style={{ width: '100%', marginBottom: 10 }}
                />
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                          disabled={deleteEdge.isPending}
                          onClick={() => {
                            deleteEdge.mutate(selectedEdge.id, { onError: (e) => err(e, 'Could not delete link') });
                            setSelEdge(null);
                          }}>
                    Remove link
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
