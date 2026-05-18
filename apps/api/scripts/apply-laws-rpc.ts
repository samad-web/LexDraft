// One-shot: apply an SQL file against LAWS_DATABASE_URL. Used to install
// the match_laws + lookup_section RPCs into the indiacode-rag corpus DB
// without needing a local psql. Safe to delete after first run.
//
// Usage from repo root:
//   pnpm --filter @lexdraft/api exec tsx scripts/apply-laws-rpc.ts <path>

import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { env } from '../src/env';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: apply-laws-rpc.ts <path-to-sql>');
    process.exit(2);
  }
  if (!env.LAWS_DATABASE_URL) {
    console.error('LAWS_DATABASE_URL not set');
    process.exit(2);
  }

  const sqlText = await readFile(file, 'utf8');
  console.log(`Applying ${file} (${sqlText.length} chars)…`);

  const sql = postgres(env.LAWS_DATABASE_URL, {
    ssl: env.lawsDatabaseSsl ? 'require' : false,
    max: 1,
  });

  try {
    await sql.unsafe(sqlText);
    console.log('OK');
  } catch (err) {
    console.error('FAILED:', err);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('uncaught', err);
  process.exit(1);
});
