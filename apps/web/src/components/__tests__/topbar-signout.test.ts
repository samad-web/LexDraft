import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('topbar sign out', () => {
  const topbar = src('components/shell/Topbar.tsx');

  it('has a labelled sign-out button after the notifications bell', () => {
    expect(topbar).toMatch(/aria-label="Sign out"/);
    expect(topbar).toContain('<Icon name="logout" />');
    expect(topbar.indexOf('aria-label="Sign out"')).toBeGreaterThan(topbar.indexOf('<Icon name="bell" />'));
  });

  it('asks before signing out, then uses the shared sign-out', () => {
    expect(topbar).toContain("confirm({ title: 'Sign out of DifAi?'");
    expect(topbar).toMatch(/\)\) signOut\(\);/);
    expect(topbar).toContain("import { useSignOut } from '@/hooks/useAuth';");
    expect(src('main.tsx')).toContain('<ConfirmProvider>');
  });
});
