import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { portalService } from '../portal.service';
import { signInForTest } from '../../__tests__/auth-test-helpers';

// These tests run against the in-memory DATABASE_URL=='' fallback. The portal
// service deliberately has no in-memory store (the production path is the
// only one worth testing); so we focus here on the JWT contract and on
// boundary behaviour that doesn't need a live DB.

describe('portalService - JWT contract', () => {
  it('rejects a tenant-user JWT as a portal token', async () => {
    const auth = await signInForTest({ email: 'tenant-user@example.com', password: 'p' });
    expect(() => portalService.verify(auth.token)).toThrow();
  });

  it('rejects a totally bogus token', () => {
    expect(() => portalService.verify('not-a-jwt')).toThrow();
  });

  it('accepts a token signed with kind:client', () => {
    // Build a portal-shaped token directly to confirm the verifier accepts
    // the right shape and rejects the wrong shape.
    process.env['JWT_SECRET'] = process.env['JWT_SECRET'] || 'test-secret-32-bytes-minimum-aaaaaaaa';
    const token = jwt.sign(
      { kind: 'client', sub: 'client-1', firmId: 'firm-1', email: 'a@b' },
      process.env['JWT_SECRET']!,
      { expiresIn: '5m' },
    );
    const claims = portalService.verify(token);
    expect(claims.kind).toBe('client');
    expect(claims.sub).toBe('client-1');
    expect(claims.firmId).toBe('firm-1');
  });
});

describe('portalService.signInWithPassword - boundary behaviour', () => {
  it('throws a 500 when the DB is not configured (demo mode)', async () => {
    // The portal sign-in path has no in-memory fallback - it requires a
    // real clients table. Test the boundary so a misconfigured deploy
    // surfaces a 500 instead of a 200 with garbage.
    await expect(
      portalService.signInWithPassword('unknown@example.com', 'whatever@123'),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe('portalService read methods - memory fallback', () => {
  it('returns empty arrays when no DB is configured', async () => {
    expect(await portalService.listCases('c', 'f')).toEqual([]);
    expect(await portalService.listHearings('c', 'f')).toEqual([]);
    expect(await portalService.listInvoices('c', 'f')).toEqual([]);
    expect(await portalService.listDocuments('c', 'f')).toEqual([]);
    expect(await portalService.clientName('c', 'f')).toBeNull();
    expect(await portalService.getDocumentStorageKey('d', 'c', 'f')).toBeNull();
  });
});
