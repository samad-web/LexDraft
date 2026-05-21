import postgres from 'postgres';
import { env } from '../env';
import { logger } from '../logger';

let client: ReturnType<typeof postgres> | null = null;

/**
 * Lazily-initialised Postgres client. Returns `null` if `DATABASE_URL` is not
 * configured - services should fall back to their in-memory store in that case.
 *
 * Connection-pool sizing (Supabase session-mode budget = 15 clients/project)
 * --------------------------------------------------------------------------
 *   main db() pool             4   (this client — read+write, parallel fan-outs)
 *   cache-broadcaster LISTEN   1   (NOTIFY/LISTEN connection, pinned)
 *   pg-boss workers            3   (capped in jobs.service.ts)
 *   migrate script (when run)  1   (max:1 in scripts/migrate.ts)
 *                             ---
 *                              9   leaves 6 of 15 free for transient retries
 *                                   and ghost connections from a previous
 *                                   `tsx watch` that hasn't released yet.
 *
 * If you see `EMAXCONNSESSION`: check for zombie `tsx` processes from prior
 * dev restarts, OR a parallel `migrate` running while the API is up. Last
 * resort: switch DATABASE_URL to Supabase transaction-mode pooler (port
 * 6543) — caps in the hundreds. `prepare: false` already lets the same
 * code work in both modes.
 */
export function db(): ReturnType<typeof postgres> | null {
  if (!env.hasDatabase) return null;
  if (!client) {
    client = postgres(env.DATABASE_URL, {
      ssl: env.databaseSsl ? 'require' : false,
      max: 4,
      idle_timeout: 10,
      connect_timeout: 10,
      prepare: false,
      onnotice: () => undefined, // silence Postgres NOTICE noise
    });
    logger.info('Postgres client initialised');
  }
  return client;
}

/** Force a fresh connection (used by the migration runner). */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
  }
}
