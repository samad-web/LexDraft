/**
 * Compose quality telemetry (compose_outcomes, migration 0099).
 *
 * One row per intake COMPOSE pass: did the drafted body reach the advocate, or
 * did it fall back to the engine skeleton — and why. No draft text or facts are
 * stored. Recording is best-effort: a missing table or a failed insert must never
 * affect drafting.
 */

import type { ComposeQualityRow, ComposeReasonKind } from '@lexdraft/types';
import { db } from '../db/client';
import { logger } from '../logger';

export type { ComposeReasonKind };

export interface ComposeOutcome {
  firmId: string | null;
  docType: string;
  status: 'composed' | 'skeleton';
  reasonKind?: ComposeReasonKind;
  removedCount: number;
  authorities: number;
  authoritiesCited: number;
  planned: boolean;
  repaired: boolean;
}

/** compose's free-text rejectedReason -> a stable category. */
export function reasonKindOf(reason: string | undefined): ComposeReasonKind {
  if (!reason) return 'unavailable';
  if (reason.startsWith('dropped from the skeleton')) return 'dropped';
  if (reason.startsWith('unlocated claims')) return 'unlocated';
  if (reason.startsWith('reply ')) return 'reply_drift';
  if (reason === 'nothing left after checks') return 'empty';
  return 'unavailable';
}

/** Set once the table is found missing; checked again on the next process start. */
let tableMissing = false;

export const composeOutcomesService = {
  record(o: ComposeOutcome): void {
    const sql = db();
    if (!sql || tableMissing) return;
    void sql`
      insert into compose_outcomes
        (firm_id, doc_type, status, reason_kind, removed_count, authorities, authorities_cited, planned, repaired)
      values
        (${o.firmId}, ${o.docType}, ${o.status}, ${o.reasonKind ?? null}, ${o.removedCount},
         ${o.authorities}, ${o.authoritiesCited}, ${o.planned}, ${o.repaired})
    `.catch((err: unknown) => {
      // Before migration 0099 every draft would log this; say it once.
      if ((err as { code?: string }).code === '42P01') {
        tableMissing = true;
        logger.warn('compose_outcomes table missing (apply migration 0099) — drafting-quality tracking off');
        return;
      }
      logger.warn({ err, docType: o.docType }, 'compose-outcomes record failed');
    });
  },

  /** Per-doc-type quality for [start, end). Empty when the table is absent. */
  async report(start: Date, end: Date): Promise<{ rows: ComposeQualityRow[] }> {
    const sql = db();
    if (!sql) return { rows: [] };
    try {
      const rows = await sql<Array<{
        doc_type: string; status: string; reason_kind: string | null; n: number;
        removed: number; cited: number; repaired: number;
      }>>`
        select doc_type, status, reason_kind, count(*)::int as n,
               coalesce(sum(removed_count), 0)::int as removed,
               coalesce(sum(authorities_cited), 0)::int as cited,
               count(*) filter (where repaired)::int as repaired
        from compose_outcomes
        where created_at >= ${start} and created_at < ${end}
        group by doc_type, status, reason_kind
      `;
      const byDoc = new Map<string, ComposeQualityRow & { removedSum: number; citedSum: number }>();
      for (const r of rows) {
        const row = byDoc.get(r.doc_type) ?? {
          docType: r.doc_type, total: 0, composed: 0, composedRate: 0, byReason: {},
          avgRemoved: 0, avgCited: 0, repaired: 0, removedSum: 0, citedSum: 0,
        };
        row.total += r.n;
        row.removedSum += r.removed;
        row.citedSum += r.cited;
        row.repaired += r.repaired;
        if (r.status === 'composed') row.composed += r.n;
        else {
          const k = (r.reason_kind ?? 'unavailable') as ComposeReasonKind;
          row.byReason[k] = (row.byReason[k] ?? 0) + r.n;
        }
        byDoc.set(r.doc_type, row);
      }
      return {
        rows: [...byDoc.values()]
          .map(({ removedSum, citedSum, ...r }) => ({
            ...r,
            composedRate: r.total ? r.composed / r.total : 0,
            avgRemoved: r.total ? removedSum / r.total : 0,
            avgCited: r.composed ? citedSum / r.composed : 0,
          }))
          .sort((a, b) => b.total - a.total),
      };
    } catch (err) {
      logger.warn({ err }, 'compose-outcomes report failed (table missing?)');
      return { rows: [] };
    }
  },
};
