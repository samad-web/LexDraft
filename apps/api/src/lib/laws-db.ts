import postgres from 'postgres';
import { env } from '../env';
import { logger } from '../logger';

// Separate Postgres client for the indiacode-rag corpus. Lives alongside
// db/client.ts (the LexDraft tenancy DB) so we don't accidentally cross
// the two — laws are public reference data, tenancy is firm-scoped.

let client: ReturnType<typeof postgres> | null = null;

export function lawsDb(): ReturnType<typeof postgres> | null {
  if (!env.LAWS_DATABASE_URL) return null;
  if (!client) {
    client = postgres(env.LAWS_DATABASE_URL, {
      ssl: env.lawsDatabaseSsl ? 'require' : false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => undefined,
    });
    logger.info('Laws-corpus Postgres client initialised');
  }
  return client;
}

export async function closeLawsDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
  }
}
