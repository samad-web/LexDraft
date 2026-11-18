import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { DIRTY_FILE, E2E_PREFIX, WEB_DIR, assertLocal } from './env';

// Deletes every E2E-* row the suite created for the test account's firm.
// Only tables with no DELETE endpoint are listed; all FKs to them cascade or
// set null (checked against apps/api/migrations). Refuses a non-local DB.
const TABLES: Array<[table: string, column: string]> = [
  ['tasks', 'title'],
  ['expenses', 'description'],
  ['invoices', 'client'],
  ['diary_entries', 'case_label'],
  ['cases', 'title'],
  ['clients', 'name'],
];

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(DIRTY_FILE)) return; // no signed-in run since the last cleanup
  const email = process.env.E2E_EMAIL?.trim();
  if (!email) throw new Error('E2E_EMAIL unset: cannot clean up E2E-* rows');
  const apiEnv = join(WEB_DIR, '..', 'api', '.env');

  const dbUrl = parseEnv(readFileSync(apiEnv, 'utf8')).DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL missing in apps/api/.env');
  assertLocal(dbUrl, 'DATABASE_URL');

  const postgres = createRequire(join(WEB_DIR, '..', 'api', 'package.json'))('postgres');
  const sql = postgres(dbUrl, { max: 1, ssl: false, onnotice: () => {} });
  try {
    const [user] = await sql`select firm_id from users where lower(email) = lower(${email}) limit 1`;
    if (!user?.firm_id) throw new Error(`no firm for ${email} in the local DB`);
    const removed: string[] = [];
    await sql.begin(async (tx: typeof sql) => {
      for (const [table, column] of TABLES) {
        const rows = await tx`delete from ${tx(table)} where firm_id = ${user.firm_id} and ${tx(column)} like ${E2E_PREFIX + '%'} returning id`;
        if (rows.length) removed.push(`${table}: ${rows.length}`);
      }
    });
    if (removed.length) console.log(`[e2e teardown] removed ${removed.join(', ')}`);
    rmSync(DIRTY_FILE);
  } finally {
    await sql.end();
  }
}
