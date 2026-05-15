/**
 * Migration validation - proves every SQL file under apps/api/migrations:
 *   1. Names itself with the agreed `NNNN_<snake_case>.sql` pattern.
 *   2. Applies cleanly against an empty schema, in order.
 *   3. Leaves the headline domain tables present.
 *   4. Is idempotent - re-running every migration a second time succeeds.
 *
 * This is the integration suite's load-bearing test. If a migration goes in
 * with a syntax error, a missing IF NOT EXISTS, or a dependency on a column
 * that doesn't exist yet, this file fails before any service test gets a
 * chance to mislead with a confusing error.
 *
 * The migration runner from `src/scripts/migrate.ts` is intentionally NOT
 * reused - it expects a real `DATABASE_URL` against the public schema and a
 * `_migrations` ledger. Here we apply files directly inside the test schema
 * with explicit `search_path` control.
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import crypto from 'node:crypto';

const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'migrations');
const NAME_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Tables that MUST exist post-migration. Failing any of these means a
 *  rename or drop slipped through without an accompanying service update. */
const REQUIRED_TABLES = [
  'users',
  'firms',
  'cases',
  'clauses',
  'drafts',
  'invoices',
  'expenses',
  'limitations',
  'audit_log',
  'mfa_pending_challenges',
  'coverage_requests',
  'consent_log',
  'engagement_templates',
];

const REQUIRED_MATVIEWS = [
  'analytics_active_matters_mv',
];

/**
 * Provision an isolated schema just for this file so the idempotency check
 * (which re-runs every migration end-to-end) doesn't fight the shared
 * integration-setup schema. The schema is dropped in afterAll.
 */
let sql: ReturnType<typeof postgres>;
let schema: string;

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL ?? '';
  if (!url) {
    throw new Error('TEST_DATABASE_URL must be set for migrations.integration.test.ts');
  }
  schema = `mig_${crypto.randomBytes(3).toString('hex')}`;
  // `max: 1` so `set search_path` (and any subsequent migration SQL) all
  // route over the same physical connection - otherwise a pool round-robin
  // could land a query in `public` instead of the test schema.
  sql = postgres(url, {
    ssl: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    onnotice: () => undefined,
    connection: { search_path: `${schema},public` },
  });
  await sql.unsafe(`drop schema if exists "${schema}" cascade`);
  await sql.unsafe(`create schema "${schema}"`);
}, 30_000);

afterAll(async () => {
  if (sql) {
    try { await sql.unsafe(`drop schema if exists "${schema}" cascade`); } catch { /* noop */ }
    await sql.end({ timeout: 5 });
  }
}, 30_000);

async function listMigrationFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

describe('migrations - file naming', () => {
  it('every .sql file matches NNNN_snake_case.sql', async () => {
    const files = await listMigrationFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f, `migration ${f} fails the naming convention`).toMatch(NAME_PATTERN);
    }
  });
});

describe('migrations - apply against empty schema', () => {
  it('applies every migration in order with a SELECT 1 health check between each', async () => {
    const files = await listMigrationFiles();
    for (const filename of files) {
      // Defensively reassert search_path in case a migration body did a
      // `set search_path = public` and forgot to reset it.
      await sql.unsafe(`set search_path to "${schema}", public`);
      const body = await readFile(resolve(MIGRATIONS_DIR, filename), 'utf8');
      await sql.unsafe(body);
      const health = await sql<{ ok: number }[]>`select 1::int as ok`;
      expect(health[0]?.ok).toBe(1);
    }
  }, 120_000);

  it('creates every required domain table', async () => {
    await sql.unsafe(`set search_path to "${schema}", public`);
    const rows = await sql<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = ${schema}
        and table_type = 'BASE TABLE'
    `;
    const present = new Set(rows.map((r) => r.table_name));
    for (const t of REQUIRED_TABLES) {
      expect(present.has(t), `expected table ${t} to exist after all migrations`).toBe(true);
    }
  });

  it('creates the analytics materialized views', async () => {
    const rows = await sql<{ matviewname: string }[]>`
      select matviewname from pg_matviews where schemaname = ${schema}
    `;
    const present = new Set(rows.map((r) => r.matviewname));
    for (const v of REQUIRED_MATVIEWS) {
      expect(present.has(v), `expected matview ${v} to exist`).toBe(true);
    }
  });
});

describe('migrations - idempotency', () => {
  it('re-running every migration a second time succeeds without errors', async () => {
    const files = await listMigrationFiles();
    for (const filename of files) {
      await sql.unsafe(`set search_path to "${schema}", public`);
      const body = await readFile(resolve(MIGRATIONS_DIR, filename), 'utf8');
      // If a migration is non-idempotent (e.g. missing `if not exists` or a
      // bare `insert` without `on conflict do nothing`), the unsafe() call
      // throws - re-throw with the file name so the failure message is
      // actually actionable.
      try {
        await sql.unsafe(body);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`migration ${filename} is NOT idempotent: ${msg}`);
      }
    }
  }, 120_000);
});
