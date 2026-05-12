import { describe, expect, it } from 'vitest';
import { authService } from '../auth.service';
import { signInForTest } from '../../__tests__/auth-test-helpers';

describe('authService — memory mode (no DATABASE_URL)', () => {
  it('auto-provisions on signIn for unknown emails', async () => {
    const res = await signInForTest({ email: 'auto@example.com', password: 'p' });
    expect(res.token).toBeTypeOf('string');
    expect(res.user.email).toBe('auto@example.com');
    expect(res.user.role).toBe('Solo Advocate');
    expect(res.user.isSuperadmin).toBe(false);
  });

  it('flags superadmin when email contains "admin"', async () => {
    const res = await signInForTest({ email: 'admin@example.com', password: 'p' });
    expect(res.user.isSuperadmin).toBe(true);
  });

  it('issues a verifiable JWT', async () => {
    const res = await signInForTest({ email: 'verify@example.com', password: 'p' });
    const claims = authService.verify(res.token);
    expect(claims.sub).toBe(res.user.id);
    expect(claims.email).toBe(res.user.email);
  });

  it('rejects re-signup for an existing email', async () => {
    const email = `dup-${Date.now()}@example.com`;
    await signInForTest({ email, password: 'p' });
    await expect(
      authService.signUp({ email, password: 'longenough', name: 'Dup', role: 'solo' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects bad password on subsequent sign-ins', async () => {
    const email = `bad-${Date.now()}@example.com`;
    await signInForTest({ email, password: 'correct-horse' });
    await expect(
      authService.signIn({ email, password: 'wrong-horse' }),
    ).rejects.toMatchObject({ status: 401 });
  });
});
