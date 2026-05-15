/**
 * Integration-test setup file.
 *
 * Vitest invokes this once per test FILE before that file's top-level imports
 * resolve. We:
 *
 *   1. Seed the safety env (JWT_SECRET et al) the way the unit setup does,
 *      so the env module passes its zod schema.
 *
 *   2. SYNCHRONOUSLY rewrite `DATABASE_URL` to point at a freshly-generated
 *      ephemeral schema name. This MUST happen before the test file's top
 *      imports run - otherwise `env.ts` reads `DATABASE_URL=''` once at
 *      load time, sets `env.hasDatabase = false` forever, and every service
 *      under test falls back to in-memory mode. The schema doesn't exist
 *      yet at this point - that's fine because `db()` only actually
 *      connects when a service method is called, and that doesn't happen
 *      until `beforeAll` provisions the schema.
 *
 *   3. In `beforeAll`, actually CREATE the schema and apply migrations.
 *
 *   4. In `afterAll`, drop the schema + close pooled clients.
 *
 * Fail-fast: this file throws synchronously if `TEST_DATABASE_URL` is
 * missing, so the suite fails the very first hook rather than silently
 * exercising the in-memory fallback.
 */

import crypto from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';
import { setupIntegrationDb, teardownIntegrationDb } from './integration-db';

// Match the unit-test setup's env contract so env.ts validates successfully
// the moment any service module is imported by a test file.
process.env['NODE_ENV'] = 'test';
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] || 'test-secret-32-bytes-minimum-aaaaaaaa';
process.env['STORAGE_DRIVER'] = process.env['STORAGE_DRIVER'] || 'local';
process.env['STORAGE_LOCAL_DIR'] = process.env['STORAGE_LOCAL_DIR'] || './.test-uploads';
process.env['STORAGE_PUBLIC_BASE_URL'] = process.env['STORAGE_PUBLIC_BASE_URL'] || 'http://localhost:4000';
process.env['STORAGE_SIGNING_SECRET'] = process.env['STORAGE_SIGNING_SECRET'] || 'storage-test-secret-32-bytes-min-x';
process.env['DEV_AUTH_AUTO_PROVISION'] = process.env['DEV_AUTH_AUTO_PROVISION'] || 'true';
process.env['DATABASE_SSL'] = process.env['DATABASE_SSL'] || 'false';

// Fail loudly if TEST_DATABASE_URL is missing - better here than 10 lines
// of confusing "schema does not exist" errors later.
const TEST_URL = process.env['TEST_DATABASE_URL'] ?? '';
if (!TEST_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require a live Postgres. '
    + 'See apps/api/INTEGRATION_TESTS.md for the Docker one-liner.',
  );
}

function appendSearchPath(url: string, schema: string): string {
  const value = `${schema},public`;
  if (url.includes('?')) {
    if (/[?&]search_path=/.test(url)) {
      return url.replace(/([?&])search_path=[^&]*/i, `$1search_path=${value}`);
    }
    return `${url}&search_path=${value}`;
  }
  return `${url}?search_path=${value}`;
}

// Generate the schema name SYNCHRONOUSLY so we can write the URL into
// process.env BEFORE the test file's static imports trigger `env.ts` to
// read DATABASE_URL. The actual `create schema` runs in `beforeAll`, by
// which time `db()` won't have been called yet (services only connect
// when their methods are invoked from a test body).
const SCHEMA = `test_${crypto.randomBytes(3).toString('hex')}`;
process.env['INTEGRATION_TEST_SCHEMA'] = SCHEMA;
process.env['DATABASE_URL'] = appendSearchPath(TEST_URL, SCHEMA);

beforeAll(async () => {
  await setupIntegrationDb();
}, 60_000);

afterAll(async () => {
  await teardownIntegrationDb();
}, 30_000);
