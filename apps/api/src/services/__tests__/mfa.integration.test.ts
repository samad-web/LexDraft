/**
 * mfaService - TOTP enrolment + verification against real Postgres.
 *
 * The enrolment / verify path requires (a) the users table, (b)
 * mfa_pending_challenges, and (c) a TOTP secret derived by otplib that the
 * test can re-derive at verify-time. We use `authenticator.generate(secret)`
 * to compute the correct code for the live 30-second window.
 *
 * Backup-code path is also covered: enrolment returns 8 plaintext codes; we
 * verify one consumes correctly (returns true exactly once) then a second
 * attempt with the same code fails (single-use semantics).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { authenticator } from 'otplib';
import { mfaService } from '../mfa.service';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser, type SeededUser } from '../../__tests__/integration-fixtures';

// Mirror the service-side options so test-generated codes line up with the
// service-side verify window.
authenticator.options = { window: 1, step: 30 };

let user: SeededUser;

beforeAll(async () => {
  const firm = await seedFirm('MFA Firm');
  user = await seedUser(firm.id, {
    email: 'mfa-user@integration.test',
    systemRole: 'Firm Admin',
  });
});

describe('mfaService - enrol → confirm → verify roundtrip', () => {
  it('issues a secret + QR + challenge, and accepts a valid code', async () => {
    const start = await mfaService.enrollStart(user.id);
    expect(start.secret).toBeTruthy();
    expect(start.otpauthUrl).toContain(encodeURIComponent('LexDraft'));
    expect(start.qrCodeDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(start.challengeId).toBeTruthy();

    const code = authenticator.generate(start.secret);
    const confirm = await mfaService.enrollConfirm(user.id, start.challengeId, code);
    expect(confirm.backupCodes).toHaveLength(8);
    expect(confirm.enrolledAt).toBeTruthy();

    // After enrolment, users.totp_secret should be populated, and
    // mfa_pending_challenges row marked consumed_at.
    const sql = getIntegrationSql();
    const userRow = await sql<Array<{ totp_secret: string | null; mfa_enrolled_at: Date | null }>>`
      select totp_secret, mfa_enrolled_at from users where id = ${user.id}::uuid
    `;
    expect(userRow[0]!.totp_secret).toBeTruthy();
    expect(userRow[0]!.mfa_enrolled_at).not.toBeNull();

    const challengeRow = await sql<Array<{ consumed_at: Date | null }>>`
      select consumed_at from mfa_pending_challenges where id = ${start.challengeId}::uuid
    `;
    expect(challengeRow[0]!.consumed_at).not.toBeNull();

    // verifyTotp with a freshly-generated code succeeds.
    const verify = await mfaService.verifyTotp(user.id, authenticator.generate(start.secret));
    expect(verify).toBe(true);

    // Tamper with the code → false.
    const bad = await mfaService.verifyTotp(user.id, '000000');
    expect(bad).toBe(false);

    // Backup-code single-use semantics.
    const usedOnce = await mfaService.verifyTotp(user.id, confirm.backupCodes[0]!);
    expect(usedOnce).toBe(true);
    const usedTwice = await mfaService.verifyTotp(user.id, confirm.backupCodes[0]!);
    expect(usedTwice).toBe(false);
  });

  it('rejects a wrong code on enrollConfirm', async () => {
    const firm = await seedFirm('MFA Firm B');
    const u = await seedUser(firm.id, {
      email: 'mfa-bad-confirm@integration.test',
      systemRole: 'Firm Admin',
    });
    const start = await mfaService.enrollStart(u.id);
    await expect(
      mfaService.enrollConfirm(u.id, start.challengeId, '000000'),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a replayed challenge after consumption', async () => {
    const firm = await seedFirm('MFA Firm C');
    const u = await seedUser(firm.id, {
      email: 'mfa-replay@integration.test',
      systemRole: 'Firm Admin',
    });
    const start = await mfaService.enrollStart(u.id);
    const code = authenticator.generate(start.secret);
    await mfaService.enrollConfirm(u.id, start.challengeId, code);
    // Second call with same challengeId - must be rejected as already used.
    await expect(
      mfaService.enrollConfirm(u.id, start.challengeId, code),
    ).rejects.toMatchObject({ status: 401 });
  });
});
