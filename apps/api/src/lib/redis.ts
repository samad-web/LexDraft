/**
 * Lazy Redis client.
 *
 * Returns `null` when REDIS_URL is unset so callers can transparently fall
 * back to in-process state (acceptable for single-replica dev / staging).
 * Never throws on connection problems — the rate limiter and cache layers
 * degrade to in-memory rather than blocking the request path.
 */

import { env } from '../env';
import { logger } from '../logger';

type RedisLike = import('ioredis').default;

let clientPromise: Promise<RedisLike | null> | null = null;

export function redis(): Promise<RedisLike | null> {
  if (!env.hasRedis) return Promise.resolve(null);
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    try {
      const { default: Redis } = await import('ioredis');
      const client = new Redis(env.REDIS_URL, {
        lazyConnect: false,
        maxRetriesPerRequest: 2,
        // Don't spam logs on a flaky network — back off and let downstream
        // calls fall through to in-memory.
        enableOfflineQueue: false,
      });
      client.on('error', (err) => logger.warn({ err }, 'redis error'));
      return client;
    } catch (err) {
      logger.error({ err }, 'redis: failed to initialise client');
      return null;
    }
  })();
  return clientPromise;
}
