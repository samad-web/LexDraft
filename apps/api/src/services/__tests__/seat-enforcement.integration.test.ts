/**
 * features/seat-enforcement.md: "Add member", role changes and re-activation
 * respect the advocate and Munshi seats paid for, like email invitations.
 */
import { describe, expect, it } from 'vitest';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { firmAdminService } from '../firm-admin.service';
import { creditService } from '../credit.service';
import { invalidatePermissionsCache } from '../permissions.service';

const sql = () => getIntegrationSql();
const roleId = async (name: string) =>
  (await sql()<{ id: string }[]>`select id from roles where firm_id is null and is_system and name = ${name} limit 1`)[0]!.id;
const seatErr = { status: 402, code: 'seat_cap_exceeded' };

describe('paid seats on direct member management', () => {
  it('AC1-AC7: add member, advocate<->Munshi switch and re-activation stay within paid seats', async () => {
    const firm = await seedFirm(`Seats ${Date.now()}`, 'Practice');
    await sql()`update firms set plan_status = 'active', selected_plan = 'associates', seats = 2, munshi_seats = 1, renews_at = now() + interval '20 days' where id = ${firm.id}::uuid`;
    const owner = await seedUser(firm.id, { role: 'Managing Partner', systemRole: 'Firm Admin' });
    const actor = { id: owner.id, email: owner.email };
    const [assoc, munshi] = [await roleId('Associate'), await roleId('Munshi')];
    const mail = (k: string) => `${k}-${Date.now()}@seats.integration.test`;

    // AC1: second advocate fits (2 of 2); a third is refused.
    const a1 = await firmAdminService.createUser(owner.id, { email: mail('a1'), roleId: assoc, password: 'longenough1' }, actor);
    await expect(firmAdminService.createUser(owner.id, { email: mail('a2'), roleId: assoc, password: 'longenough1' }, actor)).rejects.toMatchObject(seatErr);

    // AC2: a Munshi fits the Munshi seat; a second Munshi does not.
    const m1 = await firmAdminService.createUser(owner.id, { email: mail('m1'), roleId: munshi, password: 'longenough1' }, actor);
    await expect(firmAdminService.createUser(owner.id, { email: mail('m2'), roleId: munshi, password: 'longenough1' }, actor)).rejects.toMatchObject(seatErr);

    // AC3: turning the Munshi into an advocate needs an advocate seat (none free).
    await expect(firmAdminService.updateUser(owner.id, m1.user.id, { roleId: assoc }, actor)).rejects.toMatchObject(seatErr);

    // AC4: after an advocate leaves, the switch works and users.role follows,
    // so the Munshi no-AI rule no longer applies to them.
    await firmAdminService.updateUser(owner.id, a1.user.id, { status: 'deactivated' }, actor);
    await firmAdminService.updateUser(owner.id, m1.user.id, { roleId: assoc }, actor);
    const [r] = await sql()<{ role: string }[]>`select role from users where id = ${m1.user.id}::uuid`;
    expect(r!.role).toBe('Associate');

    // AC5: re-activating the old advocate would make 3 advocates on 2 seats.
    await expect(firmAdminService.updateUser(owner.id, a1.user.id, { status: 'active' }, actor)).rejects.toMatchObject(seatErr);

    // AC6: advocate -> Munshi sets role text, so AI charges are refused.
    await firmAdminService.updateUser(owner.id, m1.user.id, { roleId: munshi }, actor);
    invalidatePermissionsCache();
    await expect(creditService.charge({ firmId: firm.id, userId: m1.user.id }, 'matter_chat', 0.5)).rejects.toMatchObject({ code: 'munshi_no_ai' });

    // AC7: a role from outside the firm is refused.
    await expect(firmAdminService.updateUser(owner.id, m1.user.id, { roleId: '00000000-0000-4000-8000-000000000000' }, actor)).rejects.toMatchObject({ status: 404 });
  });
});
