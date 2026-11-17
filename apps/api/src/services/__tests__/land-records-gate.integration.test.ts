/**
 * Land Records for TN advocates only, against real Postgres. Tests map to the
 * acceptance criteria (AC#) in build-docs/features/land-records-tn-gate.md.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { assertLandAccess, landAccessFor } from '../../lib/land-access';
import { landRecordsAdmin } from '../land-records-admin.service';

const admin = { id: '', email: 'owner@example.test' };
let firmId: string;
let userId: string;
const setState = (s: string | null) => getIntegrationSql()`update users set state = ${s} where id = ${userId}::uuid`;

beforeEach(async () => {
  const sql = getIntegrationSql();
  await sql`delete from platform_settings where key = 'land_records'`;
  if (!admin.id) admin.id = (await seedUser((await seedFirm('Admin', 'Firm')).id)).id;
  firmId = (await seedFirm('Land firm', 'Solo')).id;
  userId = (await seedUser(firmId)).id;
});

describe('land records gate', () => {
  it('AC1/AC2 no state → state_required; Tamil Nadu → available', async () => {
    expect(await landAccessFor(userId)).toEqual({ status: 'state_required', state: null });
    await expect(assertLandAccess(userId)).rejects.toMatchObject({ status: 403, code: 'state_required' });
    await setState('Tamil Nadu');
    expect((await landAccessFor(userId)).status).toBe('available');
    await expect(assertLandAccess(userId)).resolves.toBeUndefined();
  });

  it('AC3 another state → coming soon, message names the state', async () => {
    await setState('Karnataka');
    await expect(assertLandAccess(userId)).rejects.toMatchObject({ status: 403, code: 'land_records_coming_soon', message: expect.stringMatching(/Karnataka is coming soon/) });
  });

  it('AC4 platform off blocks a TN advocate, firm override on cannot bypass it', async () => {
    await setState('Tamil Nadu');
    await landRecordsAdmin.setEnabled(false, admin);
    expect(await landRecordsAdmin.enabled()).toBe(false);
    await landRecordsAdmin.setFirm(firmId, 'on', admin);
    await expect(assertLandAccess(userId)).rejects.toMatchObject({ code: 'land_records_disabled' });
    await landRecordsAdmin.setEnabled(true, admin);
    await expect(assertLandAccess(userId)).resolves.toBeUndefined();
  });

  it('AC5 firm override on gives access to a non-TN firm; off blocks a TN firm; null follows the rules', async () => {
    await setState('Kerala');
    await landRecordsAdmin.setFirm(firmId, 'on', admin);
    expect((await landAccessFor(userId)).status).toBe('available');
    await setState('Tamil Nadu');
    await landRecordsAdmin.setFirm(firmId, 'off', admin);
    expect((await landAccessFor(userId)).status).toBe('disabled');
    await landRecordsAdmin.setFirm(firmId, null, admin);
    expect((await landAccessFor(userId)).status).toBe('available');
    expect(await landRecordsAdmin.setFirm('00000000-0000-0000-0000-000000000000', 'on', admin)).toBe(false);
  });

  it('AC6 switch and override changes are audited', async () => {
    await landRecordsAdmin.setEnabled(false, admin);
    await landRecordsAdmin.setFirm(firmId, 'off', admin);
    const rows = await getIntegrationSql()`select action from audit_log
      where (action = 'platform.land_records.set') or (action = 'firm.land_records.set' and target_id = ${firmId})`;
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['platform.land_records.set', 'firm.land_records.set']));
  });
});
