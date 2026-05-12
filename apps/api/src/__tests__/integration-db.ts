/**
 * Integration-test Postgres lifecycle.
 *
 * The schema name is generated SYNCHRONOUSLY by `integration-setup.ts` at
 * top-level (before `env.ts` reads DATABASE_URL) and pinned into
 * `process.env.INTEGRATION_TEST_SCHEMA`. This module just provisions the
 * actual schema, applies migrations, and tears down.
 *
 *   1. `setupIntegrationDb()` — opens a postgres-js client pinned to the
 *      test schema via `connection.search_path`, runs every migration file
 *      under `apps/api/migrations/*.sql` (sorted), and returns a handle
 *      with the schema name and a postgres-js client useful for raw setup
 *      SQL in test fixtures.
 *
 *   2. `getIntegrationSql()` — returns the client from (1). Test bodies
 *      use it for raw seeds where calling through a service would be
 *      circular.
 *
 *   3. `teardownIntegrationDb()` — drops the schema CASCADE, closes the
 *      lifecycle client, AND closes the API's lazy `db()` singleton (so
 *      the next test file's connections rebind cleanly).
 *
 * Fail-fast: every helper throws a clear error if `TEST_DATABASE_URL` or
 * `INTEGRATION_TEST_SCHEMA` is missing.
 */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'migrations');

interface IntegrationDbHandle {
  /** The ephemeral schema name created for this test file. */
  schema: string;
  /** postgres-js client bound to that schema via connection.search_path. */
  sql: ReturnType<typeof postgres>;
}

let handle: IntegrationDbHandle | null = null;

function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? '';
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests require a live Postgres. '
      + 'See apps/api/INTEGRATION_TESTS.md for the Docker one-liner.',
    );
  }
  return url;
}

function requireSchemaName(): string {
  const schema = process.env.INTEGRATION_TEST_SCHEMA ?? '';
  if (!schema) {
    throw new Error(
      'INTEGRATION_TEST_SCHEMA is not set. The integration-setup.ts file must '
      + 'run before any integration test — check vitest.integration.config.ts.',
    );
  }
  // Defensive: only allow [a-z0-9_], no spaces, no quotes — we interpolate
  // this into SQL identifiers via `"${schema}"`.
  if (!/^[a-z0-9_]+$/i.test(schema)) {
    throw new Error(`INTEGRATION_TEST_SCHEMA has unexpected characters: ${schema}`);
  }
  return schema;
}

async function listMigrations(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

async function runMigrationsInSchema(
  sql: ReturnType<typeof postgres>,
  schema: string,
): Promise<void> {
  const files = await listMigrations();
  // Connection-level search_path is set via `connection: { search_path: ... }`
  // in the postgres() constructor, but we re-assert before each migration
  // in case any migration body does `set search_path = public` and forgets
  // to reset (none currently do, but cheap insurance).
  for (const filename of files) {
    await sql.unsafe(`set search_path to "${schema}", public`);
    const body = await readFile(resolve(MIGRATIONS_DIR, filename), 'utf8');
    try {
      await sql.unsafe(body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Migration ${filename} failed: ${msg}`);
    }
  }
}

/**
 * Create the ephemeral schema and apply migrations. Idempotent within a
 * process — calling twice returns the same handle.
 */
export async function setupIntegrationDb(): Promise<IntegrationDbHandle> {
  if (handle) return handle;
  const baseUrl = requireTestDatabaseUrl();
  const schema = requireSchemaName();

  // `max: 1` because `set search_path` is per-connection. Setting it via the
  // `connection` option below pins it for THIS connection at startup; a
  // pool of size > 1 could give us a fresh, search_path-less connection on
  // a later query. The lifecycle client only does setup/teardown so 1 is
  // plenty.
  const sql = postgres(baseUrl, {
    ssl: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    onnotice: () => undefined,
    connection: { search_path: `${schema},public` },
  });

  // Quote the identifier — schema names are user-supplied (via random hex)
  // and `postgres-js` doesn't expand template params as identifiers.
  await sql.unsafe(`drop schema if exists "${schema}" cascade`);
  await sql.unsafe(`create schema "${schema}"`);

  await runMigrationsInSchema(sql, schema);

  handle = { schema, sql };
  return handle;
}

/** Returns the postgres-js handle bound to the test schema. Throws if
 *  `setupIntegrationDb` hasn't been called yet. */
export function getIntegrationSql(): ReturnType<typeof postgres> {
  if (!handle) throw new Error('integration-db: setupIntegrationDb() not called');
  return handle.sql;
}

/** Returns the test schema name. Mostly useful for diagnostic logging. */
export function getIntegrationSchema(): string {
  if (!handle) throw new Error('integration-db: setupIntegrationDb() not called');
  return handle.schema;
}

/**
 * Drop the schema and close all connections. Also closes the API's lazy
 * `db()` singleton so the next test file gets a fresh client.
 */
export async function teardownIntegrationDb(): Promise<void> {
  if (!handle) return;
  const { sql, schema } = handle;
  try {
    await sql.unsafe(`drop schema if exists "${schema}" cascade`);
  } finally {
    await sql.end({ timeout: 5 });
    try {
      const { closeDb } = await import('../db/client');
      await closeDb();
    } catch {
      // closeDb may not exist on older revisions — ignore.
    }
    handle = null;
  }
}
