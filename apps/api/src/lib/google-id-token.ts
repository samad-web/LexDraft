/**
 * Verifies a Google Identity Services ID token (the `credential` the "Sign in
 * with Google" button hands the browser) without pulling in
 * google-auth-library: fetch Google's JWKS, turn the matching JWK into a
 * KeyObject, and let jsonwebtoken check signature, issuer, audience and expiry.
 */
import { createPublicKey, type JsonWebKey, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../env';
import { HttpError, UnauthorizedError } from './errors';

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS: [string, string] = ['accounts.google.com', 'https://accounts.google.com'];

type Jwk = JsonWebKey & { kid: string };

let keyCache: { keys: Map<string, KeyObject>; expiresAt: number } | null = null;

async function loadKeys(force = false): Promise<Map<string, KeyObject>> {
  if (!force && keyCache && keyCache.expiresAt > Date.now()) return keyCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new HttpError(503, 'Could not reach Google to verify sign-in. Try again.');
  const body = (await res.json()) as { keys: Jwk[] };
  const keys = new Map<string, KeyObject>();
  for (const k of body.keys) keys.set(k.kid, createPublicKey({ key: k, format: 'jwk' }));
  // Honour Cache-Control max-age (Google rotates keys roughly daily).
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  keyCache = { keys, expiresAt: Date.now() + maxAge * 1000 };
  return keys;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (env.googleClientIds.length === 0) {
    throw new HttpError(503, 'Google sign-in is not configured on this server.');
  }
  const decoded = jwt.decode(idToken, { complete: true });
  const kid = decoded && typeof decoded === 'object' ? decoded.header.kid : undefined;
  if (!kid) throw new UnauthorizedError('Invalid Google credential');

  let key = (await loadKeys()).get(kid);
  if (!key) key = (await loadKeys(true)).get(kid);
  if (!key) throw new UnauthorizedError('Invalid Google credential');

  let claims: jwt.JwtPayload;
  try {
    claims = jwt.verify(idToken, key, {
      algorithms: ['RS256'],
      issuer: ISSUERS,
      audience: env.googleClientIds as [string, ...string[]],
    }) as jwt.JwtPayload;
  } catch {
    throw new UnauthorizedError('Google sign-in expired or was invalid. Try again.');
  }

  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  if (!claims.sub || !email || claims.email_verified !== true) {
    throw new UnauthorizedError('Your Google account email is not verified.');
  }
  return {
    sub: claims.sub,
    email,
    name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : email.split('@')[0]!,
    picture: typeof claims.picture === 'string' ? claims.picture : undefined,
  };
}
