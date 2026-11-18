import { defineConfig } from '@playwright/test';

// Full UI pass over the DifAi app installed from the Play Store on a USB phone.
// Run: npx playwright test -c playwright.android.config.ts
// Needs: adb (Android SDK platform-tools), USB debugging allowed, the app
// installed. Signs in with apps/web/.env.e2e if the app is signed out.
// Drives the app through adb (uiautomator dump + input): nothing is installed
// on the phone. The app loads the LIVE site; see e2e/native/play-app.e2e.ts
// for what it writes and how it cleans up.
export default defineConfig({
  testDir: './e2e/native',
  testMatch: /\.e2e\.ts$/,
  timeout: 120_000,
  fullyParallel: false,
  workers: 1, // one phone
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-android' }]],
  outputDir: 'test-results-android',
});
