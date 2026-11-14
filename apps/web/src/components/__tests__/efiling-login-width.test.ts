import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('eFiling sign-in fits the page', () => {
  it('the sign-in card spans the content column (no 760px cap, not centred)', () => {
    const panel = src('components/efiling/PortalLoginPanel.tsx');
    const card = panel.slice(panel.indexOf('aria-label="Sign In"'), panel.indexOf('aria-label="Sign In"') + 200);
    expect(card).toContain("width: '100%'");
    expect(card).not.toContain('maxWidth');
    expect(card).not.toContain("margin: '0 auto'");
  });

  it('the eFiling page wrappers are not capped at 1240px', () => {
    const view = src('views/EfilingView.tsx');
    expect(view).not.toContain('maxWidth: 1240');
    expect(view.match(/<div className="col efiling" style=\{\{ gap: 20 \}\}/g)?.length).toBe(2);
  });
});
