import postgres from 'postgres';
import { env } from '../env';
import { logger } from '../logger';

let client: ReturnType<typeof postgres> | null = null;

/**
 * Lazily-initialised Postgres client. Returns `null` if `DATABASE_URL` is not
 * configured - services should fall back to their in-memory store in that case.
 */
export function db(): ReturnType<typeof postgres> | null {
  if (!env.hasDatabase) return null;
  if (!client) {
    client = postgres(env.DATABASE_URL, {
      ssl: env.databaseSsl ? 'require' : false,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
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
