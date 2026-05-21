/**
 * authService.signUp - real-Postgres coverage of the firm-provisioning path.
 *
 * The unit suite runs in memory mode (no DATABASE_URL) and therefore can't
 * see what `insertUserWithNewFirm` actually writes. This file exercises the
 * DB path and asserts the contract self-serve sign-up advertises:
 *
 *   - one new firm row per sign-up (no shared seed firm)
 *   - users.firm_id points at that new firm
 *   - firms.plan_tier matches the role-to-tier mapping
 *     (solo → Solo, group → Practice, firm → Firm)
 *   - firms.name uses the user-supplied value when present, otherwise the
 *     `deriveFirmName` fallback
 *   - the firm + user insert is atomic - a duplicate-email retry on the
 *     same sign-up payload does NOT leak an orphan firm
 */

import { describe, expect, it } from 'vitest';
import { authService } from '../auth.service';
import { getIntegrationSql } from '../../__tests__/integration-db';

interface FirmRow {
  id: string;
  name: string;
  plan_tier: 'Solo' | 'Practice' | 'Firm';
}

async function firmFor(userId: string): Promise<FirmRow | undefined> {
  const sql = getIntegrationSql();
  const rows = await sql<FirmRow[]>`
    select f.id, f.name, f.plan_tier
    from users u
    join firms f on f.id = u.firm_id
    where u.id = ${userId}::uuid
    limit 1
  `;
  return rows[0];
}

async function countFirmsByName(name: string): Promise<number> {
  const sql = getIntegrationSql();
  const rows = await sql<Array<{ c: string }>>`
    select count(*)::text as c from firms where name = ${name}
  `;
  return Number(rows[0]?.c ?? '0');
}

describe('authService.signUp - per-tenant firm provisioning', () => {
  it('role=solo creates a Solo-tier firm and links the user to it', async () => {
    const email = `solo-${Date.now()}@integration.test`;
    const auth = await authService.signUp({
      email,
      password: 'integration-pass-1',
      name: 'Asha Solo',
      role: 'solo',
      firm: 'Asha Chambers',
    });

    const firm = await firmFor(auth.user.id);
    expect(firm).toBeDefined();
    expect(firm!.plan_tier).toBe('Solo');
    expect(firm!.name).toBe('Asha Chambers');
    expect(auth.user.firm).toBe('Asha Chambers');
    expect(auth.user.plan).toBe('Solo');
  });

  it('role=group creates a Practice-tier firm', async () => {
    const email = `group-${Date.now()}@integration.test`;
    const auth = await authService.signUp({
      email,
      password: 'integration-pass-1',
      name: 'Ravi Lead',
      role: 'group',
      firm: 'Ravi Practice Group',
    });

    const firm = await firmFor(auth.user.id);
    expect(firm!.plan_tier).toBe('Practice');
    expect(firm!.name).toBe('Ravi Practice Group');
    expect(auth.user.plan).toBe('Practice');
  });

  it('role=firm creates a Firm-tier firm', async () => {
    const email = `firm-${Date.now()}@integration.test`;
    const auth = await authService.signUp({
      email,
      password: 'integration-pass-1',
      name: 'Meera Partner',
      role: 'firm',
      firm: 'Meera & Associates',
    });

    const firm = await firmFor(auth.user.id);
    expect(firm!.plan_tier).toBe('Firm');
    expect(firm!.name).toBe('Meera & Associates');
    expect(auth.user.plan).toBe('Firm');
  });

  it('falls back to a synthesised firm name when input.firm is omitted', async () => {
    const email = `noname-${Date.now()}@integration.test`;
    const auth = await authService.signUp({
      email,
      password: 'integration-pass-1',
      name: 'Vikram Solo',
      role: 'solo',
    });

    const firm = await firmFor(auth.user.id);
    expect(firm!.name).toBe('Vikram Solo (Solo)');
  });

  it('two sign-ups produce two distinct firms (no shared seed tenant)', async () => {
    const a = await authService.signUp({
      email: `a-${Date.now()}@integration.test`,
      password: 'integration-pass-1',
      name: 'A One',
      role: 'solo',
      firm: 'Firm A',
    });
    const b = await authService.signUp({
      email: `b-${Date.now()}@integration.test`,
      password: 'integration-pass-1',
      name: 'B Two',
      role: 'solo',
      firm: 'Firm B',
    });

    const firmA = await firmFor(a.user.id);
    const firmB = await firmFor(b.user.id);
    expect(firmA!.id).not.toBe(firmB!.id);
  });

  it('duplicate-email sign-up leaves no firm row behind', async () => {
    const email = `dup-${Date.now()}@integration.test`;
    const firmName = `Orphan Check ${Date.now()}`;

    await authService.signUp({
      email,
      password: 'integration-pass-1',
      name: 'First Signup',
      role: 'solo',
      firm: firmName,
    });
    expect(await countFirmsByName(firmName)).toBe(1);

    // Second sign-up with the SAME email rejects. Whether the duplicate is
    // caught by signUp's pre-check or by the unique(lower(email)) constraint
    // inside the firm+user transaction, the contract is the same: no second
    // firm row materialises. (The transaction guards against a real race
    // where two clients both pass the pre-check before either commits.)
    await expect(
      authService.signUp({
        email,
        password: 'integration-pass-1',
        name: 'Second Signup',
        role: 'firm',
        firm: `${firmName} (retry)`,
      }),
    ).rejects.toBeDefined();

    expect(await countFirmsByName(`${firmName} (retry)`)).toBe(0);
    expect(await countFirmsByName(firmName)).toBe(1);
  });
});
