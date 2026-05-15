import { db } from '../db/client';
import { logger } from '../logger';

/**
 * Refresh the Firm-analytics materialized views (migration 0021).
 *
 * `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires (a) a unique index
 * on the view, and (b) that the view has already been populated at
 * least once. Migration 0021 creates each view WITH data and adds the
 * required unique index - so the CONCURRENTLY refresh is safe from the
 * very first run.
 *
 * Each REFRESH is its own statement and they run sequentially. Postgres
 * holds an exclusive lock on the view being refreshed (just the view, not
 * the source tables), so refresh-from-three-replicas is harmless: only
 * one will win at any moment, the others get blocked briefly then no-op.
 */
const VIEWS = [
  'analytics_active_matters_mv',
  'analytics_stages_mv',
  'analytics_outcomes_mv',
  'analytics_monthly_revenue_mv',
] as const;

export interface RefreshResult {
  view: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export const analyticsRefreshService = {
  async refreshAll(): Promise<RefreshResult[]> {
    const sql = db();
    if (!sql) {
      logger.warn('analytics refresh skipped - DATABASE_URL not configured');
      return [];
    }
    const out: RefreshResult[] = [];
    for (const view of VIEWS) {
      const t0 = Date.now();
      try {
        // Identifier interpolation - `sql(view)` quotes the name safely.
        // postgres-js does not allow bind-parameter interpolation of
        // identifiers, but `sql.unsafe` is fine here because `view` is
        // a compile-time-constant string from the allowlist above.
        await sql.unsafe(`refresh materialized view concurrently ${view}`);
        out.push({ view, ok: true, ms: Date.now() - t0 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        out.push({ view, ok: false, ms: Date.now() - t0, error: message });
        logger.error({ err, view }, 'analytics MV refresh failed');
      }
    }
    return out;
  },
};
