/**
 * Tenant-context helpers.
 *
 * Resolves the caller's firm_id from a userId so domain services can scope
 * their queries. Used by every read/write path that returns or mutates
 * tenant-owned rows. The result is cached briefly per userId - short
 * enough that a role/firm mutation propagates quickly, long enough that
 * the dashboard pipeline doesn't issue 5 redundant lookups per request.
 *
 * Mutation paths that change a user's role or firm membership (role
 * change, transfer, demote) MUST call `invalidateTenantCache(userId)` so
 * the caller's next request sees fresh state without waiting for TTL.
 *
 * Returns `null` for users with no firm attachment (e.g. partially
 * provisioned platform admins). Callers MUST treat null as "no tenant" and
 * return empty results rather than skipping the WHERE clause.
 */

import { db } from '../db/client';
import { cacheBroadcaster } from './cache-broadcaster';

// 15 seconds. Long enough to amortise the dashboard fan-out (which makes
// 5-6 firm-scoped queries off one user), short enough that a stale cache
// after a role/firm mutation self-heals quickly even if a caller forgot
// to invalidate.
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { firmId: string | null; expiresAt: number }>();

// Cross-replica invalidation. Other replicas' invalidateTenantCache
// calls will arrive here via the broadcaster and drop our local entry.
// Subscribing at module-load time is safe - the broadcaster buffers
// NOTIFYs until its LISTEN connection opens, but since this handler is
// registered before the API starts accepting traffic, no mutation can
// race ahead of it.
cacheBroadcaster.subscribe('tenant', (userId) => {
  if (userId === null) cache.clear();
  else cache.delete(userId);
});

export function invalidateTenantCache(userId?: string): void {
  // 1. Local invalidation - immediate, in-process.
  if (userId === undefined) cache.clear();
  else cache.delete(userId);
  // 2. Cross-replica broadcast - fire-and-forget. A failed broadcast
  //    logs a warning but never throws; in the worst case, sister
  //    replicas serve stale state until their own TTL expires.
  void cacheBroadcaster.publish('tenant', userId ?? null);
}

export async function firmIdForUser(userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > now) return hit.firmId;

  const sql = db();
  if (!sql) return null;

  const [row] = await sql<Array<{ firm_id: string | null }>>`
    select firm_id from users where id = ${userId}::uuid limit 1
  `;
  const firmId = row?.firm_id ?? null;
  cache.set(userId, { firmId, expiresAt: now + CACHE_TTL_MS });
  return firmId;
}
