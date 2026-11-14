/**
 * Munshi role (migration 0110) against real Postgres: the clerk's access and
 * no AI, through the real permission resolver and credit service.
 */
import { describe, expect, it } from 'vitest';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { invalidatePermissionsCache, resolveFeatures } from '../permissions.service';
import { creditService } from '../credit.service';

describe('Munshi = the advocate\'s clerk, no AI', () => {
  it('diary / hearings / eFiling / documents yes; AI drafting, mock arguments, matter intelligence no; AI charges refused', async () => {
    const firm = await seedFirm('Munshi Firm', 'Practice');
    await getIntegrationSql()`update firms set plan_status = 'active', selected_plan = 'associates', seats = 2, munshi_seats = 1 where id = ${firm.id}::uuid`;
    const munshi = await seedUser(firm.id, { role: 'Munshi', systemRole: 'Munshi' });
    const advocate = await seedUser(firm.id, { role: 'Associate', systemRole: 'Associate' });
    invalidatePermissionsCache();
    const m = new Set((await resolveFeatures(munshi.id)).features);
    for (const k of ['matter.view', 'matter.create', 'client.view', 'drafting.basic']) expect(m.has(k as never)).toBe(true);
    for (const k of ['drafting.ai', 'mock_arguments.use', 'matter.intelligence', 'research.basic']) expect(m.has(k as never)).toBe(false);
    // An advocate in the same firm keeps AI.
    expect(new Set((await resolveFeatures(advocate.id)).features).has('drafting.ai' as never)).toBe(true);

    await expect(creditService.charge({ firmId: firm.id, userId: munshi.id }, 'matter_chat', 0.5)).rejects.toMatchObject({ status: 403, code: 'munshi_no_ai' });
    await expect(creditService.charge({ firmId: firm.id, userId: advocate.id }, 'matter_chat', 0.5)).resolves.toBeDefined();
  });
});
