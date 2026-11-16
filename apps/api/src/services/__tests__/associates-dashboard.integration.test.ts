/**
 * Migration 0112: the Associates plan (Practice tier) includes the firm
 * dashboard, as its plan card says. Plan AND role must grant it.
 */
import { describe, expect, it } from 'vitest';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { invalidatePermissionsCache, resolveFeatures } from '../permissions.service';

const has = async (id: string, key: string) => new Set((await resolveFeatures(id)).features).has(key as never);

describe('Associates plan: firm dashboard', () => {
  it('Associates owner (Firm Admin) sees the firm dashboard; an Associate and a Munshi do not', async () => {
    const firm = await seedFirm('Associates Dash', 'Practice');
    const owner = await seedUser(firm.id, { role: 'Managing Partner', systemRole: 'Firm Admin' });
    const associate = await seedUser(firm.id, { role: 'Associate', systemRole: 'Associate' });
    const munshi = await seedUser(firm.id, { role: 'Munshi', systemRole: 'Munshi' });
    invalidatePermissionsCache();
    expect(await has(owner.id, 'firm.dashboard.view')).toBe(true);
    expect(await has(associate.id, 'firm.dashboard.view')).toBe(false);
    expect(await has(munshi.id, 'firm.dashboard.view')).toBe(false);
    // Pricing v5 (0113): analytics on every plan, for the owner; never a Munshi.
    expect(await has(owner.id, 'analytics.firm')).toBe(true);
    expect(await has(munshi.id, 'analytics.firm')).toBe(false);
  });

  it('Solo plans (Sanad/Vakalat/Brief) still have no firm dashboard', async () => {
    const firm = await seedFirm('Solo Dash', 'Solo');
    const owner = await seedUser(firm.id, { role: 'Solo Advocate', systemRole: 'Solo Advocate' });
    invalidatePermissionsCache();
    expect(await has(owner.id, 'firm.dashboard.view')).toBe(false);
  });
});
