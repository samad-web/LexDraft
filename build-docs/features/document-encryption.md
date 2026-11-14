# Document encryption at rest

## Purpose
Uploaded case documents sat on the server disk as plain files. Anyone with the disk or a backup could read them.

## Architecture
- `lib/field-crypto.ts`: `encryptFile` / `decryptFile` / `isEncryptedFile`. AES-256-GCM, same `FIELD_ENCRYPTION_KEY` as the PII columns.
- File layout: `DIFAIEN1` (8 bytes) | IV (12) | auth tag (16) | ciphertext. Fresh IV per write.
- `services/storage.service.ts` local driver: `putObject` encrypts before writing, `getObject` decrypts after reading. Every upload (signed PUT) and download (signed GET) and every server-side read goes through these two.
- `.meta` sidecar (content type only) stays plain.
- `scripts/encrypt-existing-uploads.ts`: one-time backfill, dry run by default, `--apply` to write. Encrypt → verify → temp file → verify → rename.

## Impact map
- Upload/download route `routes/uploads.routes.ts`: unchanged, calls the driver.
- 17 services use `storage()` (documents, templates, eFiling bundle, e-sign, land records…): they get decrypted bytes as before.
- S3/R2 driver: not changed (browser uploads straight to the bucket; use the provider's server-side encryption). Prod uses `local`.
- Key loss = every encrypted document is unreadable. Key must be backed up with the env file.

## Edge cases
- Legacy plaintext files (no magic header): returned as-is, so nothing breaks before the backfill.
- Tampered file or wrong key: GCM auth fails, read throws (500), altered bytes are never served.
- Production with no key: upload refused (error), never written in the clear. Dev without a key writes plaintext.
- Empty file: round-trips.

## Acceptance criteria
- A stored file on disk does not contain the document's text and starts with the magic header.
- Download returns the exact original bytes and content type.
- Old plaintext files still download.
- Tampered or wrong-key files are refused.
- Prod without key refuses the upload.
