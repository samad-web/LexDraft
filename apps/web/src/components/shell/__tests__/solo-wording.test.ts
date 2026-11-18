/** solo-wording (owner 2026-11-18): a Solo (Advocate plan) account never sees
 *  "Firm" in the sidebar/breadcrumbs, and no Team Chat without a Munshi. */
import { describe, expect, it } from 'vitest';
import { locateInNav, orgSectionTitle, visibleNavGroups } from '../nav-config';

const F = ['team.messaging', 'analytics.firm', 'matter.view'];
const titles = (plan: 'Solo' | 'Practice' | 'Firm', hasTeam = false) => visibleNavGroups(F, plan, { hasTeam }).map((g) => g.title);
const ids = (plan: 'Solo' | 'Practice' | 'Firm', hasTeam = false) => visibleNavGroups(F, plan, { hasTeam }).flatMap((g) => g.items.map((i) => i.id));

describe('org section named after the plan', () => {
  it('AC1: Solo -> "Practice", never "Firm" (sidebar and breadcrumb)', () => {
    expect(orgSectionTitle('Solo')).toBe('Practice');
    expect(titles('Solo')).toContain('Practice');
    expect(titles('Solo')).not.toContain('Firm');
    expect(locateInNav(visibleNavGroups(F, 'Solo'), '/app/settings')?.group.title).toBe('Practice');
  });
  it('AC2: Practice plan -> "Chambers"; Firm plan -> "Firm"', () => {
    expect(titles('Practice')).toContain('Chambers');
    expect(titles('Firm')).toContain('Firm');
  });
});

describe('Team Chat on Solo', () => {
  it('AC3: hidden on Solo without a Munshi seat', () => expect(ids('Solo')).not.toContain('team-chat'));
  it('AC3: shown on Solo with a Munshi seat, and always on team plans', () => {
    expect(ids('Solo', true)).toContain('team-chat');
    expect(ids('Practice')).toContain('team-chat');
    expect(ids('Firm')).toContain('team-chat');
  });
});
