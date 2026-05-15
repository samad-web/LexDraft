import { defineConfig } from 'vitest/config';

/**
 * Integration vitest config - runs the *.integration.test.ts suite against a
 * real Postgres pointed at by `TEST_DATABASE_URL`. Each test file gets its
 * own ephemeral schema (created by `integration-setup.ts` in beforeAll and
 * dropped in afterAll), so files can run in parallel without colliding on
 * the same tables.
 *
 * Invoked via `pnpm --filter @lexdraft/api test:integration`.
 *
 * Sequential `fileParallelism: false` is deliberate - the postgres-js client
 * created per test file holds a small pool, and most CI Postgres containers
 * cap at ~100 connections. Serializing test files (still parallel WITHIN a
 * file via vitest's default concurrency) keeps connection counts predictable
 * and makes failure output easier to read.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.integration.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    setupFiles: ['./src/__tests__/integration-setup.ts'],
    // Integration tests do a lot of round-trips; default 5s is tight.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
