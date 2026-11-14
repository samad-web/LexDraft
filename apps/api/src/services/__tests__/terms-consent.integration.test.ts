/**
 * Terms + Privacy consent (features/terms-consent.md AC2, AC3), real Postgres
 * in the throwaway integration schema.
 */
import { describe, expect, it } from 'vitest';
import { authService } from '../auth.service';
import { dpdpService } from '../dpdp.service';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { TERMS_CONSENT_TYPE, TERMS_VERSION } from '../../lib/legal';

const meta = { ip: '203.0.113.7', userAgent: 'vitest' };

describe('terms consent', () => {
  it('AC2: sign-up records a granted row (version, IP) and the user is not asked again', async () => {
    const email = `terms-${Date.now()}@integration.test`;
    const { user } = await authService.signUp({ email, password: 'longenough1', name: 'Terms Test', role: 'solo', acceptTerms: true }, meta);
    expect(user.needsTermsAcceptance).toBeUndefined();

    const sql = getIntegrationSql();
    const rows = await sql<Array<{ consent_type: string; consent_version: string; granted: boolean; ip: string; user_agent: string; firm_id: string | null }>>`
      select consent_type, consent_version, granted, ip, user_agent, firm_id from consent_log where user_id = ${user.id}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ consent_type: TERMS_CONSENT_TYPE, consent_version: TERMS_VERSION, granted: true, ip: meta.ip, user_agent: 'vitest' });
    expect(rows[0]!.firm_id).toBeTruthy();
    expect((await authService.getById(user.id))?.needsTermsAcceptance).toBeUndefined();
  });

  it('AC3: no row → asked; agree clears it; a later disagree asks again; an old version does not count', async () => {
    const email = `terms-gate-${Date.now()}@integration.test`;
    const { user } = await authService.signUp({ email, password: 'longenough1', name: 'Gate Test', role: 'solo' });
    const sql = getIntegrationSql();
    await sql`delete from consent_log where user_id = ${user.id}::uuid`;
    expect((await authService.getById(user.id))?.needsTermsAcceptance).toBe(true);

    const record = (consentVersion: string, granted: boolean) =>
      dpdpService.recordConsent({ userId: user.id, firmId: null, consentType: TERMS_CONSENT_TYPE, consentVersion, granted, ip: meta.ip, userAgent: 'vitest' });

    await record('1.0', true);
    expect((await authService.getById(user.id))?.needsTermsAcceptance).toBe(true);

    await record(TERMS_VERSION, true);
    expect((await authService.getById(user.id))?.needsTermsAcceptance).toBeUndefined();

    await new Promise((r) => setTimeout(r, 5));
    await record(TERMS_VERSION, false);
    expect((await authService.getById(user.id))?.needsTermsAcceptance).toBe(true);
  });
});
