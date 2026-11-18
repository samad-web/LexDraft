import { test, expect } from '@playwright/test';

// auth-card-flicker (2026-11-18): Google's button iframe briefly grows (~80px)
// while it loads or swaps to "Continue as <name>". The card must not move.
// Fake GSI: renders an 80px-tall button, then shrinks it to 40px, repeatedly.
const FAKE_GSI = `window.google = { accounts: { id: {
  initialize() {}, prompt() {}, disableAutoSelect() {}, cancel() {},
  renderButton(el) {
    const f = document.createElement('div'); f.style.width = '300px'; f.style.height = '80px'; el.appendChild(f);
    let tall = true; setInterval(() => { tall = !tall; f.style.height = tall ? '80px' : '40px'; }, 50);
  },
} } };`;

for (const url of ['/auth', '/auth?signup=1']) {
  test(`auth card stays still while the Google button resizes (${url})`, async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 728 });
    await page.route('https://accounts.google.com/gsi/client*', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_GSI }));
    await page.goto(url);
    const card = page.locator('.auth-shell');
    await expect(card).toBeVisible();
    await page.waitForTimeout(300);
    const boxes = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const b = await card.boundingBox();
      boxes.add(`${b!.x},${b!.y},${b!.width},${b!.height}`);
      await page.waitForTimeout(25);
    }
    expect([...boxes]).toHaveLength(1);
  });
}
