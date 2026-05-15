import { defineConfig } from 'vitest/config';

/**
 * Default vitest config - runs the fast unit suite against the in-memory
 * fallback (DATABASE_URL is left blank by `src/__tests__/setup.ts`).
 *
 * Integration tests live in a sibling file (vitest.integration.config.ts)
 * and are explicitly excluded here via the `*.integration.test.ts` glob so
 * they don't run when a developer types `pnpm test` without a Postgres
 * available.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**', 'dist/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
