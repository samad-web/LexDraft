/** coming-soon (owner 2026-11-18): eFiling, Clause Bank, Matter Intelligence,
 *  Title Reports and Mock Arguments show a SOON badge. */
import { describe, expect, it } from 'vitest';
import { visibleNavGroups } from '../nav-config';
import { waLink } from '../../HandOffCaseModal';

const ALL = ['matter.view', 'drafting.clauses', 'matter.intelligence', 'title_report.use', 'mock_arguments.use', 'drafting.ai'];
const badge = (id: string) => visibleNavGroups(ALL, 'Firm').flatMap((g) => g.items).find((i) => i.id === id)?.badge;

describe('Coming soon in the sidebar', () => {
  it('AC1: the five items carry SOON (replacing AI)', () => {
    for (const id of ['efiling', 'clauses', 'matter-intel', 'title-reports', 'mock-arguments']) expect(badge(id)).toBe('SOON');
  });
  it('AC1: live features keep their badge', () => {
    expect(badge('draft')).toBe('AI');
    expect(badge('formats')).toBeUndefined();
  });
});

describe('co-counsel: Send on WhatsApp', () => {
  it('AC2: opens WhatsApp to the bound number with the link typed in', () => {
    const u = waLink('+91 98765 43210', 'Ravi v. State', 'https://difai.sirahdigital.in/co-counsel/accept/tok');
    expect(u).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(decodeURIComponent(u!.split('text=')[1]!)).toContain('"Ravi v. State"');
    expect(decodeURIComponent(u!.split('text=')[1]!)).toContain('https://difai.sirahdigital.in/co-counsel/accept/tok');
  });
  it('AC2: a bare 10-digit number gets +91; no number -> no button', () => {
    expect(waLink('9876543210', undefined, 'u')).toMatch(/wa\.me\/919876543210\?/);
    expect(waLink(null, undefined, 'u')).toBeNull();
  });
});
