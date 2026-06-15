import { useId } from 'react';
import type { CasePipelineGraph } from '@lexdraft/types';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  NODE_W, NODE_H, PAD,
  edgePath, edgeMid, statusStyle, statusLabel, statusDotColor, canvasSize, nodeById, orderedNodes,
} from './pipelineLayout';

/**
 * Read-only renderer for a case pipeline graph (e.g. the client portal). Shares
 * its visual language with the editable PipelineBuilder via pipelineLayout, and
 * is adaptive: an SVG canvas on desktop, a compact vertical stage list on narrow
 * screens where the canvas would otherwise force horizontal scrolling.
 */
export function PipelineCanvas({ graph }: { graph: CasePipelineGraph }) {
  const narrow = useMediaQuery('(max-width: 768px)');
  if (graph.nodes.length === 0) return null;
  return narrow ? <PipelineReadList graph={graph} /> : <PipelineCanvasSvg graph={graph} />;
}

/** Desktop SVG snapshot. */
function PipelineCanvasSvg({ graph }: { graph: CasePipelineGraph }) {
  const markerId = useId().replace(/[:]/g, '');
  const { width, height } = canvasSize(graph.nodes);

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <svg width={width} height={height} style={{ display: 'block', minWidth: '100%' }} role="img" aria-label="Case pipeline">
        <defs>
          <marker id={`arrow-${markerId}`} viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--border-strong, #9a9a9a)" />
          </marker>
        </defs>
        <g transform={`translate(${PAD}, ${PAD})`}>
          {graph.edges.map((e) => {
            const from = nodeById(graph, e.fromNodeId);
            const to = nodeById(graph, e.toNodeId);
            if (!from || !to) return null;
            const mid = edgeMid(from, to);
            return (
              <g key={e.id}>
                <path
                  d={edgePath(from, to)}
                  fill="none"
                  stroke="var(--border-strong, #9a9a9a)"
                  strokeWidth={1.5}
                  markerEnd={`url(#arrow-${markerId})`}
                />
                {e.conditionLabel && (
                  <text x={mid.x} y={mid.y - 6} textAnchor="middle"
                        style={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {e.conditionLabel}
                  </text>
                )}
              </g>
            );
          })}

          {graph.nodes.map((n) => {
            const s = statusStyle(n.status);
            return (
              <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
                <rect
                  width={NODE_W} height={NODE_H} rx={10}
                  fill={s.bg} stroke={s.border} strokeWidth={1.5}
                  strokeDasharray={s.dashed ? '4 3' : undefined}
                />
                <text
                  x={14} y={22}
                  style={{
                    fontSize: 13, fontWeight: 600, fill: s.fg,
                    textDecoration: s.strike ? 'line-through' : undefined,
                  }}
                >
                  {truncate(n.label, 18)}
                </text>
                <text x={14} y={40}
                      style={{ fontSize: 9, letterSpacing: '0.14em', fill: s.fg, opacity: 0.75, fontFamily: 'var(--font-mono)' }}>
                  {statusLabel(n.status).toUpperCase()}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/** Narrow-screen vertical snapshot. Reads the graph top-to-bottom with branch
 *  destinations indented under each stage. */
function PipelineReadList({ graph }: { graph: CasePipelineGraph }) {
  const ordered = orderedNodes(graph);
  const labelOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? '—';

  return (
    <div className="col" style={{ gap: 0 }} role="img" aria-label="Case pipeline">
      {ordered.map((n, i) => {
        const outgoing = graph.edges.filter((e) => e.fromNodeId === n.id);
        const dot = statusDotColor(n.status);
        const skipped = n.status === 'skipped';
        const hollow = n.status === 'pending' || skipped;
        return (
          <div key={n.id} className="col" style={{ gap: 0 }}>
            {i > 0 && (
              <div aria-hidden style={{ height: 12, marginLeft: 6, borderLeft: '2px solid var(--border-subtle)' }} />
            )}
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <span
                aria-hidden
                style={{
                  flex: '0 0 auto', marginTop: 4, width: 14, height: 14, borderRadius: '50%',
                  background: hollow ? 'transparent' : dot,
                  border: `2px solid ${dot}`,
                  ...(skipped ? { borderStyle: 'dashed' } : null),
                }}
              />
              <div className="col" style={{ gap: 2, minWidth: 0, flex: 1 }}>
                <span
                  className="body-md"
                  style={{
                    fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    textDecoration: skipped ? 'line-through' : undefined,
                    color: skipped ? 'var(--text-tertiary)' : undefined,
                  }}
                >
                  {n.label}
                </span>
                <span className="mono body-xs" style={{ color: dot, letterSpacing: '0.12em' }}>
                  {statusLabel(n.status).toUpperCase()}
                </span>
                {outgoing.map((e) => (
                  <span key={e.id} className="body-xs muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    → {e.conditionLabel ? <span className="mono" style={{ color: 'var(--text-tertiary)' }}>{e.conditionLabel} </span> : null}
                    {labelOf(e.toNodeId)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
