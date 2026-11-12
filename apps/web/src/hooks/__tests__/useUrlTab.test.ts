import { describe, expect, it } from 'vitest';
import { tabFromParam } from '../useUrlTab';

const TABS = ['account', 'letterhead', 'privacy'] as const;
const tabOf = (search: string, key = 'tab') => tabFromParam(new URLSearchParams(search).get(key), TABS, 'account');

describe('useUrlTab: tab from the URL', () => {
  it('reads the active tab from ?tab= so Back and shared links land on it', () => {
    expect(tabOf('?tab=privacy')).toBe('privacy');
  });

  it('falls back to the default tab when the URL has none', () => {
    expect(tabOf('')).toBe('account');
  });

  it('ignores an unknown tab instead of showing a blank page', () => {
    expect(tabOf('?tab=billing')).toBe('account');
  });

  it('reads a custom key (Research uses ?mode=)', () => {
    expect(tabOf('?mode=letterhead&tab=privacy', 'mode')).toBe('letterhead');
  });
});
