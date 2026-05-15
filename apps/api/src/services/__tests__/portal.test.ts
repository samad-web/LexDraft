import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { portalService } from '../portal.service';
import { authService } from '../auth.service';
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

describe('portalService.requestMagicLink - memory fallback', () => {
  it('returns ok=true even when no clients table exists (no enumeration leak)', async () => {
    const res = await portalService.requestMagicLink('unknown@example.com');
    expect(res.ok).toBe(true);
    expect(res.devMagicLink).toBeUndefined();
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
