/**
 * credits-not-pages.md against real Postgres: the estimate checked before
 * drafting (AC1) and the low-credit warnings (AC5). WhatsApp is mocked.
 */
import { vi } from 'vitest';

vi.hoisted(() => { process.env.WHATSAPP_CREDITS_TEMPLATE = 'difai_credits_low'; });
const wa = vi.hoisted(() => ({ calls: [] as Array<{ template: string; params: Record<string, string> }> }));
vi.mock('../whatsapp.service', () => ({
  whatsappService: {
    sendOtp: async () => undefined,
    sendTemplate: async (_p: string, template: string, params: Record<string, string>) => { wa.calls.push({ template, params }); },
  },
}));

import { beforeEach, describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { creditAlerts, lowLevel } from '../credit-alerts.service';
import { creditService } from '../credit.service';

let firmId: string;
let ownerId: string;

beforeEach(async () => {
  wa.calls.length = 0;
  const sql = getIntegrationSql();
  firmId = (await seedFirm('Est firm', 'Solo')).id;
  ownerId = (await seedUser(firmId, { role: 'Solo Advocate' })).id;
  await sql`update users set phone = '+918754200001', status = 'active' where id = ${ownerId}::uuid`;
  await sql`update firms set plan_status = 'active', selected_plan = 'advocate', seats = 1, free_plan = false,
    renews_at = now() + interval '20 days' where id = ${firmId}::uuid`;
  await creditService.balance(firmId); // 150
});

const setLeft = (n: number) => getIntegrationSql()`update credit_grants set remaining = ${n} where firm_id = ${firmId}::uuid and source = 'plan'`;

describe('AC1 estimate before drafting', () => {
  it('median of that document type; falls back to all drafts, then 2; at least 1', async () => {
    const sql = getIntegrationSql();
    await sql`delete from metered_drafts`;
    expect(await creditService.draftEstimate('Legal Notice')).toBe(2); // no history
    for (const [k, n] of [['a', 3], ['b', 4], ['c', 9]] as const) {
      await sql`insert into metered_drafts (ref_key, firm_id, needed, paid) values (${`intake:${k}:Plaint`}, ${firmId}::uuid, ${n}, ${n})`;
    }
    await sql`insert into metered_drafts (ref_key, firm_id, needed, paid) values ('intake:z:Legal Notice', ${firmId}::uuid, 1.5, 1.5)`;
    expect(await creditService.draftEstimate('Plaint')).toBe(4);
    expect(await creditService.draftEstimate('Legal Notice')).toBe(1.5);
    expect(await creditService.draftEstimate('Writ 100%_x')).toBe(3.5); // unknown type (LIKE chars escaped) -> all drafts
    expect(await creditService.draftEstimate()).toBe(3.5);
  });

  it('a pool below the estimate is refused before any AI (402 credits_exhausted)', async () => {
    const sql = getIntegrationSql();
    await sql`delete from metered_drafts`;
    await sql`insert into metered_drafts (ref_key, firm_id, needed, paid) values ('intake:q:Plaint', ${firmId}::uuid, 6, 6)`;
    await setLeft(5);
    const est = await creditService.draftEstimate('Plaint');
    await expect(creditService.assertAvailable({ firmId, userId: ownerId }, est)).rejects.toMatchObject({ status: 402, code: 'credits_exhausted' });
  });
});

describe('AC5 low-credit warnings', () => {
  it('levels: <= 20% of the allowance, and 0', () => {
    expect(lowLevel(31, 150)).toBeNull();
    expect(lowLevel(30, 150)).toBe('20');
    expect(lowLevel(0.5, 150)).toBe('20');
    expect(lowLevel(0, 150)).toBe('0');
    expect(lowLevel(5, 0)).toBeNull(); // no allowance (packs only): warn at 0 only
  });

  it('crossing 20% then reaching 0: one bell + one WhatsApp each, never repeated in the month', async () => {
    await setLeft(29);
    expect(await creditAlerts.check(firmId)).toBe('20');
    expect(await creditAlerts.check(firmId)).toBeNull();
    await setLeft(0);
    expect(await creditAlerts.check(firmId)).toBe('0');
    expect(await creditAlerts.check(firmId)).toBeNull();
    expect(wa.calls.map((c) => c.params.credits_left)).toEqual(['29', '0']);
    expect(wa.calls.every((c) => c.template === 'difai_credits_low')).toBe(true);
    const notes = await getIntegrationSql()`select title from notifications where user_id = ${ownerId}::uuid and dedupe_key like 'credits-low:%'`;
    expect(notes).toHaveLength(2);
  });

  it('above 20%: nothing', async () => {
    expect(await creditAlerts.check(firmId)).toBeNull();
    expect(wa.calls).toHaveLength(0);
  });
});
