import type { PipelineNode, PipelineNodeStatus, CasePipelineGraph } from '@lexdraft/types';

// Shared geometry + visual tokens for the pipeline graph. Imported by both the
// editable builder (advocate) and the read-only canvas (portal) so the two
// renderings never drift.

export const NODE_W = 156;
export const NODE_H = 54;
export const PAD = 28;          // canvas inset so nodes aren't flush to the edge
export const COL_GAP = 220;     // default horizontal spacing for seeded chains

export interface NodeBox {
  cx: number; cy: number;
  left: { x: number; y: number };
  right: { x: number; y: number };
}

/** Anchor points for a node at its top-left (x, y). */
export function nodeBox(n: { x: number; y: number }): NodeBox {
  return {
    cx: n.x + NODE_W / 2,
    cy: n.y + NODE_H / 2,
    left: { x: n.x, y: n.y + NODE_H / 2 },
    right: { x: n.x + NODE_W, y: n.y + NODE_H / 2 },
  };
}

/** Cubic-bezier path from a source node's right port to a target's left port.
 *  Works for arbitrary positions; the control-point offset keeps the curve
 *  readable even when the target sits to the left. */
export function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const a = nodeBox(from).right;
  const b = nodeBox(to).left;
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

/** Midpoint of an edge, used to anchor the condition label. */
export function edgeMid(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const a = nodeBox(from).right;
  const b = nodeBox(to).left;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export interface StatusStyle {
  bg: string;
  border: string;
  fg: string;
  dashed?: boolean;
  strike?: boolean;
}

export function statusStyle(status: PipelineNodeStatus): StatusStyle {
  switch (status) {
    case 'active':
      return { bg: 'var(--text-primary)', border: 'var(--text-primary)', fg: 'var(--bg-base)' };
    case 'done':
      return { bg: 'var(--success, #2f7d32)', border: 'var(--success, #2f7d32)', fg: '#fff' };
    case 'skipped':
      return { bg: 'var(--bg-surface)', border: 'var(--border-subtle)', fg: 'var(--text-tertiary)', dashed: true, strike: true };
    case 'pending':
    default:
      return { bg: 'var(--bg-surface)', border: 'var(--border-default)', fg: 'var(--text-tertiary)' };
  }
}

export function statusLabel(status: PipelineNodeStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Single accent colour per status, for the compact list rendering (a dot /
 *  rail rather than a filled node). Mirrors statusStyle's intent. */
export function statusDotColor(status: PipelineNodeStatus): string {
  switch (status) {
    case 'active': return 'var(--text-primary)';
    case 'done': return 'var(--success, #2f7d32)';
    case 'skipped': return 'var(--text-tertiary)';
    case 'pending':
    default: return 'var(--border-strong, #9a9a9a)';
  }
}

export const NODE_STATUSES: PipelineNodeStatus[] = ['pending', 'active', 'done', 'skipped'];

/** Flatten the graph into a linear reading order for the mobile/list view.
 *  We read the canvas the way a human does — left-to-right, then top-to-bottom
 *  — falling back to the seed `position` and id so the order is fully stable.
 *  Branches are conveyed per-row via each node's outgoing edges. */
export function orderedNodes(graph: CasePipelineGraph): PipelineNode[] {
  return graph.nodes.slice().sort(
    (a, b) => (a.x - b.x) || (a.y - b.y) || (a.position - b.position) || a.id.localeCompare(b.id),
  );
}

/** Canvas size needed to show the whole graph (content lives in positive space;
 *  drag is clamped to >= 0 so we never need a negative origin). */
export function canvasSize(
  nodes: PipelineNode[],
  minW = 640,
  minH = 240,
): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + NODE_W);
    maxY = Math.max(maxY, n.y + NODE_H);
  }
  return {
    width: Math.max(minW, maxX + PAD * 2),
    height: Math.max(minH, maxY + PAD * 2),
  };
}

/** Resolve a node by id within a graph. */
export function nodeById(graph: CasePipelineGraph, id: string): PipelineNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}
