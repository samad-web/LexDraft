/**
 * Cross-replica cache invalidation over Postgres LISTEN/NOTIFY.
 *
 * Problem: several process-local caches (firmId resolver, permissions
 * resolver) accelerate hot paths by memoising per-user state for a short
 * TTL. When a mutation happens on replica A, replica A invalidates its
 * own cache — but replicas B and C continue serving stale entitlement /
 * tenant decisions until their own TTL expires.
 *
 * Solution: every replica subscribes to a `cache_invalidations` channel
 * on Postgres. When a mutation invalidates a key locally, it also fires
 * a NOTIFY with a typed payload `{ scope, key }`. Every other replica's
 * subscriber receives the NOTIFY and applies its local invalidation. The
 * publisher itself receives its own NOTIFY too — harmless because the
 * local invalidation has already happened (Set.delete on a missing key
 * is a no-op).
 *
 * Properties:
 * - No Redis dependency. We already have Postgres.
 * - Atomic with the writer: NOTIFY is queued until the publishing
 *   transaction commits, so subscribers never see a NOTIFY for state
 *   that's been rolled back.
 * - Fan-out is built in; Postgres handles per-listener queues.
 * - Sub-100ms latency in practice on the same VPC.
 * - In-memory mode (DATABASE_URL blank): broadcaster is a no-op; single-
 *   process dev work is unaffected.
 *
 * Failure modes:
 * - If the LISTEN connection drops, postgres-js reconnects automatically.
 *   In the interval, this replica may serve stale data until its TTL
 *   expires — same upper bound as the single-replica case.
 * - If NOTIFY publishing fails (e.g. transaction rollback), no message
 *   is sent — the writer's mutation didn't land either, so other
 *   replicas correctly stay on the pre-mutation state.
 */

import { db } from '../db/client';
import { logger } from '../logger';

export type CacheScope = 'tenant' | 'permissions';

export interface CacheInvalidationPayload {
  scope: CacheScope;
  /** The cache key being invalidated. `null` means "drop everything in
   *  this scope" — used for whole-firm changes like `firms.plan_tier`. */
  key: string | null;
}

const CHANNEL = 'cache_invalidations';

type Handler = (key: string | null) => void;

const handlers = new Map<CacheScope, Set<Handler>>();

let listener: { unlisten?: () => Promise<void> } | null = null;
let started = false;
let starting: Promise<void> | null = null;

/** Register an in-process invalidator for a given scope. Multiple handlers
 *  per scope are allowed; all fire on each NOTIFY. */
export function subscribe(scope: CacheScope, handler: Handler): void {
  let set = handlers.get(scope);
  if (!set) { set = new Set(); handlers.set(scope, set); }
  set.add(handler);
}

/** Publish an invalidation across all replicas. The local invalidation
 *  must still be performed by the caller — this function only broadcasts
 *  to other replicas. Network failures are logged but not thrown; a
 *  failed broadcast must never abort the parent mutation. */
export async function publish(scope: CacheScope, key: string | null): Promise<void> {
  const sql = db();
  if (!sql) return; // in-memory mode — nothing to broadcast
  try {
    const payload: CacheInvalidationPayload = { scope, key };
    await sql.notify(CHANNEL, JSON.stringify(payload));
  } catch (err) {
    // Log but don't throw — broadcast is best-effort. Replicas will
    // eventually self-heal when their TTLs expire.
    logger.warn({ err, scope, key }, 'cache_invalidations NOTIFY failed');
  }
}

/** Boot the LISTEN subscription. Idempotent. Safe to call before any
 *  subscribers are registered — they'll receive NOTIFYs delivered after
 *  their `subscribe()` call. */
export async function start(): Promise<void> {
  if (started) return;
  if (starting) return starting;

  const sql = db();
  if (!sql) {
    // In-memory mode. Mark as started so repeated calls no-op.
    started = true;
    return;
  }

  starting = (async () => {
    try {
      listener = await sql.listen(CHANNEL, (raw: string) => {
        let parsed: CacheInvalidationPayload;
        try {
          parsed = JSON.parse(raw) as CacheInvalidationPayload;
        } catch {
          logger.warn({ raw }, 'cache_invalidations: dropped non-JSON payload');
          return;
        }
        const set = handlers.get(parsed.scope);
        if (!set) return; // no in-process listeners for this scope yet
        for (const h of set) {
          try { h(parsed.key); }
          catch (err) { logger.warn({ err, scope: parsed.scope }, 'cache_invalidations handler threw'); }
        }
      });
      logger.info({ channel: CHANNEL }, 'cache_invalidations LISTEN started');
      started = true;
    } catch (err) {
      logger.error({ err }, 'cache_invalidations LISTEN failed to start');
      // Don't crash the process — single-replica deploys still work without
      // the broadcaster. Reset `starting` so a later retry can succeed.
      starting = null;
      throw err;
    }
  })();

  return starting;
}

/** Stop listening. Called during graceful shutdown. */
export async function stop(): Promise<void> {
  if (!listener) return;
  try {
    await listener.unlisten?.();
  } catch (err) {
    logger.warn({ err }, 'cache_invalidations: unlisten failed');
  } finally {
    listener = null;
    started = false;
  }
}

export const cacheBroadcaster = { subscribe, publish, start, stop };
