import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../../env';
import { verifyGoogleIdToken } from '../google-id-token';
import { normalizePhone } from '../../services/phone-otp.service';

describe('normalizePhone', () => {
  it('adds +91 to a bare Indian mobile', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('09876543210')).toBe('+919876543210');
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });
  it('keeps an E.164 number', () => {
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
  });
  it('rejects junk', () => {
    expect(() => normalizePhone('12345')).toThrow();
    expect(() => normalizePhone('abcdefghij')).toThrow();
  });
});

describe('verifyGoogleIdToken', () => {
  const CLIENT_ID = 'test-client.apps.googleusercontent.com';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const sign = (claims: Record<string, unknown>, aud = CLIENT_ID) =>
    jwt.sign(claims, privateKey, { algorithm: 'RS256', keyid: 'k1', issuer: 'https://accounts.google.com', audience: aud, expiresIn: '5m' });

  beforeAll(() => {
    env.googleClientIds.push(CLIENT_ID);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), {
      headers: { 'cache-control': 'max-age=60' },
    })));
  });
  afterAll(() => {
    env.googleClientIds.length = 0;
    vi.unstubAllGlobals();
  });

  it('accepts a valid token and lower-cases the email', async () => {
    const id = await verifyGoogleIdToken(sign({ sub: 'g-1', email: 'Asha@Example.com', email_verified: true, name: 'Asha Rao' }));
    expect(id).toEqual({ sub: 'g-1', email: 'asha@example.com', name: 'Asha Rao', picture: undefined });
  });

  it('rejects a token for another client id', async () => {
    await expect(verifyGoogleIdToken(sign({ sub: 'g-1', email: 'a@b.com', email_verified: true }, 'other-client'))).rejects.toThrow();
  });

  it('rejects an unverified email', async () => {
    await expect(verifyGoogleIdToken(sign({ sub: 'g-1', email: 'a@b.com', email_verified: false }))).rejects.toThrow(/not verified/);
  });

  it('rejects a token signed by a different key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const forged = jwt.sign({ sub: 'g-1', email: 'a@b.com', email_verified: true }, other, {
      algorithm: 'RS256', keyid: 'k1', issuer: 'https://accounts.google.com', audience: CLIENT_ID,
    });
    await expect(verifyGoogleIdToken(forged)).rejects.toThrow();
  });
});
