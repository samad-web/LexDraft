/** formats-page AC1 (owner 2026-11-18): "Formats" is its own sidebar item under Draft & AI. */
import { describe, expect, it } from 'vitest';
import { ROUTE_TITLES, visibleNavGroups } from '../nav-config';

const item = (features: string[]) => visibleNavGroups(features).flatMap((g) => g.items).find((i) => i.id === 'formats');

describe('Formats in the sidebar', () => {
  it('AC1: shown to anyone who can draft, after Clause Bank, linking to /app/formats', () => {
    expect(item(['drafting.ai'])).toMatchObject({ label: 'Formats', to: '/app/formats' });
    const ids = visibleNavGroups(['drafting.ai', 'drafting.clauses']).find((g) => g.title === 'Draft & AI')!.items.map((i) => i.id);
    expect(ids.indexOf('formats')).toBe(ids.indexOf('clauses') + 1);
    expect(ROUTE_TITLES.formats?.title).toBe('Formats');
  });
  it('AC1: hidden without drafting (the API refuses the library too)', () => {
    expect(item(['matter.view'])).toBeUndefined();
  });
});
