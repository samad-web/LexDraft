/* eslint-disable no-console */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { env } from '../env';

const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'migrations');

interface Args {
  reset: boolean;
  status: boolean;
}

function parseArgs(): Args {
  const argv = new Set(process.argv.slice(2));
  return { reset: argv.has('--reset'), status: argv.has('--status') };
}

async function listMigrations(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

async function ensureLedger(sql: ReturnType<typeof postgres>): Promise<void> {
  await sql`
    create table if not exists _migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now()
    )
  `;
}

async function appliedSet(sql: ReturnType<typeof postgres>): Promise<Set<string>> {
  const rows = await sql<{ filename: string }[]>`
    select filename from _migrations order by filename asc
  `;
  return new Set(rows.map((r) => r.filename));
}

async function runMigration(
  sql: ReturnType<typeof postgres>,
  filename: string,
  body: string,
): Promise<void> {
  // Each .sql file is run as a single command - postgres-js handles multiple
  // statements when sent via .unsafe. We wrap in a transaction for atomicity.
  console.log(`  → applying ${filename}`);
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`insert into _migrations (filename) values (${filename})`;
  });
}

async function reset(sql: ReturnType<typeof postgres>): Promise<void> {
  console.log('  ⚠  resetting public schema (dropping all tables)…');
  await sql.unsafe(`
    drop schema public cascade;
    create schema public;
    grant all on schema public to public;
  `);
}

async function main(): Promise<void> {
  if (!env.hasDatabase) {
    console.error('DATABASE_URL is not set. Add it to apps/api/.env and re-run.');
    process.exit(1);
  }

  const args = parseArgs();
  const sql = postgres(env.DATABASE_URL, {
    ssl: env.databaseSsl ? 'require' : false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    onnotice: () => undefined,
  });

  try {
    if (args.reset) {
      await reset(sql);
    }

    await ensureLedger(sql);
    const applied = await appliedSet(sql);
    const all = await listMigrations();
    const pending = all.filter((f) => !applied.has(f));

    if (args.status) {
      console.log(`\nLedger: ${applied.size} applied · ${pending.length} pending\n`);
      for (const f of all) {
        console.log(`  ${applied.has(f) ? '✓' : ' '} ${f}`);
      }
      return;
    }

    if (pending.length === 0) {
      console.log(`Up to date - ${applied.size} migration${applied.size === 1 ? '' : 's'} already applied.`);
      return;
    }

    console.log(`Applying ${pending.length} migration${pending.length === 1 ? '' : 's'}:`);
    for (const filename of pending) {
      const body = await readFile(resolve(MIGRATIONS_DIR, filename), 'utf8');
      await runMigration(sql, filename, body);
    }
    console.log(`\nDone - ${applied.size + pending.length} total applied.`);
  } catch (err) {
    console.error('\nMigration failed:');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
