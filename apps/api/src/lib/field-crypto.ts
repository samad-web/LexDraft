import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { env } from '../env';

// Field-level encryption for PII columns that must not sit in Postgres as
// plaintext (esign_signers.name/email/signed_ip, clients.email). AES-256-GCM
// via a single app-wide key (FIELD_ENCRYPTION_KEY) - no per-firm keys, no
// KMS, matching the same trust model as JWT_SECRET/STORAGE_SIGNING_SECRET
// already in this codebase. See the encryption-at-rest plan for why a wider
// scope (clients.name, drafts, case_notes, chat) was deferred.
//
// Storage format (one string, fits the existing `text` column as-is):
//   v1:<iv_base64>:<tag_base64>:<ciphertext_base64>
// The `v1:` prefix is what makes a phased rollout safe: decryptField treats
// any string WITHOUT that prefix as legacy plaintext and returns it
// untouched, so app code can deploy before the backfill script runs without
// a cutover window, and old rows keep reading correctly until backfilled.

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function requireKey(): Buffer {
  if (!env.fieldEncryptionKey) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY is not configured - cannot encrypt/decrypt PII columns',
    );
  }
  return env.fieldEncryptionKey;
}

export function encryptField(plain: string): string {
  const key = requireKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Null/empty-safe - nullable columns (email, signed_ip) pass straight through. */
export function decryptField(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return value ?? null;
  if (!value.startsWith('v1:')) return value; // legacy plaintext, pre-backfill
  const parts = value.split(':');
  if (parts.length !== 4) {
    throw new Error('Malformed encrypted field value (expected v1:<iv>:<tag>:<ciphertext>)');
  }
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const key = requireKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString('utf8');
}

/**
 * Deterministic blind index for exact-match lookup (e.g. portal login by
 * email) against an encrypted column, where the ciphertext itself can never
 * be compared at the SQL level (fresh IV every call makes it non-repeating).
 * HMAC-SHA256 keyed by the SAME field-encryption key so there is still only
 * one secret to manage; this is a one-way digest, never decrypted.
 */
export function hmacEmailLookup(email: string): string {
  const key = requireKey();
  return createHmac('sha256', key).update(email.trim().toLowerCase()).digest('hex');
}
