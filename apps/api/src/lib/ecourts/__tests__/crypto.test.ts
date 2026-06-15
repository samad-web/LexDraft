import { describe, expect, it } from 'vitest';
import { decryptResponse, encryptParams } from '../crypto';

// These tests lock the wire format against the official eCourts Services
// Android app (in.gov.ecourts.eCourtsServices v4.0). Keys, IV pool, and the
// known-good response sample are documented in
// memory/project_ecourts_api_reverse_engineering.md.

describe('eCourts crypto', () => {
  it('decrypts a known eCourts response payload', () => {
    // Sample captured live by hitting `caseHistoryWebService.php` with a
    // garbage CNR and an empty Authorization header — server replies with
    // its standard "not in session" envelope under the response key.
    const sample = 'e2c68ae0641a8a16f04604325c75143f+hsgCyBVfCQLIxUBSF0cdNBjzrZfnW08csNxek7JvCE+JZGc3/KKuBRDpopB3sTHXuKbyv2yUhbp4muVi7wz/A==';
    const plain = decryptResponse(sample);
    expect(plain).toBe('{"status":"N","Msg":"Not in session ! auth_token = "}');
  });

  it('produces wire-format strings whose IV index is valid', () => {
    const wire = encryptParams({ cino: 'KLER010001682023' });
    // Format: <ran_hex(16)><iv_idx(1)><base64_ciphertext>
    expect(wire).toMatch(/^[0-9a-f]{16}[0-5]/);
    // Base64 of an AES block is at minimum 24 chars (one block + padding).
    expect(wire.length).toBeGreaterThan(16 + 1 + 24);
  });

  it('round-trips through the encrypt → decrypt boundary when keys match', () => {
    // We can't decrypt our own encrypt output here (request and response use
    // different keys) but we can prove that encryptParams produces structurally
    // valid output for repeated calls — each call should produce a new IV
    // (and therefore distinct ciphertext) even for identical input.
    const a = encryptParams({ cino: 'KLER010001682023' });
    const b = encryptParams({ cino: 'KLER010001682023' });
    expect(a).not.toBe(b);
    // But both share the wire shape:
    expect(a.slice(0, 16)).toMatch(/^[0-9a-f]{16}$/);
    expect(b.slice(0, 16)).toMatch(/^[0-9a-f]{16}$/);
    expect(a[16]).toMatch(/^[0-5]$/);
    expect(b[16]).toMatch(/^[0-5]$/);
  });

  it('rejects payloads too short to contain an IV', () => {
    expect(() => decryptResponse('abc')).toThrow(/too short/i);
  });

  it('rejects payloads whose IV slice is not valid hex', () => {
    // 32 chars of non-hex followed by some base64 — IV decode should yield
    // zero bytes and trip the explicit length guard.
    const bad = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzaaaa';
    expect(() => decryptResponse(bad)).toThrow(/IV/i);
  });
});
