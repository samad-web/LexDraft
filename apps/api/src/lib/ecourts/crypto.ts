import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Keys + IV pool extracted from the official eCourts Services Android app
// (in.gov.ecourts.eCourtsServices v4.0). See
// memory/project_ecourts_api_reverse_engineering.md for the derivation.
const REQUEST_KEY  = Buffer.from('4D6251655468576D5A7134743677397A', 'hex'); // "MbQeThWmZq4t7w9z"
const RESPONSE_KEY = Buffer.from('3273357638782F413F4428472B4B6250', 'hex'); // "2s5v8x/A?D(G+KbP"

// Per-request CBC IV = global_half (8 bytes from this pool) + random 8 bytes.
// The 1-digit index of the chosen half is appended to the wire so the server
// can reconstruct the same IV when decrypting.
const GLOBAL_IV_HALVES = [
  '556A586E32723575',
  '34743777217A2543',
  '413F4428472B4B62',
  '48404D635166546A',
  '614E645267556B58',
  '655368566D597133',
] as const;

const BUNDLE_ID = 'in.gov.ecourts.eCourtsServices';

/**
 * Encrypt request params into the wire format the eCourts PHP endpoints expect:
 *   `<ran_hex(16)><iv_idx(1 digit)><base64_ciphertext>`
 * The IV is `Hex.parse(GLOBAL_IV_HALVES[iv_idx] + ran_hex)` (16 raw bytes).
 * Plaintext is `JSON.stringify({...params, uid: <bundleId>})`.
 */
export function encryptParams(params: Record<string, unknown>): string {
  const ivIdx = Math.floor(Math.random() * GLOBAL_IV_HALVES.length);
  const globalHalf = GLOBAL_IV_HALVES[ivIdx]!;
  const ranHex = randomBytes(8).toString('hex'); // 16 hex chars = 8 raw bytes
  const iv = Buffer.from(globalHalf + ranHex, 'hex');
  const cipher = createCipheriv('aes-128-cbc', REQUEST_KEY, iv);
  const plaintext = JSON.stringify({ ...params, uid: BUNDLE_ID });
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${ranHex}${ivIdx}${ct.toString('base64')}`;
}

/**
 * Decrypt a response body. Format:
 *   `<iv_hex(32)><base64_ciphertext>` (the `+` that occasionally appears at
 *   position 32 is a valid base64 char, not a separator).
 * The response key is different from the request key by design.
 */
export function decryptResponse(payload: string): string {
  const trimmed = payload.trim();
  if (trimmed.length < 33) {
    throw new Error(`eCourts response too short to decrypt (${trimmed.length} bytes)`);
  }
  const iv = Buffer.from(trimmed.slice(0, 32), 'hex');
  if (iv.length !== 16) {
    throw new Error('eCourts response IV did not decode to 16 bytes');
  }
  const ct = Buffer.from(trimmed.slice(32), 'base64');
  const decipher = createDecipheriv('aes-128-cbc', RESPONSE_KEY, iv);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString('utf8');
}
