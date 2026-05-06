/* eslint-disable no-console */
import postgres from 'postgres';
import { env } from '../env';

async function main(): Promise<void> {
  const sql = postgres(env.DATABASE_URL, {
    ssl: env.databaseSsl ? 'require' : false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  try {
    const tables = ['firms', 'users', 'cases', 'hearings', 'tasks', 'documents', 'alerts', 'invitations'];
    console.log('Row counts:');
    for (const t of tables) {
      const rows = await sql.unsafe(`select count(*)::int as n from ${t}`);
      const n = (rows[0] as { n: number } | undefined)?.n ?? 0;
      console.log(`  ${t.padEnd(14)} ${n}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
