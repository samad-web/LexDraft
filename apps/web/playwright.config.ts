import { defineConfig, devices } from '@playwright/test';
import { AUTH_FILE } from './e2e/support/env';

// Full-UI suite (build-docs/features/e2e-ui-suite.md).
// public  — signed-out pages, no backend needed.
// setup   — signs in once with the account in .env.e2e, saves the session.
// app     — every signed-in screen, real local API + local DB, AI/portals stubbed.
// mobile  — the shell at phone width.
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts$/,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // one real account + one local DB: keep writes serial
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalTeardown: './e2e/support/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'public', testMatch: /(landing|public|public-routes)\.e2e\.ts$/, use: { ...devices['Desktop Chrome'] } },
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    {
      name: 'app',
      testIgnore: [/(landing|public|public-routes|mobile)\.e2e\.ts$/, /[\\/]native[\\/]/],
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.e2e\.ts$/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], storageState: AUTH_FILE },
    },
  ],
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
