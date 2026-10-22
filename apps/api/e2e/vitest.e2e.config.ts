import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * End-to-end "every field" checks against the LIVE database, safely:
 * each e2e file runs the whole API inside ONE transaction that is always
 * rolled back (see efiling.e2e.ts), so nothing is left behind.
 *
 *   pnpm --filter @lexdraft/api exec vitest run --config e2e/vitest.e2e.config.ts
 *
 * Needs the dev web app on http://localhost:5173 (pnpm dev) for the browser part.
 */
function loadDotEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return out;
}

export default defineConfig({
  test: {
    environment: 'node',
    root: resolve(__dirname, '..'),
    include: ['e2e/**/*.e2e.ts'],
    testTimeout: 15 * 60_000,
    hookTimeout: 2 * 60_000,
    fileParallelism: false,
    // One browser drives ~30 full page loads per run; lift the per-IP and
    // per-user limits for the test API instance only.
    env: { ...loadDotEnv(resolve(__dirname, '..', '.env')), NODE_ENV: 'test', API_IP_RATE_LIMIT: '100000', WRITE_RATE_LIMIT: '100000' },
  },
});
